import { CursorParser } from "./CursorParser.mjs";

/** Low-level literal parser. Reader shares the cursor kernel, not this leaf API.
 * @template {Record<string, unknown>} [TContext=Record<string, unknown>]
 * @extends {CursorParser<TContext>}
 */
export class Parser extends CursorParser {
  get line() {
    return this.lineNumber;
  }
  optional() {
    this.optionalMode = true;
    return this;
  }
  /** @param {(parser: this) => unknown} fn */
  repeat(fn) {
    return this._repeatSlots(fn);
  }
}
