import test from "node:test";
import assert from "node:assert/strict";

import { Reader } from "../sources/Reader.mjs";
import { Slot } from "../sources/Slot.mjs";
import { Template } from "../sources/Template.mjs";
import { ERROR_CODES, SyntaxError } from "../sources/SyntaxError.mjs";

test("Reader module exists", () => {
  assert.equal(typeof Reader, "function");
  const reader = new Reader("text");
  assert.equal(reader.source, "text");
});

test("Reader starts with a fresh context object", () => {
  const reader = new Reader("hello");
  assert.deepEqual(reader.context, {});
  assert.equal(reader.offset, 0);
  assert.equal(reader.optionalMode, false);
});

test("literal consumes exact non-whitespace and returns the reader", () => {
  const reader = new Reader("# title\n");
  assert.equal(reader.literal("# "), reader);
  assert.equal(reader.offset, 2);
  assert.equal(reader.errors.length, 0);
});

test("literal follows Parser whitespace rules", () => {
  const reader = new Reader("a \t  b\n\n\nc");
  reader.literal("a b\n\n");
  assert.equal(reader.offset, 9);
  reader.literal("c");
  assert.equal(reader.errors.length, 0);
});

test("required literal mismatch records a parse error and leaves the cursor", () => {
  const reader = new Reader("hello\nworld", { file: "doc.md" });
  reader.literal("hello\n");
  reader.literal("earth");
  assert.equal(reader.offset, 6);
  assert.equal(reader.errors.length, 1);
  const err = reader.errors[0];
  assert.ok(err instanceof SyntaxError);
  assert.equal(err.code, ERROR_CODES.DO_MD_PARSE_ERROR);
  assert.equal(err.file, "doc.md");
  assert.equal(err.line, 2);
  assert.equal(err.column, 1);
});

test("optional literal mismatch rewinds the cursor", () => {
  const reader = new Reader("hello\nworld");
  reader.literal("hello\n");
  reader.optional().literal("earth");
  assert.equal(reader.offset, 6);
  assert.equal(reader._line, 2);
  assert.equal(reader.char, 1);
  assert.equal(reader.errors.length, 0);
});

test("line consumes text up to but not including the newline", () => {
  const reader = new Reader("hello\nworld");
  const slot = reader.line();
  assert.ok(slot instanceof Slot);
  assert.equal(slot.leafType, "line");
  assert.equal(slot.value, "hello");
  assert.equal(slot.sourceOffsetStart, 0);
  assert.equal(slot.sourceOffsetEnd, 5);
  assert.equal(reader.offset, 5);
  assert.equal(reader.remaining(), "\nworld");
});

test("line matches an empty line when the cursor is on a newline", () => {
  const reader = new Reader("\nnext");
  const slot = reader.line();
  assert.equal(slot.value, "");
  assert.equal(slot.sourceOffsetStart, 0);
  assert.equal(slot.sourceOffsetEnd, 0);
  assert.equal(reader.offset, 0);
});

test("line consumes the last line when there is no trailing newline", () => {
  const reader = new Reader("tail");
  const slot = reader.line();
  assert.equal(slot.value, "tail");
  assert.equal(reader.offset, 4);
  assert.equal(reader.errors.length, 0);
});

test("required line at EOF records a parse error", () => {
  const reader = new Reader("", { file: "empty.md" });
  const slot = reader.line();
  assert.equal(slot.value, null);
  assert.equal(slot.leafType, "line");
  assert.equal(reader.errors.length, 1);
  assert.equal(reader.errors[0].code, ERROR_CODES.DO_MD_PARSE_ERROR);
  assert.equal(reader.errors[0].file, "empty.md");
  assert.equal(reader.errors[0].line, 1);
  assert.equal(reader.errors[0].column, 1);
});

test("optional line at EOF rewinds and records no error", () => {
  const reader = new Reader("ab");
  reader.literal("ab");
  const slot = reader.optional().line();
  assert.equal(slot.value, null);
  assert.equal(reader.offset, 2);
  assert.equal(reader.errors.length, 0);
});

test("until consumes text up to a limiter", () => {
  const reader = new Reader("foo] bar");
  const slot = reader.until("]");
  assert.ok(slot instanceof Slot);
  assert.equal(slot.leafType, "text");
  assert.equal(slot.value, "foo");
  assert.equal(slot.sourceOffsetStart, 0);
  assert.equal(slot.sourceOffsetEnd, 3);
  assert.equal(reader.offset, 3);
  assert.equal(reader.remaining(), "] bar");
});

test("optional until rewinds when the limiter is missing", () => {
  const reader = new Reader("foo");
  const slot = reader.optional().until("]");
  assert.equal(slot.value, null);
  assert.equal(reader.offset, 0);
  assert.equal(reader.errors.length, 0);
});

test("regexp consumes a full match at the cursor", () => {
  const reader = new Reader("v1.2.3 tail");
  const slot = reader.regexp(/v\d+\.\d+\.\d+/);
  assert.ok(slot instanceof Slot);
  assert.equal(slot.leafType, "text");
  assert.equal(slot.value, "v1.2.3");
  assert.equal(slot.sourceOffsetStart, 0);
  assert.equal(slot.sourceOffsetEnd, 6);
  assert.equal(reader.offset, 6);
});

test("optional regexp rewinds on miss", () => {
  const reader = new Reader("abc");
  const slot = reader.optional().regexp(/\d+/);
  assert.equal(slot.value, null);
  assert.equal(reader.offset, 0);
  assert.equal(reader.errors.length, 0);
});

test("as binds parsed leaf values into reader.context", () => {
  const reader = new Reader("# hello\n");
  reader.literal("# ");
  reader.line().as("title");
  assert.deepEqual(reader.context, { title: "hello" });
});

test("asArray appends into reader.context", () => {
  const reader = new Reader("one\ntwo\n");
  reader.line().asArray("notes");
  reader.literal("\n");
  reader.line().asArray("notes");
  assert.deepEqual(reader.context, { notes: ["one", "two"] });
});

test("an unbound leaf is discarded", () => {
  const reader = new Reader("hello\n");
  reader.line();
  assert.deepEqual(reader.context, {});
});

test("trim and default apply when binding into context", () => {
  const reader = new Reader("#   hi\n");
  reader.literal("# ");
  reader.line().trim().as("title");
  reader.optional().regexp(/\d+/).default("0").as("count");
  assert.deepEqual(reader.context, { title: "hi", count: "0" });
});

test("a template with literal text and line().as parses to the bound key", () => {
  const fn = Template.wrap('# {% doc.line().as("k") %}\n', "t.tpl.md");
  const reader = new Reader("# hello\n");
  fn(reader, reader.context, null, {}, null);
  assert.deepEqual(reader.context, { k: "hello" });
  assert.equal(reader.errors.length, 0);
});

test("notEmpty records DO_MD_PARSE_ERROR with file, line, and column", () => {
  const reader = new Reader("\n", { file: "doc.md" });
  assert.throws(
    () => reader.line().notEmpty().as("k"),
    (err) => {
      assert.ok(err instanceof SyntaxError);
      assert.equal(err.code, ERROR_CODES.DO_MD_PARSE_ERROR);
      assert.equal(err.file, "doc.md");
      assert.equal(err.line, 1);
      assert.equal(err.column, 1);
      return true;
    },
  );
});

test("exists is true only when the leaf matched", () => {
  const reader = new Reader("hello");
  assert.equal(reader.line().as("k").exists, true);
  assert.equal(reader.optional().regexp(/\d+/).as("n").exists, false);
});

test("parseDocument returns a positioned document AST", () => {
  const source = "# Title\n\nBody\n";
  const reader = new Reader(source);
  const doc = reader.parseDocument();
  assert.equal(doc.type, "document");
  assert.equal(doc.children[0].type, "heading");
  assert.equal(doc.children[0].level, 1);
  assert.equal(doc.children[1].type, "paragraph");
  assert.equal(typeof doc.position.start.offset, "number");
  assert.equal(typeof doc.position.end.offset, "number");
  assert.equal(doc.position.end.offset, source.length);
});

test("heading returns flattened text and the AST node", () => {
  const reader = new Reader("# Hello *world*\n");
  const slot = reader.heading();
  assert.ok(slot instanceof Slot);
  assert.equal(slot.leafType, "heading");
  assert.equal(slot.value, "Hello world");
  assert.equal(slot.node.type, "heading");
  assert.equal(slot.node.level, 1);
  assert.equal(slot.sourceOffsetStart, 0);
  assert.equal(slot.sourceOffsetEnd, 15);
  assert.equal(reader.offset, 15);
});

test("heading(level) matches only that ATX or Setext level", () => {
  const atx = new Reader("## Two\n");
  assert.equal(atx.heading(2).value, "Two");
  const setext = new Reader("Title\n=====\n").heading(1);
  assert.equal(setext.value, "Title");
  assert.equal(setext.node.level, 1);
  const miss = new Reader("## Two\n");
  assert.equal(miss.heading(1).value, null);
  assert.equal(miss.offset, 0);
  assert.equal(miss.errors.length, 1);
  assert.equal(miss.errors[0].code, ERROR_CODES.DO_MD_PARSE_ERROR);
});

test("paragraph returns flattened text and records offsets", () => {
  const reader = new Reader("Hello *world*\nand more\n");
  const slot = reader.paragraph();
  assert.equal(slot.leafType, "paragraph");
  assert.equal(slot.value, "Hello world\nand more");
  assert.equal(slot.node.type, "paragraph");
  assert.equal(slot.sourceOffsetStart, 0);
  assert.equal(slot.sourceOffsetEnd, 22);
});

test("list returns one flattened string per item and binds with as", () => {
  const reader = new Reader("- one\n- two *x*\n");
  const slot = reader.list().as("items");
  assert.equal(slot.leafType, "list");
  assert.deepEqual(slot.value, ["one", "two x"]);
  assert.equal(slot.node.type, "list");
  assert.deepEqual(reader.context, { items: ["one", "two x"] });
});

test("table returns headers, rows, and align", () => {
  const reader = new Reader("| A | B | C | D |\n| :--- | ---: | :---: | --- |\n| 1 | 2 | 3 | 4 |\n");
  const slot = reader.table();
  assert.equal(slot.leafType, "table");
  assert.deepEqual(slot.value, {
    headers: ["A", "B", "C", "D"],
    rows: [["1", "2", "3", "4"]],
    align: ["left", "right", "center", null],
  });
  assert.equal(slot.value.headers.length, slot.value.align.length);
  assert.equal(slot.node.type, "table");
});

test("a header-only table is valid and missing cells pad with empty strings", () => {
  const headerOnly = new Reader("| A | B |\n| --- | --- |\n").table();
  assert.deepEqual(headerOnly.value.rows, []);
  assert.deepEqual(headerOnly.value.headers, ["A", "B"]);
  const padded = new Reader("| A | B | C |\n| --- | --- | --- |\n| 1 | 2 |\n").table();
  assert.deepEqual(padded.value.rows, [["1", "2", ""]]);
});

test("table extra cells throw DO_MD_USER_ERROR", () => {
  const reader = new Reader("| A | B |\n| --- | --- |\n| 1 | 2 | 3 |\n");
  assert.throws(
    () => reader.table(),
    (err) => {
      assert.ok(err instanceof SyntaxError);
      assert.equal(err.code, ERROR_CODES.DO_MD_USER_ERROR);
      return true;
    },
  );
});

test("a table with zero headers records a SyntaxError", () => {
  const reader = new Reader("hello\n");
  const slot = reader.table();
  assert.equal(slot.value, null);
  assert.equal(reader.errors.length, 1);
  assert.ok(reader.errors[0] instanceof SyntaxError);
  assert.equal(reader.errors[0].code, ERROR_CODES.DO_MD_PARSE_ERROR);
});

test("codeBlock returns language and value for fenced and indented blocks", () => {
  const fenced = new Reader("```js\nconst x = 1;\n```\n").codeBlock();
  assert.equal(fenced.leafType, "codeBlock");
  assert.deepEqual(fenced.value, { language: "js", value: "const x = 1;" });
  assert.equal(fenced.node.type, "code_block");
  const indented = new Reader("    indented\n").codeBlock();
  assert.deepEqual(indented.value, { language: null, value: "indented" });
});

test("blockQuote returns flattened string content", () => {
  const reader = new Reader("> # Title\n>\n> quoted\n");
  const slot = reader.blockQuote();
  assert.equal(slot.leafType, "blockQuote");
  assert.equal(slot.value, "Title\nquoted");
  assert.equal(slot.node.type, "block_quote");
});

test("thematicBreak returns true", () => {
  const reader = new Reader("---\n");
  const slot = reader.thematicBreak().as("hr");
  assert.equal(slot.leafType, "thematicBreak");
  assert.equal(slot.value, true);
  assert.equal(slot.node.type, "thematic_break");
  assert.equal(reader.context.hr, true);
});

test("htmlBlock returns raw HTML as data", () => {
  const reader = new Reader("<div>\n<script>alert(1)</script>\n\nAfter\n");
  const slot = reader.htmlBlock();
  assert.equal(slot.leafType, "htmlBlock");
  assert.equal(slot.value, "<div>\n<script>alert(1)</script>");
  assert.equal(slot.node.type, "html_block");
});

test("required block-leaf mismatches record a parse error and leave the cursor", () => {
  const reader = new Reader("hello", { file: "doc.md" });
  const slot = reader.heading(1);
  assert.equal(slot.value, null);
  assert.equal(reader.offset, 0);
  assert.equal(reader.errors.length, 1);
  assert.equal(reader.errors[0].code, ERROR_CODES.DO_MD_PARSE_ERROR);
  assert.equal(reader.errors[0].file, "doc.md");
  assert.equal(reader.errors[0].line, 1);
  assert.equal(reader.errors[0].column, 1);
});

test("optional block-leaf mismatches rewind and record no error", () => {
  const reader = new Reader("hello");
  const slot = reader.optional().list();
  assert.equal(slot.value, null);
  assert.equal(reader.offset, 0);
  assert.equal(reader.errors.length, 0);
});

test("block-level leaves cannot be used inside a single line", () => {
  const reader = new Reader("# Title\n");
  reader.literal("# ");
  const slot = reader.heading(1);
  assert.equal(slot.value, null);
  assert.equal(reader.offset, 2);
  assert.equal(reader.errors.length, 1);
  assert.equal(reader.errors[0].code, ERROR_CODES.DO_MD_PARSE_ERROR);
});

  test("a template can bind heading paragraph list and codeBlock leaves", () => {
  const fn = Template.wrap(
    '{% doc.heading(1).as("title") %}\n\n{% doc.paragraph().as("body") %}\n\n{% doc.list().as("items") %}\n\n{% doc.codeBlock().as("sample") %}\n',
    "t.tpl.md",
  );
  const reader = new Reader("# Hello\n\nBody text\n\n- a\n- b\n\n```js\ncode\n```\n");
  fn(reader, reader.context, null, {}, null);
  assert.deepEqual(reader.context, {
    title: "Hello",
    body: "Body text",
    items: ["a", "b"],
    sample: { language: "js", value: "code" },
  });
  assert.equal(reader.errors.length, 0);
});

test("text without a limiter consumes through the end of the paragraph", () => {
  const reader = new Reader("Hello *world*\nand more\n\nNext\n");
  const slot = reader.text();
  assert.ok(slot instanceof Slot);
  assert.equal(slot.leafType, "text");
  assert.equal(slot.value, "Hello *world*\nand more");
  assert.equal(slot.sourceOffsetStart, 0);
  assert.equal(slot.sourceOffsetEnd, 22);
  assert.equal(reader.offset, 22);
});

test("text(limiter) stops before the limiter and stays inside the paragraph", () => {
  const reader = new Reader("Ada Lovelace — 2026-01-01\n\nlater — ignored\n");
  reader.literal("Ada ");
  const slot = reader.text(" — ");
  assert.equal(slot.leafType, "text");
  assert.equal(slot.value, "Lovelace");
  assert.equal(slot.sourceOffsetStart, 4);
  assert.equal(slot.sourceOffsetEnd, 12);
  assert.equal(reader.remaining().startsWith(" — "), true);
});

test("text(limiter) does not search past the paragraph the way until does", () => {
  const source = "alpha\n\nbeta — gamma\n";
  const bounded = new Reader(source);
  assert.equal(bounded.text(" — ").value, null);
  assert.equal(bounded.offset, 0);
  assert.equal(bounded.errors.length, 1);
  const unbounded = new Reader(source);
  assert.equal(unbounded.until(" — ").value, "alpha\n\nbeta");
});

test("required text mismatches record a parse error; optional mismatches rewind", () => {
  const required = new Reader("hello", { file: "doc.md" });
  const miss = required.text(" — ");
  assert.equal(miss.value, null);
  assert.equal(required.offset, 0);
  assert.equal(required.errors.length, 1);
  assert.equal(required.errors[0].code, ERROR_CODES.DO_MD_PARSE_ERROR);
  assert.equal(required.errors[0].file, "doc.md");
  assert.equal(required.errors[0].line, 1);
  assert.equal(required.errors[0].column, 1);
  const optional = new Reader("hello");
  const slot = optional.optional().text(" — ");
  assert.equal(slot.value, null);
  assert.equal(optional.offset, 0);
  assert.equal(optional.errors.length, 0);
});

test("link returns url, flattened text, title, and the AST node", () => {
  const reader = new Reader("[Hello *world*](https://ex.com \"t\") tail");
  const slot = reader.link();
  assert.equal(slot.leafType, "link");
  assert.deepEqual(slot.value, { url: "https://ex.com", text: "Hello world", title: "t" });
  assert.equal(slot.node.type, "link");
  assert.equal(slot.node.url, "https://ex.com");
  assert.equal(slot.node.title, "t");
  assert.equal(slot.sourceOffsetStart, 0);
  assert.equal(slot.sourceOffsetEnd, 35);
  assert.equal(reader.remaining(), " tail");
});

test("link title is null when omitted", () => {
  const slot = new Reader("[n](u)").link();
  assert.deepEqual(slot.value, { url: "u", text: "n", title: null });
});

test("image returns url, flattened alt, title, and the AST node", () => {
  const reader = new Reader("![*alt*](img.png \"cap\") tail");
  const slot = reader.image();
  assert.equal(slot.leafType, "image");
  assert.deepEqual(slot.value, { url: "img.png", alt: "alt", title: "cap" });
  assert.equal(slot.node.type, "image");
  assert.equal(slot.node.alt, "alt");
  assert.equal(slot.sourceOffsetStart, 0);
  assert.equal(slot.sourceOffsetEnd, 23);
  assert.equal(reader.remaining(), " tail");
});

test("autolink returns the URL string and the AST node", () => {
  const url = new Reader("<https://ex.com> tail").autolink();
  assert.equal(url.leafType, "autolink");
  assert.equal(url.value, "https://ex.com");
  assert.equal(url.node.type, "autolink");
  assert.equal(url.node.kind, "url");
  assert.equal(url.sourceOffsetStart, 0);
  assert.equal(url.sourceOffsetEnd, 16);
  const email = new Reader("<a@b.co>").autolink();
  assert.equal(email.value, "mailto:a@b.co");
  assert.equal(email.node.kind, "email");
});

test("codeSpan returns the trimmed string and the AST node", () => {
  const reader = new Reader("` spaced ` tail");
  const slot = reader.codeSpan();
  assert.equal(slot.leafType, "codeSpan");
  assert.equal(slot.value, "spaced");
  assert.equal(slot.node.type, "code_span");
  assert.equal(slot.sourceOffsetStart, 0);
  assert.equal(slot.sourceOffsetEnd, 10);
  assert.equal(reader.remaining(), " tail");
});

test("checkbox returns a boolean for task markers", () => {
  const checked = new Reader("[x] item");
  const slot = checked.checkbox();
  assert.equal(slot.leafType, "checkbox");
  assert.equal(slot.value, true);
  assert.equal(slot.sourceOffsetStart, 0);
  assert.equal(slot.sourceOffsetEnd, 3);
  assert.equal(checked.remaining(), " item");
  assert.equal(new Reader("[X]").checkbox().value, true);
  assert.equal(new Reader("[ ] rest").checkbox().value, false);
});

test("required inline-leaf mismatches record a parse error; optional mismatches rewind", () => {
  const required = new Reader("hello", { file: "doc.md" });
  assert.equal(required.link().value, null);
  assert.equal(required.offset, 0);
  assert.equal(required.errors[0].code, ERROR_CODES.DO_MD_PARSE_ERROR);
  assert.equal(required.errors[0].file, "doc.md");
  assert.equal(required.errors[0].line, 1);
  assert.equal(required.errors[0].column, 1);
  const optional = new Reader("hello");
  assert.equal(optional.optional().image().value, null);
  assert.equal(optional.optional().autolink().value, null);
  assert.equal(optional.optional().codeSpan().value, null);
  assert.equal(optional.optional().checkbox().value, null);
  assert.equal(optional.offset, 0);
  assert.equal(optional.errors.length, 0);
});

test("byte-level leaves compose with same-line literals", () => {
  const item = new Reader("- [x] ship it\n");
  item.literal("- ");
  assert.equal(item.checkbox().as("done").value, true);
  item.literal(" ");
  assert.equal(item.line().as("text").value, "ship it");
  assert.deepEqual(item.context, { done: true, text: "ship it" });

  const catalog = new Reader("Homepage: [site](https://ex.com) — Logo: ![logo](logo.png) — Repo: <https://git.ex> — Binary: `do-md`\n");
  catalog.literal("Homepage: ");
  assert.deepEqual(catalog.link().as("homepage").value, { url: "https://ex.com", text: "site", title: null });
  catalog.literal(" — Logo: ");
  assert.deepEqual(catalog.image().as("logo").value, { url: "logo.png", alt: "logo", title: null });
  catalog.literal(" — Repo: ");
  assert.equal(catalog.autolink().as("repo").value, "https://git.ex");
  catalog.literal(" — Binary: ");
  assert.equal(catalog.codeSpan().as("binary").value, "do-md");
  assert.equal(catalog.errors.length, 0);
});

test("scope collects committed child contexts and stops at the first abort", () => {
  const reader = new Reader("# Book\n\n## One\n\nIntro one\n\n## Two\n\nIntro two\n\n## Footer\n");
  reader.heading(1).as("title");
  reader.literal("\n\n");
  reader.scope("chapters", (chapter, index) => {
    chapter.heading(2).as("name");
    chapter.literal("\n\n");
    chapter.paragraph().as("intro");
    chapter.literal("\n\n");
    assert.equal(index, reader.context.chapters.length);
  });
  assert.equal(reader.context.title, "Book");
  assert.deepEqual(reader.context.chapters, [
    { name: "One", intro: "Intro one" },
    { name: "Two", intro: "Intro two" },
  ]);
  assert.equal(reader.errors.length, 0);
});

test("scope sets an empty array when zero iterations commit", () => {
  const reader = new Reader("hello");
  reader.scope("chapters", (chapter) => {
    chapter.heading(2).as("title");
  });
  assert.deepEqual(reader.context.chapters, []);
  assert.equal(reader.offset, 0);
});

test("scope collides with as at the same level", () => {
  const reader = new Reader("x\n");
  reader.line().as("chapters");
  assert.throws(
    () => reader.scope("chapters", () => {}),
    (err) => {
      assert.ok(err instanceof SyntaxError);
      assert.equal(err.code, ERROR_CODES.DO_MD_TEMPLATE_ERROR);
      return true;
    },
  );
});

test("nested scope commits child arrays onto each parent iteration", () => {
  const reader = new Reader("## Ch1\n\n### S1\n\n### S2\n\n## Ch2\n\n### S3\n\n");
  reader.scope("chapters", (chapter) => {
    chapter.heading(2).as("name");
    chapter.literal("\n\n");
    chapter.scope("sections", (section) => {
      section.heading(3).as("name");
      section.literal("\n\n");
    });
  });
  assert.deepEqual(reader.context.chapters, [
    { name: "Ch1", sections: [{ name: "S1" }, { name: "S2" }] },
    { name: "Ch2", sections: [{ name: "S3" }] },
  ]);
});

test("optional fn rewinds when nothing binds", () => {
  const reader = new Reader("hello");
  assert.equal(
    reader.optional(() => {
      reader.heading(1).as("missing");
    }),
    false,
  );
  assert.equal(reader.offset, 0);
  assert.deepEqual(reader.context, {});
  assert.equal(reader.errors.length, 0);
});

test("optional fn commits when a slot binds and no required-mode error occurs", () => {
  const reader = new Reader("# Title\n\nbody\n");
  assert.equal(
    reader.optional(() => {
      reader.heading(1).as("title");
      reader.literal("\n\n");
    }),
    true,
  );
  assert.equal(reader.context.title, "Title");
  assert.equal(reader.remaining(), "body\n");
});

test("optional fn wrapping a matching scope commits", () => {
  const reader = new Reader("## A\n\n## B\n\n");
  assert.equal(
    reader.optional(() => {
      reader.scope("chapters", (chapter) => {
        chapter.heading(2).as("title");
        chapter.literal("\n\n");
      });
    }),
    true,
  );
  assert.deepEqual(reader.context.chapters, [{ title: "A" }, { title: "B" }]);
});

test("optional fn wrapping an empty scope rewinds", () => {
  const reader = new Reader("hello");
  assert.equal(
    reader.optional(() => {
      reader.scope("chapters", (chapter) => {
        chapter.heading(2).as("title");
      });
    }),
    false,
  );
  assert.equal(reader.offset, 0);
  assert.deepEqual(reader.context, {});
});

test("optional inside scope rewinds the optional block and keeps required literals", () => {
  const reader = new Reader("## One\n\nbody\n\n**Consequences:**\n\n## Two\n\nmore\n\n**Consequences:**\n\n");
  reader.scope("chapters", (chapter) => {
    chapter.heading(2).as("title");
    chapter.literal("\n\n");
    chapter.paragraph().as("body");
    chapter.literal("\n\n");
    chapter.optional(() => {
      chapter.literal("**Alternatives:**\n\n");
      chapter.list().as("alts");
      chapter.literal("\n\n");
    });
    chapter.literal("**Consequences:**\n\n");
  });
  assert.deepEqual(reader.context.chapters, [
    { title: "One", body: "body" },
    { title: "Two", body: "more" },
  ]);
});

test("repeat appends asArray values and returns committed contexts", () => {
  const reader = new Reader("- a\n- b\n");
  const committed = reader.repeat(() => {
    reader.literal("- ");
    reader.line().asArray("notes");
    reader.literal("\n");
  });
  assert.deepEqual(reader.context.notes, ["a", "b"]);
  assert.equal(committed.length, 2);
  assert.deepEqual(committed[1].notes, ["a", "b"]);
});

test("repeat returns false aborts the current iteration", () => {
  const reader = new Reader("- a\n- b\n");
  reader.repeat(() => {
    reader.literal("- ");
    reader.line().asArray("notes");
    reader.literal("\n");
    return false;
  });
  assert.equal(reader.offset, 0);
  assert.equal(reader.context.notes, undefined);
});

test("repeat without asArray or false hits the 10000-iteration guard", () => {
  const reader = new Reader("x");
  assert.throws(
    () => reader.repeat(() => {}),
    (err) => {
      assert.ok(err instanceof SyntaxError);
      assert.equal(err.code, ERROR_CODES.DO_MD_TEMPLATE_ERROR);
      return true;
    },
  );
});

test("scope that never aborts hits the 10000-iteration guard", () => {
  const reader = new Reader("x");
  assert.throws(
    () =>
      reader.scope("items", (child) => {
        child.regexp(/^/).as("mark");
      }),
    (err) => {
      assert.ok(err instanceof SyntaxError);
      assert.equal(err.code, ERROR_CODES.DO_MD_TEMPLATE_ERROR);
      return true;
    },
  );
});

test("skipUntilHeading leaves the cursor at the matching heading", () => {
  const reader = new Reader("intro\n\n## Details\n\nbody\n");
  assert.equal(reader.skipUntilHeading((heading) => heading.level === 2 && heading.text === "Details"), true);
  assert.equal(reader.heading(2).value, "Details");
});

test("skipUntilHeading without a predicate matches the first heading", () => {
  const reader = new Reader("intro\n\n# First\n\n## Second\n");
  assert.equal(reader.skipUntilHeading(), true);
  assert.equal(reader.heading().value, "First");
});

test("required skipUntilHeading miss advances to EOF and records a parse error", () => {
  const reader = new Reader("no heading", { file: "doc.md" });
  assert.equal(reader.skipUntilHeading(), false);
  assert.equal(reader.offset, reader.source.length);
  assert.equal(reader.errors.length, 1);
  assert.equal(reader.errors[0].code, ERROR_CODES.DO_MD_PARSE_ERROR);
  assert.equal(reader.errors[0].file, "doc.md");
});

test("optional skipUntilHeading miss restores the cursor", () => {
  const reader = new Reader("no heading");
  assert.equal(reader.optional().skipUntilHeading(), false);
  assert.equal(reader.offset, 0);
  assert.equal(reader.errors.length, 0);
});

test("skipUntilHeading does not make optional commit", () => {
  const reader = new Reader("intro\n\n## X\n");
  assert.equal(
    reader.optional(() => {
      reader.skipUntilHeading();
    }),
    false,
  );
  assert.equal(reader.offset, 0);
});

test("a template can bind text link image autolink codeSpan and checkbox leaves", () => {
  const fn = Template.wrap(
    'Author: {% doc.text(" — ").trim().as("author") %} — {% doc.until("\\n").trim().as("date") %}\nHomepage: {% doc.link().as("homepage") %} — Logo: {% doc.image().as("logo") %} — Repo: {% doc.autolink().as("repo") %} — Binary: {% doc.codeSpan().as("binary") %}\n- {% doc.checkbox().as("done") %} {% doc.line().as("action") %}\n',
    "t.tpl.md",
  );
  const reader = new Reader(
    "Author: Ada — 2026-01-01\nHomepage: [site](https://ex.com \"home\") — Logo: ![logo](logo.png) — Repo: <https://git.ex> — Binary: `do-md`\n- [x] ship it\n",
  );
  fn(reader, reader.context, null, {}, null);
  assert.deepEqual(reader.context, {
    author: "Ada",
    date: "2026-01-01",
    homepage: { url: "https://ex.com", text: "site", title: "home" },
    logo: { url: "logo.png", alt: "logo", title: null },
    repo: "https://git.ex",
    binary: "do-md",
    done: true,
    action: "ship it",
  });
  assert.equal(reader.errors.length, 0);
});

test("slotMap records as bindings with leaf type, offsets, and isArrayElement false", () => {
  const reader = new Reader("# hello\n");
  assert.deepEqual(reader.slotMap, []);
  reader.literal("# ");
  reader.line().as("title");
  assert.equal(reader.slotMap.length, 1);
  const entry = reader.slotMap[0];
  assert.equal(entry.key, "title");
  assert.equal(entry.leafType, "line");
  assert.equal(entry.sourceOffsetStart, 2);
  assert.equal(entry.sourceOffsetEnd, 7);
  assert.equal(entry.isArrayElement, false);
});

test("slotMap records asArray indexes and sets isArrayElement true", () => {
  const reader = new Reader("one\ntwo\n");
  reader.line().asArray("notes");
  reader.literal("\n");
  reader.line().asArray("notes");
  assert.deepEqual(
    reader.slotMap.map((entry) => ({
      key: entry.key,
      leafType: entry.leafType,
      isArrayElement: entry.isArrayElement,
    })),
    [
      { key: "notes[0]", leafType: "line", isArrayElement: true },
      { key: "notes[1]", leafType: "line", isArrayElement: true },
    ],
  );
  assert.equal(reader.slotMap[0].sourceOffsetStart, 0);
  assert.equal(reader.slotMap[0].sourceOffsetEnd, 3);
  assert.equal(reader.slotMap[1].sourceOffsetStart, 4);
  assert.equal(reader.slotMap[1].sourceOffsetEnd, 7);
});

test("slotMap records scoped paths and keeps isArrayElement false", () => {
  const reader = new Reader("# Book\n\n## One\n\nIntro one\n\n## Two\n\nIntro two\n\n## Footer\n");
  reader.heading(1).as("title");
  reader.literal("\n\n");
  reader.scope("chapters", (chapter) => {
    chapter.heading(2).as("name");
    chapter.literal("\n\n");
    chapter.paragraph().as("intro");
    chapter.literal("\n\n");
  });
  assert.deepEqual(
    reader.slotMap.map((entry) => ({
      key: entry.key,
      leafType: entry.leafType,
      isArrayElement: entry.isArrayElement,
    })),
    [
      { key: "title", leafType: "heading", isArrayElement: false },
      { key: "chapters[0].name", leafType: "heading", isArrayElement: false },
      { key: "chapters[0].intro", leafType: "paragraph", isArrayElement: false },
      { key: "chapters[1].name", leafType: "heading", isArrayElement: false },
      { key: "chapters[1].intro", leafType: "paragraph", isArrayElement: false },
    ],
  );
});

test("slotMap records nested scope indexes such as chapters[1].sections[0].body", () => {
  const reader = new Reader("## Ch1\n\n### S1\n\nbody one\n\n### S2\n\nbody two\n\n## Ch2\n\n### S3\n\nbody three\n\n");
  reader.scope("chapters", (chapter) => {
    chapter.heading(2).as("name");
    chapter.literal("\n\n");
    chapter.scope("sections", (section) => {
      section.heading(3).as("name");
      section.literal("\n\n");
      section.paragraph().as("body");
      section.literal("\n\n");
    });
  });
  assert.ok(
    reader.slotMap.some(
      (entry) =>
        entry.key === "chapters[1].sections[0].body" &&
        entry.leafType === "paragraph" &&
        entry.isArrayElement === false,
    ),
  );
  assert.ok(reader.slotMap.some((entry) => entry.key === "chapters[0].sections[1].name" && entry.isArrayElement === false));
});

test("aborted optional and scope iterations do not leak slotMap entries", () => {
  const reader = new Reader("hello");
  reader.optional(() => {
    reader.heading(1).as("missing");
  });
  reader.scope("chapters", (chapter) => {
    chapter.heading(2).as("title");
  });
  assert.deepEqual(reader.slotMap, []);
});

test("an unbound leaf does not record a slotMap entry", () => {
  const reader = new Reader("hello\n");
  reader.line();
  assert.deepEqual(reader.slotMap, []);
});

function assertLeaf(slot, leafType, value, nodeType) {
  assert.ok(slot instanceof Slot);
  assert.equal(slot.leafType, leafType);
  if (value !== undefined && (value === null || typeof value !== "object")) {
    assert.equal(slot.value, value);
  } else if (value !== undefined) {
    assert.deepEqual(slot.value, value);
  }
  assert.equal(typeof slot.sourceOffsetStart, "number");
  assert.equal(typeof slot.sourceOffsetEnd, "number");
  assert.ok(slot.sourceOffsetEnd >= slot.sourceOffsetStart);
  if (nodeType) {
    assert.equal(slot.node.type, nodeType);
  }
}

test("every documented block leaf value shape records leafType, offsets, and node", () => {
  const heading = new Reader("# Hello *world*\n").heading();
  assertLeaf(heading, "heading", "Hello world", "heading");
  assert.equal(typeof heading.value, "string");
  assert.equal(heading.node.level, 1);
  assert.ok(Array.isArray(heading.node.children));

  const setext = new Reader("Title\n-----\n").heading();
  assertLeaf(setext, "heading", "Title", "heading");
  assert.equal(setext.node.level, 2);

  const paragraph = new Reader("Hello *world*\nand more\n").paragraph();
  assertLeaf(paragraph, "paragraph", "Hello world\nand more", "paragraph");
  assert.equal(typeof paragraph.value, "string");

  const list = new Reader("- one\n- two *x*\n").list();
  assertLeaf(list, "list", ["one", "two x"], "list");
  assert.ok(Array.isArray(list.value));
  assert.ok(list.value.every((item) => typeof item === "string"));

  const table = new Reader("| A | B |\n| :--- | --- |\n| 1 | 2 |\n").table();
  assertLeaf(
    table,
    "table",
    { headers: ["A", "B"], rows: [["1", "2"]], align: ["left", null] },
    "table",
  );
  assert.ok(Array.isArray(table.value.headers));
  assert.ok(Array.isArray(table.value.rows));
  assert.ok(Array.isArray(table.value.align));
  assert.equal(table.value.headers.length, table.value.align.length);
  assert.equal(table.value.align[1], null);

  const fenced = new Reader("```js\nconst x = 1;\n```\n").codeBlock();
  assertLeaf(fenced, "codeBlock", { language: "js", value: "const x = 1;" }, "code_block");
  const indented = new Reader("    indented\n").codeBlock();
  assertLeaf(indented, "codeBlock", { language: null, value: "indented" }, "code_block");

  const quote = new Reader("> # Title\n>\n> quoted\n").blockQuote();
  assertLeaf(quote, "blockQuote", "Title\nquoted", "block_quote");
  assert.equal(typeof quote.value, "string");

  const hr = new Reader("---\n").thematicBreak();
  assertLeaf(hr, "thematicBreak", true, "thematic_break");
  assert.equal(new Reader("***\n").thematicBreak().value, true);
  assert.equal(new Reader("___\n").thematicBreak().value, true);

  const html = new Reader("<div>\n<script>alert(1)</script>\n\nAfter\n").htmlBlock();
  assertLeaf(html, "htmlBlock", "<div>\n<script>alert(1)</script>", "html_block");
  assert.equal(typeof html.value, "string");
});

test("every documented inline and byte leaf value shape records leafType and offsets", () => {
  const line = new Reader("hello\n").line();
  assertLeaf(line, "line", "hello");
  assert.equal(typeof line.value, "string");

  const text = new Reader("Hello *world*\nand more\n\nNext\n").text();
  assertLeaf(text, "text", "Hello *world*\nand more");
  assert.equal(typeof text.value, "string");

  const until = new Reader("foo] bar").until("]");
  assertLeaf(until, "text", "foo");
  assert.equal(typeof until.value, "string");

  const regexp = new Reader("v1.2.3 tail").regexp(/v\d+\.\d+\.\d+/);
  assertLeaf(regexp, "text", "v1.2.3");
  assert.equal(typeof regexp.value, "string");

  const link = new Reader("[Hello *world*](https://ex.com \"t\")").link();
  assertLeaf(link, "link", { url: "https://ex.com", text: "Hello world", title: "t" }, "link");
  assert.equal(typeof link.value.url, "string");
  assert.equal(typeof link.value.text, "string");
  assert.ok(Array.isArray(link.node.children));

  const untitled = new Reader("[n](u)").link();
  assertLeaf(untitled, "link", { url: "u", text: "n", title: null }, "link");

  const image = new Reader("![*alt*](img.png \"cap\")").image();
  assertLeaf(image, "image", { url: "img.png", alt: "alt", title: "cap" }, "image");
  assert.equal(typeof image.value.alt, "string");

  const autolink = new Reader("<https://ex.com>").autolink();
  assertLeaf(autolink, "autolink", "https://ex.com", "autolink");
  assert.equal(typeof autolink.value, "string");
  const email = new Reader("<a@b.co>").autolink();
  assertLeaf(email, "autolink", "mailto:a@b.co", "autolink");

  const codeSpan = new Reader("` spaced `").codeSpan();
  assertLeaf(codeSpan, "codeSpan", "spaced", "code_span");
  assert.equal(typeof codeSpan.value, "string");

  const checked = new Reader("[x] item").checkbox();
  assertLeaf(checked, "checkbox", true);
  assert.equal(typeof checked.value, "boolean");
  assert.equal(new Reader("[ ] rest").checkbox().value, false);
});

test("flattened leaf values still expose the full AST on slot.node", () => {
  const heading = new Reader("# Hello *world*\n").heading();
  assert.equal(heading.value, "Hello world");
  assert.equal(heading.node.children[1].type, "emphasis");
  const paragraph = new Reader("see [x](u)\n").paragraph();
  assert.equal(paragraph.value, "see x");
  assert.equal(paragraph.node.children[1].type, "link");
  const list = new Reader("- *em*\n").list();
  assert.deepEqual(list.value, ["em"]);
  assert.equal(list.node.children[0].type, "list_item");
  const link = new Reader("[*em*](u)").link();
  assert.equal(link.value.text, "em");
  assert.equal(link.node.children[0].type, "emphasis");
});

test("heading without a level matches any ATX or Setext heading", () => {
  assert.equal(new Reader("### Three\n").heading().value, "Three");
  assert.equal(new Reader("Title\n=====\n").heading().node.level, 1);
  assert.equal(new Reader("Title\n-----\n").heading().node.level, 2);
});

test("every block-level leaf fails inside a single line", () => {
  for (const method of ["heading", "paragraph", "list", "table", "codeBlock", "blockQuote", "thematicBreak", "htmlBlock"]) {
    const reader = new Reader("# Title\n");
    reader.literal("# ");
    const slot = reader[method]();
    assert.equal(slot.value, null, method);
    assert.equal(reader.offset, 2, method);
    assert.equal(reader.errors.length, 1, method);
    assert.equal(reader.errors[0].code, ERROR_CODES.DO_MD_PARSE_ERROR, method);
  }
});

test("scope child starts optional then switches to required after the first match", () => {
  const aborting = new Reader("## Title\n");
  aborting.scope("chapters", (chapter) => {
    chapter.heading(2).as("title");
    chapter.literal("\n\n");
    chapter.paragraph().as("body");
  });
  assert.deepEqual(aborting.context.chapters, []);
  assert.equal(aborting.offset, 0);
  assert.equal(aborting.errors.length, 0);

  const missing = new Reader("hello");
  missing.scope("chapters", (chapter) => {
    chapter.heading(2).as("title");
  });
  assert.deepEqual(missing.context.chapters, []);
  assert.equal(missing.errors.length, 0);
  assert.equal(missing.offset, 0);

  const ok = new Reader("## Title\n\nBody\n\n");
  ok.scope("chapters", (chapter) => {
    chapter.heading(2).as("title");
    chapter.literal("\n\n");
    chapter.paragraph().as("body");
    chapter.literal("\n\n");
  });
  assert.deepEqual(ok.context.chapters, [{ title: "Title", body: "Body" }]);
});

test("scope child shares the source and starts with empty context and null data", () => {
  const reader = new Reader("## A\n\n");
  const indexes = [];
  reader.scope("chapters", (chapter, index) => {
    indexes.push(index);
    assert.equal(chapter.inputSourceText, reader.inputSourceText);
    assert.deepEqual(chapter.context, {});
    assert.equal(chapter.data, null);
    assert.equal(index, reader.context.chapters.length);
    chapter.heading(2).as("title");
    chapter.literal("\n\n");
  });
  assert.deepEqual(indexes, [0, 1]);
  assert.deepEqual(reader.context.chapters, [{ title: "A" }]);
});

test("literal text between scope iterations is matched per iteration", () => {
  const reader = new Reader("## A\n\n--\n\n## B\n\n--\n\n");
  reader.scope("chapters", (chapter) => {
    chapter.heading(2).as("title");
    chapter.literal("\n\n--\n\n");
  });
  assert.deepEqual(reader.context.chapters, [{ title: "A" }, { title: "B" }]);
  assert.equal(reader.errors.length, 0);
});

test("scope aborts the current iteration and restores the parent cursor", () => {
  const reader = new Reader("## One\n\nkeep\n\n## Two\n");
  const start = reader.offset;
  reader.scope("chapters", (chapter) => {
    chapter.heading(2).as("title");
    chapter.literal("\n\n");
    chapter.paragraph().as("body");
    chapter.literal("\n\n");
  });
  assert.deepEqual(reader.context.chapters, [{ title: "One", body: "keep" }]);
  assert.equal(reader.remaining(), "## Two\n");
  assert.notEqual(reader.offset, start);
  assert.equal(reader.errors.length, 0);
});

test("scope, repeat, and optional do not return Slot", () => {
  const scoped = new Reader("## A\n\n");
  const scopeResult = scoped.scope("chapters", (chapter) => {
    chapter.heading(2).as("title");
    chapter.literal("\n\n");
  });
  assert.equal(scopeResult, undefined);

  const optionalResult = new Reader("hello").optional(() => {});
  assert.equal(typeof optionalResult, "boolean");

  const repeatResult = new Reader("x").repeat(() => false);
  assert.ok(Array.isArray(repeatResult));
});

test("optional fn stays optional after the first match and still commits", () => {
  const reader = new Reader("# Title\nhello");
  assert.equal(
    reader.optional(() => {
      reader.heading(1).as("title");
      reader.heading(2).as("missing");
    }),
    true,
  );
  assert.equal(reader.context.title, "Title");
  assert.equal(reader.context.missing, undefined);
  assert.equal(reader.errors.length, 0);
});

test("optional fn rewinds when a required-mode error occurs after a bind", () => {
  const reader = new Reader("# Title\nhello");
  assert.equal(
    reader.optional(() => {
      reader.heading(1).as("title");
      reader.required().heading(2).as("missing");
    }),
    false,
  );
  assert.equal(reader.offset, 0);
  assert.deepEqual(reader.context, {});
  assert.deepEqual(reader.slotMap, []);
  assert.equal(reader.errors.length, 0);
});

test("repeat aborts the current iteration on a required-mode error after the first match", () => {
  const reader = new Reader("- a\nNOT\n");
  const committed = reader.repeat(() => {
    reader.literal("- ");
    reader.line().asArray("notes");
    reader.literal("\n- next\n");
  });
  assert.deepEqual(committed, []);
  assert.equal(reader.context.notes, undefined);
  assert.equal(reader.offset, 0);
  assert.equal(reader.errors.length, 0);
});

test("skipUntilHeading predicate receives level, text, and node and does not consume the heading", () => {
  const reader = new Reader("intro\n\n# First\n\n## Details\n\nbody\n");
  const seen = [];
  assert.equal(
    reader.skipUntilHeading((heading) => {
      seen.push(heading);
      return heading.level === 2 && heading.text === "Details";
    }),
    true,
  );
  assert.equal(seen.length, 2);
  assert.equal(seen[0].level, 1);
  assert.equal(seen[0].text, "First");
  assert.equal(seen[0].node.type, "heading");
  assert.equal(seen[0].node.level, 1);
  assert.equal(seen[1].level, 2);
  assert.equal(seen[1].text, "Details");
  assert.equal(seen[1].node.type, "heading");
  assert.equal(seen[1].node.level, 2);
  assert.ok(Array.isArray(seen[1].node.children));
  assert.equal(reader.remaining().startsWith("## Details"), true);
  assert.equal(reader.heading(2).value, "Details");
});

test("skipUntilHeading does not bind a slot or record slotMap entries", () => {
  const reader = new Reader("intro\n\n## X\n");
  assert.equal(reader.skipUntilHeading(), true);
  assert.deepEqual(reader.context, {});
  assert.deepEqual(reader.slotMap, []);
});

test("skipUntilHeading does not make scope or repeat commit", () => {
  const scoped = new Reader("intro\n\n## X\n");
  scoped.scope("chapters", (chapter) => {
    chapter.skipUntilHeading();
  });
  assert.deepEqual(scoped.context.chapters, []);
  assert.equal(scoped.offset, 0);
  assert.deepEqual(scoped.slotMap, []);

  const repeated = new Reader("intro\n\n## X\n");
  const committed = repeated.repeat(() => {
    repeated.skipUntilHeading();
    return false;
  });
  assert.deepEqual(committed, []);
  assert.deepEqual(repeated.context, {});
  assert.equal(repeated.offset, 0);
});

test("required skipUntilHeading miss records DO_MD_PARSE_ERROR at EOF", () => {
  const reader = new Reader("no heading\n", { file: "doc.md" });
  assert.equal(reader.skipUntilHeading((heading) => heading.text === "Missing"), false);
  assert.equal(reader.offset, reader.source.length);
  assert.equal(reader.errors.length, 1);
  assert.equal(reader.errors[0].code, ERROR_CODES.DO_MD_PARSE_ERROR);
  assert.equal(reader.errors[0].file, "doc.md");
  assert.equal(typeof reader.errors[0].line, "number");
  assert.equal(typeof reader.errors[0].column, "number");
});

test("slotMap records version and chapters[2].title path shapes", () => {
  const reader = new Reader("# 1.0\n\n## A\n\n## B\n\n## C\n\n");
  reader.heading(1).as("version");
  reader.literal("\n\n");
  reader.scope("chapters", (chapter) => {
    chapter.heading(2).as("title");
    chapter.literal("\n\n");
  });
  assert.equal(reader.context.version, "1.0");
  assert.equal(reader.context.chapters.length, 3);
  assert.deepEqual(
    reader.slotMap.map((entry) => entry.key),
    ["version", "chapters[0].title", "chapters[1].title", "chapters[2].title"],
  );
  assert.ok(reader.slotMap.every((entry) => entry.isArrayElement === false));
});

test("slotMap records asArray entries inside scope with isArrayElement true", () => {
  const reader = new Reader("## Ch1\n- a\n- b\n\n## Ch2\n- c\n\n");
  reader.scope("chapters", (chapter) => {
    chapter.heading(2).as("title");
    chapter.literal("\n");
    chapter.repeat(() => {
      chapter.literal("- ");
      chapter.line().asArray("notes");
      chapter.literal("\n");
    });
    chapter.literal("\n");
  });
  assert.deepEqual(reader.context.chapters, [
    { title: "Ch1", notes: ["a", "b"] },
    { title: "Ch2", notes: ["c"] },
  ]);
  assert.deepEqual(
    reader.slotMap.map((entry) => ({
      key: entry.key,
      leafType: entry.leafType,
      isArrayElement: entry.isArrayElement,
    })),
    [
      { key: "chapters[0].title", leafType: "heading", isArrayElement: false },
      { key: "chapters[0].notes[0]", leafType: "line", isArrayElement: true },
      { key: "chapters[0].notes[1]", leafType: "line", isArrayElement: true },
      { key: "chapters[1].title", leafType: "heading", isArrayElement: false },
      { key: "chapters[1].notes[0]", leafType: "line", isArrayElement: true },
    ],
  );
  for (const entry of reader.slotMap) {
    assert.equal(typeof entry.sourceOffsetStart, "number");
    assert.equal(typeof entry.sourceOffsetEnd, "number");
    assert.ok(entry.sourceOffsetEnd >= entry.sourceOffsetStart);
  }
});
