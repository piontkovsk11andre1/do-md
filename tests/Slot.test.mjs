import test from "node:test";
import assert from "node:assert/strict";

import { Reader } from "../sources/Reader.mjs";
import { Slot } from "../sources/Slot.mjs";
import { ERROR_CODES, SyntaxError } from "../sources/SyntaxError.mjs";
import { Writer } from "../sources/Writer.mjs";

function isTemplateError(err) {
  return err instanceof SyntaxError && err.code === ERROR_CODES.DO_MD_TEMPLATE_ERROR;
}

test("Slot module exists", () => {
  const slot = new Slot("title", { value: "x" });
  assert.equal(slot.path, "title");
  slot.as("name");
  assert.equal(slot.path, "name");
});

test("as stores the parsed value on reader.context", () => {
  const reader = new Reader("hello");
  const slot = new Slot(reader, { value: "hello", matched: true, leafType: "line" });
  slot.as("k");
  assert.deepEqual(reader.context, { k: "hello" });
  assert.equal(slot.exists, true);
});

test("asArray appends into reader.context", () => {
  const reader = new Reader("ab");
  new Slot(reader, { value: "a", matched: true }).asArray("notes");
  new Slot(reader, { value: "b", matched: true }).asArray("notes");
  assert.deepEqual(reader.context, { notes: ["a", "b"] });
});

test("dotted keys are stored as flat strings", () => {
  const reader = new Reader("1.0");
  new Slot(reader, { value: "1.0", matched: true }).as("release.version");
  assert.deepEqual(reader.context, { "release.version": "1.0" });
});

test("an unbound leaf is discarded in Reader and emits nothing in Writer", () => {
  const reader = new Reader("hello");
  new Slot(reader, { value: "hello", matched: true });
  assert.deepEqual(reader.context, {});

  const writer = new Writer({ k: "hello" });
  writer.line();
  assert.equal(writer.toMarkdown(), "");
  assert.deepEqual(writer.buffer, []);
});

test("as and asArray are eager", () => {
  const reader = new Reader("hello");
  const slot = new Slot(reader, { value: "hello", matched: true });
  assert.equal(reader.context.k, undefined);
  slot.as("k");
  assert.equal(reader.context.k, "hello");
});

test("binding the same slot twice throws DO_MD_TEMPLATE_ERROR", () => {
  const reader = new Reader("hello");
  const slot = new Slot(reader, { value: "hello", matched: true });
  slot.as("a");
  assert.throws(() => slot.as("b"), isTemplateError);
});

test("same-scope duplicate as throws DO_MD_TEMPLATE_ERROR", () => {
  const reader = new Reader("one\ntwo");
  reader.line().as("k");
  reader.literal("\n");
  assert.throws(() => reader.line().as("k"), isTemplateError);
});

test("mixing as and asArray on the same key throws DO_MD_TEMPLATE_ERROR", () => {
  const reader = new Reader("one\ntwo");
  reader.line().as("k");
  reader.literal("\n");
  assert.throws(() => reader.line().asArray("k"), isTemplateError);
});

test("default applies before trim, validate, and notEmpty regardless of call order", () => {
  const reader = new Reader("abc");
  reader.optional().regexp(/\d+/).notEmpty().trim().validate((v) => v === "x").default("  x  ").as("n");
  assert.deepEqual(reader.context, { n: "x" });
});

test("trim only transforms strings", () => {
  const writer = new Writer({ n: 7 });
  writer.line().trim().as("n");
  assert.equal(writer.toMarkdown(), "7");
});

test("validate returning false throws DO_MD_USER_ERROR", () => {
  const reader = new Reader("nope");
  assert.throws(
    () => reader.line().validate(() => false).as("k"),
    (err) => err instanceof SyntaxError && err.code === ERROR_CODES.DO_MD_USER_ERROR,
  );
});

test("Reader notEmpty throws DO_MD_PARSE_ERROR", () => {
  const reader = new Reader("\n", { file: "doc.md" });
  assert.throws(
    () => reader.line().notEmpty().as("k"),
    (err) => {
      assert.ok(err instanceof SyntaxError);
      assert.equal(err.code, ERROR_CODES.DO_MD_PARSE_ERROR);
      assert.equal(err.locations[0].source, "doc.md");
      assert.equal(err.locations[0].range.start.line, 1);
      assert.equal(err.locations[0].range.start.column, 1);
      return true;
    },
  );
});

test("Writer notEmpty throws DO_MD_TEMPLATE_ERROR", () => {
  const writer = new Writer({ k: "" }, { file: "t.tpl.md" });
  assert.throws(() => writer.line().notEmpty().as("k"), isTemplateError);
});

test("notEmpty rejects an empty array", () => {
  const writer = new Writer({ k: [] });
  assert.throws(() => writer.line().notEmpty().as("k"), isTemplateError);
});

test("exists is the parse-matched flag on Reader", () => {
  const reader = new Reader("hello");
  const hit = reader.line().as("k");
  assert.equal(hit.exists, true);
  const miss = reader.optional().regexp(/\d+/).default("0").as("n");
  assert.equal(miss.exists, false);
  assert.equal(reader.context.n, "0");
});

test("exists is whether data[k] is defined on Writer", () => {
  assert.equal(new Writer({ k: "a" }).line().as("k").exists, true);
  assert.equal(new Writer({}).line().default("x").as("k").exists, false);
});
