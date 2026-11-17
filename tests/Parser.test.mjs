import test from "node:test";
import assert from "node:assert/strict";

import { Parser } from "../sources/Parser.mjs";
import { ERROR_CODES, DoMdError } from "../sources/DoMdError.mjs";
import { Slot } from "../sources/Slot.mjs";

test("Parser module exists", () => {
  assert.equal(typeof Parser, "function");
  const parser = new Parser("text");
  assert.equal(parser.source, "text");
});

test("Parser starts at offset 0 with 1-indexed line and char", () => {
  const parser = new Parser("ab\ncd");
  assert.equal(parser.inputSourceText, "ab\ncd");
  assert.equal(parser.offset, 0);
  assert.equal(parser.line, 1);
  assert.equal(parser.char, 1);
  assert.equal(parser.optionalMode, false);
  assert.deepEqual(parser.context, {});
});

test("parse advances offset, line, and char", () => {
  const parser = new Parser("ab\ncd");
  assert.equal(parser.parse("ab\n"), parser);
  assert.equal(parser.offset, 3);
  assert.equal(parser.line, 2);
  assert.equal(parser.char, 1);
  parser.parse("cd");
  assert.equal(parser.offset, 5);
  assert.equal(parser.line, 2);
  assert.equal(parser.char, 3);
});

test("non-whitespace characters must match exactly", () => {
  const parser = new Parser("hello");
  parser.parse("hallo");
  assert.equal(parser.offset, 0);
  assert.equal(parser.errors.length, 1);
  assert.ok(parser.errors[0] instanceof DoMdError);
  assert.equal(parser.errors[0].code, ERROR_CODES.DO_MD_PARSE_ERROR);
});

test("spaces and tabs match any non-empty run of spaces or tabs", () => {
  const parser = new Parser("a \t  b");
  parser.parse("a b");
  assert.equal(parser.offset, 6);
  assert.equal(parser.errors.length, 0);
});

test("a missing space run does not match", () => {
  const parser = new Parser("ab");
  parser.parse("a b");
  assert.equal(parser.offset, 0);
  assert.equal(parser.errors.length, 1);
});

test("one template newline matches exactly one document newline", () => {
  const parser = new Parser("a\n\nb");
  parser.parse("a\n");
  assert.equal(parser.offset, 2);
  assert.equal(parser.line, 2);
  assert.equal(parser.char, 1);
  assert.equal(parser.errors.length, 0);
});

test("two or more template newlines match two or more document newlines", () => {
  const parser = new Parser("a\n\n\nb");
  parser.parse("a\n\n");
  assert.equal(parser.offset, 4);
  assert.equal(parser.line, 4);
  assert.equal(parser.char, 1);
  parser.parse("b");
  assert.equal(parser.errors.length, 0);
});

test("two template newlines do not match a single document newline", () => {
  const parser = new Parser("a\nb");
  parser.parse("a\n\n");
  assert.equal(parser.offset, 0);
  assert.equal(parser.line, 1);
  assert.equal(parser.char, 1);
  assert.equal(parser.errors.length, 1);
});

test("required mismatch records a parse error at the cursor", () => {
  const parser = new Parser("hello\nworld", { file: "doc.md" });
  parser.parse("hello\n");
  parser.parse("earth");
  assert.equal(parser.offset, 6);
  assert.equal(parser.errors.length, 1);
  const err = parser.errors[0];
  assert.equal(err.code, ERROR_CODES.DO_MD_PARSE_ERROR);
  assert.equal(err.locations[0].source, "doc.md");
  assert.equal(err.locations[0].range.start.line, 2);
  assert.equal(err.locations[0].range.start.column, 1);
  assert.equal(err.locations[0].snippet, "world");
});

test("optional mode rewinds the cursor and records no error", () => {
  const parser = new Parser("hello\nworld");
  parser.parse("hello\n");
  parser.optional().parse("earth");
  assert.equal(parser.offset, 6);
  assert.equal(parser.line, 2);
  assert.equal(parser.char, 1);
  assert.equal(parser.errors.length, 0);
});

test("required() turns mismatch recording back on", () => {
  const parser = new Parser("hello");
  parser.optional().parse("nope").required().parse("nope");
  assert.equal(parser.offset, 0);
  assert.equal(parser.errors.length, 1);
});

test("parseRegExp consumes a match at the cursor and returns a Slot", () => {
  const parser = new Parser("v1.2.3 tail");
  const slot = parser.parseRegExp(/v\d+\.\d+\.\d+/);
  assert.ok(slot instanceof Slot);
  assert.equal(slot.leafType, "text");
  assert.equal(slot.value, "v1.2.3");
  assert.equal(slot.sourceOffsetStart, 0);
  assert.equal(slot.sourceOffsetEnd, 6);
  assert.equal(parser.offset, 6);
});

test("parseRegExp does not search ahead of the cursor", () => {
  const parser = new Parser("ab12");
  const slot = parser.parseRegExp(/\d+/);
  assert.equal(slot.value, null);
  assert.equal(parser.offset, 0);
  assert.equal(parser.errors.length, 1);
});

test("optional parseRegExp rewinds on miss", () => {
  const parser = new Parser("abc");
  const slot = parser.optional().parseRegExp(/\d+/);
  assert.equal(slot.value, null);
  assert.equal(parser.offset, 0);
  assert.equal(parser.errors.length, 0);
});

test("parseUntil consumes text up to a limiter", () => {
  const parser = new Parser("foo] bar");
  const slot = parser.parseUntil("]");
  assert.ok(slot instanceof Slot);
  assert.equal(slot.leafType, "text");
  assert.equal(slot.value, "foo");
  assert.equal(slot.sourceOffsetStart, 0);
  assert.equal(slot.sourceOffsetEnd, 3);
  assert.equal(parser.offset, 3);
  assert.equal(parser.remaining(), "] bar");
});

test("optional parseUntil rewinds when the limiter is missing", () => {
  const parser = new Parser("foo");
  const slot = parser.optional().parseUntil("]");
  assert.equal(slot.value, null);
  assert.equal(parser.offset, 0);
  assert.equal(parser.errors.length, 0);
});

test("error records a domain error at the current line and column", () => {
  const parser = new Parser("ab\ncd", { path: "notes.md" });
  parser.parse("ab\nc");
  const err = parser.error("custom miss");
  assert.equal(err.code, ERROR_CODES.DO_MD_PARSE_ERROR);
  assert.equal(err.locations[0].source, "notes.md");
  assert.equal(err.locations[0].range.start.line, 2);
  assert.equal(err.locations[0].range.start.column, 2);
  assert.equal(parser.errors[0], err);
});

test("parseOneOf returns the first successful alternative", () => {
  const parser = new Parser("v2 rest");
  const slot = parser.parseOneOf(
    (p) => p.parseRegExp(/v1/),
    (p) => p.parseRegExp(/v2/),
    (p) => p.parseRegExp(/v3/),
  );
  assert.ok(slot instanceof Slot);
  assert.equal(slot.value, "v2");
  assert.equal(parser.offset, 2);
  assert.equal(parser.errors.length, 0);
});

test("parseOneOf drops failed alternatives and restores the cursor between tries", () => {
  const parser = new Parser("xyz");
  const slot = parser.parseOneOf(
    (p) => p.parseRegExp(/abc/),
    (p) => {
      p.parse("xy");
    },
  );
  assert.equal(slot.value, "xy");
  assert.equal(parser.offset, 2);
  assert.equal(parser.errors.length, 0);
});

test("parseOneOf empty alternatives is a required miss", () => {
  const parser = new Parser("abc");
  const slot = parser.parseOneOf();
  assert.ok(slot instanceof Slot);
  assert.equal(slot.value, null);
  assert.equal(parser.offset, 0);
  assert.equal(parser.errors.length, 1);
  assert.equal(parser.errors[0].code, ERROR_CODES.DO_MD_PARSE_ERROR);
  assert.equal(parser.errors[0].locations[0].range.start.line, 1);
  assert.equal(parser.errors[0].locations[0].range.start.column, 1);
});

test("optional parseOneOf miss returns an unmatched slot without an error", () => {
  const parser = new Parser("abc");
  const slot = parser.optional().parseOneOf((p) => p.parseRegExp(/\d+/));
  assert.equal(slot.value, null);
  assert.equal(parser.offset, 0);
  assert.equal(parser.errors.length, 0);
});

test("parseOneOf wraps a non-Slot success as a text leaf", () => {
  const parser = new Parser("hello!");
  const slot = parser.parseOneOf((p) => p.parse("hello"));
  assert.ok(slot instanceof Slot);
  assert.equal(slot.leafType, "text");
  assert.equal(slot.value, "hello");
  assert.equal(slot.sourceOffsetStart, 0);
  assert.equal(slot.sourceOffsetEnd, 5);
  assert.equal(parser.offset, 5);
});

test("Parser.repeat collects matched slots and stops at the first miss", () => {
  const parser = new Parser("a1b2!");
  const slots = parser.repeat((p) => p.parseRegExp(/[a-z]\d/));
  assert.equal(slots.length, 2);
  assert.equal(slots[0].value, "a1");
  assert.equal(slots[1].value, "b2");
  assert.equal(parser.offset, 4);
  assert.equal(parser.remaining(), "!");
  assert.equal(parser.errors.length, 1);
  assert.equal(parser.errors[0].code, ERROR_CODES.DO_MD_PARSE_ERROR);
});

test("optional Parser.repeat stops on miss without recording an error", () => {
  const parser = new Parser("aaX");
  const slots = parser.optional().repeat((p) => p.parseRegExp(/a/));
  assert.equal(slots.map((slot) => slot.value).join(""), "aa");
  assert.equal(parser.offset, 2);
  assert.equal(parser.errors.length, 0);
});

test("Parser.repeat stops when fn returns false without recording an error", () => {
  const parser = new Parser("abc");
  let index = 0;
  const slots = parser.repeat((p) => {
    index += 1;
    if (index === 2) {
      return false;
    }
    return p.parseRegExp(/[a-z]/);
  });
  assert.equal(slots.length, 1);
  assert.equal(slots[0].value, "a");
  assert.equal(parser.offset, 1);
  assert.equal(parser.errors.length, 0);
});

test("Parser.repeat stops on zero-width match without throwing", () => {
  const parser = new Parser("abc");
  const slots = parser.repeat((p) => p.parseRegExp(/^/));
  assert.deepEqual(slots, []);
  assert.equal(parser.offset, 0);
  assert.doesNotMatch(
    parser.errors.map((err) => err.message).join("\n"),
    /max scope iterations exceeded/,
  );
});
