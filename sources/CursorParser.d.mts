// Generated from checked JSDoc by npm run types. Do not edit.
import { SourceText } from "./SourceText.mjs";
import { Slot } from "./Slot.mjs";
export type CursorSnapshot = import("./types.d.mts").CursorSnapshot;
export type ReaderOptions = import("./types.d.mts").ReaderOptions;
export type BindingMode = import("./RuntimeContracts.d.mts").BindingMode;
export type LiteralToken =
  | {
      type: "spaces";
    }
  | {
      type: "newlines";
      count: number;
    }
  | {
      type: "text";
      value: string;
    };
/** Literal cursor kernel with one canonical offset.
 * @template {Record<string, unknown>} [TContext=Record<string, unknown>]
 */
export declare class CursorParser<
  TContext extends Record<string, unknown> = Record<string, unknown>,
> {
  #private;
  options: {
    [option: string]: unknown;
    sourceText?: import("./SourceText.mjs").SourceText;
    file?: string;
    path?: string;
  };
  diagnosticSource: SourceText;
  optionalMode: boolean;
  context: TContext;
  /** @type {import('./DoMdError.mjs').DoMdError[]} */
  errors: import("./DoMdError.mjs").DoMdError[];
  /** @type {Map<string, BindingMode>} */
  bindings: Map<string, BindingMode>;
  diagnosticOffsetBase: number;
  /** @internal */
  _callbackDepth: number;
  /** @returns {'reader'} */
  get mode(): "reader";
  /** @param {unknown} [source] @param {ReaderOptions} [options] */
  constructor(source?: unknown, options?: ReaderOptions);
  get sourceText(): SourceText;
  get inputSourceText(): string;
  get file(): string | null;
  get offset(): number;
  /** @param {number} value */
  set offset(value: number);
  get lineNumber(): number;
  get char(): number;
  get source(): unknown;
  /** @param {unknown} value */
  set source(value: unknown);
  get position(): number;
  /** @param {number} value */
  set position(value: number);
  /** Rewind a whole read session; moving only the cursor is seek()/position. */
  reset(): this;
  /** Replace input atomically and start a fresh session, including subclass metadata. */
  /** @param {unknown} source @param {{file?: string | null}} [options] */
  replaceSource(
    source: unknown,
    {
      file,
    }?: {
      file?: string | null;
    },
  ): this;
  /** @param {number} offset */
  seek(offset: number): this;
  remaining(): string;
  snapshotCursor(): import("./types.d.mts").CursorSnapshot;
  /** @param {CursorSnapshot} cursor */
  restoreCursor(cursor: CursorSnapshot): this;
  /** @param {number} end */
  advanceTo(end: number): this;
  required(): this;
  /** @param {unknown} msg */
  error(msg: unknown): import("./DoMdError.mjs").DoMdError;
  /** @param {unknown} literal */
  parse(literal: unknown): this;
  /** @param {RegExp | string} re */
  parseRegExp(re: RegExp | string): Slot<string>;
  /** @param {unknown} limiter */
  parseUntil(limiter: unknown): Slot<string>;
  allowWhitespaces(): this;
  allowNewlines(): this;
  allowNewlinesAndWhitespaces(): this;
  /** @param {Array<(parser: this) => unknown>} fns @returns {Slot<unknown>} */
  parseOneOf(...fns: Array<(parser: this) => unknown>): Slot<unknown>;
}
