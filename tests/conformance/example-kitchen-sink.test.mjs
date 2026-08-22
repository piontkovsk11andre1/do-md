import test from "node:test";
import assert from "node:assert/strict";

import { create } from "../../sources/commands/create.mjs";
import { exportDoc } from "../../sources/commands/exportDoc.mjs";
import { render } from "../../sources/commands/render.mjs";
import { set } from "../../sources/commands/set.mjs";
import { validate } from "../../sources/commands/validate.mjs";
import { Virtual } from "../../sources/IO/Virtual.mjs";
import { ERROR_CODES } from "../../sources/SyntaxError.mjs";
import {
  loadFixture,
  normalize,
  parseDocument,
} from "../conformance-helpers.mjs";

const NAME = "example-kitchen-sink";

const REQUIRED_LEAF_TYPES = [
  "heading",
  "paragraph",
  "list",
  "table",
  "codeBlock",
  "blockQuote",
  "thematicBreak",
  "htmlBlock",
  "line",
  "text",
  "link",
  "image",
  "autolink",
  "codeSpan",
  "checkbox",
];

const SLOT_MAP = [
  { key: "title", leafType: "heading", isArrayElement: false },
  { key: "subtitle", leafType: "line", isArrayElement: false },
  { key: "status", leafType: "line", isArrayElement: false },
  { key: "abstract", leafType: "paragraph", isArrayElement: false },
  { key: "callout", leafType: "blockQuote", isArrayElement: false },
  { key: "hasRule", leafType: "thematicBreak", isArrayElement: false },
  { key: "author", leafType: "text", isArrayElement: false },
  { key: "authoredOn", leafType: "text", isArrayElement: false },
  { key: "version", leafType: "text", isArrayElement: false },
  { key: "tags", leafType: "list", isArrayElement: false },
  { key: "compatibility", leafType: "table", isArrayElement: false },
  { key: "example", leafType: "codeBlock", isArrayElement: false },
  { key: "embed", leafType: "htmlBlock", isArrayElement: false },
  { key: "done[0]", leafType: "checkbox", isArrayElement: true },
  { key: "actions[0]", leafType: "line", isArrayElement: true },
  { key: "done[1]", leafType: "checkbox", isArrayElement: true },
  { key: "actions[1]", leafType: "line", isArrayElement: true },
  { key: "homepage", leafType: "link", isArrayElement: false },
  { key: "logo", leafType: "image", isArrayElement: false },
  { key: "repo", leafType: "autolink", isArrayElement: false },
  { key: "binary", leafType: "codeSpan", isArrayElement: false },
  { key: "chapters[0].name", leafType: "line", isArrayElement: false },
  { key: "chapters[0].body", leafType: "paragraph", isArrayElement: false },
  { key: "chapters[0].seeAlso", leafType: "link", isArrayElement: false },
  { key: "chapters[1].name", leafType: "line", isArrayElement: false },
  { key: "chapters[1].body", leafType: "paragraph", isArrayElement: false },
  { key: "chapters[1].seeAlso", leafType: "link", isArrayElement: false },
  { key: "referencesHeader", leafType: "line", isArrayElement: false },
  { key: "references[0]", leafType: "link", isArrayElement: true },
  { key: "references[1]", leafType: "link", isArrayElement: true },
  { key: "footerNotes[0]", leafType: "line", isArrayElement: true },
  { key: "footerNotes[1]", leafType: "line", isArrayElement: true },
];

function kitchenSinkIo() {
  const fixture = loadFixture(NAME);
  const io = new Virtual({
    "/template.tpl.md": fixture.template,
    "/input.md": fixture.input,
    "/summary.tpl.md": [
      "Title: {% doc.line().as(\"title\") %}",
      "Status: {% doc.line().as(\"status\") %}",
      "Version: {% doc.line().as(\"version\") %}",
      "",
    ].join("\n"),
  });
  return { ...fixture, io };
}

function parseKitchenSink() {
  const { template, input, expected } = loadFixture(NAME);
  const reader = parseDocument(input, template, `${NAME}/input.md`);
  return { reader, expected };
}

test("conformance/example-kitchen-sink slot map covers every bound leaf", () => {
  const { reader } = parseKitchenSink();
  assert.equal(reader.errors.length, 0, reader.errors.map((err) => err.message).join("; "));
  assert.deepEqual(
    reader.slotMap.map((entry) => ({
      key: entry.key,
      leafType: entry.leafType,
      isArrayElement: entry.isArrayElement,
    })),
    SLOT_MAP,
  );
});

test("conformance/example-kitchen-sink binds every leaf type", () => {
  const { reader } = parseKitchenSink();
  const seen = new Set(reader.slotMap.map((entry) => entry.leafType));
  for (const leafType of REQUIRED_LEAF_TYPES) {
    assert.equal(seen.has(leafType), true, leafType);
  }
});

test("conformance/example-kitchen-sink aligns repeat + checkbox + asArray", () => {
  const { reader, expected } = parseKitchenSink();
  assert.deepEqual(reader.context.done, [true, false]);
  assert.deepEqual(reader.context.actions, ["ship it", "write tests"]);
  assert.deepEqual(reader.context.done, expected.done);
  assert.deepEqual(reader.context.actions, expected.actions);
  assert.ok(reader.slotMap.every((entry) => {
    if (!entry.key.startsWith("done[") && !entry.key.startsWith("actions[")) {
      return true;
    }
    return entry.isArrayElement === true;
  }));
});

test("conformance/example-kitchen-sink records scoped chapter paths", () => {
  const { reader } = parseKitchenSink();
  assert.deepEqual(
    reader.slotMap
      .filter((entry) => entry.key.startsWith("chapters["))
      .map((entry) => ({
        key: entry.key,
        leafType: entry.leafType,
        isArrayElement: entry.isArrayElement,
      })),
    [
      { key: "chapters[0].name", leafType: "line", isArrayElement: false },
      { key: "chapters[0].body", leafType: "paragraph", isArrayElement: false },
      { key: "chapters[0].seeAlso", leafType: "link", isArrayElement: false },
      { key: "chapters[1].name", leafType: "line", isArrayElement: false },
      { key: "chapters[1].body", leafType: "paragraph", isArrayElement: false },
      { key: "chapters[1].seeAlso", leafType: "link", isArrayElement: false },
    ],
  );
});

test("conformance/example-kitchen-sink binds modifiers, optionals, and byte-level leaves", () => {
  const { reader, expected } = parseKitchenSink();
  assert.equal(reader.context.subtitle, "Feature catalog");
  assert.notEqual(reader.context.subtitle, "(no subtitle)");
  assert.equal(reader.context.status, "draft");
  assert.equal(reader.context.hasRule, true);
  assert.equal(reader.context.author, "Ada Lovelace");
  assert.equal(reader.context.authoredOn, "2026-08-22");
  assert.equal(reader.context.version, "1.0.0");
  assert.equal(reader.context.referencesHeader, "References");
  assert.equal(reader.context.callout, expected.callout);
  assert.equal(reader.context.embed, expected.embed);
  assert.deepEqual(reader.context.references, expected.references);
  assert.deepEqual(reader.context.homepage, expected.homepage);
  assert.deepEqual(reader.context.logo, expected.logo);
  assert.equal(reader.context.repo, "https://git.example.com");
  assert.equal(reader.context.binary, "do-md");
  assert.deepEqual(reader.context.compatibility.align, ["left", "center", "right"]);
  assert.deepEqual(reader.context.example, { language: "js", value: "const n = 1;" });
});

test("conformance/example-kitchen-sink status validate rejects unknown values", () => {
  const { template, input } = loadFixture(NAME);
  const invalid = input.replace("**Status:** draft", "**Status:** shipped");
  assert.throws(
    () => parseDocument(invalid, template, `${NAME}/invalid-status.md`),
    (err) => err && err.code === ERROR_CODES.DO_MD_USER_ERROR,
  );
});

test("conformance/example-kitchen-sink checkbox slots are 3-byte markers", () => {
  const { template, input } = loadFixture(NAME);
  const { reader } = parseKitchenSink();
  const boxes = reader.slotMap.filter((entry) => entry.leafType === "checkbox");
  assert.equal(boxes.length, 2);
  assert.equal(input.slice(boxes[0].sourceOffsetStart, boxes[0].sourceOffsetEnd), "[x]");
  assert.equal(input.slice(boxes[1].sourceOffsetStart, boxes[1].sourceOffsetEnd), "[ ]");
  for (const entry of boxes) {
    assert.equal(entry.sourceOffsetEnd - entry.sourceOffsetStart, 3);
  }
});

test("conformance/example-kitchen-sink skipUntilHeading does not bind a slot", () => {
  const { reader } = parseKitchenSink();
  assert.equal(reader.slotMap.some((entry) => entry.key.includes("skip")), false);
  assert.deepEqual(reader.context.footerNotes, [
    "Keep fixtures small.",
    "Omit skipped interstitial content.",
  ]);
});

test("conformance/example-kitchen-sink validate/export/create/set/render", async () => {
  const { io, expected, expectedOutput } = kitchenSinkIo();

  const validated = await validate({
    io,
    file: "/input.md",
    template: "/template.tpl.md",
  });
  assert.deepEqual(validated, {
    ok: true,
    exitCode: 0,
    output: null,
    context: null,
    errors: [],
  });

  const exported = await exportDoc({
    io,
    file: "/input.md",
    template: "/template.tpl.md",
    savePath: "/expected.json",
  });
  assert.equal(exported.ok, true, exported.errors.map((err) => err.message).join("; "));
  assert.deepEqual(exported.context, expected);
  assert.deepEqual(JSON.parse(await io.readFileAsync("/expected.json")), expected);

  const created = await create({
    io,
    file: "/created.md",
    template: "/template.tpl.md",
    data: JSON.parse(await io.readFileAsync("/expected.json")),
  });
  assert.equal(created.ok, true, created.errors.map((err) => err.message).join("; "));
  assert.equal(created.output, expectedOutput);

  const original = await io.readFileAsync("/input.md");
  const rendered = await render({
    io,
    file: "/input.md",
    parseTemplate: "/template.tpl.md",
    renderTemplate: "/summary.tpl.md",
    outFile: "/summary.md",
  });
  assert.equal(rendered.ok, true, rendered.errors.map((err) => err.message).join("; "));
  assert.equal(await io.readFileAsync("/input.md"), original);
  assert.match(await io.readFileAsync("/summary.md"), /Title: Kitchen Sink/);
  assert.match(await io.readFileAsync("/summary.md"), /Status: draft/);
  assert.match(await io.readFileAsync("/summary.md"), /Version: 1\.0\.0/);

  const mutated = await set({
    io,
    file: "/input.md",
    template: "/template.tpl.md",
    key: "version",
    value: "2.0.0",
  });
  assert.equal(mutated.ok, true, mutated.errors.map((err) => err.message).join("; "));
  assert.equal(mutated.context.version, "2.0.0");
  assert.equal(mutated.context.status, "draft");
  assert.match(normalize(mutated.output), /Version: 2\.0\.0/);
  assert.match(await io.readFileAsync("/input.md"), /Version: 2\.0\.0/);
});
