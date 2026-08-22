import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

import { Reader } from "../../sources/Reader.mjs";
import { Template } from "../../sources/Template.mjs";
import { parseMarkdown, flattenNode } from "../../sources/Reader/Markdown.mjs";

const fixturesRoot = path.dirname(fileURLToPath(import.meta.url));

const TEMPLATE_FIXTURES = ["chapters", "lists", "tables", "code-blocks", "links", "images", "checkboxes"];

const FORBIDDEN_TYPES = new Set([
  "footnote",
  "footnote_reference",
  "footnote_definition",
  "definition_list",
  "definition_item",
  "definition",
  "link_reference",
  "link_reference_definition",
  "reference_definition",
  "image_reference",
  "shortcut_reference",
  "collapsed_reference",
]);

function readFixture(name, file) {
  return fs.readFileSync(path.join(fixturesRoot, name, file), "utf8");
}

function parseFixture(name) {
  const template = readFixture(name, "template.tpl.md");
  const input = readFixture(name, "input.md");
  const expected = JSON.parse(readFixture(name, "expected.json"));
  const fn = Template.wrap(template, `${name}/template.tpl.md`);
  const reader = new Reader(input, { file: `${name}/input.md` });
  fn(reader, reader.context, null, {}, null);
  return { reader, expected, input };
}

function walkTypes(node, visit) {
  if (!node || typeof node !== "object") {
    return;
  }
  if (typeof node.type === "string") {
    visit(node);
  }
  if (Array.isArray(node.children)) {
    for (const child of node.children) {
      walkTypes(child, visit);
    }
  }
  if (Array.isArray(node.headers)) {
    for (const cell of node.headers) {
      for (const child of cell.children ?? []) {
        walkTypes(child, visit);
      }
    }
  }
  if (Array.isArray(node.rows)) {
    for (const row of node.rows) {
      for (const cell of row) {
        for (const child of cell.children ?? []) {
          walkTypes(child, visit);
        }
      }
    }
  }
}

for (const name of TEMPLATE_FIXTURES) {
  test(`conformance/${name} parses to expected.json`, () => {
    const { reader, expected } = parseFixture(name);
    assert.equal(reader.errors.length, 0, reader.errors.map((err) => err.message).join("; "));
    assert.deepEqual(reader.context, expected);
  });
}

test("conformance/chapters records scoped slot-map paths", () => {
  const { reader } = parseFixture("chapters");
  assert.deepEqual(
    reader.slotMap.map((entry) => ({
      key: entry.key,
      leafType: entry.leafType,
      isArrayElement: entry.isArrayElement,
    })),
    [
      { key: "title", leafType: "line", isArrayElement: false },
      { key: "chapters[0].name", leafType: "heading", isArrayElement: false },
      { key: "chapters[0].intro", leafType: "paragraph", isArrayElement: false },
      { key: "chapters[1].name", leafType: "heading", isArrayElement: false },
      { key: "chapters[1].intro", leafType: "paragraph", isArrayElement: false },
    ],
  );
});

test("conformance/lists input is two list blocks", () => {
  const ast = parseMarkdown(readFixture("lists", "input.md"));
  const lists = ast.children.filter((node) => node.type === "list");
  assert.equal(lists.length, 2);
  assert.equal(lists[0].ordered, false);
  assert.equal(lists[1].ordered, true);
  assert.equal(lists[0].children[2].checked, true);
  assert.equal(flattenNode(lists[0].children[1]), "beta em");
});

test("conformance/tables input is a GFM table", () => {
  const ast = parseMarkdown(readFixture("tables", "input.md"));
  assert.equal(ast.children[0].type, "table");
  assert.deepEqual(ast.children[0].align, ["left", "right", "center", null]);
});

test("conformance/code-blocks input has fenced and indented code", () => {
  const ast = parseMarkdown(readFixture("code-blocks", "input.md"));
  const blocks = ast.children.filter((node) => node.type === "code_block");
  assert.equal(blocks.length, 2);
  assert.equal(blocks[0].fenced, true);
  assert.equal(blocks[0].language, "js");
  assert.equal(blocks[1].fenced, false);
  assert.equal(blocks[1].language, null);
});

test("conformance/links input is an inline link", () => {
  const ast = parseMarkdown(readFixture("links", "input.md"));
  assert.equal(ast.children[0].children[0].type, "link");
  assert.equal(ast.children[0].children[0].url, "https://example.com");
});

test("conformance/images input is an inline image", () => {
  const ast = parseMarkdown(readFixture("images", "input.md"));
  assert.equal(ast.children[0].children[0].type, "image");
  assert.equal(ast.children[0].children[0].alt, "logo");
});

test("conformance/checkboxes records asArray slot-map entries", () => {
  const { reader } = parseFixture("checkboxes");
  assert.ok(reader.slotMap.every((entry) => entry.isArrayElement === true));
  assert.deepEqual(
    reader.slotMap.map((entry) => entry.key),
    ["done[0]", "text[0]", "done[1]", "text[1]"],
  );
});

test("conformance/checkboxes input is a task list", () => {
  const ast = parseMarkdown(readFixture("checkboxes", "input.md"));
  assert.equal(ast.children[0].type, "list");
  assert.equal(ast.children[0].ordered, false);
  assert.equal(ast.children[0].children[0].checked, true);
  assert.equal(ast.children[0].children[1].checked, false);
  assert.equal(flattenNode(ast.children[0].children[0]), "ship it");
  assert.equal(flattenNode(ast.children[0].children[1]), "write tests");
});

test("conformance/excluded-constructs are not special AST node types", () => {
  const input = readFixture("excluded-constructs", "input.md");
  const expected = JSON.parse(readFixture("excluded-constructs", "expected.json"));
  const ast = parseMarkdown(input);
  const seen = new Set();
  const texts = [];
  walkTypes(ast, (node) => {
    seen.add(node.type);
    if (node.type === "text") {
      texts.push(node.value);
    }
  });

  for (const type of FORBIDDEN_TYPES) {
    assert.equal(seen.has(type), false, type);
  }
  assert.equal(seen.has("link"), false);
  assert.equal(seen.has("image"), false);
  assert.deepEqual(
    ast.children.map((node) => ({
      type: node.type,
      ...(node.level != null ? { level: node.level } : {}),
      text: flattenNode(node),
    })),
    expected.blocks,
  );
  assert.ok(texts.some((value) => value.includes("[ref][id]")));
  assert.ok(texts.some((value) => value.includes("![img][id]")));
  assert.ok(texts.some((value) => value.includes("[^note]")));
  assert.ok(texts.some((value) => value.includes("[id]: https://example.com")));
  assert.ok(texts.some((value) => value.includes(": definition of the term")));
  assert.ok(texts.some((value) => value.includes("&nbsp;")));
  assert.equal(seen.has("hard_break"), false);
  assert.equal(ast.children[5].type, "paragraph");
  assert.equal(flattenNode(ast.children[5]), "First");
  assert.equal(ast.children[6].type, "heading");
  assert.equal(ast.children[6].level, 1);
  assert.equal(flattenNode(ast.children[6]), "Second");
});
