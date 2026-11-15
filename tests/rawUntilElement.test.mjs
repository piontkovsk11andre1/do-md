import test from "node:test";
import assert from "node:assert/strict";

import { exportDoc } from "../sources/commands/exportDoc.mjs";
import { Editor } from "../sources/Editor.mjs";
import { Reader } from "../sources/Reader.mjs";
import { Slot } from "../sources/Slot.mjs";
import { Writer } from "../sources/Writer.mjs";
import { Virtual } from "../sources/IO/Virtual.mjs";
import { ERROR_CODES } from "../sources/SyntaxError.mjs";

const TEMPLATE = '{% doc.repeat((item) => { item.rawUntilElement("list"); item.listTree().asArray("lists") }); doc.rawRest() %}';

function templateError(err) {
  return err?.code === ERROR_CODES.DO_MD_TEMPLATE_ERROR;
}

async function exported(source) {
  const io = new Virtual({ "/doc.md": source, "/tpl.md": TEMPLATE });
  return exportDoc({ io, file: "/doc.md", template: "/tpl.md", savePath: "/out.json" });
}

async function opened(source) {
  const io = new Virtual({ "/doc.md": source, "/tpl.md": TEMPLATE });
  return Editor.open({ io, file: "/doc.md", template: "/tpl.md" });
}

test("rawUntilElement keeps fence and paragraph hyphens and parses the real list", async () => {
  const source = [
    "Prose before.",
    "",
    "A paragraph with a - hyphen item.",
    "",
    "```",
    "- fence item",
    "```",
    "",
    "> - quoted item",
    "",
    "- real item",
    "  - nested",
    "",
  ].join("\n");
  const reader = new Reader(source);
  const gap = reader.rawUntilElement("list");
  assert.equal(gap._matched, true);
  assert.equal(gap.value, source.slice(0, source.indexOf("- real item")));
  assert.match(gap.value, /Prose before\./);
  assert.match(gap.value, /- fence item/);
  assert.match(gap.value, /- hyphen item/);
  assert.match(gap.value, /- quoted item/);
  assert.equal(gap.value.includes("- real item"), false);
  const tree = reader.listTree();
  assert.equal(tree._matched, true);
  assert.equal(tree.value.items.length, 1);
  assert.equal(tree.value.items[0].children[1].type, "list");
  assert.equal(reader.errors.length, 0);

  const result = await exported(source);
  assert.equal(result.ok, true, result.errors?.map((err) => err.message).join("; "));
  assert.equal(result.context.lists.length, 1);
  assert.equal(result.context.lists[0].items[0].children[1].type, "list");
  assert.equal(JSON.stringify(result.context).includes("fence item"), false);
  assert.equal(JSON.stringify(result.context).includes("quoted item"), false);
});

test("a file that starts with a list captures an empty success", async () => {
  const source = "- [ ] start\n  - nested\n";
  const reader = new Reader(source);
  const gap = reader.rawUntilElement("list");
  assert.equal(gap._matched, true);
  assert.equal(gap.value, "");
  assert.equal(reader.offset, 0);
  assert.equal(reader.errors.length, 0);
  assert.equal(reader.listTree()._matched, true);

  const result = await exported(source);
  assert.equal(result.ok, true, result.errors?.map((err) => err.message).join("; "));
  assert.equal(result.context.lists.length, 1);
  assert.equal(result.context.lists[0].items[0].checked, false);
  assert.equal(result.context.lists[0].items[0].children[1].type, "list");
});

test("export of two lists returns only lists and omits the heading", async () => {
  const source = "- alpha\n\n## Hidden heading\n\n- beta\n";
  const result = await exported(source);
  assert.equal(result.ok, true, result.errors?.map((err) => err.message).join("; "));
  assert.deepEqual(Object.keys(result.context), ["lists"]);
  assert.equal(result.context.lists.length, 2);
  assert.equal(JSON.stringify(result.context).includes("Hidden heading"), false);
});

test("a file with no list still parses and leaves no document error", async () => {
  const source = "Just prose.\n\n## Still none\n";
  const result = await exported(source);
  assert.equal(result.ok, true, result.errors?.map((err) => err.message).join("; "));
  assert.deepEqual(result.errors, []);
  assert.equal(Object.hasOwn(result.context, "lists"), false);
  assert.equal(JSON.stringify(result.context).includes("Still none"), false);
});

test("set of a checkbox changes three bytes and leaves the heading offset", async () => {
  const heading = "## Stable heading";
  const source = `- [ ] first\n\n${heading}\n\n- [x] second\n`;
  const editor = await opened(source);
  const headingAt = source.indexOf(heading);
  const checkbox = editor.slotMap.find((slot) => slot.key === "lists[0].items[0].checked");
  assert.equal(checkbox.sourceOffsetEnd - checkbox.sourceOffsetStart, 3);
  assert.equal(source.slice(checkbox.sourceOffsetStart, checkbox.sourceOffsetEnd), "[ ]");
  editor.set("lists[0].items[0].checked", true);
  const rendered = editor.render();
  assert.equal(rendered.slice(checkbox.sourceOffsetStart, checkbox.sourceOffsetEnd), "[x]");
  assert.equal(rendered.slice(0, checkbox.sourceOffsetStart), source.slice(0, checkbox.sourceOffsetStart));
  assert.equal(rendered.slice(checkbox.sourceOffsetEnd), source.slice(checkbox.sourceOffsetEnd));
  assert.equal(rendered.indexOf(heading), headingAt);
  assert.equal(rendered.slice(headingAt, headingAt + heading.length), heading);
});

test("set that adds a child rewrites only the list after the heading", async () => {
  const heading = "## Stable heading";
  const source = `- [ ] first\n\n${heading}\n\n- second\n`;
  const editor = await opened(source);
  const headingAt = source.indexOf(heading);
  const firstList = editor.slotMap.find((slot) => slot.key === "lists[0]");
  const secondList = editor.slotMap.find((slot) => slot.key === "lists[1]");
  assert.ok(firstList.sourceOffsetEnd <= headingAt);
  assert.ok(headingAt < secondList.sourceOffsetStart);
  const tree = editor.get("lists[1]");
  editor.set("lists[1]", {
    ...tree,
    items: [
      ...tree.items,
      {
        checked: null,
        children: [{ type: "paragraph", children: [{ type: "text", value: "added child" }] }],
      },
    ],
  });
  const rendered = editor.render();
  assert.equal(rendered.slice(0, secondList.sourceOffsetStart), source.slice(0, secondList.sourceOffsetStart));
  assert.equal(rendered.indexOf(heading), headingAt);
  assert.equal(rendered.slice(headingAt, headingAt + heading.length), heading);
  assert.equal(
    rendered.slice(firstList.sourceOffsetStart, firstList.sourceOffsetEnd),
    source.slice(firstList.sourceOffsetStart, firstList.sourceOffsetEnd),
  );
  assert.match(rendered.slice(secondList.sourceOffsetStart), /^- second\n- added child/);
  assert.ok(rendered.length > source.length);
  assert.equal(rendered.includes("- [ ] first"), true);
});

test("an unknown rawUntilElement type throws before parse or emit", () => {
  const reader = new Reader("- item\n");
  assert.throws(() => reader.rawUntilElement("heading"), templateError);
  assert.throws(() => reader.rawUntilElement(), templateError);
  assert.equal(reader.offset, 0);
  assert.deepEqual(reader.errors, []);

  const writer = new Writer({ gap: "kept\r\n" });
  assert.throws(() => writer.rawUntilElement("quote"), templateError);
  assert.throws(() => writer.rawUntilElement(), templateError);
  assert.equal(writer.toMarkdown(), "");
});

test("an unbound writer call returns a slot and appends nothing", () => {
  const writer = new Writer({});
  const slot = writer.rawUntilElement("list");
  assert.notEqual(slot, false);
  assert.equal(slot instanceof Slot, true);
  assert.equal(slot.leafType, "rawUntilElement");
  assert.equal(writer.toMarkdown(), "");

  const bound = new Writer({ gap: "prose\r\n- not normalized" });
  bound.rawUntilElement("list").as("gap");
  assert.equal(bound.toMarkdown(), "prose\r\n- not normalized");
});

test("a cursor inside a line skips that block and still finds a later list", () => {
  const source = "```\ncode line\n- fence item\n```\n\n- later item\n";
  const reader = new Reader(source);
  reader.advanceTo(source.indexOf("code line") + 2);
  const start = reader.offset;
  const gap = reader.rawUntilElement("list");
  assert.equal(gap._matched, true);
  assert.equal(gap.value, source.slice(start, source.indexOf("- later item")));
  assert.equal(gap.value.includes("- fence item"), true);
  assert.equal(reader.offset, source.indexOf("- later item"));
  assert.equal(reader.listTree().value.items[0].children[0].type, "paragraph");
  assert.equal(reader.errors.length, 0);
});

test("line-boundary cursors retain enclosing blocks when finding top-level lists", () => {
  for (const source of [
    "```\n- fake\n```\n\n- real\n",
    "---\nitems:\n  - fake\n---\n\n- real\n",
    "- parent\n  - nested\n\n## Heading\n\n- real\n",
    "> quote\n> - nested\n\n- real\n",
  ]) {
    const start = source.indexOf("\n") + 1;
    const end = source.indexOf("- real");
    const reader = new Reader(source);
    reader.advanceTo(start);
    const gap = reader.rawUntilElement("list");
    assert.equal(gap._matched, true);
    assert.equal(gap.value, source.slice(start, end));
    assert.equal(reader.offset, end);
    assert.equal(reader.listTree().value.items.length, 1);
    assert.deepEqual(reader.errors, []);
  }
});

test("a miss inside a fence leaves the cursor unchanged", () => {
  const reader = new Reader("```\n- fake\n```\n");
  reader.advanceTo(4);
  const gap = reader.rawUntilElement("list");
  assert.equal(gap._matched, false);
  assert.equal(reader.offset, 4);
});
