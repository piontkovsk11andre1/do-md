import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

import { Reader } from "../sources/Reader.mjs";
import { Slot } from "../sources/Slot.mjs";
import { Template } from "../sources/Template.mjs";
import { Writer } from "../sources/Writer.mjs";
import {
  describeTemplateFunction,
  listTemplateFunctions,
  renderTemplateReference,
  templateLanguage,
} from "../sources/TemplateLanguage.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const AUTHORING_FUNCTIONS = [
  "literal", "line", "until", "regexp", "text", "rawUntil", "rawBlock", "rawRest",
  "heading", "paragraph", "list", "listTree", "frontmatter", "table", "codeBlock",
  "blockQuote", "thematicBreak", "htmlBlock", "link", "image", "autolink", "codeSpan",
  "checkbox", "optional", "scope", "repeat", "skipUntilHeading", "query",
];
const SLOT_MODIFIERS = ["as", "asArray", "trim", "default", "validate", "notEmpty", "exists"];

test("template-language registry covers every supported authoring method", () => {
  assert.deepEqual(listTemplateFunctions(), AUTHORING_FUNCTIONS);
  assert.deepEqual(templateLanguage.modifiers.map((entry) => entry.name), SLOT_MODIFIERS);
  for (const name of AUTHORING_FUNCTIONS) {
    assert.equal(typeof Reader.prototype[name], "function", `Reader.${name}`);
    assert.equal(typeof Writer.prototype[name], "function", `Writer.${name}`);
    assert.equal(describeTemplateFunction(`doc.${name}`).name, name);
    assert.equal(typeof describeTemplateFunction(name).example, "string");
  }
  for (const name of SLOT_MODIFIERS.filter((name) => name !== "exists")) {
    assert.equal(typeof Slot.prototype[name], "function", `Slot.${name}`);
  }
  assert.equal(typeof new Slot().exists, "boolean");
});

test("Markdown and JSON references render from the public registry", async () => {
  const json = JSON.parse(renderTemplateReference({ format: "json" }));
  assert.deepEqual(json.functions.map((entry) => entry.name), AUTHORING_FUNCTIONS);
  assert.match(renderTemplateReference({ topic: "listTree", format: "markdown" }), /ListTreeValue/);
  assert.equal(renderTemplateReference({ topic: "missing" }), null);
  assert.equal(
    await fs.readFile(path.join(root, "docs/template-language.md"), "utf8"),
    `${renderTemplateReference({ format: "markdown" })}\n`,
  );
});

test("shipped release-notes example parses and renders", async () => {
  const dir = path.join(root, "examples/release-notes");
  const [source, template, dataText] = await Promise.all([
    fs.readFile(path.join(dir, "document.md"), "utf8"),
    fs.readFile(path.join(dir, "template.tpl.md"), "utf8"),
    fs.readFile(path.join(dir, "data.json"), "utf8"),
  ]);
  const fn = Template.wrap(template, "examples/release-notes/template.tpl.md");
  const reader = new Reader(source);
  fn(reader, reader.context, null, {}, null);
  assert.equal(reader.assertConsumed(), true);
  assert.deepEqual(reader.context, JSON.parse(dataText));

  const writer = new Writer(JSON.parse(dataText));
  fn(writer, writer.data, writer.data, {}, null);
  assert.equal(writer.toMarkdown(), source);
});
