import test from "node:test";
import assert from "node:assert/strict";

import { create } from "../../sources/commands/create.mjs";
import { exportDoc } from "../../sources/commands/exportDoc.mjs";
import { normalizeDocument, readText, utf8ByteLength } from "../../sources/commands/helpers.mjs";
import { Editor } from "../../sources/Editor.mjs";
import { Virtual } from "../../sources/IO/Virtual.mjs";
import { ERROR_CODES } from "../../sources/SyntaxError.mjs";

const LINE_TPL = '{% doc.line().as("title") %}\n';
const TWO_LINE_TPL = '{% doc.line().as("a") %}\n{% doc.line().as("b") %}\n';
const CODE_TPL = '{% doc.codeBlock().as("block") %}\n';
const HTML_TPL = '{% doc.htmlBlock().as("html") %}\n{% doc.optional() %}\n';

async function readDoc(raw) {
  return readText(new Virtual({ "/doc.md": raw }), "/doc.md");
}

async function openDoc(raw, template = LINE_TPL) {
  return Editor.open({
    io: new Virtual({ "/doc.md": raw, "/tpl.md": template }),
    file: "/doc.md",
    template: "/tpl.md",
  });
}

async function parseDoc(raw, template = LINE_TPL) {
  const io = new Virtual({ "/doc.md": raw, "/tpl.md": template });
  return exportDoc({ io, file: "/doc.md", template: "/tpl.md", savePath: "/out.json" });
}

async function renderData(data, template = LINE_TPL) {
  const io = new Virtual({ "/tpl.md": template });
  return create({ io, file: "/out.md", template: "/tpl.md", data });
}

async function roundtrip2(raw, template = LINE_TPL) {
  const parsed = await parseDoc(raw, template);
  assert.equal(parsed.ok, true, parsed.errors.map((err) => err.message).join("; "));
  const rendered = await renderData(parsed.context, template);
  assert.equal(rendered.ok, true, rendered.errors.map((err) => err.message).join("; "));
  return { parsed, rendered };
}

test("normalizeDocument strips a leading BOM", () => {
  assert.equal(normalizeDocument("\uFEFFhello\n"), "hello\n");
  assert.equal(normalizeDocument("a\uFEFFb\n"), "a\uFEFFb\n");
});

test("normalizeDocument converts CRLF and CR to LF", () => {
  assert.equal(normalizeDocument("a\r\nb\rc\n"), "a\nb\nc\n");
});

test("normalizeDocument converts CR-only input to LF", () => {
  assert.equal(normalizeDocument("alpha\rbeta\r"), "alpha\nbeta\n");
  assert.equal(normalizeDocument("alpha\rbeta"), "alpha\nbeta\n");
  assert.ok(!normalizeDocument("alpha\rbeta\r").includes("\r"));
});

test("normalizeDocument ensures a final LF", () => {
  assert.equal(normalizeDocument("hello"), "hello\n");
  assert.equal(normalizeDocument("hello\n"), "hello\n");
  assert.equal(normalizeDocument(""), "\n");
  assert.equal(normalizeDocument("\uFEFF"), "\n");
});

test("normalizeDocument does not NFC-normalize", () => {
  assert.equal(normalizeDocument("caf\u00e9\n"), "caf\u00e9\n");
  assert.equal(normalizeDocument("cafe\u0301\n"), "cafe\u0301\n");
  assert.notEqual(normalizeDocument("caf\u00e9\n"), normalizeDocument("cafe\u0301\n"));
  assert.equal("cafe\u0301".normalize("NFC"), "caf\u00e9");
});

test("normalizeDocument preserves trailing spaces and intra-line whitespace", () => {
  assert.equal(normalizeDocument("caf\u00e9  \n"), "caf\u00e9  \n");
  assert.equal(normalizeDocument("hello  \t  \nworld   "), "hello  \t  \nworld   \n");
});

test("readText returns stripped LF source with a final LF", async () => {
  const io = new Virtual({ "/doc.md": "\uFEFFa\r\nb\rc" });
  assert.equal(await readText(io, "/doc.md"), "a\nb\nc\n");
});

test("readText converts CR-only input to LF", async () => {
  const raw = "alpha\rbeta\r";
  assert.equal(await readDoc(raw), "alpha\nbeta\n");
  assert.ok(!raw.includes("\n"));
  assert.ok(!(await readDoc(raw)).includes("\r"));
});

test("readText inserts a final LF when the input has none", async () => {
  assert.equal(await readDoc("hello"), "hello\n");
  assert.equal(await readDoc("hello\n"), "hello\n");
  assert.equal(await readDoc(""), "\n");
});

test("readText preserves precomposed and decomposed Unicode separately", async () => {
  const nfc = "caf\u00e9\n";
  const nfd = "cafe\u0301\n";
  assert.equal(await readDoc(nfc), nfc);
  assert.equal(await readDoc(nfd), nfd);
  assert.notEqual(await readDoc(nfc), await readDoc(nfd));
});

test("readText preserves trailing spaces", async () => {
  assert.equal(await readDoc("Hello  \nworld   "), "Hello  \nworld   \n");
});

test("readText preserves intra-line tabs and multiple spaces", async () => {
  assert.equal(await readDoc("hello  \t  world\nfoo \t\t bar"), "hello  \t  world\nfoo \t\t bar\n");
});

test("library reads convert CR-only input and round-trip to LF", async () => {
  const raw = "alpha\rbeta\r";
  const lf = "alpha\nbeta\n";
  const editor = await openDoc(raw, TWO_LINE_TPL);
  assert.equal(editor.originalSource, lf);
  assert.equal(editor.render(), lf);
  assert.equal(editor.get("a"), "alpha");
  assert.equal(editor.get("b"), "beta");

  const { parsed, rendered } = await roundtrip2(raw, TWO_LINE_TPL);
  assert.deepEqual(parsed.context, { a: "alpha", b: "beta" });
  assert.equal(rendered.output, lf);
  assert.ok(!rendered.output.includes("\r"));
});

test("library reads insert a final LF and do not double an existing one", async () => {
  const editor = await openDoc("Hello");
  assert.equal(editor.originalSource, "Hello\n");
  assert.equal(editor.render(), "Hello\n");
  assert.equal(editor.get("title"), "Hello");

  const already = await openDoc("Hello\n");
  assert.equal(already.originalSource, "Hello\n");
  assert.equal(already.render(), "Hello\n");

  const { parsed, rendered } = await roundtrip2("Hello");
  assert.deepEqual(parsed.context, { title: "Hello" });
  assert.equal(rendered.output, "Hello\n");
});

test("library reads do not NFC-normalize precomposed vs decomposed text", async () => {
  const nfc = "caf\u00e9\n";
  const nfd = "cafe\u0301\n";
  assert.equal("cafe\u0301".normalize("NFC"), "caf\u00e9");

  const nfcEditor = await openDoc(nfc);
  const nfdEditor = await openDoc(nfd);
  assert.equal(nfcEditor.originalSource, nfc);
  assert.equal(nfdEditor.originalSource, nfd);
  assert.notEqual(nfcEditor.originalSource, nfdEditor.originalSource);
  assert.equal(nfcEditor.get("title"), "caf\u00e9");
  assert.equal(nfdEditor.get("title"), "cafe\u0301");

  const nfcRound = await roundtrip2(nfc);
  const nfdRound = await roundtrip2(nfd);
  assert.equal(nfcRound.parsed.context.title, "caf\u00e9");
  assert.equal(nfdRound.parsed.context.title, "cafe\u0301");
  assert.equal(nfcRound.rendered.output, nfc);
  assert.equal(nfdRound.rendered.output, nfd);
  assert.notEqual(nfcRound.rendered.output, nfdRound.rendered.output);
});

test("library reads preserve trailing spaces through parse and render", async () => {
  const raw = "Hello  \nworld   ";
  const normalized = "Hello  \nworld   \n";
  const editor = await openDoc(raw, TWO_LINE_TPL);
  assert.equal(editor.originalSource, normalized);
  assert.equal(editor.get("a"), "Hello  ");
  assert.equal(editor.get("b"), "world   ");

  const { parsed, rendered } = await roundtrip2(raw, TWO_LINE_TPL);
  assert.deepEqual(parsed.context, { a: "Hello  ", b: "world   " });
  assert.equal(rendered.output, normalized);
});

test("library reads preserve intra-line whitespace in text, code, and HTML", async () => {
  const raw = "hello  \t  world\nfoo \t\t bar";
  const normalized = "hello  \t  world\nfoo \t\t bar\n";
  const editor = await openDoc(raw, TWO_LINE_TPL);
  assert.equal(editor.originalSource, normalized);
  assert.equal(editor.get("a"), "hello  \t  world");
  assert.equal(editor.get("b"), "foo \t\t bar");

  const { parsed, rendered } = await roundtrip2(raw, TWO_LINE_TPL);
  assert.deepEqual(parsed.context, { a: "hello  \t  world", b: "foo \t\t bar" });
  assert.equal(rendered.output, normalized);

  const code = "```\n  foo\t  bar  \n    baz  \n```\n";
  const codeEditor = await openDoc(code, CODE_TPL);
  assert.equal(codeEditor.originalSource, code);
  assert.equal(codeEditor.get("block").value, "  foo\t  bar  \n    baz  ");

  const codeRound = await roundtrip2(code, CODE_TPL);
  assert.equal(codeRound.parsed.context.block.value, "  foo\t  bar  \n    baz  ");
  assert.match(codeRound.rendered.output, /  foo\t  bar  \n    baz  /);

  const html = "<div class=\"x\">  foo\tbar  </div>\n";
  const htmlEditor = await openDoc(html, HTML_TPL);
  assert.equal(htmlEditor.originalSource, html);
  assert.equal(htmlEditor.get("html"), "<div class=\"x\">  foo\tbar  </div>");

  const htmlRound = await roundtrip2(html, HTML_TPL);
  assert.equal(htmlRound.parsed.context.html, "<div class=\"x\">  foo\tbar  </div>");
  assert.match(htmlRound.rendered.output, /<div class="x">  foo\tbar  <\/div>/);
});

test("readText rejects raw UTF-8 bytes over options.maxInputBytes", async () => {
  const raw = "hello";
  const io = new Virtual({ "/doc.md": raw });
  const size = utf8ByteLength(raw);
  assert.equal(await readText(io, "/doc.md", { maxInputBytes: size }), "hello\n");
  await assert.rejects(
    () => readText(io, "/doc.md", { maxInputBytes: size - 1 }),
    (err) => {
      assert.equal(err.code, ERROR_CODES.DO_MD_USER_ERROR);
      assert.equal(err.file, "/doc.md");
      return true;
    },
  );
});

test("readText measures raw bytes, not post-normalize length", async () => {
  const raw = "hello";
  const io = new Virtual({ "/doc.md": raw });
  const size = utf8ByteLength(raw);
  assert.ok(utf8ByteLength(normalizeDocument(raw)) > size);
  assert.equal(await readText(io, "/doc.md", { maxInputBytes: size }), "hello\n");
});
