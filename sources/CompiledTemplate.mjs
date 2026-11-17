import { parse } from "acorn";
import { compileTemplateSource } from "./TemplateCompiler.mjs";
import { addProcessingLocation } from "./Diagnostics.mjs";
import { makeTemplateError } from "./DoMdError.mjs";
import { generatedOffset } from "./StackTrace.mjs";
import { mapDiagnostic } from "./SourceMap.mjs";

export const TEMPLATE_SOURCE_URL = "//# sourceURL=";
const compilations = new WeakMap();

/**
 * Owns a translation, its unique generated source, and the lazily compiled JS.
 * execute() is synchronous, just like the template language. Function adapters
 * retain this owner; metadata lookup is only an adapter convenience.
 */
export class CompiledTemplate {
  #code;
  #sourceMap;
  #executable = null;
  #adapter = null;

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
      this.#executable = new Function(
        "doc",
        "ctx",
        "data",
        "options",
        "io",
        `${this.code}\n${TEMPLATE_SOURCE_URL}${this.sourceMap.generated.source}`,
      );
    } catch (cause) {
      let message = cause.message;
      let locations = [];
      // Acorn runs only after the engine rejects compilation. The function wrapper
      // preserves return/parameter grammar; its prefix is excluded from mapping.
      const prefix = "function template(doc,ctx,data,options,io){\n";
      try {
        parse(`${prefix}${this.code}\n}`, { ecmaVersion: "latest", sourceType: "script" });
      } catch (syntax) {
        const offset = syntax.pos - prefix.length;
        if (offset >= 0) {
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
  #mapError(error) {
    const isDiagnostic = typeof error?.toDiagnostic === "function";
    const result = isDiagnostic
      ? error
      : makeTemplateError(error?.message ?? String(error), { cause: error });
    if (result.locations.some((location) => location.source === this.sourceMap.generated.source)) {
      return result;
    }
    const causeOffset = isDiagnostic
      ? generatedOffset(error.cause?.stack, this.sourceMap.generated)
      : null;
    const offset = causeOffset ?? generatedOffset(error?.stack, this.sourceMap.generated);
    if (offset == null) {
      return result;
    }
    result.locations.push(this.sourceMap.generated.location(offset, null, { role: "generated" }));
    result.locations = mapDiagnostic(result, this.sourceMap, { role: "template" }).locations;
    return result;
  }

  /** Execute once against the caller's Reader/Writer; accumulated mismatches also get origins. */
  execute(doc, context, data, options = {}, io) {
    const executable = this.#prepare();
    try {
      return executable(doc, context, data, options, io);
    } catch (error) {
      throw addProcessingLocation(this.#mapError(error), doc);
    } finally {
      for (const error of doc?.errors ?? []) {
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

  static forFunction(fn) {
    return compilations.get(fn) ?? null;
  }
}
