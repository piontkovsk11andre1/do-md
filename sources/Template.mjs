import { CompiledTemplate, TEMPLATE_SOURCE_URL } from "./CompiledTemplate.mjs";
import { fromNativeError, isDiagnosticError } from "./DoMdError.mjs";
import { addProcessingLocation, diagnosticDocument } from "./Diagnostics.mjs";
export { TEMPLATE_SOURCE_URL } from "./CompiledTemplate.mjs";

/** Compile the document language; JS compilation occurs when execution is requested. */
/** @param {unknown} source @param {{ file?: string }} [options] */
export function compileTemplate(source, options) {
  return new CompiledTemplate(source, options);
}
/** @param {unknown} source */
export function renderBlocks(source) {
  return compileTemplate(source).code;
}

/** Execute user functions as well as compiled adapters using the same error boundary. */
/** @template {Record<string, unknown>} T
 * @param {import('./types.d.mts').TemplateFunction<T>} fn @param {unknown} doc @param {T} context
 * @param {T | null} data @param {Record<string, unknown> | undefined} options
 * @param {import('./types.d.mts').IOAdapter | undefined} io @param {string} templatePath */
export function runTemplate(fn, doc, context, data, options, io, templatePath) {
  const document = diagnosticDocument(doc);
  try {
    const invoke = () => fn(doc, context, data, options ?? {}, io);
    return document?.withReadSession ? document.withReadSession(invoke) : invoke();
  } catch (error) {
    const diagnostic = isDiagnosticError(error)
      ? error
      : fromNativeError(error, { file: templatePath });
    throw addProcessingLocation(diagnostic, document);
  }
}

/** User-authored template source. Compilation results own executable state. */
export class Template {
  /** @param {unknown} [source] @param {{ file?: string }} [options] */
  constructor(source = "", { file = "template.js" } = {}) {
    this.source = String(source);
    this.file = file;
  }
  static get sourceDirective() {
    return TEMPLATE_SOURCE_URL;
  }
  /** @param {unknown} source */
  static renderBlocks(source) {
    return renderBlocks(source);
  }
  /** @param {unknown} source @param {{ file?: string }} [options] */
  static compile(source, options) {
    return compileTemplate(source, options);
  }
  /** @template {Record<string, unknown>} [T=Record<string, unknown>]
   * @param {unknown} source @param {string} [path] @returns {import('./types.d.mts').TemplateFunction<T>} */
  static wrap(source, path = "template.js") {
    return compileTemplate(source, { file: path }).toFunction();
  }
  /** @template {Record<string, unknown>} T @overload
   * @param {import('./types.d.mts').TemplateFunction<T>} fn @returns {CompiledTemplate<T> | null} */
  /** @overload @param {Function} fn @returns {CompiledTemplate<never> | null} */
  /** @param {Function} fn @returns {CompiledTemplate<never> | null} */
  static compilation(fn) {
    return CompiledTemplate.forFunction(fn);
  }
  renderBlocks() {
    return this.compile().code;
  }
  compile() {
    return compileTemplate(this.source, { file: this.file });
  }
  /** @template {Record<string, unknown>} [T=Record<string, unknown>]
   * @returns {import('./types.d.mts').TemplateFunction<T>} */
  wrap() {
    return Template.wrap(this.source, this.file);
  }
}
