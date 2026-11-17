import { parse } from "acorn";
import { compileTemplateSource } from "./TemplateCompiler.mjs";
import { addProcessingLocation, diagnosticDocument } from "./Diagnostics.mjs";
import { makeTemplateError, isDiagnosticError, errorMessage, errorStack } from "./DoMdError.mjs";
import { generatedOffset } from "./StackTrace.mjs";
import { mapDiagnostic } from "./SourceMap.mjs";

export const TEMPLATE_SOURCE_URL = "//# sourceURL=";
/** Input types are erased contravariantly; typed adapters recover their own T. */
/** @type {WeakMap<Function, CompiledTemplate<never>>} */
const compilations = new WeakMap();

/**
 * Owns a translation, its unique generated source, and the lazily compiled JS.
 * execute() is synchronous, just like the template language. Function adapters
 * retain this owner; metadata lookup is only an adapter convenience.
 * @template {Record<string, unknown>} [TContext=Record<string, unknown>]
 */
export class CompiledTemplate {
  #code;
  #sourceMap;
  /** @type {import('./types.d.mts').TemplateFunction<TContext> | null} */
  #executable = null;
  /** @type {import('./types.d.mts').TemplateFunction<TContext> | null} */
  #adapter = null;

  /** @param {unknown} source @param {{ file?: string }} [options] */
  constructor(source, { file = "template.js" } = {}) {
    const compiled = compileTemplateSource(source, file);
    this.#code = compiled.code;
    this.#sourceMap = compiled.sourceMap;
  }
  get code() {
    return this.#code;
  }
  get sourceMap() {
    return this.#sourceMap;
  }

  /** Inspecting generated code is allowed even for an invalid JS body. */
  #prepare() {
    if (this.#executable) {
      return this.#executable;
    }
    try {
      this.#executable = /** @type {import('./types.d.mts').TemplateFunction<TContext>} */ (
        new Function(
          "doc",
          "ctx",
          "data",
          "options",
          "io",
          `${this.code}\n${TEMPLATE_SOURCE_URL}${this.sourceMap.generated.source}`,
        )
      );
    } catch (cause) {
      if (cause instanceof EvalError) {
        throw makeTemplateError(
          "Template execution requires dynamic JavaScript compilation (new Function); this environment blocks it. Check the page Content Security Policy or runtime code-generation policy.",
          { cause },
        );
      }
      let message = errorMessage(cause);
      /** @type {import('./types.d.mts').DiagnosticLocation[]} */
      let locations = [];
      // Acorn runs only after the engine rejects compilation. The function wrapper
      // preserves return/parameter grammar; its prefix is excluded from mapping.
      const prefix = "function template(doc,ctx,data,options,io){\n";
      try {
        parse(`${prefix}${this.code}\n}`, { ecmaVersion: "latest", sourceType: "script" });
      } catch (syntax) {
        if (
          syntax instanceof SyntaxError &&
          "pos" in syntax &&
          typeof syntax.pos === "number" &&
          syntax.pos >= prefix.length
        ) {
          const offset = syntax.pos - prefix.length;
          message = syntax.message.replace(/ \(\d+:\d+\)$/, "");
          const location = this.sourceMap.generated.location(
            Math.min(offset, this.code.length),
            null,
            { role: "generated" },
          );
          locations = mapDiagnostic(
            { code: "DO_MD_TEMPLATE_ERROR", message, locations: [location] },
            this.sourceMap,
            { role: "template" },
          ).locations;
        }
      }
      throw makeTemplateError(message, { cause, locations });
    }
    return this.#executable;
  }

  /** Add this compilation's origin once, preserving causes and inner origins. */
  /** @param {unknown} error */
  #mapError(error) {
    const isDiagnostic = isDiagnosticError(error);
    const result = isDiagnostic ? error : makeTemplateError(errorMessage(error), { cause: error });
    if (result.locations.some((location) => location.source === this.sourceMap.generated.source)) {
      return result;
    }
    const causeOffset = isDiagnostic
      ? generatedOffset(errorStack(error.cause), this.sourceMap.generated)
      : null;
    const offset = causeOffset ?? generatedOffset(errorStack(error), this.sourceMap.generated);
    if (offset == null) {
      return result;
    }
    result.locations.push(this.sourceMap.generated.location(offset, null, { role: "generated" }));
    result.locations = mapDiagnostic(result, this.sourceMap, { role: "template" }).locations;
    return result;
  }

  /** Execute once against the caller's Reader/Writer; accumulated mismatches also get origins. */
  /** @param {unknown} doc @param {TContext} context @param {TContext | null} data
   * @param {Record<string, unknown>} [options] @param {import('./types.d.mts').IOAdapter} [io] */
  execute(doc, context, data, options = {}, io) {
    const executable = this.#prepare();
    const document = diagnosticDocument(doc);
    try {
      const invoke = () => executable(doc, context, data, options, io);
      return document?.withReadSession ? document.withReadSession(invoke) : invoke();
    } catch (error) {
      throw addProcessingLocation(this.#mapError(error), document);
    } finally {
      for (const error of document?.errors ?? []) {
        this.#mapError(error);
      }
    }
  }

  /** Produce the existing five-argument template function without duplicating ownership. */
  toFunction() {
    this.#prepare();
    if (!this.#adapter) {
      this.#adapter = (doc, context, data, options, io) =>
        this.execute(doc, context, data, options, io);
      compilations.set(this.#adapter, this);
    }
    return this.#adapter;
  }

  /** @template {Record<string, unknown>} T @overload
   * @param {import('./types.d.mts').TemplateFunction<T>} fn @returns {CompiledTemplate<T> | null} */
  /** @overload @param {Function} fn @returns {CompiledTemplate<never> | null} */
  /** @param {Function} fn @returns {CompiledTemplate<never> | null} */
  static forFunction(fn) {
    return compilations.get(fn) ?? null;
  }
}
