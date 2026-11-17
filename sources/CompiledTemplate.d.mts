// Generated from checked JSDoc by npm run types. Do not edit.
export declare const TEMPLATE_SOURCE_URL = "//# sourceURL=";
/**
 * Owns a translation, its unique generated source, and the lazily compiled JS.
 * execute() is synchronous, just like the template language. Function adapters
 * retain this owner; metadata lookup is only an adapter convenience.
 * @template {Record<string, unknown>} [TContext=Record<string, unknown>]
 */
export declare class CompiledTemplate<
  TContext extends Record<string, unknown> = Record<string, unknown>,
> {
  #private;
  /** @param {unknown} source @param {{ file?: string }} [options] */
  constructor(
    source: unknown,
    {
      file,
    }?: {
      file?: string;
    },
  );
  get code(): string;
  get sourceMap(): import("./SourceMap.mjs").SourceMap;
  /** Execute once against the caller's Reader/Writer; accumulated mismatches also get origins. */
  /** @param {unknown} doc @param {TContext} context @param {TContext | null} data
   * @param {Record<string, unknown>} [options] @param {import('./types.d.mts').IOAdapter} [io] */
  execute(
    doc: unknown,
    context: TContext,
    data: TContext | null,
    options?: Record<string, unknown>,
    io?: import("./types.d.mts").IOAdapter,
  ): unknown;
  /** Produce the existing five-argument template function without duplicating ownership. */
  toFunction(): import("./types.d.mts").TemplateFunction<TContext>;
  /** @template {Record<string, unknown>} T @overload
   * @param {import('./types.d.mts').TemplateFunction<T>} fn @returns {CompiledTemplate<T> | null} */
  /** @overload @param {Function} fn @returns {CompiledTemplate<never> | null} */
  /** @param {Function} fn @returns {CompiledTemplate<never> | null} */
  static forFunction<T extends Record<string, unknown>>(
    fn: import("./types.d.mts").TemplateFunction<T>,
  ): CompiledTemplate<T> | null;
  /** @template {Record<string, unknown>} T @overload
   * @param {import('./types.d.mts').TemplateFunction<T>} fn @returns {CompiledTemplate<T> | null} */
  /** @overload @param {Function} fn @returns {CompiledTemplate<never> | null} */
  /** @param {Function} fn @returns {CompiledTemplate<never> | null} */
  static forFunction(fn: Function): CompiledTemplate<never> | null;
}
