import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { NodeFilesystem } from "../../sources/IO/NodeFilesystem.mjs";
import { ERROR_CODES, SyntaxError } from "../../sources/SyntaxError.mjs";

test("NodeFilesystem module exists", () => {
  const io = new NodeFilesystem();
  assert.equal(typeof io.readFileAsync, "function");
  assert.equal(typeof io.writeFileAsync, "function");
  assert.equal(typeof io.statAsync, "function");
  assert.equal(typeof io.resolvePath, "function");
  assert.equal(typeof io.globAsync, "function");
});

test("globAsync expands template directories and glob patterns", async () => {
  const io = new NodeFilesystem();
  const dir = await mkdtemp(join(tmpdir(), "do-md-glob-"));
  try {
    await mkdir(join(dir, "nested"));
    await writeFile(join(dir, "a.md.template"), "a");
    await writeFile(join(dir, "custom.template"), "custom");
    await writeFile(join(dir, "nested", "b.md.template"), "b");
    await writeFile(join(dir, "ignored.md"), "x");
    assert.deepEqual(await io.globAsync(dir), [join(dir, "a.md.template"), join(dir, "nested", "b.md.template")].sort());
    assert.deepEqual(await io.globAsync(join(dir, "custom.template")), [join(dir, "custom.template")]);
    assert.deepEqual(await io.globAsync("**/*.md.template", { cwd: dir }), [
      join(dir, "a.md.template"),
      join(dir, "nested", "b.md.template"),
    ].sort());
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("resolvePath joins relative paths and keeps absolute ones", () => {
  const io = new NodeFilesystem();
  assert.equal(io.resolvePath("/tmp", "a.txt"), resolve("/tmp", "a.txt"));
  assert.equal(io.resolvePath("/tmp", "/abs/b.txt"), resolve("/tmp", "/abs/b.txt"));
});

test("readFileAsync rejects missing files with DO_MD_IO_ERROR", async () => {
  const io = new NodeFilesystem();
  const missing = join(tmpdir(), `do-md-missing-${process.pid}-${Date.now()}.md`);
  await assert.rejects(
    () => io.readFileAsync(missing),
    (err) => err instanceof SyntaxError && err.code === ERROR_CODES.DO_MD_IO_ERROR,
  );
});

test("statAsync rejects missing files with DO_MD_IO_ERROR", async () => {
  const io = new NodeFilesystem();
  const missing = join(tmpdir(), `do-md-missing-${process.pid}-${Date.now()}.md`);
  await assert.rejects(
    () => io.statAsync(missing),
    (err) => err instanceof SyntaxError && err.code === ERROR_CODES.DO_MD_IO_ERROR,
  );
});

test("readFileAsync and writeFileAsync round-trip disk files", async () => {
  const io = new NodeFilesystem();
  const dir = await mkdtemp(join(tmpdir(), "do-md-io-"));
  try {
    const file = io.resolvePath(dir, "note.md");
    await io.writeFileAsync(file, "hello");
    assert.equal(await io.readFileAsync(file), "hello");
    assert.deepEqual(await io.statAsync(file), {
      isFile: true,
      isDirectory: false,
      size: 5,
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
