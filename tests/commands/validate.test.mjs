import test from "node:test";
import assert from "node:assert/strict";

import { validate } from "../../sources/commands/validate.mjs";
import { Virtual } from "../../sources/IO/Virtual.mjs";
import { ERROR_CODES } from "../../sources/SyntaxError.mjs";

const TEMPLATE = '# {% doc.line().as("title") %}\n';
const INPUT = "# Hello\n";

function snapshot(io) {
  return Object.fromEntries(io.entries);
}

function trackWrites(io) {
  const writes = [];
  const original = io.writeFileAsync.bind(io);
  io.writeFileAsync = async (path, content, options) => {
    writes.push({ path, content });
    return original(path, content, options);
  };
  return writes;
}

test("validate command module exists", () => {
  assert.equal(typeof validate, "function");
});

test("validate success writes nothing and returns an empty Result", async () => {
  const io = new Virtual({ "/doc.md": INPUT, "/tpl.md": TEMPLATE });
  const writes = trackWrites(io);
  const before = snapshot(io);
  const result = await validate({ io, file: "/doc.md", template: "/tpl.md" });

  assert.deepEqual(result, { ok: true, exitCode: 0, output: null, context: null, errors: [] });
  assert.deepEqual(writes, []);
  assert.deepEqual(snapshot(io), before);
});

test("validate parse failure writes nothing and resolves exit 2", async () => {
  const io = new Virtual({ "/doc.md": "not a heading\n", "/tpl.md": TEMPLATE });
  const writes = trackWrites(io);
  const before = snapshot(io);
  const result = await validate({ io, file: "/doc.md", template: "/tpl.md" });

  assert.equal(result.ok, false);
  assert.equal(result.exitCode, 2);
  assert.equal(result.output, null);
  assert.equal(result.context, null);
  assert.ok(result.errors.length > 0);
  assert.equal(result.errors[0].code, ERROR_CODES.DO_MD_PARSE_ERROR);
  assert.equal(result.errors[0].file, "/doc.md");
  assert.equal(typeof result.errors[0].message, "string");
  assert.equal(typeof result.errors[0].line, "number");
  assert.equal(typeof result.errors[0].column, "number");
  assert.ok("snippet" in result.errors[0]);
  assert.deepEqual(Object.keys(result).sort(), ["context", "errors", "exitCode", "ok", "output"]);
  assert.deepEqual(writes, []);
  assert.deepEqual(snapshot(io), before);
});

test("validate resolves relative paths against cwd", async () => {
  const io = new Virtual({ "/work/doc.md": INPUT, "/work/tpl.md": TEMPLATE });
  const result = await validate({ io, file: "doc.md", template: "tpl.md", cwd: "/work" });
  assert.deepEqual(result, { ok: true, exitCode: 0, output: null, context: null, errors: [] });
});

test("validate rejects missing arguments with DO_MD_USER_ERROR", async () => {
  await assert.rejects(() => validate({}), (err) => err.code === ERROR_CODES.DO_MD_USER_ERROR);
  await assert.rejects(
    () => validate({ io: new Virtual(), file: "/doc.md" }),
    (err) => err.code === ERROR_CODES.DO_MD_USER_ERROR,
  );
});

test("validate rejects a wrap-time template error", async () => {
  const io = new Virtual({ "/doc.md": INPUT, "/tpl.md": "{% function( %}\n" });
  await assert.rejects(
    () => validate({ io, file: "/doc.md", template: "/tpl.md" }),
    (err) => err.code === ERROR_CODES.DO_MD_TEMPLATE_ERROR,
  );
});

test("validate rejects a missing file with DO_MD_IO_ERROR", async () => {
  const io = new Virtual({ "/tpl.md": TEMPLATE });
  await assert.rejects(
    () => validate({ io, file: "/missing.md", template: "/tpl.md" }),
    (err) => err.code === ERROR_CODES.DO_MD_IO_ERROR,
  );
});
