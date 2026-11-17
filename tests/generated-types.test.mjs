import test from "node:test";
import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

test("declaration generation bootstraps stale types and check mode never repairs them", async () => {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const temporary = await mkdtemp(join(tmpdir(), "do-md-types-"));
  try {
    await cp(join(root, "sources"), join(temporary, "sources"), { recursive: true });
    await mkdir(join(temporary, "scripts"));
    await cp(
      join(root, "scripts/generate-types.mjs"),
      join(temporary, "scripts/generate-types.mjs"),
    );
    await cp(join(root, "tsconfig.core.json"), join(temporary, "tsconfig.core.json"));
    await cp(join(root, ".prettierrc.json"), join(temporary, ".prettierrc.json"));
    await symlink(
      join(root, "node_modules"),
      join(temporary, "node_modules"),
      process.platform === "win32" ? "junction" : "dir",
    );
    const declaration = join(temporary, "sources/SourceText.d.mts");
    await writeFile(declaration, "export {};\n");
    const run = (args) =>
      spawnSync(process.execPath, [join(temporary, "scripts/generate-types.mjs"), ...args], {
        encoding: "utf8",
        cwd: temporary,
      });
    const check = run(["--check"]);
    assert.equal(check.status, 1);
    assert.match(check.stderr, /Stale declaration/);
    assert.equal(await readFile(declaration, "utf8"), "export {};\n");
    const generated = run([]);
    assert.equal(generated.status, 0, generated.stderr + generated.stdout);
    assert.equal(
      await readFile(declaration, "utf8"),
      await readFile(join(root, "sources/SourceText.d.mts"), "utf8"),
    );
    const current = run(["--check"]);
    assert.equal(current.status, 0, current.stderr + current.stdout);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});
