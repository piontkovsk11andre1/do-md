// Generated from checked JSDoc by npm run types. Do not edit.
import { CursorParser } from "./CursorParser.mjs";
/** Low-level literal parser. Reader shares the cursor kernel, not this leaf API.
 * @template {Record<string, unknown>} [TContext=Record<string, unknown>]
 * @extends {CursorParser<TContext>}
 */
export declare class Parser<
  TContext extends Record<string, unknown> = Record<string, unknown>,
> extends CursorParser<TContext> {
  get line(): number;
  optional(): this;
  /** @param {(parser: this) => unknown} fn */
  repeat(fn: (parser: this) => unknown): import("./Slot.mjs").Slot<unknown>[];
}
