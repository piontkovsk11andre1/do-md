// Generated from checked JSDoc by npm run types. Do not edit.
import { CompiledTemplate } from "./CompiledTemplate.mjs";
export { TEMPLATE_SOURCE_URL } from "./CompiledTemplate.mjs";
/** Compile the document language; JS compilation occurs when execution is requested. */
/** @param {unknown} source @param {{ file?: string }} [options] */
export declare function compileTemplate(
  source: unknown,
  options?: {
    file?: string;
  },
): CompiledTemplate<Record<string, unknown>>;
/** @param {unknown} source */
export declare function renderBlocks(source: unknown): string;
/** Execute user functions as well as compiled adapters using the same error boundary. */
/** @template {Record<string, unknown>} T
 * @param {import('./types.d.mts').TemplateFunction<T>} fn @param {unknown} doc @param {T} context
 * @param {T | null} data @param {Record<string, unknown> | undefined} options
 * @param {import('./types.d.mts').IOAdapter | undefined} io @param {string} templatePath */
export declare function runTemplate<T extends Record<string, unknown>>(
  fn: import("./types.d.mts").TemplateFunction<T>,
  doc: unknown,
  context: T,
  data: T | null,
  options: Record<string, unknown> | undefined,
  io: import("./types.d.mts").IOAdapter | undefined,
  templatePath: string,
): unknown;
/** User-authored template source. Compilation results own executable state. */
export declare class Template {
  source: string;
  file: string;
  /** @param {unknown} [source] @param {{ file?: string }} [options] */
  constructor(
    source?: unknown,
    {
      file,
    }?: {
      file?: string;
    },
  );
  static get sourceDirective(): string;
  /** @param {unknown} source */
  static renderBlocks(source: unknown): string;
  /** @param {unknown} source @param {{ file?: string }} [options] */
  static compile(
    source: unknown,
    options?: {
      file?: string;
    },
  ): CompiledTemplate<Record<string, unknown>>;
  /** @template {Record<string, unknown>} [T=Record<string, unknown>]
   * @param {unknown} source @param {string} [path] @returns {import('./types.d.mts').TemplateFunction<T>} */
  static wrap<T extends Record<string, unknown> = Record<string, unknown>>(
    source: unknown,
    path?: string,
  ): import("./types.d.mts").TemplateFunction<T>;
  /** @template {Record<string, unknown>} T @overload
   * @param {import('./types.d.mts').TemplateFunction<T>} fn @returns {CompiledTemplate<T> | null} */
  /** @overload @param {Function} fn @returns {CompiledTemplate<never> | null} */
  /** @param {Function} fn @returns {CompiledTemplate<never> | null} */
  static compilation<T extends Record<string, unknown>>(
    fn: import("./types.d.mts").TemplateFunction<T>,
  ): CompiledTemplate<T> | null;
  /** @template {Record<string, unknown>} T @overload
   * @param {import('./types.d.mts').TemplateFunction<T>} fn @returns {CompiledTemplate<T> | null} */
  /** @overload @param {Function} fn @returns {CompiledTemplate<never> | null} */
  /** @param {Function} fn @returns {CompiledTemplate<never> | null} */
  static compilation(fn: Function): CompiledTemplate<never> | null;
  renderBlocks(): string;
  compile(): CompiledTemplate<Record<string, unknown>>;
  /** @template {Record<string, unknown>} [T=Record<string, unknown>]
   * @returns {import('./types.d.mts').TemplateFunction<T>} */
  wrap<
    T extends Record<string, unknown> = Record<string, unknown>,
  >(): import("./types.d.mts").TemplateFunction<T>;
}
