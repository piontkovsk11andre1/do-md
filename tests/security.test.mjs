import test from "node:test";
import assert from "node:assert/strict";

import { Editor } from "../sources/Editor.mjs";
import { validate } from "../sources/commands/validate.mjs";
import { exportDoc } from "../sources/commands/exportDoc.mjs";
import { set } from "../sources/commands/set.mjs";
import { create } from "../sources/commands/create.mjs";
import { readText, utf8ByteLength } from "../sources/commands/helpers.mjs";
import { Virtual } from "../sources/IO/Virtual.mjs";
import { ERROR_CODES } from "../sources/SyntaxError.mjs";

const TEMPLATE = '{% doc.line().as("title") %}\n';
const INPUT = "Hello\n";

function files(doc = INPUT) {
  return { "/doc.md": doc, "/tpl.md": TEMPLATE };
}

function underLimit(...texts) {
  return Math.max(...texts.map((text) => utf8ByteLength(text)));
}

test("maxInputBytes is unlimited by default", async () => {
  const oversized = `${"A".repeat(20000)}\n`;
  const io = new Virtual(files(oversized));
  const editor = await Editor.open({ io, file: "/doc.md", template: "/tpl.md" });
  assert.equal(editor.get("title"), "A".repeat(20000));
  const result = await validate({ io, file: "/doc.md", template: "/tpl.md" });
  assert.equal(result.ok, true);
});

test("maxInputBytes rejects input larger than the raw UTF-8 byte limit", async () => {
  const io = new Virtual(files());
  const size = utf8ByteLength(INPUT);
  await assert.rejects(
    () => Editor.open({ io, file: "/doc.md", template: "/tpl.md", options: { maxInputBytes: size - 1 } }),
    (err) => {
      assert.equal(err.code, ERROR_CODES.DO_MD_USER_ERROR);
      assert.equal(err.file, "/doc.md");
      return true;
    },
  );
});

test("maxInputBytes allows input equal to the raw UTF-8 byte limit", async () => {
  const io = new Virtual(files());
  const editor = await Editor.open({
    io,
    file: "/doc.md",
    template: "/tpl.md",
    options: { maxInputBytes: underLimit(INPUT, TEMPLATE) },
  });
  assert.equal(editor.get("title"), "Hello");
});

test("maxInputBytes counts UTF-8 bytes, not JS string length", async () => {
  const raw = `${"é".repeat(20)}\n`;
  assert.ok(utf8ByteLength(raw) > raw.length);
  const io = new Virtual(files(raw));
  await assert.rejects(
    () =>
      Editor.open({
        io,
        file: "/doc.md",
        template: "/tpl.md",
        options: { maxInputBytes: raw.length },
      }),
    (err) => {
      assert.equal(err.code, ERROR_CODES.DO_MD_USER_ERROR);
      assert.equal(err.file, "/doc.md");
      return true;
    },
  );
  const editor = await Editor.open({
    io,
    file: "/doc.md",
    template: "/tpl.md",
    options: { maxInputBytes: underLimit(raw, TEMPLATE) },
  });
  assert.equal(editor.get("title"), "é".repeat(20));
});

test("maxInputBytes uses raw bytes, not post-normalize length", async () => {
  const raw = "Hello";
  const previousNormalized = "Hello\n";
  assert.ok(utf8ByteLength(previousNormalized) > utf8ByteLength(raw));
  const io = new Virtual(files(raw));
  const editor = await Editor.open({
    io,
    file: "/doc.md",
    template: "/tpl.md",
    options: { maxInputBytes: underLimit(raw, TEMPLATE) },
  });
  assert.equal(editor.originalSource, raw);
  await assert.rejects(
    () =>
      readText(new Virtual({ "/doc.md": "\uFEFFHello\n" }), "/doc.md", {
        maxInputBytes: utf8ByteLength("Hello\n"),
      }),
    (err) => err.code === ERROR_CODES.DO_MD_USER_ERROR,
  );
});

test("validate rejects maxInputBytes overflow", async () => {
  const io = new Virtual(files());
  await assert.rejects(
    () => validate({ io, file: "/doc.md", template: "/tpl.md", options: { maxInputBytes: 1 } }),
    (err) => {
      assert.equal(err.code, ERROR_CODES.DO_MD_USER_ERROR);
      assert.equal(err.file, "/doc.md");
      return true;
    },
  );
});

test("exportDoc rejects maxInputBytes overflow", async () => {
  const io = new Virtual(files());
  await assert.rejects(
    () =>
      exportDoc({
        io,
        file: "/doc.md",
        template: "/tpl.md",
        savePath: "/out.json",
        options: { maxInputBytes: 1 },
      }),
    (err) => err.code === ERROR_CODES.DO_MD_USER_ERROR,
  );
  assert.equal(io.entries.has("/out.json"), false);
});

test("set rejects maxInputBytes overflow", async () => {
  const io = new Virtual(files());
  await assert.rejects(
    () =>
      set({
        io,
        file: "/doc.md",
        template: "/tpl.md",
        key: "title",
        value: "X",
        options: { maxInputBytes: 1 },
      }),
    (err) => err.code === ERROR_CODES.DO_MD_USER_ERROR,
  );
});

test("create rejects a template over maxInputBytes", async () => {
  const io = new Virtual({ "/tpl.md": TEMPLATE });
  await assert.rejects(
    () =>
      create({
        io,
        file: "/out.md",
        template: "/tpl.md",
        data: { title: "Hello" },
        options: { maxInputBytes: 1 },
      }),
    (err) => {
      assert.equal(err.code, ERROR_CODES.DO_MD_USER_ERROR);
      assert.equal(err.file, "/tpl.md");
      return true;
    },
  );
});

const UNSAFE_PATCHES = [
  [{ ["__proto__"]: { polluted: true } }, "__proto__"],
  [{ constructor: { polluted: true } }, "constructor"],
  [{ prototype: { polluted: true } }, "prototype"],
  [{ extra: { ["__proto__"]: { polluted: true } } }, "extra.__proto__"],
  [{ extra: { nested: { constructor: true } } }, "extra.nested.constructor"],
  [{ items: [{ prototype: true }] }, "items[0].prototype"],
  [JSON.parse('{"__proto__":{"polluted":true}}'), "__proto__"],
  [JSON.parse('{"extra":{"constructor":{"polluted":true}}}'), "extra.constructor"],
];

function assertUnsafePatch(err, path) {
  assert.equal(err.code, ERROR_CODES.DO_MD_USER_ERROR);
  assert.match(err.message, /unsafe patch key/);
  assert.match(err.message, new RegExp(path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  return true;
}

test("Editor.merge rejects __proto__, constructor, and prototype at any depth", async () => {
  const io = new Virtual(files());
  const editor = await Editor.open({ io, file: "/doc.md", template: "/tpl.md" });
  for (const [patch, path] of UNSAFE_PATCHES) {
    assert.throws(() => editor.merge(patch), (err) => assertUnsafePatch(err, path));
  }
  assert.equal(editor.isDirty, false);
  assert.equal(editor.get("title"), "Hello");
  assert.equal(Object.hasOwn(Object.prototype, "polluted"), false);
  assert.equal({}.polluted, undefined);
});

test("set({ patch }) rejects prototype-pollution keys and does not write", async () => {
  const io = new Virtual(files());
  for (const [patch, path] of UNSAFE_PATCHES) {
    await assert.rejects(
      () => set({ io, file: "/doc.md", template: "/tpl.md", patch }),
      (err) => assertUnsafePatch(err, path),
    );
  }
  assert.equal(await io.readFileAsync("/doc.md"), INPUT);
});

test("Markdown documents are data and are never executed", async () => {
  const payload = [
    "process.exit(1)",
    'new Function("throw new Error(\\"executed\\")")()',
    '<script>throw new Error("xss")</script>',
    "{% process.exit(1) %}",
  ].join("\n");
  const tpl = [
    '{% doc.line().as("exit") %}',
    '{% doc.line().as("fn") %}',
    '{% doc.line().as("script") %}',
    '{% doc.line().as("block") %}',
  ].join("\n");
  const htmlTpl = "{% doc.htmlBlock().as(\"html\") %}\n{% doc.rawRest().as(\"remainder\") %}";
  const htmlDoc = "<div>\n<script>alert(1)</script>\n\nAfter\n";
  const io = new Virtual({
    "/doc.md": `${payload}\n`,
    "/tpl.md": `${tpl}\n`,
    "/html.md": htmlDoc,
    "/html.tpl.md": htmlTpl,
  });

  const result = await exportDoc({
    io,
    file: "/doc.md",
    template: "/tpl.md",
    savePath: "/out.json",
  });
  assert.equal(result.ok, true);
  assert.equal(result.context.exit, "process.exit(1)");
  assert.equal(result.context.fn, 'new Function("throw new Error(\\"executed\\")")()');
  assert.equal(result.context.script, '<script>throw new Error("xss")</script>');
  assert.equal(result.context.block, "{% process.exit(1) %}");

  const html = await exportDoc({
    io,
    file: "/html.md",
    template: "/html.tpl.md",
    savePath: "/html.json",
  });
  assert.equal(html.ok, true);
  assert.equal(html.context.html, "<div>\n<script>alert(1)</script>");

  const checked = await validate({ io, file: "/doc.md", template: "/tpl.md" });
  assert.equal(checked.ok, true);
});

test("trusted templates are unsandboxed and may access process", async () => {
  const tpl = "{% ctx.hostPid = process.pid\ndoc.line().as(\"title\") %}\n";
  const io = new Virtual({ "/doc.md": INPUT, "/tpl.md": tpl });
  const result = await exportDoc({
    io,
    file: "/doc.md",
    template: "/tpl.md",
    savePath: "/out.json",
  });
  assert.equal(result.ok, true);
  assert.equal(result.context.hostPid, process.pid);
  assert.equal(result.context.title, "Hello");
});
