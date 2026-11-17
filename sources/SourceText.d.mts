// Generated from checked JSDoc by npm run types. Do not edit.
/** @typedef {import('./types.d.mts').DiagnosticLocation} DiagnosticLocation */
/** @typedef {import('./types.d.mts').SourcePoint} SourcePoint */
/** @typedef {Omit<DiagnosticLocation, 'range'> & { range: { start: SourcePoint, end: SourcePoint | null } }} SourceLocation */
export type DiagnosticLocation = import("./types.d.mts").DiagnosticLocation;
export type SourcePoint = import("./types.d.mts").SourcePoint;
export type SourceLocation = Omit<DiagnosticLocation, "range"> & {
  range: {
    start: SourcePoint;
    end: SourcePoint | null;
  };
};
/**
 * Immutable text plus an index of line boundaries.
 *
 * Every offset is a UTF-16 index, including positions inside CRLF and surrogate
 * pairs. Line and column numbers are one-based; EOF is a valid point. Indexing
 * once avoids rescanning a document for every mapped error or edited slot.
 */
export declare class SourceText {
  #private;
  /** @param {string} text @param {string | null} [source] */
  constructor(text: string, source?: string | null);
  get text(): string;
  get source(): string | null;
  get length(): number;
  get lineCount(): number;
  /** Resolve a valid offset in O(log lines), preserving UTF-16 columns. @param {number} offset */
  pointAt(offset: number): {
    offset: number;
    line: number;
    column: number;
  };
  /** Return null for an invalid coordinate; an offset on an EOL character is valid.
   * @param {number} line @param {number} column @returns {number | null}
   */
  offsetAt(line: number, column: number): number | null;
  /** Return a line without its terminator, or null if absent. @param {number} line */
  lineAt(line: number): string | null;
  /** Build a detached diagnostic location, never retaining the complete source.
   * @param {number} start @param {number | null} [end]
   * @param {Partial<Pick<DiagnosticLocation, 'role' | 'relation' | 'precision'>>} [options]
   * @returns {SourceLocation}
   */
  location(
    start: number,
    end?: number | null,
    options?: Partial<Pick<DiagnosticLocation, "role" | "relation" | "precision">>,
  ): SourceLocation;
}
