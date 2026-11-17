/** @typedef {import('./types.d.mts').DiagnosticLocation} DiagnosticLocation */
/** @typedef {import('./types.d.mts').SourcePoint} SourcePoint */
/** @typedef {Omit<DiagnosticLocation, 'range'> & { range: { start: SourcePoint, end: SourcePoint | null } }} SourceLocation */

/**
 * Immutable text plus an index of line boundaries.
 *
 * Every offset is a UTF-16 index, including positions inside CRLF and surrogate
 * pairs. Line and column numbers are one-based; EOF is a valid point. Indexing
 * once avoids rescanning a document for every mapped error or edited slot.
 */
export class SourceText {
  /** @type {number[]} */
  #starts = [0];
  /** @type {number[]} */
  #ends = [];
  /** @type {string} */
  #text;
  /** @type {string | null} */
  #source;

  /** @param {string} text @param {string | null} [source] */
  constructor(text, source = null) {
    if (typeof text !== "string") {
      throw new TypeError("source text must be a string");
    }
    if (source !== null && typeof source !== "string") {
      throw new TypeError("source identifier must be a string or null");
    }
    this.#text = text;
    this.#source = source;
    for (let offset = 0; offset < text.length; offset++) {
      if (text[offset] !== "\r" && text[offset] !== "\n") {
        continue;
      }
      this.#ends.push(offset);
      if (text[offset] === "\r" && text[offset + 1] === "\n") {
        offset++;
      }
      this.#starts.push(offset + 1);
    }
    this.#ends.push(text.length);
    Object.freeze(this);
  }

  get text() {
    return this.#text;
  }
  get source() {
    return this.#source;
  }
  get length() {
    return this.#text.length;
  }
  get lineCount() {
    return this.#starts.length;
  }

  /** Resolve a valid offset in O(log lines), preserving UTF-16 columns. @param {number} offset */
  pointAt(offset) {
    if (!Number.isInteger(offset) || offset < 0 || offset > this.length) {
      throw new RangeError("invalid source offset");
    }
    let low = 0;
    let high = this.#starts.length;
    while (low + 1 < high) {
      const middle = (low + high) >>> 1;
      if (this.#starts[middle] <= offset) {
        low = middle;
      } else {
        high = middle;
      }
    }
    return { offset, line: low + 1, column: offset - this.#starts[low] + 1 };
  }

  /** Return null for an invalid coordinate; an offset on an EOL character is valid.
   * @param {number} line @param {number} column @returns {number | null}
   */
  offsetAt(line, column) {
    if (
      !Number.isInteger(line) ||
      line < 1 ||
      line > this.lineCount ||
      !Number.isInteger(column) ||
      column < 1
    ) {
      return null;
    }
    const offset = this.#starts[line - 1] + column - 1;
    const end = line < this.lineCount ? this.#starts[line] - 1 : this.length;
    return offset <= end ? offset : null;
  }

  /** Return a line without its terminator, or null if absent. @param {number} line */
  lineAt(line) {
    if (!Number.isInteger(line) || line < 1 || line > this.lineCount) {
      return null;
    }
    return this.#text.slice(this.#starts[line - 1], this.#ends[line - 1]);
  }

  /** Build a detached diagnostic location, never retaining the complete source.
   * @param {number} start @param {number | null} [end]
   * @param {Partial<Pick<DiagnosticLocation, 'role' | 'relation' | 'precision'>>} [options]
   * @returns {SourceLocation}
   */
  location(start, end = null, options = {}) {
    if (end != null && end < start) {
      throw new RangeError("range end precedes start");
    }
    const point = this.pointAt(start);
    return {
      role: options.role ?? "document",
      relation: options.relation ?? "origin",
      source: this.source,
      range: { start: point, end: end == null ? null : this.pointAt(end) },
      precision: options.precision ?? "exact",
      snippet: this.lineAt(point.line),
    };
  }
}
