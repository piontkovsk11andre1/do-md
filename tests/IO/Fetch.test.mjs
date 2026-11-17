import test from "node:test";
import assert from "node:assert/strict";

import { Fetch } from "../../sources/IO/Fetch.mjs";
import { ERROR_CODES, DoMdError } from "../../sources/DoMdError.mjs";

test("Fetch IO module exists", () => {
  const io = new Fetch();
  assert.equal(typeof io.readFileAsync, "function");
  assert.equal(typeof io.writeFileAsync, "function");
  assert.equal(typeof io.statAsync, "function");
  assert.equal(typeof io.resolvePath, "function");
});

test("resolvePath joins relative paths and keeps absolute ones", () => {
  const io = new Fetch();
  assert.equal(io.resolvePath("/tmp", "a.txt"), "/tmp/a.txt");
  assert.equal(io.resolvePath("/tmp", "/abs/b.txt"), "/abs/b.txt");
  assert.equal(io.resolvePath("https://example.com/tpl", "a.txt"), "https://example.com/tpl/a.txt");
  assert.equal(
    io.resolvePath("https://example.com/tpl", "https://cdn.example.com/b.txt"),
    "https://cdn.example.com/b.txt",
  );
});

test("readFileAsync rejects missing files with DO_MD_IO_ERROR", async () => {
  const io = new Fetch();
  const original = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: false,
    status: 404,
    text: async () => "",
  });
  try {
    await assert.rejects(
      () => io.readFileAsync("https://example.com/missing.md"),
      (err) => err instanceof DoMdError && err.code === ERROR_CODES.DO_MD_IO_ERROR,
    );
  } finally {
    globalThis.fetch = original;
  }
});

test("readFileAsync resolves the response body on HTTP success", async () => {
  const io = new Fetch();
  const original = globalThis.fetch;
  const body = "# remote template\n";
  const calls = [];
  const fetchOptions = { headers: { Accept: "text/plain" } };
  globalThis.fetch = async (path, options) => {
    calls.push({ path, options });
    return {
      ok: true,
      status: 200,
      text: async () => body,
    };
  };
  try {
    const text = await io.readFileAsync("https://example.com/tpl.md", fetchOptions);
    assert.equal(text, body);
    assert.deepEqual(calls, [{ path: "https://example.com/tpl.md", options: fetchOptions }]);
  } finally {
    globalThis.fetch = original;
  }
});

test("writeFileAsync rejects with DO_MD_IO_ERROR", async () => {
  const io = new Fetch();
  await assert.rejects(
    () => io.writeFileAsync("https://example.com/out.md", "# no"),
    (err) => err instanceof DoMdError && err.code === ERROR_CODES.DO_MD_IO_ERROR,
  );
});

test("statAsync rejects with DO_MD_IO_ERROR", async () => {
  const io = new Fetch();
  await assert.rejects(
    () => io.statAsync("https://example.com/out.md"),
    (err) => err instanceof DoMdError && err.code === ERROR_CODES.DO_MD_IO_ERROR,
  );
});
