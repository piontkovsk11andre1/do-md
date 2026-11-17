import test from "node:test";
import assert from "node:assert/strict";

import { exportDoc } from "../../sources/commands/exportDoc.mjs";
import { Virtual } from "../../sources/IO/Virtual.mjs";
import { ERROR_CODES } from "../../sources/DoMdError.mjs";

const TEMPLATE = '# {% doc.line().as("title") %}\n';
const INPUT = "# Hello\n";

test("export command module exists", () => {
  assert.equal(typeof exportDoc, "function");
});

test("exportDoc overwrites an existing JSON save path", async () => {
  const io = new Virtual({
    "/doc.md": INPUT,
    "/tpl.md": TEMPLATE,
    "/out.json": '{"stale":true}',
  });
  const result = await exportDoc({
    io,
    file: "/doc.md",
    template: "/tpl.md",
    savePath: "/out.json",
  });

  assert.equal(result.ok, true);
  assert.equal(result.exitCode, 0);
  assert.equal(result.output, null);
  assert.deepEqual(result.context, { title: "Hello" });
  assert.deepEqual(result.errors, []);
  assert.equal(
    await io.readFileAsync("/out.json"),
    `${JSON.stringify({ title: "Hello" }, null, 2)}\n`,
  );
});

test("exportDoc parse failure does not write or overwrite savePath", async () => {
  const io = new Virtual({
    "/doc.md": "not a heading\n",
    "/tpl.md": TEMPLATE,
    "/out.json": '{"keep":true}',
  });
  const result = await exportDoc({
    io,
    file: "/doc.md",
    template: "/tpl.md",
    savePath: "/out.json",
  });

  assert.equal(result.ok, false);
  assert.equal(result.exitCode, 2);
  assert.equal(result.output, null);
  assert.equal(result.context, null);
  assert.ok(result.errors.length > 0);
  assert.equal(result.errors[0].code, ERROR_CODES.DO_MD_PARSE_ERROR);
  assert.equal(await io.readFileAsync("/out.json"), '{"keep":true}');
  assert.deepEqual(Object.keys(result).sort(), ["context", "errors", "exitCode", "ok", "output"]);
});

test("exportDoc rejects missing arguments with DO_MD_USER_ERROR", async () => {
  await assert.rejects(
    () => exportDoc({}),
    (err) => err.code === ERROR_CODES.DO_MD_USER_ERROR,
  );
  await assert.rejects(
    () => exportDoc({ io: new Virtual(), file: "/doc.md", template: "/tpl.md" }),
    (err) => err.code === ERROR_CODES.DO_MD_USER_ERROR,
  );
});

test("exportDoc rejects a wrap-time template error", async () => {
  const io = new Virtual({ "/doc.md": INPUT, "/tpl.md": "{% function( %}\n" });
  await assert.rejects(
    () => exportDoc({ io, file: "/doc.md", template: "/tpl.md", savePath: "/out.json" }),
    (err) => err.code === ERROR_CODES.DO_MD_TEMPLATE_ERROR,
  );
  assert.equal(io.entries.has("/out.json"), false);
});

test("exportDoc rejects a missing file with DO_MD_IO_ERROR", async () => {
  const io = new Virtual({ "/tpl.md": TEMPLATE });
  await assert.rejects(
    () => exportDoc({ io, file: "/missing.md", template: "/tpl.md", savePath: "/out.json" }),
    (err) => err.code === ERROR_CODES.DO_MD_IO_ERROR,
  );
});
