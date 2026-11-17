import test from "node:test";
import assert from "node:assert/strict";
import { Parser, Reader, Template, SourceText } from "../sources/index.mjs";

test("all cursor entry points maintain canonical Unicode/CRLF coordinates", () => {
  const text = "😀first\r\nsecond\rthird\n";
  const index = new SourceText(text);
  const parser = new Parser(text);
  for (let offset = 0; offset <= text.length; offset++) {
    parser.position = offset;
    assert.equal(parser.line, index.pointAt(offset).line);
    assert.equal(parser.char, index.pointAt(offset).column);
    parser.restoreCursor({ offset, line: 999, char: 999 });
    assert.deepEqual(parser.snapshotCursor(), {
      offset,
      line: index.pointAt(offset).line,
      char: index.pointAt(offset).column,
    });
  }
  parser.seek(3);
  for (const invalid of [-1, text.length + 1, 1.5, NaN]) {
    assert.throws(() => {
      parser.offset = invalid;
    }, RangeError);
    assert.equal(parser.offset, 3);
  }
  assert.throws(() => {
    parser.char = 99;
  }, TypeError);
  assert.throws(() => {
    parser.line = 99;
  }, TypeError);
});

test("reset clears contexts, bindings, query/region/slot metadata and restarts the same source", () => {
  const reader = new Reader("# One\n# Two\n");
  const read = () =>
    reader.query((doc) =>
      doc.scope("chapters", (child) => {
        child.literal("# ");
        child.line().as("title");
        child.literal("\n");
      }),
    );
  read();
  assert.equal(reader.context.chapters.length, 2);
  assert.ok(reader.slotMap.length && reader.regionMap.length && reader.queryMap.length);
  const source = reader.sourceText;
  assert.equal(reader.reset(), reader);
  assert.equal(reader.sourceText, source);
  assert.equal(reader.offset, 0);
  assert.deepEqual(reader.context, {});
  assert.deepEqual([reader.slotMap, reader.regionMap, reader.queryMap], [[], [], []]);
  assert.equal(reader.bindings.size, 0);
  read();
  assert.equal(reader.context.chapters.length, 2);
});

test("source assignment is a fresh session while seek retains accumulated data", () => {
  const reader = new Reader("old", { file: "old.md" });
  reader.line().as("title");
  reader.source = "new";
  assert.deepEqual(reader.context, {});
  assert.equal(reader.offset, 0);
  reader.line().as("title");
  assert.equal(reader.context.title, "new");
  reader.seek(0);
  assert.equal(reader.context.title, "new");
  assert.equal(reader.bindings.size, 1);
  reader.replaceSource("line\nvalue", { file: "new.md" }).parse("line\n");
  reader.parse("missing");
  assert.equal(reader.errors[0].locations[0].source, "new.md");
  assert.equal(reader.errors[0].locations[0].range.start.line, 2);
});

test("invalid replacement/index inputs cannot leave a partially replaced session", () => {
  const reader = new Reader("old", { file: "old.md" });
  reader.line().as("title");
  assert.throws(() => reader.replaceSource("new", { file: 42 }), TypeError);
  assert.equal(reader.source, "old");
  assert.equal(reader.file, "old.md");
  assert.equal(reader.context.title, "old");
  assert.equal(reader.offset, 3);
  for (const sourceText of [0, false, "", new SourceText("different", "old.md")]) {
    assert.throws(() => new Reader("old", { file: "old.md", sourceText }), TypeError);
  }
});

test("lifecycle changes are rejected inside callbacks and compiled templates without corrupting state", () => {
  const reader = new Reader("original");
  assert.throws(
    () =>
      reader.optional((doc) => {
        doc.line().as("title");
        doc.replaceSource("changed");
      }),
    /inside a parsing callback/,
  );
  assert.equal(reader.source, "original");
  assert.equal(reader.offset, 0);
  assert.deepEqual(reader.context, {});
  assert.throws(() => Template.wrap("{% doc.reset(); %}")(reader), /inside a parsing callback/);
  assert.equal(reader.source, "original");
  assert.equal(reader.reset(), reader);
  reader.line().as("title");
  assert.equal(reader.context.title, "original");
});
