import { CompiledTemplate, TEMPLATE_SOURCE_URL } from "./CompiledTemplate.mjs";
import { fromNativeError } from "./DoMdError.mjs";
import { addProcessingLocation } from "./Diagnostics.mjs";
export { TEMPLATE_SOURCE_URL } from "./CompiledTemplate.mjs";

/** Compile the document language; JS compilation occurs when execution is requested. */
export function compileTemplate(source, options) {
  return new CompiledTemplate(source, options);
}
export function renderBlocks(source) {
  return compileTemplate(source).code;
}

/** Execute user functions as well as compiled adapters using the same error boundary. */
export function runTemplate(fn, doc, context, data, options, io, templatePath) {
  try {
    return fn(doc, context, data, options ?? {}, io);
  } catch (error) {
    const diagnostic =
      typeof error?.toDiagnostic === "function"
        ? error
        : fromNativeError(error, { file: templatePath });
    throw addProcessingLocation(diagnostic, doc);
  }
}

/** User-authored template source. Compilation results own executable state. */
export class Template {
  constructor(source = "", { file = "template.js" } = {}) {
    this.source = String(source);
    this.file = file;
  }
  static get sourceDirective() {
    return TEMPLATE_SOURCE_URL;
  }
  static renderBlocks(source) {
    return renderBlocks(source);
  }
  static compile(source, options) {
    return compileTemplate(source, options);
  }
  static wrap(source, path = "template.js") {
    return compileTemplate(source, { file: path }).toFunction();
  }
  static compilation(fn) {
    return CompiledTemplate.forFunction(fn);
  }
  renderBlocks() {
    return this.compile().code;
  }
  compile() {
    return compileTemplate(this.source, { file: this.file });
  }
  wrap() {
    return this.compile().toFunction();
  }
}
