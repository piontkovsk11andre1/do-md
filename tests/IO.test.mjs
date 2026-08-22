import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { IO } from "../sources/IO.mjs";
import { NodeFilesystem } from "../sources/IO/NodeFilesystem.mjs";
import { Fetch } from "../sources/IO/Fetch.mjs";
import { Virtual } from "../sources/IO/Virtual.mjs";
import { ERROR_CODES } from "../sources/SyntaxError.mjs";

test("IO interface stub exists", () => {
  const io = new IO();
  assert.equal(typeof io.readFileAsync, "function");
  assert.equal(typeof io.writeFileAsync, "function");
  assert.equal(typeof io.readFileSnapshotAsync, "function");
  assert.equal(typeof io.writeFileAtomicAsync, "function");
  assert.equal(typeof io.statAsync, "function");
  assert.equal(typeof io.resolvePath, "function");
});

test("Virtual snapshots and atomic writes implement exact revision CAS", async () => {
  const io = new Virtual({ "/doc.md": "one" });
  const first = await io.readFileSnapshotAsync("/doc.md");
  assert.equal(first.content, "one");
  assert.match(first.revision, /^sha256:[0-9a-f]{64}$/);

  const written = await io.writeFileAtomicAsync("/doc.md", "two", { expectedRevision: first.revision });
  assert.equal(written.revision, (await io.readFileSnapshotAsync("/doc.md")).revision);
  await assert.rejects(
    () => io.writeFileAtomicAsync("/doc.md", "stale", { expectedRevision: first.revision }),
    (error) => error.code === ERROR_CODES.DO_MD_CONFLICT && error.file === "/doc.md",
  );
  assert.equal(await io.readFileAsync("/doc.md"), "two");

  await io.writeFileAtomicAsync("/new.md", "new", { ifAbsent: true });
  await assert.rejects(
    () => io.writeFileAtomicAsync("/new.md", "replace", { ifAbsent: true }),
    (error) => error.code === ERROR_CODES.DO_MD_CONFLICT,
  );
  await io.writeFileAtomicAsync("/new.md", "forced", { ifAbsent: true, force: true });
  assert.equal(await io.readFileAsync("/new.md"), "forced");
});

test("NodeFilesystem snapshots and atomic writes preserve files on conflict", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "do-md-io-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, "doc.md");
  const fresh = path.join(directory, "fresh.md");
  const io = new NodeFilesystem();
  await fs.writeFile(file, "one", "utf8");

  const snapshot = await io.readFileSnapshotAsync(file);
  await io.writeFileAtomicAsync(file, "two", { expectedRevision: snapshot.revision, encoding: "utf8" });
  await assert.rejects(
    () => io.writeFileAtomicAsync(file, "stale", { expectedRevision: snapshot.revision, encoding: "utf8" }),
    (error) => error.code === ERROR_CODES.DO_MD_CONFLICT && error.file === file,
  );
  assert.equal(await fs.readFile(file, "utf8"), "two");

  const concurrent = await io.readFileSnapshotAsync(file);
  const commits = await Promise.allSettled([
    io.writeFileAtomicAsync(file, "three-a", { expectedRevision: concurrent.revision, encoding: "utf8" }),
    io.writeFileAtomicAsync(file, "three-b", { expectedRevision: concurrent.revision, encoding: "utf8" }),
  ]);
  assert.equal(commits.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(commits.filter((result) => result.status === "rejected").length, 1);
  assert.equal(commits.find((result) => result.status === "rejected").reason.code, ERROR_CODES.DO_MD_CONFLICT);

  await io.writeFileAtomicAsync(fresh, "created", { ifAbsent: true, encoding: "utf8" });
  await assert.rejects(
    () => io.writeFileAtomicAsync(fresh, "replace", { ifAbsent: true, encoding: "utf8" }),
    (error) => error.code === ERROR_CODES.DO_MD_CONFLICT,
  );
  assert.equal(await fs.readFile(fresh, "utf8"), "created");
  assert.deepEqual((await fs.readdir(directory)).sort(), ["doc.md", "fresh.md"]);
});

test("Fetch exposes snapshots and rejects atomic writes", async (t) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("remote");
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const io = new Fetch();
  const snapshot = await io.readFileSnapshotAsync("https://example.test/doc.md");
  assert.equal(snapshot.content, "remote");
  assert.match(snapshot.revision, /^sha256:[0-9a-f]{64}$/);
  await assert.rejects(
    () => io.writeFileAtomicAsync("https://example.test/doc.md", "x"),
    (error) => error.code === ERROR_CODES.DO_MD_IO_ERROR,
  );
});
