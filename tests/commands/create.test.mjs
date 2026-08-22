import test from "node:test";
import assert from "node:assert/strict";

import { create } from "../../sources/commands/create.mjs";
import { Virtual } from "../../sources/IO/Virtual.mjs";
import { ERROR_CODES } from "../../sources/SyntaxError.mjs";

const TEMPLATE = '# {% doc.line().as("title") %}\n';

function trackReads(io) {
  const reads = [];
  const original = io.readFileAsync.bind(io);
  io.readFileAsync = async (path, options) => {
    reads.push(path);
    return original(path, options);
  };
  return reads;
}

test("create command module exists", () => {
  assert.equal(typeof create, "function");
});

test("create refuses to overwrite without force and does not write", async () => {
  const existing = "# keep me\n";
  const io = new Virtual({ "/out.md": existing, "/tpl.md": TEMPLATE });
  const reads = trackReads(io);
  const result = await create({
    io,
    file: "/out.md",
    template: "/tpl.md",
    data: { title: "Hello" },
  });

  assert.equal(result.ok, false);
  assert.equal(result.exitCode, 1);
  assert.equal(result.output, null);
  assert.equal(result.context, null);
  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0].code, ERROR_CODES.DO_MD_USER_ERROR);
  assert.equal(result.errors[0].file, "/out.md");
  assert.deepEqual(reads, []);
  assert.equal(io.entries.get("/out.md"), existing);
});

test("create never reads the target file", async () => {
  const io = new Virtual({ "/tpl.md": TEMPLATE });
  const reads = trackReads(io);
  const result = await create({
    io,
    file: "/out.md",
    template: "/tpl.md",
    data: { title: "Hello" },
  });

  assert.equal(result.ok, true);
  assert.equal(result.exitCode, 0);
  assert.equal(result.output.includes("Hello"), true);
  assert.equal(result.context, null);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(Object.keys(result).sort(), ["context", "errors", "exitCode", "ok", "output"]);
  assert.ok(!reads.includes("/out.md"));
  assert.match(io.entries.get("/out.md"), /Hello/);
});

test("create overwrites when force is true", async () => {
  const io = new Virtual({ "/out.md": "# old\n", "/tpl.md": TEMPLATE });
  const result = await create({
    io,
    file: "/out.md",
    template: "/tpl.md",
    data: { title: "Hello" },
    force: true,
  });

  assert.equal(result.ok, true);
  assert.equal(result.exitCode, 0);
  assert.match(await io.readFileAsync("/out.md"), /Hello/);
  assert.ok(!String(await io.readFileAsync("/out.md")).includes("old"));
});

test("create uses an atomic ifAbsent write to reject a creation race", async () => {
  const io = new Virtual({ "/tpl.md": TEMPLATE });
  const atomic = io.writeFileAtomicAsync.bind(io);
  io.writeFileAtomicAsync = async (path, content, options) => {
    await io.writeFileAsync(path, "# raced\n");
    return atomic(path, content, options);
  };
  await assert.rejects(
    () => create({ io, file: "/out.md", template: "/tpl.md", data: { title: "Hello" } }),
    (err) => err.code === ERROR_CODES.DO_MD_CONFLICT,
  );
  assert.equal(await io.readFileAsync("/out.md"), "# raced\n");
});

test("create rejects missing arguments with DO_MD_USER_ERROR", async () => {
  await assert.rejects(() => create({}), (err) => err.code === ERROR_CODES.DO_MD_USER_ERROR);
  await assert.rejects(
    () => create({ io: new Virtual({ "/tpl.md": TEMPLATE }), file: "/out.md" }),
    (err) => err.code === ERROR_CODES.DO_MD_USER_ERROR,
  );
});

test("create rejects a wrap-time template error", async () => {
  const io = new Virtual({ "/tpl.md": "{% function( %}\n" });
  await assert.rejects(
    () => create({ io, file: "/out.md", template: "/tpl.md", data: { title: "Hello" } }),
    (err) => err.code === ERROR_CODES.DO_MD_TEMPLATE_ERROR,
  );
  assert.equal(io.entries.has("/out.md"), false);
});

test("create rejects a missing template with DO_MD_IO_ERROR", async () => {
  const io = new Virtual();
  await assert.rejects(
    () => create({ io, file: "/out.md", template: "/missing.tpl.md", data: { title: "Hello" } }),
    (err) => err.code === ERROR_CODES.DO_MD_IO_ERROR,
  );
});

const SERIALIZER_TPL = `{% doc.heading(1).as("title") %}

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

const SERIALIZER_DATA = {
  title: "Hello",
  items: ["a", "b"],
  block: { language: "js", value: "x" },
  table: { headers: ["A", "B"], rows: [["1", "2"]], align: [null, null] },
};

const SERIALIZER_OPTIONS = {
  bullet: "*",
  orderedDelim: ")",
  fence: "~",
  headingStyle: "setext",
  tightLists: false,
  tablePadding: false,
  myCustomFlag: "yes",
  quiet: true,
  json: true,
};

test("create honors Writer serializer settings and forwards options into the template", async () => {
  const io = new Virtual({ "/tpl.md": SERIALIZER_TPL });
  const result = await create({
    io,
    file: "/out.md",
    template: "/tpl.md",
    data: SERIALIZER_DATA,
    options: SERIALIZER_OPTIONS,
  });

  assert.equal(result.ok, true);
  assert.match(result.output, /^Hello\n=====/);
  assert.match(result.output, /\* a\n\n\* b/);
  assert.match(result.output, /~~~js\nx\n~~~/);
  assert.match(result.output, /\|A\|B\|/);
  assert.match(result.output, /1\) one\n2\) two/);
  assert.match(result.output, /yes:\*:true:true:\)/);
});
