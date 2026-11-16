import path from "node:path";
import fs from "node:fs/promises";
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packagePath = path.join(root, "package.json");
const binPath = path.join(root, "bin/do-md.mjs");
const sourcesPath = path.join(root, "sources");

async function collectMjs(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectMjs(full)));
    } else if (entry.name.endsWith(".mjs")) {
      files.push(full);
    }
  }
  return files;
}

async function collectDeclarations(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectDeclarations(full)));
    } else if (entry.name.endsWith(".d.mts")) {
      files.push(full);
    }
  }
  return files;
}

test("package manifest is CLI-compatible", async () => {
  const packageText = await fs.readFile(packagePath, "utf8");
  const pkg = JSON.parse(packageText);

  assert.equal(pkg.name, "@p10i/do-md");
  assert.equal(pkg.version, "1.4.1");
  assert.equal(pkg.license, "MIT");
  assert.equal(pkg.type, "module");
  assert.equal(pkg.engines?.node, ">=20.0.0");
  assert.deepEqual(pkg.bin, {
    "do-md": "bin/do-md.mjs",
    "do-md-mcp": "bin/do-md-mcp.mjs",
  });
  assert.equal(pkg.main, "sources/index.mjs");
  assert.equal(pkg.types, "sources/index.d.mts");
  assert.deepEqual(pkg.files, ["bin/", "sources/", "docs/", "examples/", "skills/", "Dockerfile", "compose.example.yaml", ".dockerignore", "README.md", "LICENSE"]);
  assert.deepEqual(pkg.dependencies, {
    "@modelcontextprotocol/sdk": "1.32.2",
    yargs: "^17.0.0",
    chalk: "^5.0.0",
    "fast-glob": "^3.3.3",
    yaml: "^2.9.0",
    zod: "4.6.7",
  });

  assert.deepEqual(pkg.exports, {
    ".": {
      types: "./sources/index.d.mts",
      import: "./sources/index.mjs",
    },
    "./sources/*.mjs": {
      types: "./sources/*.d.mts",
      import: "./sources/*.mjs",
    },
    "./skills/do-md/SKILL.md": "./skills/do-md/SKILL.md",
    "./package.json": "./package.json",
  });
  assert.equal(pkg.browser, undefined);
  assert.equal(pkg.typings, undefined);
  assert.match(pkg.devDependencies?.typescript, /^\^/);
});

test("every exported runtime source has a declaration", async () => {
  const runtimeFiles = (await collectMjs(sourcesPath)).map((file) =>
    path.relative(sourcesPath, file).replace(/\.mjs$/, "").replaceAll("\\", "/"));
  const declarationFiles = (await collectDeclarations(sourcesPath)).map((file) =>
    path.relative(sourcesPath, file).replace(/\.d\.mts$/, "").replaceAll("\\", "/"));

  for (const runtime of runtimeFiles) {
    assert.ok(declarationFiles.includes(runtime), `missing declaration for sources/${runtime}.mjs`);
  }
});

test("shipped README documents the supported commands", async () => {
  const readme = await fs.readFile(path.join(root, "README.md"), "utf8");
  assert.match(readme, /do-md validate <file> <template>/);
  assert.match(readme, /do-md create\s+<file> <template>/);
  assert.match(readme, /do-md export\s+<file> <template>/);
  assert.match(readme, /do-md set\s+<file> <template>/);
  assert.match(readme, /do-md render\s+<file> <parse-template>/);
  assert.match(readme, /do-md match\s+<file> <templates>/);
  assert.match(readme, /do-md query\s+<file> <template>/);
  const postV1 = [
    "diff",
    "schema",
    "mock",
    "format",
    "lint",
    "coverage",
    "infer",
    "migrate",
    "index",
    "bundle",
    "split",
    "sync",
    "cross-reference",
    "archive",
    "graph",
    "report",
  ];
  for (const name of postV1) {
    assert.doesNotMatch(readme, new RegExp(`do-md(?:-mcp)?\\s+${name}\\b`), name);
  }
  assert.doesNotMatch(readme, /\b(SchemaDoc|MockDoc|DiffDoc|QueryDoc|LinterDoc|CoverageDoc|FormDoc|HtmlDoc|TextDoc|PhpDoc|SqlDoc|RstDoc)\b/);
});

test("package source has no accidental public entry files", async () => {
  const forbidden = [
    "sources/index.cjs",
    "sources/Pipeline.mjs",
    "sources/Compiler.mjs",
    "sources/Doc.mjs",
    "sources/SchemaDoc.mjs",
    "sources/MockDoc.mjs",
    "sources/DiffDoc.mjs",
    "sources/QueryDoc.mjs",
    "sources/LinterDoc.mjs",
    "sources/CoverageDoc.mjs",
    "sources/FormDoc.mjs",
    "sources/HtmlDoc.mjs",
    "sources/TextDoc.mjs",
    "sources/PhpDoc.mjs",
    "sources/SqlDoc.mjs",
    "sources/RstDoc.mjs",
    "sources/Configuration.mjs",
    "sources/Program.mjs",
  ];
  for (const rel of forbidden) {
    await assert.rejects(fs.access(path.join(root, rel)), rel);
  }
});

test("CLI dependencies stay behind Shell.mjs", async () => {
  const binText = await fs.readFile(binPath, "utf8");
  assert.match(binText, /from ["']\.\.\/sources\/Shell\.mjs["']/);
  assert.doesNotMatch(binText, /\byargs\b|\bchalk\b/);

  const sourceFiles = await collectMjs(sourcesPath);
  const cliImporters = [];
  const shellImporters = [];
  for (const file of sourceFiles) {
    const text = await fs.readFile(file, "utf8");
    if (/\bfrom\s+["']yargs["']|\bfrom\s+["']chalk["']/.test(text)) {
      cliImporters.push(path.relative(root, file).replaceAll("\\", "/"));
    }
    if (file !== path.join(sourcesPath, "Shell.mjs") && /from\s+["'][^"']*Shell\.mjs["']/.test(text)) {
      shellImporters.push(path.relative(root, file).replaceAll("\\", "/"));
    }
  }

  assert.deepEqual(cliImporters, ["sources/Shell.mjs"]);
  assert.deepEqual(shellImporters, []);
});

test("source modules use named exports and do not import the public barrel", async () => {
  const sourceFiles = await collectMjs(sourcesPath);
  const publicIndex = path.join(sourcesPath, "index.mjs");
  const defaultExporters = [];
  const barrelImporters = [];

  for (const file of sourceFiles) {
    const text = await fs.readFile(file, "utf8");
    if (/^export\s+default\b/m.test(text) || /export\s*\{[^}]*\bas\s+default\b/.test(text)) {
      defaultExporters.push(path.relative(root, file).replaceAll("\\", "/"));
    }
    if (file === publicIndex) {
      continue;
    }
    const fromRe = /from\s+["']([^"']+)["']/g;
    let match;
    while ((match = fromRe.exec(text))) {
      const spec = match[1];
      if (spec === "@p10i/do-md") {
        barrelImporters.push(path.relative(root, file).replaceAll("\\", "/"));
        break;
      }
      if (!spec.startsWith(".")) {
        continue;
      }
      const resolved = path.normalize(path.join(path.dirname(file), spec));
      if (resolved === publicIndex) {
        barrelImporters.push(path.relative(root, file).replaceAll("\\", "/"));
        break;
      }
    }
  }

  assert.deepEqual(defaultExporters, []);
  assert.deepEqual(barrelImporters, []);
});

test("CI runs node --test tests/ on Node 20+", async () => {
  const workflows = [];
  let dir = root;
  for (let i = 0; i < 8; i++) {
    const wfDir = path.join(dir, ".github", "workflows");
    let names = [];
    try {
      names = await fs.readdir(wfDir);
    } catch {
      names = [];
    }
    for (const name of names) {
      if (/\.ya?ml$/i.test(name)) {
        workflows.push(path.join(wfDir, name));
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }

  assert.ok(workflows.length > 0, "expected a CI workflow under .github/workflows");

  const texts = [];
  for (const file of workflows) {
    texts.push(await fs.readFile(file, "utf8"));
  }
  const combined = texts.join("\n");
  assert.match(combined, /node --test tests\//);
  assert.match(combined, /node-version[\s\S]*\b20\b/);
});

function runNpm(args) {
  if (process.platform === "win32") {
    return spawnSync("cmd.exe", ["/d", "/s", "/c", "npm.cmd", ...args], {
      cwd: root,
      encoding: "utf8",
      windowsHide: true,
    });
  }
  return spawnSync("npm", args, { cwd: root, encoding: "utf8" });
}

test("npm pack --dry-run includes runtime, reference docs, examples, README, and LICENSE", () => {
  const packed = runNpm(["pack", "--dry-run"]);
  assert.equal(packed.status, 0, packed.stderr || packed.stdout);
  const text = `${packed.stdout}\n${packed.stderr}`;
  for (const entry of [
    "bin/do-md.mjs",
    "bin/do-md-mcp.mjs",
    "sources/index.mjs",
    "sources/index.d.mts",
    "sources/types.d.mts",
    "sources/Reader.d.mts",
    "sources/Reader/Markdown.d.mts",
    "sources/MCP/Server.mjs",
    "sources/MCP/Server.d.mts",
    "sources/MCP/Scoping.mjs",
    "sources/TemplateLanguage.mjs",
    "sources/TemplateLanguage.d.mts",
    "docs/template-language.md",
    "examples/release-notes/template.md.template",
    "examples/release-notes/document.md",
    "examples/query-sections/query.md.template",
    "examples/README.md",
    "examples/release-notes/README.md",
    "examples/query-sections/README.md",
    "examples/structured-document/template.md.template",
    "examples/structured-document/expected.json",
    "examples/precise-editing/expected.updated.md",
    "examples/markdown-to-js/report.js.template",
    "examples/markdown-to-js/expected.mjs",
    "skills/do-md/SKILL.md",
    "sources/Skill.mjs",
    "README.md",
    "LICENSE",
  ]) {
    assert.match(text, new RegExp(entry.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), entry);
  }
  assert.doesNotMatch(text, /(^|\s)tests\//);
  assert.doesNotMatch(text, /\.rundown\//);
});
