import test from "node:test";
import assert from "node:assert/strict";
import { createSourceMap, mapPosition, mapRange, composeSourceMaps, mapDiagnostic, sourcePoint, sourceOffset } from "../sources/index.mjs";

const exact = (generatedStart, generatedEnd, originalStart) => ({ generatedStart, generatedEnd,
  originalStart, originalEnd: originalStart + generatedEnd - generatedStart, kind: "exact" });

test("source points use UTF-16, handle CRLF/CR/LF and include EOF", () => {
  const text = "😀a\r\nb\rc\nd";
  assert.deepEqual(sourcePoint(text, 2), { offset: 2, line: 1, column: 3 });
  assert.deepEqual(sourcePoint(text, 5), { offset: 5, line: 2, column: 1 });
  assert.deepEqual(sourcePoint(text, text.length), { offset: text.length, line: 4, column: 2 });
  for (const offset of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) {
    if (offset <= text.length) assert.equal(sourceOffset(text, sourcePoint(text, offset)), offset);
  }
  assert.equal(sourceOffset(text, { line: 99, column: 1 }), null);
  assert.equal(sourceOffset(text, { line: 1, column: 99 }), null);
  assert.throws(() => sourcePoint(text, -1), RangeError);
});

test("exact mapping has half-open boundaries and supports EOF", () => {
  const map = createSourceMap({ generated: { source: "chunk", text: "abc" },
    original: { source: "file.md", text: "prefix\nabc" }, segments: [exact(0, 3, 7)] });
  assert.deepEqual(mapPosition(map, 1).range.start, { offset: 8, line: 2, column: 2 });
  assert.equal(mapPosition(map, 3).range.start.offset, 10);
  assert.equal(mapPosition(map, 4), null);
  assert.equal(mapPosition(map, -1), null);
  assert.equal(mapRange(map, { start: 0, end: 3 }).range.end.offset, 10);
});

test("range segments keep the full original range; unmapped gaps stay unmapped", () => {
  const map = createSourceMap({ generated: { source: "code", text: "abc--de" },
    original: { source: "template", text: "hello" }, segments: [
      { generatedStart: 0, generatedEnd: 3, originalStart: 0, originalEnd: 5, kind: "range" },
      exact(5, 7, 3),
    ] });
  const location = mapPosition(map, 2);
  assert.equal(location.precision, "range");
  assert.equal(location.range.start.offset, 0);
  assert.equal(location.range.end.offset, 5);
  assert.equal(mapPosition(map, 3), null);
  assert.equal(mapRange(map, { start: 1, end: 6 }), null);
});

test("empty sources and invalid map segments are explicit", () => {
  const empty = { generated: { source: "a", text: "" }, original: { source: "b", text: "" }, segments: [] };
  assert.equal(mapPosition(createSourceMap(empty), 0), null);
  assert.throws(() => createSourceMap({ ...empty, segments: [exact(0, 1, 0)] }), RangeError);
  assert.throws(() => createSourceMap({ ...empty, generated: { source: "a", text: "abc" },
    original: { source: "b", text: "abc" }, segments: [exact(1, 3, 0), exact(0, 1, 0)] }), RangeError);
});

test("composition splits exact segments across removed indentation", () => {
  const original = "  abc\n  def";
  const outer = createSourceMap({ generated: { source: "template", text: "abc\ndef" },
    original: { source: "document.md", text: original }, segments: [exact(0, 4, 2), exact(4, 7, 8)] });
  const inner = createSourceMap({ generated: { source: "js", text: "abc\ndef" }, original: outer.generated,
    segments: [exact(0, 7, 0)] });
  const map = composeSourceMaps(inner, outer);
  for (let offset = 0; offset <= 7; offset++) {
    const intermediate = mapPosition(inner, offset);
    assert.deepEqual(mapPosition(map, offset), mapPosition(outer, intermediate.range.start.offset));
  }
  assert.equal(mapRange(map, { start: 0, end: 7 }).precision, "range");
  assert.throws(() => composeSourceMaps(outer, inner), /intermediate source/);
});

test("composition preserves range precision and unmapped generated code", () => {
  const outer = createSourceMap({ generated: { source: "template", text: "abc" },
    original: { source: "doc", text: "--abc" }, segments: [exact(0, 3, 2)] });
  const inner = createSourceMap({ generated: { source: "js", text: "call()!" }, original: outer.generated,
    segments: [{ generatedStart: 0, generatedEnd: 6, originalStart: 0, originalEnd: 3, kind: "range" }] });
  const composed = composeSourceMaps(inner, outer);
  assert.equal(mapPosition(composed, 2).precision, "range");
  assert.equal(mapPosition(composed, 2).range.end.offset, 5);
  assert.equal(mapPosition(composed, 6), null);
});

test("mapDiagnostic adds origins immutably, preserves context and does not invent positions", () => {
  const map = createSourceMap({ generated: { source: "template", text: "abc" },
    original: { source: "document", text: "--abc" }, segments: [exact(1, 3, 3)] });
  const diagnostic = { code: "DO_MD_TEMPLATE_ERROR", message: "bad", locations: [{
    role: "template", source: "template", relation: "origin", precision: "exact", snippet: "abc",
    range: { start: { offset: 1, line: 1, column: 2 }, end: null },
  }] };
  const mapped = mapDiagnostic(diagnostic, map);
  assert.equal(mapped.locations.length, 2);
  assert.equal(diagnostic.locations.length, 1);
  assert.equal(mapped.locations[1].source, "document");
  assert.equal(mapped.locations[1].range.start.offset, 3);
  assert.deepEqual(mapDiagnostic(mapped, map), mapped);
  diagnostic.locations[0].range.start.offset = 0;
  assert.equal(mapDiagnostic(diagnostic, map).locations.length, 1);
  diagnostic.locations[0].range.start = { offset: null, line: 1, column: 2 };
  diagnostic.locations[0].precision = "context";
  assert.equal(mapDiagnostic(diagnostic, map).locations[1].precision, "context");
});
