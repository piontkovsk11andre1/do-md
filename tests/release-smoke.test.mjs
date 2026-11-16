import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { startServe } from "./http-helpers.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WIN = process.platform === "win32";
const INSTALL_TIMEOUT_MS = 180_000;
const COMMAND_TIMEOUT_MS = 30_000;

const cleanupDirs = [];
let installPromise;

function spawnTool(command, args, options = {}) {
  if (WIN) {
    return spawnSync("cmd.exe", ["/d", "/s", "/c", command, ...args], {
      encoding: "utf8",
      windowsHide: true,
      ...options,
    });
  }
  return spawnSync(command, args, {
    encoding: "utf8",
    windowsHide: true,
    ...options,
  });
}

function runNpm(args, options = {}) {
  return spawnTool(WIN ? "npm.cmd" : "npm", args, {
    env: {
      ...process.env,
      npm_config_update_notifier: "false",
      npm_config_fund: "false",
      npm_config_audit: "false",
    },
    ...options,
  });
}

async function pathExists(file) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

async function firstExisting(candidates) {
  for (const candidate of candidates) {
    if (await pathExists(candidate)) {
      return candidate;
    }
  }
  return null;
}

function shimPath(binDir, name) {
  return path.join(binDir, WIN ? `${name}.cmd` : name);
}

function runInstalled(bin, args, options = {}) {
  return spawnTool(bin, args, {
    timeout: COMMAND_TIMEOUT_MS,
    ...options,
  });
}

async function withTempDir(prefix, fn) {
  const dir = await fs.mkdtemp(path.join(tmpdir(), prefix));
  try {
    return await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

async function installIsolated() {
  const packDir = await fs.mkdtemp(path.join(tmpdir(), "do-md-pack-"));
  const prefix = await fs.mkdtemp(path.join(tmpdir(), "do-md-global-"));
  cleanupDirs.push(packDir, prefix);

  const packed = runNpm(["pack", "--pack-destination", packDir], { cwd: ROOT });
  assert.equal(packed.status, 0, packed.stderr || packed.stdout);
  const tarballName = (await fs.readdir(packDir)).find((name) => name.endsWith(".tgz"));
  assert.ok(tarballName, "npm pack did not write a tarball");
  const tarball = path.join(packDir, tarballName);

  const installed = runNpm(
    ["install", "-g", "--prefix", prefix, "--ignore-scripts", "--prefer-offline", tarball],
    { timeout: INSTALL_TIMEOUT_MS },
  );
  assert.equal(installed.status, 0, installed.stderr || installed.stdout);

  const binDir = WIN ? prefix : path.join(prefix, "bin");
  const installedPkg = await firstExisting([
    path.join(prefix, "node_modules", "@p10i", "do-md"),
    path.join(prefix, "lib", "node_modules", "@p10i", "do-md"),
  ]);
  assert.ok(installedPkg, `installed @p10i/do-md not found under ${prefix}`);
  assert.notEqual(path.resolve(installedPkg), ROOT);

  const doMd = shimPath(binDir, "do-md");
  const doMdMcp = shimPath(binDir, "do-md-mcp");
  assert.equal(await pathExists(doMd), true, doMd);
  assert.equal(await pathExists(doMdMcp), true, doMdMcp);

  return {
    prefix,
    binDir,
    installedPkg,
    doMd,
    doMdMcp,
    doMdJs: path.join(installedPkg, "bin/do-md.mjs"),
    doMdMcpJs: path.join(installedPkg, "bin/do-md-mcp.mjs"),
  };
}

function getInstall() {
  if (!installPromise) {
    installPromise = installIsolated();
  }
  return installPromise;
}

test.after(async () => {
  await Promise.all(cleanupDirs.map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

test("npm pack + isolated global install exposes do-md and do-md-mcp", { timeout: INSTALL_TIMEOUT_MS }, async () => {
  const install = await getInstall();
  for (const relative of [
    "bin/do-md.mjs",
    "bin/do-md-mcp.mjs",
    "sources/index.mjs",
    "sources/MCP/Server.mjs",
    "sources/HttpServer.mjs",
    "Dockerfile",
    "compose.example.yaml",
    "README.md",
    "LICENSE",
  ]) {
    assert.equal(await pathExists(path.join(install.installedPkg, relative)), true, relative);
  }
});

test("installed serve executes HTTP commands and both installed MCP proxies dispatch remotely", { timeout: INSTALL_TIMEOUT_MS }, async () => {
  const install = await getInstall();
  await withTempDir("do-md-smoke-http-", async (root) => {
    await fs.writeFile(path.join(root, "doc.md"), "# Hello\n");
    await fs.writeFile(path.join(root, "tpl.md"), '# {% doc.line().as("title") %}\n');
    const service = await startServe(root, install.doMdJs);
    try {
      const response = await fetch(`${service.url}/v1/commands/export`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ params: { file: "doc.md", template: "tpl.md" } }),
      });
      assert.deepEqual((await response.json()).context, { title: "Hello" });
      for (const entry of [[install.doMdJs, "mcp"], [install.doMdMcpJs]]) {
        const transport = new StdioClientTransport({ command: process.execPath, args: [...entry, "--root", ".", "--url", service.url], stderr: "pipe" });
        const client = new Client({ name: "installed-remote", version: "1" });
        try {
          await client.connect(transport);
          const result = await client.callTool({ name: "validate", arguments: { file: "doc.md", template: "tpl.md" } });
          assert.equal(result.isError, false);
          assert.equal(client.getServerVersion().version, "1.4.1");
        } finally { await client.close(); }
      }
    } finally { await service.close(); }
  });
});

test(
  "installed do-md runs validate, export, create, set, render, match, and query from a clean temp project",
  { timeout: INSTALL_TIMEOUT_MS },
  async () => {
    const install = await getInstall();
    await withTempDir("do-md-smoke-cli-", async (dir) => {
      await fs.writeFile(
        path.join(dir, "release.md.template"),
        `# {% doc.line().as("version") %}

Released on {% doc.until(".").as("date") %}.

## Changes

{% doc.list().as("changes") %}
`,
      );
      await fs.writeFile(
        path.join(dir, "release.md"),
        `# 1.0.0

Released on 2026-05-02.

## Changes

- Added Doc interface
- Removed dual-compile
`,
      );
      await fs.writeFile(path.join(dir, "other.md.template"), 'Version: {% doc.line().as("version") %}\n');
      await fs.writeFile(
        path.join(dir, "z-query.md.template"),
        '{% doc.rawUntil("## Changes"); doc.query((match) => { match.literal("## Changes\\n\\n"); match.list().as("changes") }); doc.rawRest() %}',
      );

      const validated = runInstalled(install.doMd, ["validate", "release.md", "release.md.template"], { cwd: dir });
      assert.equal(validated.status, 0, validated.stderr);
      assert.equal(validated.stderr, "");

      const matched = runInstalled(install.doMd, ["match", "release.md", "*.md.template"], { cwd: dir });
      assert.equal(matched.status, 0, matched.stderr);
      assert.match(matched.stdout.replaceAll("\\", "/"), /\/release\.md\.template\s*$/);

      const queried = runInstalled(install.doMd, ["query", "release.md", "z-query.md.template"], { cwd: dir });
      assert.equal(queried.status, 0, queried.stderr);
      assert.deepEqual(JSON.parse(queried.stdout).context, {
        changes: ["Added Doc interface", "Removed dual-compile"],
      });

      const exported = runInstalled(
        install.doMd,
        ["export", "release.md", "release.md.template", "--save", "release.json"],
        { cwd: dir },
      );
      assert.equal(exported.status, 0, exported.stderr);
      assert.deepEqual(JSON.parse(await fs.readFile(path.join(dir, "release.json"), "utf8")), {
        version: "1.0.0",
        date: "2026-05-02",
        changes: ["Added Doc interface", "Removed dual-compile"],
      });

      const created = runInstalled(
        install.doMd,
        ["create", "release-2.md", "release.md.template", "--data", "release.json"],
        { cwd: dir },
      );
      assert.equal(created.status, 0, created.stderr);
      assert.match(await fs.readFile(path.join(dir, "release-2.md"), "utf8"), /1\.0\.0/);
      assert.match(await fs.readFile(path.join(dir, "release-2.md"), "utf8"), /2026-05-02/);

      const original = await fs.readFile(path.join(dir, "release.md"), "utf8");
      const rendered = runInstalled(
        install.doMd,
        ["render", "release.md", "release.md.template", "other.md.template", "out.txt"],
        { cwd: dir },
      );
      assert.equal(rendered.status, 0, rendered.stderr);
      assert.equal(await fs.readFile(path.join(dir, "release.md"), "utf8"), original);
      assert.match(await fs.readFile(path.join(dir, "out.txt"), "utf8"), /Version: 1\.0\.0/);

      const mutated = runInstalled(
        install.doMd,
        ["set", "release.md", "release.md.template", "--key", "version", "--value", "2.0.0"],
        { cwd: dir },
      );
      assert.equal(mutated.status, 0, mutated.stderr);
      const updated = await fs.readFile(path.join(dir, "release.md"), "utf8");
      assert.match(updated, /^# 2\.0\.0/m);
      assert.match(updated, /Released on 2026-05-02\./);
      assert.match(updated, /Added Doc interface/);
    });
  },
);

test(
  "installed do-md mcp and do-md-mcp start and handle one validate request",
  { timeout: INSTALL_TIMEOUT_MS },
  async () => {
    const install = await getInstall();
    await withTempDir("do-md-smoke-mcp-", async (root) => {
      await fs.writeFile(path.join(root, "ok.md"), "# Hello\n");
      await fs.writeFile(path.join(root, "tpl.md"), '# {% doc.line().as("title") %}\n');

      const entries = [
        { name: "do-md mcp", argv: [install.doMdJs, "mcp", "--root", root] },
        { name: "do-md-mcp", argv: [install.doMdMcpJs, "--root", root] },
      ];
      const payloads = [];
      for (const entry of entries) {
        const transport = new StdioClientTransport({
          command: process.execPath,
          args: entry.argv,
          stderr: "pipe",
        });
        const client = new Client({ name: "do-md-release-smoke", version: "1.0.0" });
        try {
          await client.connect(transport);
          const result = await client.callTool({
            name: "validate",
            arguments: { file: "ok.md", template: "tpl.md" },
          });
          const text = result.content?.[0]?.text;
          assert.equal(typeof text, "string", entry.name);
          const payload = JSON.parse(text);
          assert.equal(payload.ok, true, entry.name);
          assert.deepEqual(payload.errors, [], entry.name);
          payloads.push(payload);
        } finally {
          await client.close();
        }
      }
      assert.deepEqual(payloads[1], payloads[0]);
    });
  },
);
