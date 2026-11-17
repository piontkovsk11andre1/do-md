import { parse } from "acorn";
import { randomUUID } from "node:crypto";
import { addProcessingLocation, fromNativeError, locationFromStack, makeTemplateError } from "./SyntaxError.mjs";
import { createSourceMap, mapDiagnostic, sourceLocation, sourceOffset } from "./SourceMap.mjs";

export const TEMPLATE_SOURCE_URL = "//# sourceURL=";
const metadata = new WeakMap();

export function compileTemplate(source, { file = "template.js" } = {}) {
  const text = String(source ?? "");
  const generated = `generated:do-md/template-${randomUUID()}`;
  let code = "";
  const segments = [];
  const emit = (value, start, end, kind) => {
    if (!value.length) return;
    segments.push({ generatedStart: code.length, generatedEnd: code.length + value.length,
      originalStart: start, originalEnd: end, kind });
    code += value;
  };
  let literal = "";
  let literalStart = 0;
  let index = text.startsWith("\uFEFF") ? 1 : 0;
  const flushLiteral = () => {
    if (literal) emit(`doc.literal(${JSON.stringify(literal)});\n`, literalStart, index, "range");
    literal = "";
  };
  while (index < text.length) {
    if (text.startsWith("\\{%", index) || text.startsWith("\\%}", index)) {
      if (!literal) literalStart = index;
      literal += text.slice(index + 1, index + 3);
      index += 3;
    } else if (text.startsWith("{%", index)) {
      flushLiteral();
      index += 2;
      const close = text.indexOf("%}", index);
      let start = index;
      let end = close < 0 ? text.length : close;
      if (text.startsWith("\r\n", start)) start += 2;
      else if (text[start] === "\n" || text[start] === "\r") start++;
      if (end > start && text.slice(start, end).endsWith("\r\n")) end -= 2;
      else if (end > start && /[\r\n]/.test(text[end - 1])) end--;
      emit(text.slice(start, end), start, end, "exact");
      emit("\n", end, end, "range");
      index = close < 0 ? text.length : close + 2;
    } else {
      if (!literal) literalStart = index;
      literal += text[index++];
    }
  }
  flushLiteral();
  return { code, sourceMap: createSourceMap({ generated: { source: generated, text: code },
    original: { source: String(file), text }, segments }) };
}

export function renderBlocks(source) {
  return compileTemplate(source).code;
}

function mapExecutionError(error, compiled) {
  const isDiagnostic = typeof error?.toDiagnostic === "function";
  const result = isDiagnostic ? error : makeTemplateError(error?.message ?? String(error), { cause: error });
  const id = compiled.sourceMap.generated.source;
  if (result.locations.some((l) => l.source === id)) return result;
  const causeFrame = isDiagnostic && error?.cause?.stack ? locationFromStack(error.cause.stack, id) : null;
  const frame = causeFrame?.file === id ? causeFrame : locationFromStack(error?.stack, id);
  if (frame.file !== id) return result;
  // V8's Function constructor adds two wrapper lines before the supplied body.
  const offset = sourceOffset(compiled.code, { line: frame.line - 2, column: frame.column });
  if (offset == null) return result;
  result.locations.push(sourceLocation(id, compiled.code, offset, null, { role: "generated" }));
  result.locations = mapDiagnostic(result, compiled.sourceMap, { role: "template" }).locations;
  return result;
}

export function runTemplate(fn, doc, ctx, data, options, io, templatePath) {
  try {
    return fn(doc, ctx, data, options ?? {}, io);
  } catch (error) {
    const diagnostic = typeof error?.toDiagnostic === "function" ? error : fromNativeError(error, { file: templatePath });
    throw addProcessingLocation(diagnostic, doc);
  }
}

export class Template {
  constructor(source = "", { file = "template.js" } = {}) {
    this.source = String(source);
    this.file = file;
  }

  static get sourceDirective() { return TEMPLATE_SOURCE_URL; }
  static renderBlocks(source) { return renderBlocks(source); }
  static compile(source, options) { return compileTemplate(source, options); }

  static wrap(source, path = "template.js") {
    const compiled = compileTemplate(source, { file: path });
    let fn;
    try {
      fn = new Function("doc", "ctx", "data", "options", "io", `${compiled.code}\n${TEMPLATE_SOURCE_URL}${compiled.sourceMap.generated.source}`);
    } catch (cause) {
      const error = makeTemplateError(cause?.message ?? String(cause), { cause });
      // Parse only failures. The wrapper gives return and parameters the same grammar as Function.
      const prefix = "function template(doc,ctx,data,options,io){\n";
      try {
        parse(`${prefix}${compiled.code}\n}`, { ecmaVersion: "latest", sourceType: "script" });
      } catch (syntax) {
        const offset = syntax.pos - prefix.length;
        if (offset >= 0) {
          const point = Math.min(offset, compiled.code.length);
          error.message = syntax.message.replace(/ \(\d+:\d+\)$/, "");
          error.locations.push(sourceLocation(compiled.sourceMap.generated.source, compiled.code, point, null, { role: "generated" }));
          error.locations = mapDiagnostic(error, compiled.sourceMap, { role: "template" }).locations;
        }
      }
      throw error;
    }
    const wrapped = function (doc, ctx, data, options, io) {
      try {
        return fn(doc, ctx, data, options, io);
      } catch (error) {
        throw addProcessingLocation(mapExecutionError(error, compiled), doc);
      } finally {
        // Reader mismatches may be accumulated instead of thrown.
        for (const error of doc?.errors ?? []) mapExecutionError(error, compiled);
      }
    };
    metadata.set(wrapped, compiled);
    return wrapped;
  }

  static compilation(fn) { return metadata.get(fn) ?? null; }
  renderBlocks() { return renderBlocks(this.source); }
  compile() { return compileTemplate(this.source, { file: this.file }); }
  wrap() { return Template.wrap(this.source, this.file); }
}
