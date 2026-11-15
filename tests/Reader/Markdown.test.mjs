import test from "node:test";
import assert from "node:assert/strict";

import { Reader } from "../../sources/Reader.mjs";
import { parseMarkdown, flattenInlines, flattenNode } from "../../sources/Reader/Markdown.mjs";

function assertPosition(node) {
  assert.equal(typeof node.position?.start?.offset, "number");
  assert.equal(typeof node.position.start.line, "number");
  assert.equal(typeof node.position.start.column, "number");
  assert.equal(typeof node.position.end.offset, "number");
  assert.equal(typeof node.position.end.line, "number");
  assert.equal(typeof node.position.end.column, "number");
  assert.ok(node.position.start.offset >= 0);
  assert.ok(node.position.end.offset >= node.position.start.offset);
  assert.ok(node.position.start.line >= 1);
  assert.ok(node.position.start.column >= 1);
  assert.ok(node.position.end.line >= 1);
  assert.ok(node.position.end.column >= 1);
}

function walkTyped(node, visit) {
  visit(node);
  if (Array.isArray(node.children)) {
    for (const child of node.children) {
      walkTyped(child, visit);
    }
  }
}

function parse(source) {
  return parseMarkdown(source);
}

test("parseMarkdown returns a document AST", () => {
  const parsed = parseMarkdown("# Heading\n\nBody");
  assert.equal(parsed.type, "document");
  assert.ok(Array.isArray(parsed.children));
  assert.equal(parsed.children[0].type, "heading");
  assert.equal(parsed.children[1].type, "paragraph");
});

test("YAML frontmatter is parsed only at the document start with positions", () => {
  const source = "\uFEFF---\r\ntitle: Hello\r\ntags:\r\n  - one\r\n---\r\n\r\nBody\r\n";
  const parsed = parseMarkdown(source);
  const node = parsed.children[0];
  assert.equal(node.type, "frontmatter");
  assert.equal(node.format, "yaml");
  assert.equal(node.raw, "title: Hello\r\ntags:\r\n  - one\r\n");
  assert.equal(node.content, node.raw);
  assert.deepEqual(node.data, { title: "Hello", tags: ["one"] });
  assert.deepEqual(node.position.start, { offset: 0, line: 1, column: 1 });
  assert.equal(node.position.end.offset, source.indexOf("\r\n\r\nBody"));
  assert.equal(parsed.children[1].type, "paragraph");

  const later = parseMarkdown("Body\n\n---\ntitle: no\n---\n");
  assert.equal(later.children.some((child) => child.type === "frontmatter"), false);
});

test("Reader.parseDocument returns the same document AST", () => {
  const source = "# Heading\n\nBody\n";
  const fromReader = new Reader(source).parseDocument();
  const fromParser = parseMarkdown(source);
  assert.deepEqual(fromReader, fromParser);
  assert.equal(fromReader.type, "document");
  assertPosition(fromReader);
  assert.equal(fromReader.position.start.offset, 0);
  assert.equal(fromReader.position.start.line, 1);
  assert.equal(fromReader.position.start.column, 1);
  assert.equal(fromReader.position.end.offset, source.length);
});

test("Reader.fromMarkdown returns a v1 document AST", () => {
  const parsed = Reader.fromMarkdown("# Heading\n\nBody");
  assert.equal(parsed.type, "document");
  assert.equal(parsed.children[0].type, "heading");
  assert.equal(parsed.children[1].type, "paragraph");
  assert.equal(parsed.blocks, undefined);
});

test("empty document is a positioned document with no children", () => {
  const parsed = parse("");
  assert.equal(parsed.type, "document");
  assert.deepEqual(parsed.children, []);
  assertPosition(parsed);
  assert.equal(parsed.position.start.offset, 0);
  assert.equal(parsed.position.end.offset, 0);
});

test("every typed AST node carries source positions", () => {
  const parsed = parse(
    [
      "# Title",
      "",
      "Paragraph",
      "",
      "Setext",
      "=====",
      "",
      "---",
      "",
      "> quote",
      "",
      "- item",
      "",
      "```js",
      "code",
      "```",
      "",
      "    indented",
      "",
      "| A | B |",
      "| --- | --- |",
      "| 1 | 2 |",
      "",
      "<div>",
      "raw",
      "",
    ].join("\n"),
  );
  let count = 0;
  walkTyped(parsed, (node) => {
    assert.equal(typeof node.type, "string");
    assertPosition(node);
    count += 1;
  });
  assert.ok(count >= 10);
});

test("ATX headings capture level 1 through 6", () => {
  const source = ["# One", "## Two", "### Three", "#### Four", "##### Five", "###### Six"].join("\n");
  const parsed = parse(source);
  assert.equal(parsed.children.length, 6);
  parsed.children.forEach((node, index) => {
    assert.equal(node.type, "heading");
    assert.equal(node.level, index + 1);
    assert.equal(flattenInlines(node.children), ["One", "Two", "Three", "Four", "Five", "Six"][index]);
    assert.ok(Array.isArray(node.children));
    assertPosition(node);
    assert.equal(node.position.start.line, index + 1);
    assert.equal(node.position.start.column, 1);
  });
});

test("ATX heading positions span the heading line", () => {
  const source = "# Title\n";
  const heading = parse(source).children[0];
  assert.equal(heading.type, "heading");
  assert.equal(heading.level, 1);
  assert.deepEqual(heading.position.start, { offset: 0, line: 1, column: 1 });
  assert.deepEqual(heading.position.end, { offset: 7, line: 1, column: 8 });
});

test("Setext headings use = for level 1 and - for level 2", () => {
  const parsed = parse("Alpha\n=====\n\nBeta\n-----\n");
  assert.equal(parsed.children.length, 2);
  assert.equal(parsed.children[0].type, "heading");
  assert.equal(parsed.children[0].level, 1);
  assert.equal(flattenInlines(parsed.children[0].children), "Alpha");
  assert.equal(parsed.children[1].type, "heading");
  assert.equal(parsed.children[1].level, 2);
  assert.equal(flattenInlines(parsed.children[1].children), "Beta");
  assert.equal(parsed.children[0].position.start.line, 1);
  assert.equal(parsed.children[0].position.end.line, 2);
  assert.equal(parsed.children[1].position.start.line, 4);
  assert.equal(parsed.children[1].position.end.line, 5);
});

test("multi-line Setext bodies use only the last line as the heading", () => {
  const parsed = parse("First\nSecond\n=====\n");
  assert.equal(parsed.children.length, 2);
  assert.equal(parsed.children[0].type, "paragraph");
  assert.equal(flattenInlines(parsed.children[0].children), "First");
  assert.equal(parsed.children[1].type, "heading");
  assert.equal(parsed.children[1].level, 1);
  assert.equal(flattenInlines(parsed.children[1].children), "Second");
});

test("paragraphs collect consecutive non-blank lines", () => {
  const parsed = parse("Hello\nworld\n\nNext\n");
  assert.equal(parsed.children.length, 2);
  assert.equal(parsed.children[0].type, "paragraph");
  assert.ok(Array.isArray(parsed.children[0].children));
  assert.equal(flattenInlines(parsed.children[0].children), "Hello\nworld");
  assert.equal(parsed.children[1].type, "paragraph");
  assert.equal(flattenInlines(parsed.children[1].children), "Next");
  assertPosition(parsed.children[0]);
  assert.equal(parsed.children[0].position.start.offset, 0);
  assert.equal(parsed.children[0].position.start.line, 1);
  assert.equal(parsed.children[0].position.end.line, 2);
});

test("thematic breaks match --- *** and ___ of three or more", () => {
  const parsed = parse("---\n\n***\n\n___\n\n- - -\n");
  assert.equal(parsed.children.length, 4);
  for (const node of parsed.children) {
    assert.equal(node.type, "thematic_break");
    assert.equal(node.children, undefined);
    assert.equal(node.value, undefined);
    assertPosition(node);
  }
});

test("a lone --- is a thematic break, not a Setext underline", () => {
  const parsed = parse("---\n");
  assert.equal(parsed.children.length, 1);
  assert.equal(parsed.children[0].type, "thematic_break");
});

test("fenced code blocks capture language, value, and fenced flag", () => {
  const parsed = parse("```js\nconst x = 1;\n```\n");
  assert.equal(parsed.children.length, 1);
  const node = parsed.children[0];
  assert.equal(node.type, "code_block");
  assert.equal(node.language, "js");
  assert.equal(node.meta, "");
  assert.equal(node.value, "const x = 1;");
  assert.equal(node.fenced, true);
  assert.ok(!node.value.endsWith("\n"));
  assertPosition(node);
  assert.equal(node.position.start.offset, 0);
  assert.equal(node.position.start.line, 1);
});

test("tilde fences and missing language are supported", () => {
  const parsed = parse("~~~\nplain\n~~~\n");
  const node = parsed.children[0];
  assert.equal(node.type, "code_block");
  assert.equal(node.language, null);
  assert.equal(node.meta, "");
  assert.equal(node.value, "plain");
  assert.equal(node.fenced, true);
});

test("indented code blocks have fenced false and language null", () => {
  const parsed = parse("    indented\n    still\n");
  const node = parsed.children[0];
  assert.equal(node.type, "code_block");
  assert.equal(node.fenced, false);
  assert.equal(node.language, null);
  assert.equal(node.meta, "");
  assert.equal(node.value, "indented\nstill");
  assert.ok(!node.value.endsWith("\n"));
  assertPosition(node);
});

test("block quotes contain nested block children", () => {
  const parsed = parse("> # Title\n>\n> quoted\n>\n> - item\n");
  const quote = parsed.children[0];
  assert.equal(quote.type, "block_quote");
  assert.ok(Array.isArray(quote.children));
  assert.equal(quote.children[0].type, "heading");
  assert.equal(quote.children[0].level, 1);
  assert.equal(flattenInlines(quote.children[0].children), "Title");
  assert.equal(quote.children[1].type, "paragraph");
  assert.equal(flattenInlines(quote.children[1].children), "quoted");
  assert.equal(quote.children[2].type, "list");
  assert.equal(flattenNode(quote), "Title\nquoted\nitem");
  assertPosition(quote);
  assertPosition(quote.children[0]);
});

test("nested block quotes parse as nested block_quote nodes", () => {
  const parsed = parse("> > inner\n");
  const outer = parsed.children[0];
  assert.equal(outer.type, "block_quote");
  assert.equal(outer.children[0].type, "block_quote");
  assert.equal(outer.children[0].children[0].type, "paragraph");
  assert.equal(flattenInlines(outer.children[0].children[0].children), "inner");
});

test("bullet lists expose ordered false, null start, and list_item children", () => {
  const parsed = parse("- one\n- two\n");
  const list = parsed.children[0];
  assert.equal(list.type, "list");
  assert.equal(list.ordered, false);
  assert.equal(list.start, null);
  assert.equal(list.tight, true);
  assert.equal(list.children.length, 2);
  assert.equal(list.children[0].type, "list_item");
  assert.equal(list.children[0].checked, null);
  assert.equal(list.children[1].checked, null);
  assert.equal(flattenNode(list.children[0]), "one");
  assert.equal(flattenNode(list.children[1]), "two");
  assertPosition(list);
  assertPosition(list.children[0]);
  assertPosition(list.children[1]);
});

test("ordered lists record the first item number as start", () => {
  const parsed = parse("3. three\n4. four\n");
  const list = parsed.children[0];
  assert.equal(list.type, "list");
  assert.equal(list.ordered, true);
  assert.equal(list.start, 3);
  assert.equal(list.tight, true);
  assert.equal(list.children.length, 2);
  assert.equal(flattenNode(list.children[0]), "three");
});

test("blank lines between list items make the list loose", () => {
  const parsed = parse("- one\n\n- two\n");
  const list = parsed.children[0];
  assert.equal(list.type, "list");
  assert.equal(list.tight, false);
  assert.equal(list.children.length, 2);
});

test("task list items set checked true, false, or null", () => {
  const parsed = parse("- [ ] todo\n- [x] done\n- [X] also\n- plain\n");
  const list = parsed.children[0];
  assert.equal(list.children[0].checked, false);
  assert.equal(list.children[1].checked, true);
  assert.equal(list.children[2].checked, true);
  assert.equal(list.children[3].checked, null);
  assert.equal(flattenNode(list.children[0]), "todo");
  assert.equal(flattenNode(list.children[1]), "done");
});

test("nested lists appear as subsequent children of a list item", () => {
  const parsed = parse("- parent\n  - child\n");
  const list = parsed.children[0];
  assert.equal(list.children.length, 1);
  const item = list.children[0];
  assert.equal(item.type, "list_item");
  assert.ok(item.children.some((child) => child.type === "list"));
  const nested = item.children.find((child) => child.type === "list");
  assert.equal(nested.ordered, false);
  assert.equal(flattenNode(nested.children[0]), "child");
});

test("GFM pipe tables capture headers, rows, and align", () => {
  const parsed = parse("| A | B | C | D |\n| :--- | ---: | :---: | --- |\n| 1 | 2 | 3 | 4 |\n");
  const table = parsed.children[0];
  assert.equal(table.type, "table");
  assert.deepEqual(table.align, ["left", "right", "center", null]);
  assert.equal(table.headers.length, 4);
  assert.equal(table.rows.length, 1);
  assert.equal(table.rows[0].length, 4);
  assert.deepEqual(
    table.headers.map((cell) => flattenInlines(cell.children)),
    ["A", "B", "C", "D"],
  );
  assert.deepEqual(
    table.rows[0].map((cell) => flattenInlines(cell.children)),
    ["1", "2", "3", "4"],
  );
  assert.equal(table.align.length, table.headers.length);
  assert.equal(table.rows[0].length, table.headers.length);
  assertPosition(table);
});

test("a header-only table is valid with empty rows", () => {
  const parsed = parse("| A | B |\n| --- | --- |\n");
  const table = parsed.children[0];
  assert.equal(table.type, "table");
  assert.equal(table.headers.length, 2);
  assert.deepEqual(table.rows, []);
  assert.equal(table.align.length, 2);
});

test("missing trailing table cells are padded to the header width", () => {
  const parsed = parse("| A | B | C |\n| --- | --- | --- |\n| 1 | 2 |\n");
  const table = parsed.children[0];
  assert.equal(table.rows[0].length, 3);
  assert.deepEqual(
    table.rows[0].map((cell) => flattenInlines(cell.children)),
    ["1", "2", ""],
  );
});

test("HTML blocks store raw text up to the next blank line", () => {
  const parsed = parse("<div>\n<script>alert(1)</script>\n\nAfter\n");
  const html = parsed.children[0];
  assert.equal(html.type, "html_block");
  assert.equal(html.value, "<div>\n<script>alert(1)</script>");
  assert.equal(typeof html.value, "string");
  assert.equal(parsed.children[1].type, "paragraph");
  assert.equal(flattenInlines(parsed.children[1].children), "After");
  assertPosition(html);
});

test("HTML comments, processing instructions, and CDATA open HTML blocks", () => {
  const parsed = parse("<!-- comment -->\n\n<?pi?>\n\n<![CDATA[x]]>\n");
  assert.equal(parsed.children.length, 3);
  assert.equal(parsed.children[0].type, "html_block");
  assert.equal(parsed.children[0].value, "<!-- comment -->");
  assert.equal(parsed.children[1].type, "html_block");
  assert.equal(parsed.children[1].value, "<?pi?>");
  assert.equal(parsed.children[2].type, "html_block");
  assert.equal(parsed.children[2].value, "<![CDATA[x]]>");
});

test("a mixed document preserves block order and positions", () => {
  const source = [
    "# Title",
    "",
    "Intro",
    "",
    "---",
    "",
    "> quoted",
    "",
    "- one",
    "- two",
    "",
    "```",
    "code",
    "```",
    "",
    "| H |",
    "| --- |",
    "| v |",
    "",
    "<div>",
    "",
  ].join("\n");
  const parsed = new Reader(source).parseDocument();
  assert.deepEqual(
    parsed.children.map((node) => node.type),
    ["heading", "paragraph", "thematic_break", "block_quote", "list", "code_block", "table", "html_block"],
  );
  let previous = -1;
  for (const node of parsed.children) {
    assertPosition(node);
    assert.ok(node.position.start.offset >= previous);
    previous = node.position.end.offset;
  }
});

function inlinesOf(source) {
  const parsed = parse(source);
  assert.equal(parsed.children[0].type, "paragraph");
  return parsed.children[0].children;
}

function walkInlines(nodes, visit) {
  for (const node of nodes) {
    visit(node);
    if (Array.isArray(node.children)) {
      walkInlines(node.children, visit);
    }
  }
}

test("text nodes merge adjacent runs and carry positions", () => {
  const children = inlinesOf("hello world");
  assert.equal(children.length, 1);
  assert.equal(children[0].type, "text");
  assert.equal(children[0].value, "hello world");
  assertPosition(children[0]);
  assert.deepEqual(children[0].position.start, { offset: 0, line: 1, column: 1 });
  assert.deepEqual(children[0].position.end, { offset: 11, line: 1, column: 12 });
});

test("unmatched markers and entities stay as a single merged text node", () => {
  const children = inlinesOf("see * star and [ref][id] and &nbsp;");
  assert.equal(children.length, 1);
  assert.equal(children[0].type, "text");
  assert.equal(children[0].value, "see * star and [ref][id] and &nbsp;");
});

test("emphasis and strong parse star and underscore delimiters", () => {
  const children = inlinesOf("*em* and **strong** and _em_ and __strong__");
  assert.equal(children[0].type, "emphasis");
  assert.equal(flattenInlines(children[0].children), "em");
  assert.equal(children[2].type, "strong");
  assert.equal(flattenInlines(children[2].children), "strong");
  assert.equal(children[4].type, "emphasis");
  assert.equal(flattenInlines(children[4].children), "em");
  assert.equal(children[6].type, "strong");
  assert.equal(flattenInlines(children[6].children), "strong");
  for (const node of [children[0], children[2], children[4], children[6]]) {
    assert.ok(Array.isArray(node.children));
    assertPosition(node);
  }
});

test("intraword underscores do not open emphasis", () => {
  const children = inlinesOf("snake_case and foo_bar_baz");
  assert.equal(children.length, 1);
  assert.equal(children[0].type, "text");
  assert.equal(children[0].value, "snake_case and foo_bar_baz");
});

test("triple markers nest strong and emphasis", () => {
  const children = inlinesOf("***both***");
  assert.equal(children.length, 1);
  assert.ok(children[0].type === "strong" || children[0].type === "emphasis");
  const nested = children[0].children;
  assert.equal(nested.length, 1);
  assert.equal(nested[0].type, children[0].type === "strong" ? "emphasis" : "strong");
  assert.equal(flattenInlines(nested[0].children), "both");
  assert.equal(flattenInlines(children), "both");
});

test("emphasis can contain strong and strong can contain emphasis", () => {
  const em = inlinesOf("*foo **bar** baz*");
  assert.equal(em[0].type, "emphasis");
  assert.equal(em[0].children[1].type, "strong");
  assert.equal(flattenInlines(em), "foo bar baz");
  const strong = inlinesOf("**foo *bar* baz**");
  assert.equal(strong[0].type, "strong");
  assert.equal(strong[0].children[1].type, "emphasis");
  assert.equal(flattenInlines(strong), "foo bar baz");
});

test("code spans apply the CommonMark space-trim rule", () => {
  const children = inlinesOf("`code` and ` spaced ` and ` ` and `  ` and ``foo`bar``");
  assert.equal(children[0].type, "code_span");
  assert.equal(children[0].value, "code");
  assert.equal(children[2].type, "code_span");
  assert.equal(children[2].value, "spaced");
  assert.equal(children[4].type, "code_span");
  assert.equal(children[4].value, " ");
  assert.equal(children[6].type, "code_span");
  assert.equal(children[6].value, "  ");
  assert.equal(children[8].type, "code_span");
  assert.equal(children[8].value, "foo`bar");
  assertPosition(children[0]);
});

test("links capture url, optional title, and inline children", () => {
  const children = inlinesOf("[text](https://ex.com) and [t](u \"title\") and [*em*](u)");
  assert.equal(children[0].type, "link");
  assert.equal(children[0].url, "https://ex.com");
  assert.equal(children[0].title, null);
  assert.equal(flattenInlines(children[0].children), "text");
  assert.equal(children[2].type, "link");
  assert.equal(children[2].url, "u");
  assert.equal(children[2].title, "title");
  assert.equal(children[4].type, "link");
  assert.equal(children[4].children[0].type, "emphasis");
  assertPosition(children[0]);
  assertPosition(children[0].children[0]);
});

test("images flatten alt and keep url and title", () => {
  const children = inlinesOf("![alt](img.png \"cap\") and ![*x*](u)");
  assert.equal(children[0].type, "image");
  assert.equal(children[0].url, "img.png");
  assert.equal(children[0].title, "cap");
  assert.equal(children[0].alt, "alt");
  assert.equal(children[0].children, undefined);
  assert.equal(children[2].type, "image");
  assert.equal(children[2].alt, "x");
  assert.equal(children[2].title, null);
  assertPosition(children[0]);
});

test("autolinks distinguish url and mailto email forms", () => {
  const children = inlinesOf("<https://ex.com> and <a@b.co>");
  assert.equal(children[0].type, "autolink");
  assert.equal(children[0].kind, "url");
  assert.equal(children[0].url, "https://ex.com");
  assert.equal(flattenInlines(children[0].children), "https://ex.com");
  assert.equal(children[2].type, "autolink");
  assert.equal(children[2].kind, "email");
  assert.equal(children[2].url, "mailto:a@b.co");
  assert.equal(flattenInlines(children[2].children), "a@b.co");
  assertPosition(children[0]);
  assertPosition(children[2]);
});

test("bare urls are text, not autolinks", () => {
  const children = inlinesOf("https://not-autolink.com");
  assert.equal(children.length, 1);
  assert.equal(children[0].type, "text");
  assert.equal(children[0].value, "https://not-autolink.com");
});

test("hard breaks come from trailing spaces or a backslash before a newline", () => {
  const spaces = inlinesOf("line  \nbreak");
  assert.equal(spaces[0].type, "text");
  assert.equal(spaces[0].value, "line");
  assert.equal(spaces[1].type, "hard_break");
  assert.equal(spaces[2].type, "text");
  assert.equal(spaces[2].value, "break");
  assertPosition(spaces[1]);
  const slash = inlinesOf("line\\\nbreak");
  assert.equal(slash[1].type, "hard_break");
  assert.equal(flattenInlines(slash), "line\nbreak");
});

test("soft breaks preserve a single newline inside a paragraph", () => {
  const children = inlinesOf("soft\nbreak");
  assert.equal(children[0].type, "text");
  assert.equal(children[1].type, "soft_break");
  assert.equal(children[2].type, "text");
  assert.equal(flattenInlines(children), "soft\nbreak");
  assertPosition(children[1]);
  assert.deepEqual(children[1].position.start, { offset: 4, line: 1, column: 5 });
  assert.deepEqual(children[1].position.end, { offset: 5, line: 2, column: 1 });
});

test("inline HTML is captured as raw data and never interpreted", () => {
  const children = inlinesOf("a <span onclick=\"alert(1)\">x</span> <!--c--> <?pi?> b");
  const html = children.filter((node) => node.type === "html_inline");
  assert.deepEqual(
    html.map((node) => node.value),
    ["<span onclick=\"alert(1)\">", "</span>", "<!--c-->", "<?pi?>"],
  );
  for (const node of html) {
    assert.equal(typeof node.value, "string");
    assertPosition(node);
  }
  assert.equal(flattenInlines(children), "a <span onclick=\"alert(1)\">x</span> <!--c--> <?pi?> b");
});

test("every inline node type carries source positions", () => {
  const children = inlinesOf("A *em* **strong** `code` [t](u) ![a](i) <https://ex.com> x  \ny\nz <em>w</em>");
  const seen = new Set();
  walkInlines(children, (node) => {
    assert.equal(typeof node.type, "string");
    assertPosition(node);
    seen.add(node.type);
  });
  for (const type of ["text", "emphasis", "strong", "code_span", "link", "image", "autolink", "hard_break", "soft_break", "html_inline"]) {
    assert.ok(seen.has(type), type);
  }
});

const AST_NODE_TYPES = [
  "document",
  "heading",
  "paragraph",
  "thematic_break",
  "code_block",
  "block_quote",
  "list",
  "list_item",
  "table",
  "html_block",
  "text",
  "emphasis",
  "strong",
  "code_span",
  "link",
  "image",
  "autolink",
  "hard_break",
  "soft_break",
  "html_inline",
];

function walkAll(node, visit) {
  if (!node || typeof node !== "object") {
    return;
  }
  visit(node);
  if (Array.isArray(node.children)) {
    for (const child of node.children) {
      walkAll(child, visit);
    }
  }
  if (Array.isArray(node.headers)) {
    for (const cell of node.headers) {
      for (const child of cell.children ?? []) {
        walkAll(child, visit);
      }
    }
  }
  if (Array.isArray(node.rows)) {
    for (const row of node.rows) {
      for (const cell of row) {
        for (const child of cell.children ?? []) {
          walkAll(child, visit);
        }
      }
    }
  }
}

function catalogSource() {
  return [
    "# Title",
    "",
    "Hello *em* and **strong** and `code` and a",
    "soft break. Hard  ",
    "break. [link](u \"t\") ![alt](img) <https://ex.com> <span>x</span>",
    "",
    "---",
    "",
    "> quoted",
    "",
    "- item",
    "- [x] task",
    "",
    "```js",
    "code",
    "```",
    "",
    "    indented",
    "",
    "| A | B |",
    "| --- | ---: |",
    "| 1 | 2 |",
    "",
    "<div>",
    "raw",
    "",
    "Setext",
    "=====",
    "",
  ].join("\n");
}

test("every documented AST node type is produced with documented fields", () => {
  const parsed = parse(catalogSource());
  assert.equal(parsed.type, "document");
  assert.ok(Array.isArray(parsed.children));
  const byType = new Map();
  walkAll(parsed, (node) => {
    if (typeof node.type === "string") {
      if (!byType.has(node.type)) {
        byType.set(node.type, []);
      }
      byType.get(node.type).push(node);
    }
  });
  for (const type of AST_NODE_TYPES) {
    assert.ok(byType.has(type), type);
  }

  const document = byType.get("document")[0];
  assert.equal(document, parsed);
  assert.equal(byType.get("document").length, 1);

  const heading = byType.get("heading").find((node) => flattenInlines(node.children) === "Title");
  assert.equal(heading.level, 1);
  assert.ok(Array.isArray(heading.children));
  const setext = byType.get("heading").find((node) => flattenInlines(node.children) === "Setext");
  assert.equal(setext.level, 1);

  const paragraph = byType.get("paragraph")[0];
  assert.ok(Array.isArray(paragraph.children));

  const thematic = byType.get("thematic_break")[0];
  assert.equal(thematic.children, undefined);
  assert.equal(thematic.value, undefined);

  const fenced = byType.get("code_block").find((node) => node.fenced);
  assert.equal(fenced.language, "js");
  assert.equal(fenced.meta, "");
  assert.equal(fenced.value, "code");
  assert.equal(fenced.fenced, true);
  const indented = byType.get("code_block").find((node) => !node.fenced);
  assert.equal(indented.language, null);
  assert.equal(indented.meta, "");
  assert.equal(indented.fenced, false);
  assert.equal(indented.value, "indented");

  const quote = byType.get("block_quote")[0];
  assert.ok(Array.isArray(quote.children));
  assert.ok(quote.children.every((child) => typeof child.type === "string"));

  const list = byType.get("list")[0];
  assert.equal(list.ordered, false);
  assert.equal(list.start, null);
  assert.equal(typeof list.tight, "boolean");
  assert.ok(list.children.every((child) => child.type === "list_item"));
  assert.equal(list.children[0].checked, null);
  assert.equal(list.children[1].checked, true);
  assert.ok(Array.isArray(list.children[0].children));

  const table = byType.get("table")[0];
  assert.ok(Array.isArray(table.align));
  assert.ok(Array.isArray(table.headers));
  assert.ok(Array.isArray(table.rows));
  assert.equal(table.align.length, table.headers.length);
  assert.deepEqual(table.align, [null, "right"]);
  for (const cell of [...table.headers, ...table.rows[0]]) {
    assert.equal(cell.type, undefined);
    assert.ok(Array.isArray(cell.children));
  }

  const html = byType.get("html_block")[0];
  assert.equal(typeof html.value, "string");
  assert.match(html.value, /<div>/);

  const text = byType.get("text")[0];
  assert.equal(typeof text.value, "string");
  const emphasis = byType.get("emphasis")[0];
  assert.ok(Array.isArray(emphasis.children));
  const strong = byType.get("strong")[0];
  assert.ok(Array.isArray(strong.children));
  const codeSpan = byType.get("code_span")[0];
  assert.equal(typeof codeSpan.value, "string");
  const link = byType.get("link")[0];
  assert.equal(typeof link.url, "string");
  assert.equal(link.title, "t");
  assert.ok(Array.isArray(link.children));
  const image = byType.get("image")[0];
  assert.equal(typeof image.url, "string");
  assert.equal(typeof image.alt, "string");
  assert.equal(image.children, undefined);
  const autolink = byType.get("autolink")[0];
  assert.equal(autolink.kind, "url");
  assert.equal(typeof autolink.url, "string");
  assert.ok(Array.isArray(autolink.children));
  const hard = byType.get("hard_break")[0];
  assert.equal(hard.value, undefined);
  const soft = byType.get("soft_break")[0];
  assert.equal(soft.value, undefined);
  const htmlInline = byType.get("html_inline")[0];
  assert.equal(typeof htmlInline.value, "string");
});

test("source-position shape is present on every typed node including table-cell inlines", () => {
  const parsed = parse(catalogSource());
  let count = 0;
  walkAll(parsed, (node) => {
    if (typeof node.type !== "string") {
      return;
    }
    assertPosition(node);
    assert.equal(Number.isInteger(node.position.start.offset), true);
    assert.equal(Number.isInteger(node.position.start.line), true);
    assert.equal(Number.isInteger(node.position.start.column), true);
    assert.equal(Number.isInteger(node.position.end.offset), true);
    assert.equal(Number.isInteger(node.position.end.line), true);
    assert.equal(Number.isInteger(node.position.end.column), true);
    assert.deepEqual(Object.keys(node.position.start).sort(), ["column", "line", "offset"]);
    assert.deepEqual(Object.keys(node.position.end).sort(), ["column", "line", "offset"]);
    count += 1;
  });
  assert.ok(count >= AST_NODE_TYPES.length);
});

test("plus and star markers produce bullet lists", () => {
  const plus = parse("+ one\n+ two\n").children[0];
  assert.equal(plus.type, "list");
  assert.equal(plus.ordered, false);
  assert.equal(plus.start, null);
  assert.equal(plus.children.length, 2);
  assert.equal(flattenNode(plus.children[0]), "one");
  const star = parse("* one\n* two\n").children[0];
  assert.equal(star.type, "list");
  assert.equal(star.ordered, false);
  assert.equal(flattenNode(star.children[1]), "two");
});

test("ordered lists accept a closing-paren marker", () => {
  const list = parse("1) first\n2) second\n").children[0];
  assert.equal(list.type, "list");
  assert.equal(list.ordered, true);
  assert.equal(list.start, 1);
  assert.equal(flattenNode(list.children[0]), "first");
});

test("table cell inlines carry source positions", () => {
  const table = parse("| *A* | B |\n| --- | --- |\n| `1` | 2 |\n").children[0];
  assert.equal(table.headers[0].children[0].type, "emphasis");
  assertPosition(table.headers[0].children[0]);
  assert.equal(table.rows[0][0].children[0].type, "code_span");
  assertPosition(table.rows[0][0].children[0]);
  assert.equal(flattenInlines(table.headers[0].children), "A");
  assert.equal(flattenInlines(table.rows[0][0].children), "1");
});
