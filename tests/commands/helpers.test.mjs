import test from "node:test";
import assert from "node:assert/strict";

import { create } from "../../sources/commands/create.mjs";
import { exportDoc } from "../../sources/commands/exportDoc.mjs";
import {
  normalizeDocument,
  parseSource,
  readText,
  utf8ByteLength,
  wrapTemplate,
  writeText,
} from "../../sources/commands/helpers.mjs";
import { Editor } from "../../sources/Editor.mjs";
import { Virtual } from "../../sources/IO/Virtual.mjs";
import { ERROR_CODES } from "../../sources/DoMdError.mjs";

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

test("normalizeDocument preserves a leading BOM", () => {
  assert.equal(normalizeDocument("\uFEFFhello\n"), "\uFEFFhello\n");
  assert.equal(normalizeDocument("a\uFEFFb\n"), "a\uFEFFb\n");
});

test("normalizeDocument preserves mixed line endings", () => {
  assert.equal(normalizeDocument("a\r\nb\rc\n"), "a\r\nb\rc\n");
});

test("normalizeDocument preserves CR-only input", () => {
  assert.equal(normalizeDocument("alpha\rbeta\r"), "alpha\rbeta\r");
  assert.equal(normalizeDocument("alpha\rbeta"), "alpha\rbeta");
});

test("normalizeDocument preserves final-newline state", () => {
  assert.equal(normalizeDocument("hello"), "hello");
  assert.equal(normalizeDocument("hello\n"), "hello\n");
  assert.equal(normalizeDocument(""), "");
  assert.equal(normalizeDocument("\uFEFF"), "\uFEFF");
});

test("normalizeDocument does not NFC-normalize", () => {
  assert.equal(normalizeDocument("caf\u00e9\n"), "caf\u00e9\n");
  assert.equal(normalizeDocument("cafe\u0301\n"), "cafe\u0301\n");
  assert.notEqual(normalizeDocument("caf\u00e9\n"), normalizeDocument("cafe\u0301\n"));
  assert.equal("cafe\u0301".normalize("NFC"), "caf\u00e9");
});

test("normalizeDocument preserves trailing spaces and intra-line whitespace", () => {
  assert.equal(normalizeDocument("caf\u00e9  \n"), "caf\u00e9  \n");
  assert.equal(normalizeDocument("hello  \t  \nworld   "), "hello  \t  \nworld   ");
});

test("readText returns exact source bytes", async () => {
  const io = new Virtual({ "/doc.md": "\uFEFFa\r\nb\rc" });
  assert.equal(await readText(io, "/doc.md"), "\uFEFFa\r\nb\rc");
});

test("readText preserves CR-only input", async () => {
  const raw = "alpha\rbeta\r";
  assert.equal(await readDoc(raw), raw);
  assert.ok(!raw.includes("\n"));
  assert.ok((await readDoc(raw)).includes("\r"));
});

test("readText preserves a missing final LF", async () => {
  assert.equal(await readDoc("hello"), "hello");
  assert.equal(await readDoc("hello\n"), "hello\n");
  assert.equal(await readDoc(""), "");
});

test("readText preserves precomposed and decomposed Unicode separately", async () => {
  const nfc = "caf\u00e9\n";
  const nfd = "cafe\u0301\n";
  assert.equal(await readDoc(nfc), nfc);
  assert.equal(await readDoc(nfd), nfd);
  assert.notEqual(await readDoc(nfc), await readDoc(nfd));
});

test("readText preserves trailing spaces", async () => {
  assert.equal(await readDoc("Hello  \nworld   "), "Hello  \nworld   ");
});

test("readText preserves intra-line tabs and multiple spaces", async () => {
  assert.equal(await readDoc("hello  \t  world\nfoo \t\t bar"), "hello  \t  world\nfoo \t\t bar");
});

test("library reads preserve CR-only input while generated output remains LF", async () => {
  const raw = "alpha\rbeta\r";
  const lf = "alpha\nbeta\n";
  const editor = await openDoc(raw, TWO_LINE_TPL);
  assert.equal(editor.originalSource, raw);
  assert.equal(editor.render(), raw);
  assert.equal(editor.get("a"), "alpha");
  assert.equal(editor.get("b"), "beta");

  const { parsed, rendered } = await roundtrip2(raw, TWO_LINE_TPL);
  assert.deepEqual(parsed.context, { a: "alpha", b: "beta" });
  assert.equal(rendered.output, lf);
  assert.ok(!rendered.output.includes("\r"));
});

test("library reads preserve missing and existing final LF", async () => {
  const editor = await openDoc("Hello");
  assert.equal(editor.originalSource, "Hello");
  assert.equal(editor.render(), "Hello");
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
  const normalized = raw;
  const editor = await openDoc(raw, TWO_LINE_TPL);
  assert.equal(editor.originalSource, normalized);
  assert.equal(editor.get("a"), "Hello  ");
  assert.equal(editor.get("b"), "world   ");

  const { parsed, rendered } = await roundtrip2(raw, TWO_LINE_TPL);
  assert.deepEqual(parsed.context, { a: "Hello  ", b: "world   " });
  assert.equal(rendered.output, `${normalized}\n`);
});

test("library reads preserve intra-line whitespace in text, code, and HTML", async () => {
  const raw = "hello  \t  world\nfoo \t\t bar";
  const normalized = raw;
  const editor = await openDoc(raw, TWO_LINE_TPL);
  assert.equal(editor.originalSource, normalized);
  assert.equal(editor.get("a"), "hello  \t  world");
  assert.equal(editor.get("b"), "foo \t\t bar");

  const { parsed, rendered } = await roundtrip2(raw, TWO_LINE_TPL);
  assert.deepEqual(parsed.context, { a: "hello  \t  world", b: "foo \t\t bar" });
  assert.equal(rendered.output, `${normalized}\n`);

  const code = "```\n  foo\t  bar  \n    baz  \n```\n";
  const codeEditor = await openDoc(code, CODE_TPL);
  assert.equal(codeEditor.originalSource, code);
  assert.equal(codeEditor.get("block").value, "  foo\t  bar  \n    baz  ");

  const codeRound = await roundtrip2(code, CODE_TPL);
  assert.equal(codeRound.parsed.context.block.value, "  foo\t  bar  \n    baz  ");
  assert.match(codeRound.rendered.output, /  foo\t  bar  \n    baz  /);

  const html = '<div class="x">  foo\tbar  </div>\n';
  const htmlEditor = await openDoc(html, HTML_TPL);
  assert.equal(htmlEditor.originalSource, html);
  assert.equal(htmlEditor.get("html"), '<div class="x">  foo\tbar  </div>');

  const htmlRound = await roundtrip2(html, HTML_TPL);
  assert.equal(htmlRound.parsed.context.html, '<div class="x">  foo\tbar  </div>');
  assert.match(htmlRound.rendered.output, /<div class="x">  foo\tbar  <\/div>/);
});

test("readText rejects raw UTF-8 bytes over options.maxInputBytes", async () => {
  const raw = "hello";
  const io = new Virtual({ "/doc.md": raw });
  const size = utf8ByteLength(raw);
  assert.equal(await readText(io, "/doc.md", { maxInputBytes: size }), "hello");
  await assert.rejects(
    () => readText(io, "/doc.md", { maxInputBytes: size - 1 }),
    (err) => {
      assert.equal(err.code, ERROR_CODES.DO_MD_USER_ERROR);
      assert.equal(err.locations[0].source, "/doc.md");
      return true;
    },
  );
});

test("conditional writes reject adapters without atomic-write support", async () => {
  const io = {
    async writeFileAsync() {},
  };
  await assert.rejects(
    () => writeText(io, "/doc.md", "next", { expectedRevision: "sha256:old" }),
    (error) => error.code === ERROR_CODES.DO_MD_USER_ERROR && /atomic writes/.test(error.message),
  );
});

test("readText measures raw bytes, not post-normalize length", async () => {
  const raw = "hello";
  const io = new Virtual({ "/doc.md": raw });
  const size = utf8ByteLength(raw);
  assert.equal(utf8ByteLength(normalizeDocument(raw)), size);
  assert.equal(await readText(io, "/doc.md", { maxInputBytes: size }), "hello");
});

test("parseSource reports trailing content after template execution", () => {
  const source = "first\nsecond\n";
  const fn = wrapTemplate(LINE_TPL, "/tpl.md");
  const reader = parseSource(source, fn, { file: "/doc.md", templatePath: "/tpl.md" });
  assert.equal(reader.context.title, "first");
  assert.equal(reader.errors.length, 1);
  assert.equal(reader.errors[0].code, ERROR_CODES.DO_MD_PARSE_ERROR);
  assert.match(reader.errors[0].message, /unexpected trailing content/);
});
