import test from "node:test";
import assert from "node:assert/strict";
import { readFile, access } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";

const root = fileURLToPath(new URL("../", import.meta.url));
const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));

test("package metadata describes the release and its integration surfaces", () => {
  assert.equal(pkg.name, "@p10i/do-md");
  assert.match(pkg.version, /^2\.0\.0-rc\.\d+$/);
  assert.equal(pkg.type, "module");
  assert.equal(pkg.license, "MIT");
  assert.equal(pkg.engines.node, ">=22.13.0");
  assert.match(pkg.repository.url, /^git\+https:\/\/github\.com\/.+\/do-md\.git$/);
  assert.match(pkg.bugs.url, /\/issues$/);
  assert.ok(pkg.keywords.includes("markdown"));
  assert.deepEqual(Object.keys(pkg.bin).sort(), ["do-md", "do-md-mcp"]);
});

test("every public entry point resolves to runtime code and declarations", async () => {
  assert.deepEqual(
    Object.keys(pkg.exports).sort(),
    [
      ".",
      "./browser",
      "./http",
      "./io",
      "./markdown",
      "./mcp",
      "./package.json",
      "./skills/do-md/SKILL.md",
    ].sort(),
  );
  for (const [subpath, target] of Object.entries(pkg.exports)) {
    if (typeof target === "string") {
      await access(join(root, target));
      continue;
    }
    await access(join(root, target.types));
    await access(join(root, target.import));
    const module = await import(`@p10i/do-md${subpath === "." ? "" : subpath.slice(1)}`);
    assert.ok(Object.keys(module).length > 0, subpath);
  }
});

test("private implementation files cannot be imported through package subpaths", async () => {
  for (const subpath of [
    "sources/Reader.mjs",
    "sources/TemplateCompiler.mjs",
    "sources/Service/Executor.mjs",
  ]) {
    await assert.rejects(import(`@p10i/do-md/${subpath}`), {
      code: "ERR_PACKAGE_PATH_NOT_EXPORTED",
    });
  }
});

test("CI runs Linux/image gates and leaves Windows/browser jobs opt-in", async () => {
  const workflow = parseYaml(
    await readFile(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8"),
  );
  assert.deepEqual(workflow.jobs.test.strategy.matrix.os, ["ubuntu-latest"]);
  assert.equal(workflow.on.workflow_dispatch.inputs.windows.default, false);
  assert.equal(workflow.on.workflow_dispatch.inputs.browsers.default, false);
  assert.match(workflow.jobs.windows.if, /workflow_dispatch.*inputs.windows/);
  assert.match(workflow.jobs.browser.if, /workflow_dispatch.*inputs.browsers/);
  assert.ok(
    workflow.jobs.image.steps.some((step) =>
      step.run?.includes("docker build --target verification"),
    ),
  );
});

test("packed artifact includes public integrations and excludes development state", () => {
  const command = process.platform === "win32" ? "cmd.exe" : "npm";
  const args =
    process.platform === "win32"
      ? ["/d", "/s", "/c", "npm.cmd", "pack", "--dry-run", "--json"]
      : ["pack", "--dry-run", "--json"];
  const result = spawnSync(command, args, { cwd: root, encoding: "utf8", windowsHide: true });
  assert.equal(result.status, 0, result.stderr);
  const [artifact] = JSON.parse(result.stdout);
  const paths = new Set(artifact.files.map((file) => file.path));
  for (const path of [
    "README.md",
    "LICENSE",
    "CHANGELOG.md",
    "sources/index.mjs",
    "sources/index.d.mts",
    "sources/SourceText.d.mts",
    "sources/HTTP/index.mjs",
    "sources/browser.mjs",
    "sources/browser.d.mts",
    "examples/browser/index.html",
    "examples/browser/app.mjs",
    "skills/do-md/SKILL.md",
    "docs/migration-2.md",
    "examples/release-notes/template.md.template",
  ]) {
    assert.ok(paths.has(path), path);
  }
  for (const path of paths) {
    assert.doesNotMatch(path, /^(?:tests|node_modules|\.types|coverage|benchmarks)\//);
  }
});
