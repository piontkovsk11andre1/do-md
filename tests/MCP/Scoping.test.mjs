import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink, writeFile, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ERROR_CODES } from "../../sources/DoMdError.mjs";
import {
  ensureWithinRoot,
  isWithinRoot,
  resolveScopedPath,
  scopeError,
} from "../../sources/MCP/Scoping.mjs";

function assertUserError(err, file) {
  assert.equal(err.code, ERROR_CODES.DO_MD_USER_ERROR);
  for (const location of err.locations) {
    assert.equal(location.range.start.line, 1);
    assert.equal(location.range.start.column, 1);
  }
  if (file !== undefined) {
    assert.equal(err.locations[0].source, file);
  }
  return true;
}

async function withFixture(fn) {
  const dir = await mkdtemp(join(tmpdir(), "do-md-mcp-scope-"));
  const root = join(dir, "root");
  try {
    await mkdir(join(root, "nested"), { recursive: true });
    await mkdir(join(dir, "outside-dir"));
    await writeFile(join(root, "inside.md"), "ok\n");
    await writeFile(join(root, "nested", "child.md"), "ok\n");
    await writeFile(join(dir, "outside.md"), "no\n");
    await writeFile(join(dir, "outside-dir", "secret.md"), "no\n");
    const rootReal = await realpath(root);
    await fn({ dir, root: rootReal });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function trySymlink(target, path, type) {
  try {
    await symlink(target, path, type);
    return true;
  } catch (error) {
    if (error?.code === "EPERM" || error?.code === "EACCES" || error?.code === "ENOTSUP") {
      return false;
    }
    throw error;
  }
}

test("MCP scoping module exists", () => {
  assert.equal(typeof ensureWithinRoot, "function");
  assert.equal(ensureWithinRoot("/root", "/root/file.md"), true);
});

test("ensureWithinRoot rejects lexical .. and absolute escapes", () => {
  assert.equal(ensureWithinRoot("/root", "file.md"), true);
  assert.equal(ensureWithinRoot("/root", "nested/../file.md"), true);
  assert.equal(ensureWithinRoot("/root", "../secret.md"), false);
  assert.equal(ensureWithinRoot("/root", "/root/../../etc/passwd"), false);
  assert.equal(ensureWithinRoot("/root", "/etc/passwd"), false);
  assert.equal(isWithinRoot("/root", "/root-other/file.md"), false);
});

test("scopeError is a DO_MD_USER_ERROR diagnostic", () => {
  const error = scopeError("docs/a.md");
  assertUserError(error, "docs/a.md");
  assert.equal(error.locations[0].snippet, null);
});

test("resolveScopedPath accepts paths under --root", async () => {
  await withFixture(async ({ root }) => {
    const inside = await resolveScopedPath(root, "inside.md");
    assert.equal(inside, join(root, "inside.md"));
    const nested = await resolveScopedPath(root, "nested/child.md");
    assert.equal(nested, join(root, "nested", "child.md"));
    const viaDotDot = await resolveScopedPath(root, "nested/../inside.md");
    assert.equal(viaDotDot, join(root, "inside.md"));
    const absoluteInside = await resolveScopedPath(root, join(root, "inside.md"));
    assert.equal(absoluteInside, join(root, "inside.md"));
    const missing = await resolveScopedPath(root, "nested/new.md");
    assert.equal(missing, join(root, "nested", "new.md"));
    const self = await resolveScopedPath(root, ".");
    assert.equal(self, root);
  });
});

test("resolveScopedPath rejects .. traversal that escapes --root", async () => {
  await withFixture(async ({ root }) => {
    await assert.rejects(
      () => resolveScopedPath(root, "../outside.md"),
      (err) => assertUserError(err, "../outside.md"),
    );
    await assert.rejects(
      () => resolveScopedPath(root, "nested/../../outside.md"),
      (err) => assertUserError(err, "nested/../../outside.md"),
    );
  });
});

test("resolveScopedPath rejects absolute paths outside --root", async () => {
  await withFixture(async ({ dir, root }) => {
    const outside = join(dir, "outside.md");
    await assert.rejects(
      () => resolveScopedPath(root, outside),
      (err) => assertUserError(err, outside),
    );
    const secret = join(dir, "outside-dir", "secret.md");
    await assert.rejects(
      () => resolveScopedPath(root, secret),
      (err) => assertUserError(err, secret),
    );
  });
});

test("resolveScopedPath rejects a sibling directory that shares a path prefix", async () => {
  await withFixture(async ({ root }) => {
    const sibling = `${root}-other`;
    await mkdir(sibling);
    const secret = join(sibling, "file.md");
    await writeFile(secret, "no\n");
    try {
      await assert.rejects(
        () => resolveScopedPath(root, secret),
        (err) => assertUserError(err, secret),
      );
    } finally {
      await rm(sibling, { recursive: true, force: true });
    }
  });
});

test("resolveScopedPath rejects symlink escapes", async (t) => {
  await withFixture(async ({ dir, root }) => {
    const fileLink = join(root, "escape-link.md");
    const dirLink = join(root, "escape-dir");
    const madeFile = await trySymlink(join("..", "outside.md"), fileLink, "file");
    const madeDir =
      (await trySymlink(join("..", "outside-dir"), dirLink, "dir")) ||
      (await trySymlink(join(dir, "outside-dir"), dirLink, "junction"));
    if (!madeFile && !madeDir) {
      t.skip("symlinks are not permitted in this environment");
      return;
    }
    if (madeFile) {
      await assert.rejects(
        () => resolveScopedPath(root, "escape-link.md"),
        (err) => assertUserError(err, "escape-link.md"),
      );
    }
    if (madeDir) {
      await assert.rejects(
        () => resolveScopedPath(root, "escape-dir/secret.md"),
        (err) => assertUserError(err, "escape-dir/secret.md"),
      );
      await assert.rejects(
        () => resolveScopedPath(root, "escape-dir/missing.md"),
        (err) => assertUserError(err, "escape-dir/missing.md"),
      );
    }
  });
});
