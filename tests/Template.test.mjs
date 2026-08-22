import test from "node:test";
import assert from "node:assert/strict";

import { renderBlocks, Template, TEMPLATE_SOURCE_URL } from "../sources/Template.mjs";
import { ERROR_CODES, SyntaxError } from "../sources/SyntaxError.mjs";

test("Template module exports sourceURL constant", () => {
  assert.equal(TEMPLATE_SOURCE_URL, "//# sourceURL=");
  const template = new Template("return 1", { file: "t.js" });
  assert.equal(template.file, "t.js");
});

test("renderBlocks emits literal text as doc.literal JSON", () => {
  assert.equal(renderBlocks("hello"), `doc.literal("hello");\n`);
  assert.equal(Template.renderBlocks("hello"), `doc.literal("hello");\n`);
});

test("renderBlocks emits nothing for an empty literal", () => {
  assert.equal(renderBlocks(""), "");
  assert.equal(renderBlocks("{%%}"), "\n");
});

test("renderBlocks splits literals and blocks", () => {
  assert.equal(
    renderBlocks('# {% doc.line().as("title") %}\n'),
    `doc.literal("# ");\n doc.line().as("title") \ndoc.literal("\\n");\n`,
  );
});

test("renderBlocks unescapes \\{% and \\%} in literals", () => {
  assert.equal(renderBlocks("see \\{% and \\%}"), `doc.literal("see {% and %}");\n`);
});

test("renderBlocks strips one leading and trailing newline inside blocks", () => {
  const source = "{%\n    doc.heading(1).as(\"title\")\n%}";
  assert.equal(renderBlocks(source), "    doc.heading(1).as(\"title\")\n");
});

test("renderBlocks keeps multiline block JavaScript verbatim", () => {
  const source = "{%\nconst x = 1\nconst y = 2\n%}";
  assert.equal(renderBlocks(source), "const x = 1\nconst y = 2\n");
});

test("renderBlocks does not append a semicolon to block content", () => {
  const source = [
    '{% const items = doc.list().as("items") %}',
    "{% (someCondition ? items : []).forEach(x => doc.literal(x)) %}",
  ].join("\n");
  assert.equal(
    renderBlocks(source),
    ' const items = doc.list().as("items") \ndoc.literal("\\n");\n (someCondition ? items : []).forEach(x => doc.literal(x)) \n',
  );
});

test("renderBlocks supports the open-callback pattern", () => {
  const source = [
    '{%doc.scope("chapters", chapter => {%}',
    '## {%chapter.line().as("title")%}',
    "{%})%}",
  ].join("\n");
  assert.equal(
    renderBlocks(source),
    'doc.scope("chapters", chapter => {\ndoc.literal("\\n## ");\nchapter.line().as("title")\ndoc.literal("\\n");\n})\n',
  );
});

test("Template.wrap returns a function with the documented signature", () => {
  const fn = Template.wrap("hi", "hi.tpl.md");
  assert.equal(typeof fn, "function");
  assert.equal(fn.length, 5);
  const calls = [];
  const doc = {
    literal(text) {
      calls.push(text);
    },
  };
  fn(doc, {}, null, {}, null);
  assert.deepEqual(calls, ["hi"]);
});

test("Template.wrap appends sourceURL so runtime errors report the template path", () => {
  const fn = Template.wrap("{% throw new Error(\"boom\") %}", "notes.tpl.md");
  assert.match(Function.prototype.toString.call(fn), /\/\/# sourceURL=notes\.tpl\.md/);
  assert.throws(() => fn({}, {}, null, {}, null), (err) => {
    assert.match(String(err.stack), /notes\.tpl\.md/);
    return true;
  });
});

test("Template.wrap passes io through the wrapped function", () => {
  const fn = Template.wrap("{% io.seen += 1 %}", "io.tpl.md");
  const io = { seen: 0 };
  fn({}, {}, null, {}, io);
  assert.equal(io.seen, 1);
});

test("Template.wrap reports new Function SyntaxError as DO_MD_TEMPLATE_ERROR", () => {
  assert.throws(() => Template.wrap("{% const %}", "bad.tpl.md"), (err) => {
    assert.ok(err instanceof SyntaxError);
    assert.equal(err.code, ERROR_CODES.DO_MD_TEMPLATE_ERROR);
    assert.equal(err.file, "bad.tpl.md");
    assert.equal(err.line, 1);
    assert.equal(err.column, 1);
    return true;
  });
});
