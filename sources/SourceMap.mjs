import { SourceText } from "./SourceText.mjs";
import { sameLocation } from "./Diagnostics.mjs";

/** @typedef {import('./types.d.mts').Diagnostic} Diagnostic */
/** @typedef {import('./types.d.mts').DiagnosticLocation} DiagnosticLocation */
/** @typedef {import('./SourceText.mjs').SourceLocation} SourceLocation */
/** @typedef {{ generatedStart: number, generatedEnd: number, originalStart: number, originalEnd: number, kind: 'exact' | 'range' }} SourceMapSegment */
/** @typedef {{ source: string | null, text: string }} MapSource */
/** @typedef {{ generated: MapSource, original: MapSource, segments: readonly SourceMapSegment[] }} SourceMapDefinition */

/**
 * Immutable, validated mapping between two sources.
 *
 * Generated segments are sorted, disjoint, half-open ranges. Exact segments
 * preserve character offsets; range segments retain a whole provenance span.
 * Gaps deliberately have no origin. This richer range precision is why the
 * internal format is not a point-only Source Map v3/VLQ table.
 */
export class SourceMap {
  /** @type {SourceText} */
  #generated;
  /** @type {SourceText} */
  #original;
  /** @type {readonly Readonly<SourceMapSegment>[]} */
  #segments;

  /** Validate once at construction; mappings can subsequently trust the segments.
   * @param {SourceMapDefinition} definition
   */
  constructor({ generated, original, segments }) {
    for (const input of [generated, original]) {
      if (typeof input?.source !== "string" || typeof input.text !== "string") {
        throw new TypeError("source maps require source identifiers and text");
      }
    }
    this.#generated =
      generated instanceof SourceText
        ? generated
        : new SourceText(generated.text, generated.source);
    this.#original =
      original instanceof SourceText ? original : new SourceText(original.text, original.source);
    let previousEnd = 0;
    this.#segments = Object.freeze(
      segments.map((segment) => {
        const { generatedStart, generatedEnd, originalStart, originalEnd, kind } = segment;
        const offsets = [generatedStart, generatedEnd, originalStart, originalEnd];
        if (
          !offsets.every(Number.isInteger) ||
          generatedStart < previousEnd ||
          generatedEnd < generatedStart ||
          generatedEnd > generated.text.length ||
          originalStart < 0 ||
          originalEnd < originalStart ||
          originalEnd > original.text.length ||
          !["exact", "range"].includes(kind) ||
          (kind === "exact" && generatedEnd - generatedStart !== originalEnd - originalStart)
        ) {
          throw new RangeError("invalid source-map segment");
        }
        previousEnd = generatedEnd;
        return Object.freeze({ generatedStart, generatedEnd, originalStart, originalEnd, kind });
      }),
    );
    Object.freeze(this);
  }

  get generated() {
    return this.#generated;
  }
  get original() {
    return this.#original;
  }
  get segments() {
    return this.#segments;
  }

  /** First segment whose end is after offset. @param {number} offset */
  #indexAt(offset) {
    let low = 0;
    let high = this.#segments.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (this.#segments[middle].generatedEnd <= offset) {
        low = middle + 1;
      } else {
        high = middle;
      }
    }
    return low;
  }

  /** Map a point, including EOF only when the final segment reaches it.
   * @param {number} offset @returns {SourceLocation | null}
   */
  mapPosition(offset) {
    if (!Number.isInteger(offset) || offset < 0 || offset > this.generated.length) {
      return null;
    }
    const segment =
      offset === this.generated.length
        ? this.#segments.findLast((entry) => entry.generatedEnd === offset)
        : this.#segments[this.#indexAt(offset)];
    if (!segment || offset < segment.generatedStart) {
      return null;
    }
    const start =
      segment.kind === "exact"
        ? segment.originalStart + offset - segment.generatedStart
        : segment.originalStart;
    return this.original.location(start, segment.kind === "range" ? segment.originalEnd : null, {
      precision: segment.kind,
    });
  }

  /**
   * Map every covered segment. A gap or backwards origin makes the span unmappable;
   * removed intervening source text broadens precision rather than claiming exactness.
   * @param {{ start: number, end?: number | null }} range @returns {SourceLocation | null}
   */
  mapRange({ start, end = null }) {
    const first = this.mapPosition(start);
    if (!first || end == null) {
      return first;
    }
    if (end === start) {
      if (first.precision === "exact") {
        first.range.end = this.original.pointAt(first.range.start.offset);
      }
      return first;
    }
    if (!Number.isInteger(end) || end < start || end > this.generated.length) {
      return null;
    }
    let cursor = start;
    let lastEnd = first.range.start.offset;
    /** @type {'exact' | 'range'} */
    let precision = "exact";
    for (let index = this.#indexAt(start); index < this.#segments.length; index++) {
      const segment = this.#segments[index];
      if (segment.generatedStart >= end) {
        break;
      }
      if (segment.generatedStart > cursor) {
        return null;
      }
      const from = Math.max(cursor, segment.generatedStart);
      const to = Math.min(end, segment.generatedEnd);
      const originalStart =
        segment.kind === "exact"
          ? segment.originalStart + from - segment.generatedStart
          : segment.originalStart;
      const originalEnd =
        segment.kind === "exact"
          ? segment.originalStart + to - segment.generatedStart
          : segment.originalEnd;
      if (
        originalStart < lastEnd &&
        !(segment.kind === "range" && originalStart === first.range.start.offset)
      ) {
        return null;
      }
      if (segment.kind === "range" || originalStart !== lastEnd) {
        precision = "range";
      }
      lastEnd = originalEnd;
      cursor = to;
    }
    return cursor === end
      ? this.original.location(first.range.start.offset, lastEnd, { precision })
      : null;
  }

  /** Compose through a shared source; split exact segments at outer boundaries.
   * @param {SourceMap} outer @returns {SourceMap}
   */
  compose(outer) {
    if (
      this.original.source !== outer.generated.source ||
      this.original.text !== outer.generated.text
    ) {
      throw new TypeError("source maps do not share the same intermediate source");
    }
    /** @type {SourceMapSegment[]} */
    const segments = [];
    for (const innerSegment of this.#segments) {
      if (innerSegment.kind === "range") {
        const mapped = outer.mapRange({
          start: innerSegment.originalStart,
          end: innerSegment.originalEnd,
        });
        if (mapped) {
          segments.push({
            ...innerSegment,
            originalStart: mapped.range.start.offset,
            originalEnd: mapped.range.end?.offset ?? mapped.range.start.offset,
            kind: "range",
          });
        }
        continue;
      }
      for (
        let index = outer.#indexAt(innerSegment.originalStart);
        index < outer.#segments.length;
        index++
      ) {
        const outerSegment = outer.#segments[index];
        if (outerSegment.generatedStart >= innerSegment.originalEnd) {
          break;
        }
        const from = Math.max(innerSegment.originalStart, outerSegment.generatedStart);
        const to = Math.min(innerSegment.originalEnd, outerSegment.generatedEnd);
        if (from >= to) {
          continue;
        }
        segments.push({
          generatedStart: innerSegment.generatedStart + from - innerSegment.originalStart,
          generatedEnd: innerSegment.generatedStart + to - innerSegment.originalStart,
          originalStart:
            outerSegment.kind === "exact"
              ? outerSegment.originalStart + from - outerSegment.generatedStart
              : outerSegment.originalStart,
          originalEnd:
            outerSegment.kind === "exact"
              ? outerSegment.originalStart + to - outerSegment.generatedStart
              : outerSegment.originalEnd,
          kind: outerSegment.kind,
        });
      }
    }
    return new SourceMap({ generated: this.generated, original: outer.original, segments });
  }
}

/** Coordinate convenience for a one-off string. Reuse SourceText for repeated lookups.
 * @param {string} text @param {number} offset
 */
export function sourcePoint(text, offset) {
  return new SourceText(text).pointAt(offset);
}
/** @param {string} text @param {{ line: number, column: number }} point */
export function sourceOffset(text, { line, column }) {
  return new SourceText(text).offsetAt(line, column);
}
/** @param {string | null} source @param {string} text @param {number} start @param {number | null} [end]
 * @param {Partial<Pick<DiagnosticLocation, 'role' | 'relation' | 'precision'>>} [options]
 */
export function sourceLocation(source, text, start, end = null, options = {}) {
  return new SourceText(text, source).location(start, end, options);
}
/** @param {SourceMapDefinition} definition */
export function createSourceMap(definition) {
  return new SourceMap(definition);
}
/** @param {SourceMap} map @param {number} offset */
export function mapPosition(map, offset) {
  return map.mapPosition(offset);
}
/** @param {SourceMap} map @param {{ start: number, end?: number | null }} range */
export function mapRange(map, range) {
  return map.mapRange(range);
}
/** @param {SourceMap} inner @param {SourceMap} outer */
export function composeSourceMaps(inner, outer) {
  return inner.compose(outer);
}

/** Extend a serialized diagnostic without mutating it or increasing precision.
 * @param {Diagnostic | { toDiagnostic(): Diagnostic }} diagnostic @param {SourceMap} map
 * @param {{ role?: DiagnosticLocation['role'] }} [options] @returns {Diagnostic}
 */
export function mapDiagnostic(diagnostic, map, { role = "document" } = {}) {
  const result = structuredClone(
    "toDiagnostic" in diagnostic ? diagnostic.toDiagnostic() : diagnostic,
  );
  const candidates = [...result.locations]
    .reverse()
    .filter((location) => location.source === map.generated.source);
  for (const location of candidates) {
    const start =
      location.range.start.offset ??
      map.generated.offsetAt(location.range.start.line, location.range.start.column);
    const end = location.range.end == null ? null : location.range.end.offset;
    if (start == null) {
      continue;
    }
    const mapped = map.mapRange({ start, end });
    if (!mapped) {
      continue;
    }
    mapped.role = role;
    mapped.relation = location.relation;
    if (location.precision !== "exact") {
      mapped.precision = location.precision;
    }
    if (!result.locations.some((existing) => sameLocation(existing, mapped))) {
      result.locations.push(mapped);
    }
    break;
  }
  return result;
}
