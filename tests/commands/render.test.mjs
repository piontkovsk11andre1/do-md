import test from "node:test";
import assert from "node:assert/strict";

import { render } from "../../sources/commands/render.mjs";
import { Virtual } from "../../sources/IO/Virtual.mjs";
import { ERROR_CODES } from "../../sources/SyntaxError.mjs";

const PARSE_TEMPLATE = '# {% doc.line().as("title") %}\n';
const RENDER_TEMPLATE = 'Title: {% doc.line().as("title") %}\n';
const INPUT = "# Hello\n";

test("render command module exists", () => {
  assert.equal(typeof render, "function");
});

test("render writes only outFile and never modifies the input", async () => {
  const io = new Virtual({
    "/doc.md": INPUT,
    "/parse.tpl.md": PARSE_TEMPLATE,
    "/render.tpl.md": RENDER_TEMPLATE,
  });
  const result = await render({
    io,
    file: "/doc.md",
    parseTemplate: "/parse.tpl.md",
    renderTemplate: "/render.tpl.md",
    outFile: "/out.txt",
  });

  assert.equal(result.ok, true);
  assert.equal(result.exitCode, 0);
  assert.match(result.output, /Title: Hello/);
  assert.deepEqual(result.context, { title: "Hello" });
  assert.deepEqual(result.errors, []);
  assert.equal(await io.readFileAsync("/doc.md"), INPUT);
  assert.match(await io.readFileAsync("/out.txt"), /Title: Hello/);
});

test("render parse failure does not write outFile or change the input", async () => {
  const io = new Virtual({
    "/doc.md": "not a heading\n",
    "/parse.tpl.md": PARSE_TEMPLATE,
    "/render.tpl.md": RENDER_TEMPLATE,
  });
  const result = await render({
    io,
    file: "/doc.md",
    parseTemplate: "/parse.tpl.md",
    renderTemplate: "/render.tpl.md",
    outFile: "/out.txt",
  });

  assert.equal(result.ok, false);
  assert.equal(result.exitCode, 2);
  assert.equal(result.output, null);
  assert.equal(result.context, null);
  assert.ok(result.errors.length > 0);
  assert.equal(result.errors[0].code, ERROR_CODES.DO_MD_PARSE_ERROR);
  assert.equal(await io.readFileAsync("/doc.md"), "not a heading\n");
  await assert.rejects(() => io.readFileAsync("/out.txt"));
  assert.deepEqual(Object.keys(result).sort(), ["context", "errors", "exitCode", "ok", "output"]);
});

test("render rejects missing arguments with DO_MD_USER_ERROR", async () => {
  await assert.rejects(() => render({}), (err) => err.code === ERROR_CODES.DO_MD_USER_ERROR);
  await assert.rejects(
    () =>
      render({
        io: new Virtual(),
        file: "/doc.md",
        parseTemplate: "/parse.tpl.md",
        renderTemplate: "/render.tpl.md",
      }),
    (err) => err.code === ERROR_CODES.DO_MD_USER_ERROR,
  );
});

test("render rejects a wrap-time template error", async () => {
  const io = new Virtual({
    "/doc.md": INPUT,
    "/parse.tpl.md": PARSE_TEMPLATE,
    "/render.tpl.md": "{% function( %}\n",
  });
  await assert.rejects(
    () =>
      render({
        io,
        file: "/doc.md",
        parseTemplate: "/parse.tpl.md",
        renderTemplate: "/render.tpl.md",
        outFile: "/out.txt",
      }),
    (err) => err.code === ERROR_CODES.DO_MD_TEMPLATE_ERROR,
  );
  await assert.rejects(() => io.readFileAsync("/out.txt"));
  assert.equal(await io.readFileAsync("/doc.md"), INPUT);
});

test("render rejects a missing input with DO_MD_IO_ERROR", async () => {
  const io = new Virtual({
    "/parse.tpl.md": PARSE_TEMPLATE,
    "/render.tpl.md": RENDER_TEMPLATE,
  });
  await assert.rejects(
    () =>
      render({
        io,
        file: "/missing.md",
        parseTemplate: "/parse.tpl.md",
        renderTemplate: "/render.tpl.md",
        outFile: "/out.txt",
      }),
    (err) => err.code === ERROR_CODES.DO_MD_IO_ERROR,
  );
});

const SERIALIZER_PARSE_TPL = `{% doc.heading(1).as("title") %}

{% doc.list().as("items") %}

{% doc.codeBlock().as("block") %}

{% doc.table().as("table") %}
`;

const SERIALIZER_RENDER_TPL = `{% doc.heading(1).as("title") %}

{% doc.list().as("items") %}

{% doc.codeBlock().as("block") %}

{% doc.table().as("table") %}
{%
doc.append({
  type: "list",
  ordered: true,
  start: 1,
  tight: true,
  children: [
    { type: "list_item", children: [{ type: "paragraph", children: [{ type: "text", value: "one" }] }] },
    { type: "list_item", children: [{ type: "paragraph", children: [{ type: "text", value: "two" }] }] },
  ],
})
doc.literal([options.myCustomFlag, options.bullet, String(options.quiet), String(options.json), options.orderedDelim].join(":"))
%}
`;

const SERIALIZER_DOC = `# Hello

- a
- b

\`\`\`js
x
\`\`\`

| A | B |
| --- | --- |
| 1 | 2 |
`;

test("render honors Writer serializer settings and forwards options into the template", async () => {
  const io = new Virtual({
    "/doc.md": SERIALIZER_DOC,
    "/parse.tpl.md": SERIALIZER_PARSE_TPL,
    "/render.tpl.md": SERIALIZER_RENDER_TPL,
  });
  const result = await render({
    io,
    file: "/doc.md",
    parseTemplate: "/parse.tpl.md",
    renderTemplate: "/render.tpl.md",
    outFile: "/out.md",
    options: {
      bullet: "*",
      orderedDelim: ")",
      fence: "~",
      headingStyle: "setext",
      tightLists: false,
      tablePadding: false,
      myCustomFlag: "yes",
      quiet: true,
      json: true,
    },
  });

  assert.equal(result.ok, true);
  assert.match(result.output, /^Hello\n=====/);
  assert.match(result.output, /\* a\n\n\* b/);
  assert.match(result.output, /~~~js\nx\n~~~/);
  assert.match(result.output, /\|A\|B\|/);
  assert.match(result.output, /1\) one\n2\) two/);
  assert.match(result.output, /yes:\*:true:true:\)/);
});
