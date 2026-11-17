import { SourceText } from "./SourceText.mjs";

/** Prefer the outermost processing site, then the outermost mapped code origin. */
export function primaryLocation(diagnostic) {
  const locations = diagnostic?.locations ?? [];
  return (
    locations.findLast((location) => location.relation === "processing") ??
    locations.findLast((location) => location.role !== "generated") ??
    null
  );
}

/** Attach a known filename to parser diagnostics that were created from text only. */
export function attachSource(error, source) {
  for (const location of error?.locations ?? []) {
    if (location.source == null) {
      location.source = source;
    }
  }
  return error;
}

/** Add a slot's precise input span, or a reader cursor explicitly marked as context. */
export function addProcessingLocation(error, owner, slot = null) {
  if (owner?.mode !== "reader") {
    return error;
  }
  const source = owner.diagnosticSource ?? owner.sourceText;
  if (!(source instanceof SourceText)) {
    return error;
  }
  const base = owner.diagnosticOffsetBase ?? 0;
  const start = base + (slot?.sourceOffsetStart ?? owner.offset ?? 0);
  const end = slot?.sourceOffsetEnd == null ? null : base + slot.sourceOffsetEnd;
  const location = source.location(start, end, {
    relation: "processing",
    precision: slot ? "range" : "context",
  });
  const existing = error.locations.findIndex(
    (entry) => entry.relation === "processing" && entry.source === location.source,
  );
  if (existing < 0) {
    error.locations.push(location);
  } else if (slot) {
    error.locations[existing] = location;
  }
  return error;
}

/** Compare semantic locations independently of object property order or display snippets. */
export function sameLocation(left, right) {
  return (
    left.source === right.source &&
    left.role === right.role &&
    left.relation === right.relation &&
    left.precision === right.precision &&
    left.range.start.line === right.range.start.line &&
    left.range.start.column === right.range.start.column &&
    left.range.start.offset === right.range.start.offset &&
    left.range.end?.offset === right.range.end?.offset &&
    left.range.end?.line === right.range.end?.line &&
    left.range.end?.column === right.range.end?.column
  );
}
