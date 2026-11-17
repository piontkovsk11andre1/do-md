import test from "node:test";
import assert from "node:assert/strict";

import { Editor } from "../sources/Editor.mjs";
import { Reader } from "../sources/Reader.mjs";
import { Writer } from "../sources/Writer.mjs";
import { Virtual } from "../sources/IO/Virtual.mjs";
import { ERROR_CODES } from "../sources/DoMdError.mjs";

const META = "module id=run-some-script";
const FENCED = "```js module id=run-some-script\nbody\n```\n";

function codeKeys(value) {
  return Object.keys(value).sort();
}

test("codeBlock reads language and the info remainder without parsing tokens", () => {
  const slot = new Reader(FENCED).codeBlock();
  assert.equal(slot.leafType, "codeBlock");
  assert.equal(slot.value.language, "js");
  assert.equal(slot.value.meta, META);
  assert.equal(slot.value.value, "body");
  assert.deepEqual(slot.value, { language: "js", meta: META, value: "body" });
  assert.deepEqual(codeKeys(slot.value), ["language", "meta", "value"]);
  assert.equal(Object.hasOwn(slot.value, "info"), false);
  assert.equal(Object.hasOwn(slot.value, "module"), false);
  assert.equal(Object.hasOwn(slot.value, "id"), false);
  assert.equal(slot.node.language, "js");
  assert.equal(slot.node.meta, META);
  assert.equal(slot.node.value, "body");
  assert.equal(Object.hasOwn(slot.node, "info"), false);

  const spaced = new Reader("```js  module  id=run-some-script\nbody\n```\n").codeBlock();
  assert.equal(spaced.value.language, "js");
  assert.equal(spaced.value.meta, "module  id=run-some-script");
  assert.equal(spaced.value.value, "body");
});

test("language-only, empty info, and indented blocks have meta empty string", () => {
  const languageOnly = new Reader("```js\nconst x = 1;\n```\n").codeBlock();
  assert.equal(languageOnly.value.language, "js");
  assert.equal(languageOnly.value.meta, "");
  assert.notEqual(languageOnly.value.meta, null);
  assert.equal(languageOnly.node.meta, "");

  const emptyInfo = new Reader("```\nplain\n```\n").codeBlock();
  assert.equal(emptyInfo.value.language, null);
  assert.equal(emptyInfo.value.meta, "");
  assert.notEqual(emptyInfo.value.meta, null);
  assert.equal(emptyInfo.value.value, "plain");

  const indented = new Reader("    indented\n").codeBlock();
  assert.equal(indented.value.language, null);
  assert.equal(indented.value.meta, "");
  assert.notEqual(indented.value.meta, null);
  assert.equal(indented.node.language, null);
  assert.equal(indented.node.meta, "");
  assert.equal(indented.value.value, "indented");
});

test("bound codeBlock emits language and meta with one separating space", () => {
  const writer = new Writer({
    sample: { language: "js", meta: META, value: "body" },
  });
  writer.codeBlock().as("sample");
  assert.equal(writer.toMarkdown(), "```js module id=run-some-script\nbody\n```");
  assert.equal(writer.toMarkdown().startsWith("```js module id=run-some-script\n"), true);
  assert.equal(writer.toAst().children[0].meta, META);
  assert.equal(writer.toAst().children[0].language, "js");
});

test("omitted or empty meta emits language with no trailing space", () => {
  const omitted = new Writer({ sample: { language: "js", value: "body" } });
  omitted.codeBlock().as("sample");
  assert.equal(omitted.toMarkdown(), "```js\nbody\n```");
  assert.equal(omitted.toMarkdown().startsWith("```js\n"), true);
  assert.equal(omitted.toMarkdown().includes("```js "), false);

  const empty = new Writer({ sample: { language: "js", meta: "", value: "body" } });
  empty.codeBlock().as("sample");
  assert.equal(empty.toMarkdown(), "```js\nbody\n```");
  assert.equal(empty.toMarkdown().startsWith("```js\n"), true);
});

test("null or empty language does not promote meta into the info string", () => {
  const missing = new Writer({
    sample: { language: null, meta: META, value: "body" },
  });
  missing.codeBlock().as("sample");
  assert.equal(missing.toMarkdown(), "```\nbody\n```");
  const reread = new Reader(`${missing.toMarkdown()}\n`).codeBlock();
  assert.equal(reread.value.language, null);
  assert.equal(reread.value.meta, "");
  assert.notEqual(reread.value.language, "module");

  const emptyLanguage = new Writer({
    sample: { language: "", meta: META, value: "body" },
  });
  emptyLanguage.codeBlock().as("sample");
  assert.equal(emptyLanguage.toMarkdown(), "```\nbody\n```");
});

test("set of meta rewrites the info string and leaves the body bytes unchanged", async () => {
  const io = new Virtual({
    "/doc.md": FENCED,
    "/tpl.md": '{% doc.codeBlock().as("sample") %}\n',
  });
  const editor = await Editor.open({ io, file: "/doc.md", template: "/tpl.md" });
  assert.deepEqual(editor.get("sample"), { language: "js", meta: META, value: "body" });
  const nextMeta = "module id=other-script";
  editor.set("sample", { language: "js", meta: nextMeta, value: "body" });
  const rendered = editor.render();
  assert.equal(rendered, "```js module id=other-script\nbody\n```\n");
  assert.equal(
    rendered.slice(rendered.indexOf("\n"), rendered.lastIndexOf("\n```")),
    FENCED.slice(FENCED.indexOf("\n"), FENCED.lastIndexOf("\n```")),
  );
  const again = new Reader(rendered).codeBlock();
  assert.deepEqual(again.value, { language: "js", meta: nextMeta, value: "body" });
  assert.equal(again.value.meta, nextMeta);
  assert.equal(Object.hasOwn(again.value, "module"), false);
  assert.equal(Object.hasOwn(again.value, "id"), false);
  assert.equal(Object.hasOwn(again.value, "info"), false);
});

test("set of language and value without meta still succeeds and re-reads meta as empty", async () => {
  const io = new Virtual({
    "/doc.md": "```js\nconst x = 1;\n```\n",
    "/tpl.md": '{% doc.codeBlock().as("sample") %}\n',
  });
  const editor = await Editor.open({ io, file: "/doc.md", template: "/tpl.md" });
  editor.set("sample", { language: "ts", value: "const y = 2;" });
  assert.deepEqual(new Reader(editor.render()).codeBlock().value, {
    language: "ts",
    meta: "",
    value: "const y = 2;",
  });
  assert.throws(
    () => editor.set("sample", { language: "ts", meta: { id: "run" }, value: "const y = 2;" }),
    (err) => err.code === ERROR_CODES.DO_MD_USER_ERROR && /type mismatch/.test(err.message),
  );
});
