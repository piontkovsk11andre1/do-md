import test from "node:test";
import assert from "node:assert/strict";

import { Reader } from "../sources/Reader.mjs";
import { parseMarkdown } from "../sources/Reader/Markdown.mjs";
import { Slot } from "../sources/Slot.mjs";
import { ERROR_CODES, SyntaxError } from "../sources/SyntaxError.mjs";
import { Template } from "../sources/Template.mjs";
import { Writer } from "../sources/Writer.mjs";

function stripPosition(node) {
  if (node == null || typeof node !== "object") {
    return node;
  }
  if (Array.isArray(node)) {
    return node.map(stripPosition);
  }
  const out = {};
  for (const [key, value] of Object.entries(node)) {
    if (key === "position") {
      continue;
    }
    out[key] = stripPosition(value);
  }
  return out;
}

function assertAppendRoundTrip(source, options = {}) {
  const ast = parseMarkdown(source);
  const markdown = new Writer({}, options).append(ast).toMarkdown();
  assert.deepEqual(stripPosition(parseMarkdown(markdown)), stripPosition(ast));
  return markdown;
}

test("Writer module exists", () => {
  const writer = new Writer({ title: "A" });
  writer.write("hello");
  assert.equal(writer.toMarkdown(), "hello");
  assert.equal(writer.toString(), "hello");
});

test("Writer starts with ctx === data and an empty buffer", () => {
  const data = { k: "hello" };
  const writer = new Writer(data);
  assert.equal(writer.data, data);
  assert.equal(writer.context, data);
  assert.deepEqual(writer.buffer, []);
});

test("primitive data throws DO_MD_USER_ERROR", () => {
  assert.throws(
    () => new Writer(42),
    (err) => err instanceof SyntaxError && err.code === ERROR_CODES.DO_MD_USER_ERROR,
  );
});

test("literal appends text unchanged", () => {
  const writer = new Writer({});
  writer.literal("a  \t\n\n  b");
  assert.equal(writer.toMarkdown(), "a  \t\n\n  b");
  assert.deepEqual(writer.buffer, ["a  \t\n\n  b"]);
});

test("line, until, and regexp return Slots and emit from data[k]", () => {
  const writer = new Writer({ line: "hello", until: "foo", re: "v1" });
  const line = writer.line();
  const until = writer.until("]");
  const re = writer.regexp(/v\d+/);
  assert.ok(line instanceof Slot);
  assert.ok(until instanceof Slot);
  assert.ok(re instanceof Slot);
  assert.equal(line.leafType, "line");
  assert.equal(until.leafType, "text");
  assert.equal(re.leafType, "text");
  line.as("line");
  writer.literal(" ");
  until.as("until");
  writer.literal(" ");
  re.as("re");
  assert.equal(writer.toMarkdown(), "hello foo v1");
});

test("an unbound leaf emits nothing", () => {
  const writer = new Writer({ k: "hello" });
  writer.literal("# ");
  writer.line();
  writer.literal("\n");
  assert.equal(writer.toMarkdown(), "# \n");
});

test("as reads data[k] and emits after the bind pipeline", () => {
  const writer = new Writer({ title: "  hi  " });
  writer.literal("# ");
  writer.line().trim().as("title");
  writer.literal("\n");
  assert.equal(writer.toMarkdown(), "# hi\n");
});

test("default substitutes when data[k] is undefined", () => {
  const writer = new Writer({});
  writer.line().default("fallback").as("k");
  assert.equal(writer.toMarkdown(), "fallback");
});

test("toString aliases toMarkdown", () => {
  const writer = new Writer({ k: "x" });
  writer.literal("pre-");
  writer.line().as("k");
  assert.equal(writer.toString(), writer.toMarkdown());
  assert.equal(writer.toString(), "pre-x");
});

test("a template with literal text and line().as renders from the bound key", () => {
  const fn = Template.wrap('# {% doc.line().as("k") %}\n', "t.tpl.md");
  const writer = new Writer({ k: "hello" });
  fn(writer, writer.data, writer.data, {}, null);
  assert.equal(writer.toMarkdown(), "# hello\n");
});

test("the same template parses to { k } and renders from { k }", () => {
  const fn = Template.wrap('# {% doc.line().as("k") %}\n', "t.tpl.md");
  const reader = new Reader("# hello\n");
  fn(reader, reader.context, null, {}, null);
  assert.deepEqual(reader.context, { k: "hello" });

  const writer = new Writer(reader.context);
  fn(writer, writer.data, writer.data, {}, null);
  assert.equal(writer.toMarkdown(), "# hello\n");
});

function isTemplateError(err) {
  return err instanceof SyntaxError && err.code === ERROR_CODES.DO_MD_TEMPLATE_ERROR;
}

function isUserError(err) {
  return err instanceof SyntaxError && err.code === ERROR_CODES.DO_MD_USER_ERROR;
}

test("scope iterates data[k] with a shared buffer and ctx === data === element", () => {
  const chapters = [
    { name: "One", intro: "Intro one" },
    { name: "Two", intro: "Intro two" },
  ];
  const writer = new Writer({ title: "Book", chapters });
  writer.literal("# ");
  writer.line().as("title");
  writer.literal("\n\n");
  const seen = [];
  const result = writer.scope("chapters", (chapter, index) => {
    assert.equal(chapter.context, chapter.data);
    assert.equal(chapter.data, chapters[index]);
    assert.equal(chapter.buffer, writer.buffer);
    seen.push(index);
    chapter.heading(2).as("name");
    chapter.literal("\n\n");
    chapter.paragraph().as("intro");
    chapter.literal("\n\n");
  });
  assert.equal(result, undefined);
  assert.deepEqual(seen, [0, 1]);
  assert.equal(writer.toMarkdown(), "# Book\n\n## One\n\nIntro one\n\n## Two\n\nIntro two\n\n");
});

test("scope emits nothing when data[k] is undefined, null, or []", () => {
  for (const chapters of [undefined, null, []]) {
    const writer = new Writer(chapters === undefined ? {} : { chapters });
    writer.literal("pre");
    writer.scope("chapters", (chapter) => {
      chapter.literal("X");
      chapter.line().as("name");
    });
    writer.literal("post");
    assert.equal(writer.toMarkdown(), "prepost");
  }
});

test("scope throws DO_MD_TEMPLATE_ERROR when data[k] is a non-array", () => {
  const writer = new Writer({ chapters: "nope" });
  assert.throws(() => writer.scope("chapters", () => {}), isTemplateError);
});

test("scope collides with as at the same level", () => {
  const writer = new Writer({ chapters: "x" });
  writer.line().as("chapters");
  assert.throws(() => writer.scope("chapters", () => {}), isTemplateError);
});

test("nested scope emits each child against its own element", () => {
  const writer = new Writer({
    chapters: [
      { name: "Ch1", sections: [{ name: "S1" }, { name: "S2" }] },
      { name: "Ch2", sections: [{ name: "S3" }] },
    ],
  });
  writer.scope("chapters", (chapter) => {
    chapter.literal("## ");
    chapter.line().as("name");
    chapter.literal("\n");
    chapter.scope("sections", (section) => {
      section.literal("### ");
      section.line().as("name");
      section.literal("\n");
    });
  });
  assert.equal(writer.toMarkdown(), "## Ch1\n### S1\n### S2\n## Ch2\n### S3\n");
});

test("scope literals between iterations emit verbatim each time", () => {
  const writer = new Writer({ chapters: [{ name: "A" }, { name: "B" }] });
  writer.scope("chapters", (chapter) => {
    chapter.literal("- ");
    chapter.line().as("name");
    chapter.literal("\n");
  });
  assert.equal(writer.toMarkdown(), "- A\n- B\n");
});

test("scope child primitive element throws DO_MD_USER_ERROR", () => {
  const writer = new Writer({ chapters: ["A"] });
  assert.throws(() => writer.scope("chapters", () => {}), isUserError);
});

test("optional discards the whole block when a required key is missing", () => {
  const writer = new Writer({});
  writer.literal("keep\n");
  assert.equal(
    writer.optional(() => {
      writer.literal("## Callout\n\n");
      writer.blockQuote().as("callout");
    }),
    false,
  );
  assert.equal(writer.toMarkdown(), "keep\n");
});

test("optional emits when every leaf has data", () => {
  const writer = new Writer({ callout: "Hi" });
  assert.equal(
    writer.optional(() => {
      writer.literal("> ");
      writer.blockQuote().as("callout");
      writer.literal("\n");
    }),
    true,
  );
  assert.equal(writer.toMarkdown(), "> Hi\n");
});

test("optional succeeds when a missing key has a default", () => {
  const writer = new Writer({});
  assert.equal(
    writer.optional(() => {
      writer.line().default("References").as("header");
    }),
    true,
  );
  assert.equal(writer.toMarkdown(), "References");
});

test("optional discards all leaves if any required key is missing", () => {
  const writer = new Writer({ a: "one" });
  assert.equal(
    writer.optional(() => {
      writer.line().as("a");
      writer.literal("|");
      writer.line().as("b");
    }),
    false,
  );
  assert.equal(writer.toMarkdown(), "");
});

test("optional wrapping an empty scope emits nothing", () => {
  const writer = new Writer({});
  assert.equal(
    writer.optional(() => {
      writer.literal("## Chapters\n");
      writer.scope("chapters", (chapter) => {
        chapter.line().as("name");
      });
    }),
    false,
  );
  assert.equal(writer.toMarkdown(), "");
});

test("optional wrapping a matching scope emits the children", () => {
  const writer = new Writer({ chapters: [{ title: "A" }, { title: "B" }] });
  assert.equal(
    writer.optional(() => {
      writer.scope("chapters", (chapter) => {
        chapter.heading(2).as("title");
        chapter.literal("\n");
      });
    }),
    true,
  );
  assert.equal(writer.toMarkdown(), "## A\n## B\n");
});

test("optional inside scope discards only the optional block", () => {
  const writer = new Writer({
    chapters: [
      { title: "One", body: "body", seeAlso: { url: "https://ex.com", text: "ex", title: null } },
      { title: "Two", body: "more" },
    ],
  });
  writer.scope("chapters", (chapter) => {
    chapter.heading(2).as("title");
    chapter.literal("\n\n");
    chapter.paragraph().as("body");
    chapter.literal("\n\n");
    chapter.optional(() => {
      chapter.literal("**See also:** ");
      chapter.link().as("seeAlso");
      chapter.literal("\n\n");
    });
  });
  assert.equal(
    writer.toMarkdown(),
    "## One\n\nbody\n\n**See also:** [ex](https://ex.com)\n\n## Two\n\nmore\n\n",
  );
});

test("optional suppresses notEmpty and still emits a defined empty value", () => {
  const writer = new Writer({ k: "" });
  assert.equal(
    writer.optional(() => {
      writer.line().notEmpty().as("k");
    }),
    true,
  );
  assert.equal(writer.toMarkdown(), "");
});

test("optional no-arg is a sticky flag and does not throw", () => {
  const writer = new Writer({ k: "" });
  const result = writer.optional();
  assert.equal(result, writer);
  writer.line().notEmpty().as("k");
  assert.equal(writer.toMarkdown(), "");
});

test("repeat emits asArray values and returns undefined", () => {
  const writer = new Writer({ notes: ["a", "b"] });
  const result = writer.repeat(() => {
    writer.literal("- ");
    writer.line().asArray("notes");
    writer.literal("\n");
  });
  assert.equal(result, undefined);
  assert.equal(writer.toMarkdown(), "- a\n- b\n");
});

test("repeat stops on a missing element and discards the current iteration", () => {
  const writer = new Writer({ done: [true, false], actions: ["ship"] });
  writer.repeat(() => {
    writer.literal("- ");
    writer.checkbox().asArray("done");
    writer.literal(" ");
    writer.line().asArray("actions");
    writer.literal("\n");
  });
  assert.equal(writer.toMarkdown(), "- [x] ship\n");
});

test("repeat stops when the array is missing and emits nothing", () => {
  const writer = new Writer({});
  writer.literal("pre");
  writer.repeat(() => {
    writer.literal("- ");
    writer.line().asArray("notes");
    writer.literal("\n");
  });
  writer.literal("post");
  assert.equal(writer.toMarkdown(), "prepost");
});

test("repeat throws DO_MD_TEMPLATE_ERROR when data[k] is a non-array", () => {
  const writer = new Writer({ notes: "nope" });
  assert.throws(
    () =>
      writer.repeat(() => {
        writer.line().asArray("notes");
      }),
    isTemplateError,
  );
});

test("repeat returning false discards the current iteration and stops", () => {
  const writer = new Writer({ notes: ["a", "b"] });
  writer.repeat(() => {
    writer.literal("- ");
    writer.line().asArray("notes");
    writer.literal("\n");
    return false;
  });
  assert.equal(writer.toMarkdown(), "");
});

test("repeat without asArray or false hits the 10000-iteration guard", () => {
  const writer = new Writer({});
  assert.throws(() => writer.repeat(() => {}), isTemplateError);
});

test("scope with 10000 items hits the 10000-iteration guard", () => {
  const writer = new Writer({
    chapters: Array.from({ length: 10000 }, () => ({ name: "x" })),
  });
  assert.throws(() => writer.scope("chapters", () => {}), isTemplateError);
});

test("scope with 9999 items does not hit the iteration guard", () => {
  const writer = new Writer({
    chapters: Array.from({ length: 9999 }, () => ({ name: "x" })),
  });
  writer.scope("chapters", (chapter) => {
    chapter.line().as("name");
  });
  assert.equal(writer.toMarkdown(), "x".repeat(9999));
});

test("repeat applies trim, default, validate, and notEmpty in bind order", () => {
  const writer = new Writer({ notes: ["  ok  "] });
  writer.repeat(() => {
    writer.line().default("x").trim().validate((v) => v === "ok").notEmpty().asArray("notes");
    writer.literal("\n");
  });
  assert.equal(writer.toMarkdown(), "ok\n");
});

test("repeat validate returning false throws DO_MD_USER_ERROR and discards the iteration", () => {
  const writer = new Writer({ notes: ["nope"] });
  writer.literal("keep");
  assert.throws(
    () =>
      writer.repeat(() => {
        writer.literal("-");
        writer.line().validate(() => false).asArray("notes");
      }),
    isUserError,
  );
  assert.equal(writer.toMarkdown(), "keep");
});

test("scope applies trim, default, validate, and notEmpty on child data", () => {
  const writer = new Writer({
    chapters: [{ name: "  One  " }],
  });
  writer.scope("chapters", (chapter) => {
    chapter.line().trim().validate((v) => v === "One").notEmpty().as("name");
    chapter.literal("|");
    chapter.line().default("none").as("missing");
  });
  assert.equal(writer.toMarkdown(), "One|none");
});

test("notEmpty outside optional still throws DO_MD_TEMPLATE_ERROR", () => {
  const writer = new Writer({ k: "" });
  assert.throws(() => writer.line().notEmpty().as("k"), isTemplateError);
});

test("validate returning false throws DO_MD_USER_ERROR", () => {
  const writer = new Writer({ k: "x" });
  assert.throws(() => writer.line().validate(() => false).as("k"), isUserError);
});

test("a chapters template renders nested scope from data", () => {
  const fn = Template.wrap(
    `# {% doc.line().as("title") %}

{%
doc.scope("chapters", (ch) => {
  ch.heading(2).as("name")
  ch.literal("\\n\\n")
  ch.paragraph().as("intro")
  ch.literal("\\n\\n")
})
doc.optional()
%}`,
    "chapters.tpl.md",
  );
  const writer = new Writer({
    title: "Book",
    chapters: [
      { name: "One", intro: "Intro one" },
      { name: "Two", intro: "Intro two" },
    ],
  });
  fn(writer, writer.data, writer.data, {}, null);
  assert.equal(writer.toMarkdown(), "# Book\n\n## One\n\nIntro one\n\n## Two\n\nIntro two\n\n");
});

test("Writer default serializer options", () => {
  const writer = new Writer({});
  assert.deepEqual(
    {
      bullet: writer.options.bullet,
      orderedDelim: writer.options.orderedDelim,
      fence: writer.options.fence,
      headingStyle: writer.options.headingStyle,
      tightLists: writer.options.tightLists,
      tablePadding: writer.options.tablePadding,
    },
    {
      bullet: "-",
      orderedDelim: ".",
      fence: "`",
      headingStyle: "atx",
      tightLists: true,
      tablePadding: true,
    },
  );
});

test("bullet option is used by writeList, list slots, and append", () => {
  const writer = new Writer({ items: ["a", "b"] }, { bullet: "*" });
  writer.writeList(["x", "y"]);
  writer.list().as("items");
  assert.equal(writer.toMarkdown(), "* x\n* y\n\n* a\n* b");
  const markdown = new Writer({}, { bullet: "+" }).append(parseMarkdown("- one\n- two\n")).toMarkdown();
  assert.match(markdown, /^\+ one\n\+ two/);
  assert.deepEqual(stripPosition(parseMarkdown(markdown)), stripPosition(parseMarkdown("- one\n- two\n")));
});

test("orderedDelim option is used when appending ordered lists", () => {
  const markdown = new Writer({}, { orderedDelim: ")" }).append(parseMarkdown("1. a\n2. b\n")).toMarkdown();
  assert.match(markdown, /^1\) a\n2\) b/);
  assert.deepEqual(stripPosition(parseMarkdown(markdown)), stripPosition(parseMarkdown("1. a\n2. b\n")));
});

test("fence option is used by writeCodeBlock, codeBlock slots, and append", () => {
  const writer = new Writer({ block: { language: "js", value: "x" } }, { fence: "~" });
  writer.writeCodeBlock("y", "md");
  writer.codeBlock().as("block");
  assert.equal(writer.toMarkdown(), "~~~md\ny\n~~~\n\n~~~js\nx\n~~~");
  const markdown = new Writer({}, { fence: "~" }).append(parseMarkdown("```js\ncode\n```\n")).toMarkdown();
  assert.match(markdown, /^~~~js\ncode\n~~~/);
  assert.deepEqual(stripPosition(parseMarkdown(markdown)), stripPosition(parseMarkdown("```js\ncode\n```\n")));
});

test("headingStyle setext is used for levels 1-2 and ATX for higher levels", () => {
  const writer = new Writer({ title: "Hello", section: "Two", deep: "Three" }, { headingStyle: "setext" });
  writer.heading(1).as("title");
  writer.literal("\n");
  writer.heading(2).as("section");
  writer.literal("\n");
  writer.heading(3).as("deep");
  assert.equal(writer.toMarkdown(), "Hello\n=====\nTwo\n---\n### Three");
  const direct = new Writer({}, { headingStyle: "setext" });
  direct.writeHeading(1, "Title");
  assert.equal(direct.toMarkdown(), "Title\n=====\n\n");
  const empty = new Writer({}, { headingStyle: "setext" });
  empty.writeHeading(1, "");
  assert.equal(empty.toMarkdown(), "#\n\n");
});

test("tightLists false emits loose lists from writeList and list slots", () => {
  const writer = new Writer({ items: ["a", "b"] }, { tightLists: false });
  writer.writeList(["x", "y"]);
  writer.list().as("items");
  assert.equal(writer.toMarkdown(), "- x\n\n- y\n\n- a\n\n- b");
  assert.equal(writer.toAst().children[0].tight, false);
});

test("append keeps a tight list tight even when tightLists is false", () => {
  const markdown = new Writer({}, { tightLists: false }).append(parseMarkdown("- one\n- two\n")).toMarkdown();
  assert.match(markdown, /^- one\n- two/);
  assert.equal(parseMarkdown(markdown).children[0].tight, true);
});

test("tablePadding and align emit left, right, center, and default separators", () => {
  const table = {
    headers: ["A", "B", "C", "D"],
    rows: [["1", "22", "3", "4"]],
    align: ["left", "right", "center", null],
  };
  const padded = new Writer({});
  padded.writeTable(table);
  assert.equal(
    padded.toMarkdown(),
    "| A   |   B |  C  | D   |\n| :-- | --: | :-: | --- |\n| 1   |  22 |  3  | 4   |\n\n",
  );
  const compact = new Writer({}, { tablePadding: false });
  compact.writeTable(table);
  assert.equal(compact.toMarkdown(), "|A|B|C|D|\n|:--|--:|:-:|---|\n|1|22|3|4|\n\n");
  const slot = new Writer({ table: { headers: ["A", "B"], rows: [], align: ["right"] } });
  slot.table().as("table");
  assert.equal(slot.toMarkdown(), "|   A | B   |\n| --: | --- |");
});

test("append serializes a document AST and reparses modulo position", () => {
  const source = [
    "# Title",
    "",
    "Hello *em* and **strong** and `code`",
    "soft. Hard  ",
    "break. [link](u \"t\") ![alt](img) <https://ex.com> <a@b.co> <span>x</span>",
    "",
    "---",
    "",
    "> quoted",
    "",
    "- item",
    "- [x] task",
    "",
    "3. three",
    "4. four",
    "",
    "```js",
    "code",
    "```",
    "",
    "    indented",
    "",
    "| A | B | C | D |",
    "| :--- | ---: | :---: | --- |",
    "| 1 | 2 | 3 | 4 |",
    "",
    "<div>",
    "raw",
    "",
  ].join("\n");
  const markdown = assertAppendRoundTrip(source);
  assert.match(markdown, /\| :-- \| --: \| :-: \| --- \|/);
});

test("append keeps nested block quotes inside list items", () => {
  assertAppendRoundTrip("- a\n  > q\n");
  assertAppendRoundTrip("- a\n\n  > q\n");
});

test("append honors serializer options without breaking AST equality", () => {
  const source = "# Title\n\n- one\n- two\n\n1. a\n2. b\n\n```js\nx\n```\n";
  assertAppendRoundTrip(source, {
    bullet: "*",
    orderedDelim: ")",
    fence: "~",
    headingStyle: "setext",
  });
});

test("toAst returns a document of appended nodes without positions", () => {
  const ast = parseMarkdown("# A\n\nB\n");
  const writer = new Writer().append(ast);
  const out = writer.toAst();
  assert.equal(out.type, "document");
  assert.equal(out.children[0].type, "heading");
  assert.equal(out.children[0].position, undefined);
  assert.equal(out.children[1].type, "paragraph");
  assert.deepEqual(stripPosition(out), stripPosition(ast));
});

test("every leaf returns a Slot with the documented leafType", () => {
  const writer = new Writer({});
  assert.equal(writer.line().leafType, "line");
  assert.equal(writer.text().leafType, "text");
  assert.equal(writer.until("]").leafType, "text");
  assert.equal(writer.regexp(/x/).leafType, "text");
  assert.equal(writer.heading(2).leafType, "heading");
  assert.equal(writer.paragraph().leafType, "paragraph");
  assert.equal(writer.list().leafType, "list");
  assert.equal(writer.table().leafType, "table");
  assert.equal(writer.codeBlock().leafType, "codeBlock");
  assert.equal(writer.blockQuote().leafType, "blockQuote");
  assert.equal(writer.thematicBreak().leafType, "thematicBreak");
  assert.equal(writer.htmlBlock().leafType, "htmlBlock");
  assert.equal(writer.link().leafType, "link");
  assert.equal(writer.image().leafType, "image");
  assert.equal(writer.autolink().leafType, "autolink");
  assert.equal(writer.codeSpan().leafType, "codeSpan");
  assert.equal(writer.checkbox().leafType, "checkbox");
});

test("byte-level leaves emit only the value with no implicit block boundary", () => {
  const writer = new Writer({
    line: "L",
    text: "T",
    until: "U",
    re: "R",
    homepage: { url: "https://ex.com", text: "site", title: null },
    logo: { url: "logo.png", alt: "logo", title: "cap" },
    repo: "https://git.ex",
    binary: "do-md",
    done: true,
  });
  writer.literal("# ");
  writer.line().as("line");
  writer.literal("|");
  writer.text().as("text");
  writer.literal("|");
  writer.until("]").as("until");
  writer.literal("|");
  writer.regexp(/R/).as("re");
  writer.literal(" Homepage: ");
  writer.link().as("homepage");
  writer.literal(" Logo: ");
  writer.image().as("logo");
  writer.literal(" Repo: ");
  writer.autolink().as("repo");
  writer.literal(" Binary: ");
  writer.codeSpan().as("binary");
  writer.literal(" - ");
  writer.checkbox().as("done");
  writer.literal(" tail");
  assert.equal(
    writer.toMarkdown(),
    "# L|T|U|R Homepage: [site](https://ex.com) Logo: ![logo](logo.png \"cap\") Repo: <https://git.ex> Binary: `do-md` - [x] tail",
  );
});

test("block-level leaves emit complete Markdown from Reader value shapes", () => {
  const writer = new Writer({
    title: "Hello",
    body: "Intro",
    items: ["a", "b"],
    table: { headers: ["A", "B"], rows: [["1", "2"]], align: ["left", null] },
    sample: { language: "js", value: "x" },
    quote: "Hi",
    hr: true,
    embed: "<div>raw</div>",
  });
  writer.heading(1).as("title");
  writer.literal("\n\n");
  writer.paragraph().as("body");
  writer.literal("\n\n");
  writer.list().as("items");
  writer.literal("\n\n");
  writer.table().as("table");
  writer.literal("\n\n");
  writer.codeBlock().as("sample");
  writer.literal("\n\n");
  writer.blockQuote().as("quote");
  writer.literal("\n\n");
  writer.thematicBreak().as("hr");
  writer.literal("\n\n");
  writer.htmlBlock().as("embed");
  assert.equal(
    writer.toMarkdown(),
    [
      "# Hello",
      "",
      "Intro",
      "",
      "- a",
      "- b",
      "",
      "| A   | B   |",
      "| :-- | --- |",
      "| 1   | 2   |",
      "",
      "```js",
      "x",
      "```",
      "",
      "Hi",
      "",
      "---",
      "",
      "<div>raw</div>",
    ].join("\n"),
  );
});

test("# plus line and heading(1) emit byte-equivalent Markdown", () => {
  const composed = new Writer({ title: "Hello" });
  composed.literal("# ");
  composed.line().as("title");
  composed.literal("\n");
  const block = new Writer({ title: "Hello" });
  block.heading(1).as("title");
  block.literal("\n");
  assert.equal(composed.toMarkdown(), "# Hello\n");
  assert.equal(block.toMarkdown(), composed.toMarkdown());
});

test("codeBlock language may be null and serialization adds the closing newline", () => {
  const writer = new Writer({ sample: { language: null, value: "indented" } });
  writer.codeBlock().as("sample");
  assert.equal(writer.toMarkdown(), "```\nindented\n```");
});

test("link and image titles may be null", () => {
  const writer = new Writer({
    homepage: { url: "u", text: "n", title: null },
    logo: { url: "img", alt: "alt", title: null },
  });
  writer.link().as("homepage");
  writer.literal(" ");
  writer.image().as("logo");
  assert.equal(writer.toMarkdown(), "[n](u) ![alt](img)");
});

test("autolink emits a url string and strips mailto for email values", () => {
  const writer = new Writer({ repo: "https://ex.com", mail: "mailto:a@b.co" });
  writer.autolink().as("repo");
  writer.literal(" ");
  writer.autolink().as("mail");
  assert.equal(writer.toMarkdown(), "<https://ex.com> <a@b.co>");
});

test("checkbox emits [x] or [ ] from a boolean", () => {
  const writer = new Writer({ done: true, open: false });
  writer.checkbox().as("done");
  writer.literal(" ");
  writer.checkbox().as("open");
  assert.equal(writer.toMarkdown(), "[x] [ ]");
});

test("missing keys emit nothing unless a default is provided", () => {
  const missing = new Writer({});
  missing.literal("pre");
  missing.line().as("k");
  missing.literal("post");
  assert.equal(missing.toMarkdown(), "prepost");
  assert.equal(missing.line().as("also").exists, false);

  const present = new Writer({ k: "x" });
  assert.equal(present.line().as("k").exists, true);

  const fallback = new Writer({});
  fallback.heading(2).default("Fallback").as("title");
  assert.equal(fallback.toMarkdown(), "## Fallback");
});

test("skipUntilHeading is a Writer no-op", () => {
  const writer = new Writer({ title: "Hello" });
  writer.literal("pre");
  assert.equal(writer.skipUntilHeading("§14"), false);
  assert.equal(writer.skipUntilHeading(), false);
  writer.line().as("title");
  assert.equal(writer.toMarkdown(), "preHello");
});

test("table slots pad short rows, reject extra cells, and reject empty headers", () => {
  const padded = new Writer({
    table: { headers: ["A", "B", "C"], rows: [["1", "2"]], align: [] },
  });
  padded.table().as("table");
  assert.equal(padded.toMarkdown(), "| A   | B   | C   |\n| --- | --- | --- |\n| 1   | 2   |     |");

  const extra = new Writer({
    table: { headers: ["A", "B"], rows: [["1", "2", "3"]], align: [null, null] },
  });
  assert.throws(() => extra.table().as("table"), isUserError);

  const empty = new Writer({ table: { headers: [], rows: [], align: [] } });
  assert.throws(() => empty.table().as("table"), isUserError);
});

test("invalid structured leaf shapes throw DO_MD_USER_ERROR", () => {
  assert.throws(() => new Writer({ items: "nope" }).list().as("items"), isUserError);
  assert.throws(() => new Writer({ table: "nope" }).table().as("table"), isUserError);
  assert.throws(() => new Writer({ sample: "nope" }).codeBlock().as("sample"), isUserError);
  assert.throws(() => new Writer({ homepage: "nope" }).link().as("homepage"), isUserError);
  assert.throws(() => new Writer({ logo: "nope" }).image().as("logo"), isUserError);
});

test("direct emit methods write without reading data and return the Writer", () => {
  const writer = new Writer({ title: "ignored" });
  const methods = [
    ["writeHeading", [1, "Title"]],
    ["writeParagraph", ["Body"]],
    ["writeText", ["txt"]],
    ["writeLine", ["ln"]],
    ["writeNewline", [2]],
    ["writeList", [["a", "b"]]],
    ["writeTable", [{ headers: ["A"], rows: [["1"]], align: [null] }]],
    ["writeCodeBlock", ["x", "js"]],
    ["writeBlockQuote", ["q"]],
    ["writeThematicBreak", []],
    ["writeHtmlBlock", ["<div>"]],
    ["writeLink", ["u", "n", "t"]],
    ["writeImage", ["img", "alt", null]],
    ["writeAutolink", ["https://ex.com"]],
    ["writeCodeSpan", ["code"]],
    ["writeEmphasis", ["em"]],
    ["writeStrong", ["st"]],
    ["writeCheckbox", [true]],
    ["append", [{ type: "thematic_break" }]],
  ];
  for (const [name, args] of methods) {
    const isolated = new Writer({ title: "ignored" });
    const result = isolated[name](...args);
    assert.equal(result, isolated, name);
    assert.equal(result instanceof Slot, false, name);
  }

  writer.writeHeading(1, "Title");
  writer.writeParagraph("Body");
  writer.writeText("txt");
  writer.writeLine("ln");
  writer.writeNewline(2);
  writer.writeList(["a", "b"]);
  writer.writeTable({ headers: ["A"], rows: [["1"]], align: [null] });
  writer.writeCodeBlock("x", "js");
  writer.writeBlockQuote("q");
  writer.writeThematicBreak();
  writer.writeHtmlBlock("<div>");
  writer.writeLink("u", "n", "t");
  writer.writeImage("img", "alt", null);
  writer.writeAutolink("https://ex.com");
  writer.writeCodeSpan("code");
  writer.writeEmphasis("em");
  writer.writeStrong("st");
  writer.writeCheckbox(true);
  writer.writeCheckbox(false);
  assert.equal(
    writer.toMarkdown(),
    [
      "# Title",
      "",
      "Body",
      "",
      "txtln",
      "",
      "",
      "- a",
      "- b",
      "",
      "| A   |",
      "| --- |",
      "| 1   |",
      "",
      "```js",
      "x",
      "```",
      "",
      "> q",
      "",
      "---",
      "",
      "<div>",
      "",
      '[n](u "t")![alt](img)<https://ex.com>`code`*em***st**[x][ ]',
    ].join("\n"),
  );
});

test("toAst records nodes from leaves and direct emit methods", () => {
  const writer = new Writer({
    title: "A",
    body: "B",
    items: ["c"],
    sample: { language: null, value: "d" },
    homepage: { url: "u", text: "n", title: null },
  });
  writer.heading(1).as("title");
  writer.paragraph().as("body");
  writer.list().as("items");
  writer.codeBlock().as("sample");
  writer.link().as("homepage");
  writer.writeEmphasis("em");
  const ast = writer.toAst();
  assert.equal(ast.type, "document");
  assert.deepEqual(
    ast.children.map((node) => node.type),
    ["heading", "paragraph", "list", "code_block", "paragraph"],
  );
  assert.equal(ast.children[0].position, undefined);
  assert.equal(ast.children[0].level, 1);
  assert.equal(ast.children[2].tight, true);
  assert.equal(ast.children[3].language, null);
  assert.equal(ast.children[4].children[0].type, "link");
  assert.equal(ast.children[4].children[1].type, "emphasis");
});
