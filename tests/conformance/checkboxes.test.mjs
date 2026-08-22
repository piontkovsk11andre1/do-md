import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

import { parseMarkdown, flattenNode } from "../../sources/Reader/Markdown.mjs";
import {
  parseDocument,
  renderDocument,
} from "../conformance-helpers.mjs";

const NAME = "checkboxes";
const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), NAME);

function readFixture(file) {
  return fs.readFileSync(path.join(dir, file), "utf8");
}

function load() {
  return {
    template: readFixture("template.tpl.md"),
    input: readFixture("input.md"),
    expected: JSON.parse(readFixture("expected.json")),
  };
}

function parse() {
  const { template, input, expected } = load();
  const reader = parseDocument(input, template, `${NAME}/input.md`);
  return { reader, expected, input, template };
}

test("conformance/checkboxes parses done/text arrays", () => {
  const { reader, expected } = parse();
  assert.equal(reader.errors.length, 0, reader.errors.map((err) => err.message).join("; "));
  assert.deepEqual(reader.context, expected);
  assert.deepEqual(reader.context.done, [true, false]);
  assert.deepEqual(reader.context.text, ["ship it", "write tests"]);
  assert.ok(reader.context.done.every((value) => typeof value === "boolean"));
});

test("conformance/checkboxes records checkbox and line asArray slots", () => {
  const { reader } = parse();
  assert.deepEqual(
    reader.slotMap.map((entry) => ({
      key: entry.key,
      leafType: entry.leafType,
      isArrayElement: entry.isArrayElement,
    })),
    [
      { key: "done[0]", leafType: "checkbox", isArrayElement: true },
      { key: "text[0]", leafType: "line", isArrayElement: true },
      { key: "done[1]", leafType: "checkbox", isArrayElement: true },
      { key: "text[1]", leafType: "line", isArrayElement: true },
    ],
  );
});

test("conformance/checkboxes checkbox slots are 3-byte markers", () => {
  const { reader, input } = parse();
  const boxes = reader.slotMap.filter((entry) => entry.leafType === "checkbox");
  assert.equal(boxes.length, 2);
  assert.equal(input.slice(boxes[0].sourceOffsetStart, boxes[0].sourceOffsetEnd), "[x]");
  assert.equal(input.slice(boxes[1].sourceOffsetStart, boxes[1].sourceOffsetEnd), "[ ]");
  for (const entry of boxes) {
    assert.equal(entry.sourceOffsetEnd - entry.sourceOffsetStart, 3);
  }
});

test("conformance/checkboxes input is a task list", () => {
  const ast = parseMarkdown(readFixture("input.md"));
  assert.equal(ast.children[0].type, "list");
  assert.equal(ast.children[0].ordered, false);
  assert.equal(ast.children[0].children.length, 2);
  assert.equal(ast.children[0].children[0].checked, true);
  assert.equal(ast.children[0].children[1].checked, false);
  assert.equal(flattenNode(ast.children[0].children[0]), "ship it");
  assert.equal(flattenNode(ast.children[0].children[1]), "write tests");
});

test("conformance/checkboxes parse of rendered expected data matches expected.json", () => {
  const { template, expected } = load();
  const rendered = renderDocument(expected, template, `${NAME}/template.tpl.md`);
  assert.match(rendered, /- \[x\] ship it\n- \[ \] write tests\n/);
  const reader = parseDocument(rendered, template, `${NAME}/rendered.md`);
  assert.equal(reader.errors.length, 0, reader.errors.map((err) => err.message).join("; "));
  assert.deepEqual(reader.context, expected);
});
