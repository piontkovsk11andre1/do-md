import { SourceMap } from "./SourceMap.mjs";
import { SourceText } from "./SourceText.mjs";

// Identity is diagnostic-only. A module nonce separates bundled copies; the
// sequence guarantees distinct identities for compilations owned by this module.
const moduleId = Math.random().toString(36).slice(2);
let nextCompilation = 0;

/**
 * Translate literal runs and JS blocks in one pass. Segment offsets are recorded
 * when emitting code, so trimming delimiters/newlines never loses provenance.
 * Exact segments describe copied JS; generated literal calls retain whole spans.
 * @param {unknown} source @param {string} file
 */
export function compileTemplateSource(source, file) {
  const original = new SourceText(String(source ?? ""), file);
  const text = original.text;
  let code = "";
  /** @type {import('./SourceMap.mjs').SourceMapSegment[]} */
  const segments = [];
  /** @param {string} value @param {number} start @param {number} end @param {'exact' | 'range'} kind */
  const emit = (value, start, end, kind) => {
    if (!value.length) {
      return;
    }
    segments.push({
      generatedStart: code.length,
      generatedEnd: code.length + value.length,
      originalStart: start,
      originalEnd: end,
      kind,
    });
    code += value;
  };
  let literal = "";
  let literalStart = 0;
  let index = text.startsWith("\uFEFF") ? 1 : 0;
  const flushLiteral = () => {
    if (literal) {
      emit(`doc.literal(${JSON.stringify(literal)});\n`, literalStart, index, "range");
    }
    literal = "";
  };
  while (index < text.length) {
    if (text.startsWith("\\{%", index) || text.startsWith("\\%}", index)) {
      if (!literal) {
        literalStart = index;
      }
      literal += text.slice(index + 1, index + 3);
      index += 3;
    } else if (text.startsWith("{%", index)) {
      flushLiteral();
      index += 2;
      const close = text.indexOf("%}", index);
      let start = index;
      let end = close < 0 ? text.length : close;
      if (text.startsWith("\r\n", start)) {
        start += 2;
      } else if (text[start] === "\n" || text[start] === "\r") {
        start++;
      }
      if (end > start && text.slice(start, end).endsWith("\r\n")) {
        end -= 2;
      } else if (end > start && /[\r\n]/.test(text[end - 1])) {
        end--;
      }
      emit(text.slice(start, end), start, end, "exact");
      emit("\n", end, end, "range");
      index = close < 0 ? text.length : close + 2;
    } else {
      if (!literal) {
        literalStart = index;
      }
      literal += text[index++];
    }
  }
  flushLiteral();
  const generated = new SourceText(
    code,
    `generated:do-md/template-${moduleId}-${++nextCompilation}`,
  );
  return { code, sourceMap: new SourceMap({ generated, original, segments }) };
}
