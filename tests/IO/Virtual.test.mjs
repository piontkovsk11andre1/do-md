import test from "node:test";
import assert from "node:assert/strict";

import { Virtual } from "../../sources/IO/Virtual.mjs";
import { ERROR_CODES, SyntaxError } from "../../sources/SyntaxError.mjs";

test("Virtual IO module exists", async () => {
  const io = new Virtual({ "/tmp/a.txt": "value" });
  assert.equal(await io.readFileAsync("/tmp/a.txt"), "value");
  await io.writeFileAsync("/tmp/b.txt", "next");
  assert.equal(await io.readFileAsync("/tmp/b.txt"), "next");
});

test("Virtual is in-memory read and write IO with normalized paths", async () => {
  const io = new Virtual({ "notes\\a.md": "one" });
  assert.equal(await io.readFileAsync("notes/a.md"), "one");
  await io.writeFileAsync("notes/../notes/a.md", "two");
  assert.equal(await io.readFileAsync("notes/a.md"), "two");
});

test("readFileAsync rejects missing files with DO_MD_IO_ERROR", async () => {
  const io = new Virtual();
  await assert.rejects(
    () => io.readFileAsync("missing.md"),
    (err) => err instanceof SyntaxError && err.code === ERROR_CODES.DO_MD_IO_ERROR,
  );
});

test("statAsync returns file metadata", async () => {
  const io = new Virtual({ "/tmp/a.txt": "hi" });
  assert.deepEqual(await io.statAsync("/tmp/a.txt"), {
    isFile: true,
    isDirectory: false,
    size: 2,
  });
});

test("resolvePath joins relative paths and keeps absolute ones", () => {
  const io = new Virtual();
  assert.equal(io.resolvePath("/tmp", "a.txt"), "/tmp/a.txt");
  assert.equal(io.resolvePath("/tmp", "/abs/b.txt"), "/abs/b.txt");
});

test("globAsync expands template directories and glob patterns", async () => {
  const io = new Virtual({
    "/templates/a.md.template": "a",
    "/templates/legacy.tpl.md": "legacy",
    "/templates/nested/b.md.template": "b",
    "/templates/ignored.md": "x",
  });
  const expected = ["/templates/a.md.template", "/templates/nested/b.md.template"];
  assert.deepEqual(await io.globAsync("templates", { cwd: "/" }), expected);
  assert.deepEqual(await io.globAsync("/templates/legacy.tpl.md"), ["/templates/legacy.tpl.md"]);
  assert.deepEqual(await io.globAsync("templates/**/*.md.template", { cwd: "/" }), expected);
});
