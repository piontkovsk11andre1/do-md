// Coordinates use UTF-16 offsets and half-open ranges, matching JS string slicing.
export function sourcePoint(text, offset) {
  if (!Number.isInteger(offset) || offset < 0 || offset > text.length) throw new RangeError("invalid source offset");
  let line = 1;
  let start = 0;
  for (let i = 0; i < offset; i++) {
    if (text[i] === "\r") {
      if (text[i + 1] === "\n" && i + 1 === offset) continue;
      if (text[i + 1] === "\n" && i + 1 < offset) i++;
      line++;
      start = i + 1;
    } else if (text[i] === "\n") {
      line++;
      start = i + 1;
    }
  }
  return { offset, line, column: offset - start + 1 };
}

export function sourceOffset(text, { line, column }) {
  if (!Number.isInteger(line) || !Number.isInteger(column) || line < 1 || column < 1) return null;
  let current = 1;
  let start = 0;
  for (let i = 0; i < text.length && current < line; i++) {
    if (text[i] === "\r" || text[i] === "\n") {
      if (text[i] === "\r" && text[i + 1] === "\n") i++;
      current++;
      start = i + 1;
    }
  }
  if (current !== line) return null;
  const offset = start + column - 1;
  let end = start;
  while (end < text.length && text[end] !== "\r" && text[end] !== "\n") end++;
  if (text[end] === "\r" && text[end + 1] === "\n") end++;
  return offset <= end ? offset : null;
}

export function sourceLocation(source, text, start, end = null, options = {}) {
  return {
    role: options.role ?? "document",
    relation: options.relation ?? "origin",
    source,
    range: { start: sourcePoint(text, start), end: end == null ? null : sourcePoint(text, end) },
    precision: options.precision ?? "exact",
    snippet: text.split(/\r\n|\r|\n/)[sourcePoint(text, start).line - 1] ?? null,
  };
}

export function createSourceMap({ generated, original, segments }) {
  for (const input of [generated, original]) {
    if (typeof input?.source !== "string" || typeof input.text !== "string") throw new TypeError("source maps require source identifiers and text");
  }
  let previousEnd = 0;
  const copy = segments.map((segment) => {
    const { generatedStart: gs, generatedEnd: ge, originalStart: os, originalEnd: oe, kind } = segment;
    if (![gs, ge, os, oe].every(Number.isInteger) || gs < previousEnd || ge < gs || ge > generated.text.length
      || os < 0 || oe < os || oe > original.text.length || !["exact", "range"].includes(kind)
      || (kind === "exact" && ge - gs !== oe - os)) throw new RangeError("invalid source-map segment");
    previousEnd = ge;
    return { generatedStart: gs, generatedEnd: ge, originalStart: os, originalEnd: oe, kind };
  });
  return { generated: { ...generated }, original: { ...original }, segments: copy };
}

export function mapPosition(map, offset) {
  if (!Number.isInteger(offset) || offset < 0 || offset > map.generated.text.length) return null;
  const segment = map.segments.find((s) => offset >= s.generatedStart && offset < s.generatedEnd)
    ?? (offset === map.generated.text.length ? map.segments.findLast((s) => s.generatedEnd === offset) : null);
  if (!segment) return null;
  const start = segment.kind === "exact" ? segment.originalStart + offset - segment.generatedStart : segment.originalStart;
  return sourceLocation(map.original.source, map.original.text, start,
    segment.kind === "range" ? segment.originalEnd : null, { precision: segment.kind });
}

export function mapRange(map, { start, end = null }) {
  const first = mapPosition(map, start);
  if (!first || end == null) return first;
  if (end === start) {
    if (first.precision === "exact") first.range.end = { ...first.range.start };
    return first;
  }
  if (!Number.isInteger(end) || end < start || end > map.generated.text.length) return null;
  let cursor = start;
  let lastEnd = first.range.start.offset;
  let precision = "exact";
  for (const segment of map.segments) {
    if (segment.generatedEnd <= cursor || segment.generatedStart >= end) continue;
    if (segment.generatedStart > cursor) return null;
    const from = Math.max(cursor, segment.generatedStart);
    const to = Math.min(end, segment.generatedEnd);
    const os = segment.kind === "exact" ? segment.originalStart + from - segment.generatedStart : segment.originalStart;
    const oe = segment.kind === "exact" ? segment.originalStart + to - segment.generatedStart : segment.originalEnd;
    if (os < lastEnd && !(segment.kind === "range" && os === first.range.start.offset)) return null;
    if (segment.kind === "range" || os !== lastEnd) precision = "range";
    lastEnd = oe;
    cursor = to;
  }
  if (cursor !== end) return null;
  return sourceLocation(map.original.source, map.original.text, first.range.start.offset, lastEnd, { precision });
}

export function composeSourceMaps(inner, outer) {
  if (inner.original.source !== outer.generated.source || inner.original.text !== outer.generated.text) {
    throw new TypeError("source maps do not share the same intermediate source");
  }
  const segments = [];
  for (const a of inner.segments) {
    if (a.kind === "range") {
      const mapped = mapRange(outer, { start: a.originalStart, end: a.originalEnd });
      if (mapped) segments.push({ ...a, originalStart: mapped.range.start.offset,
        originalEnd: mapped.range.end?.offset ?? mapped.range.start.offset, kind: "range" });
      continue;
    }
    for (const b of outer.segments) {
      const from = Math.max(a.originalStart, b.generatedStart);
      const to = Math.min(a.originalEnd, b.generatedEnd);
      if (from >= to) continue;
      segments.push({
        generatedStart: a.generatedStart + from - a.originalStart,
        generatedEnd: a.generatedStart + to - a.originalStart,
        originalStart: b.kind === "exact" ? b.originalStart + from - b.generatedStart : b.originalStart,
        originalEnd: b.kind === "exact" ? b.originalStart + to - b.generatedStart : b.originalEnd,
        kind: b.kind,
      });
    }
  }
  return createSourceMap({ generated: inner.generated, original: outer.original, segments });
}

// Extend a serialized diagnostic without mutating the error or earlier mappings.
export function mapDiagnostic(diagnostic, map, { role = "document" } = {}) {
  const result = structuredClone(typeof diagnostic.toDiagnostic === "function" ? diagnostic.toDiagnostic() : diagnostic);
  const candidates = [...result.locations].reverse().filter((location) => location.source === map.generated.source);
  for (const location of candidates) {
    const start = location.range.start.offset ?? sourceOffset(map.generated.text, location.range.start);
    const end = location.range.end == null ? null : location.range.end.offset ?? sourceOffset(map.generated.text, location.range.end);
    if (start == null || (location.range.end != null && end == null)) continue;
    const mapped = mapRange(map, { start, end });
    if (!mapped) continue;
    mapped.role = role;
    mapped.relation = location.relation;
    if (location.precision === "context") mapped.precision = "context";
    else if (location.precision === "range") mapped.precision = "range";
    if (!result.locations.some((existing) => JSON.stringify(existing) === JSON.stringify(mapped))) result.locations.push(mapped);
    break;
  }
  return result;
}
