import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

import { MCP_CODES } from "../../sources/MCP/Server.mjs";
import { ERROR_CODES } from "../../sources/SyntaxError.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DO_MD = path.join(ROOT, "bin/do-md.mjs");
const DO_MD_MCP = path.join(ROOT, "bin/do-md-mcp.mjs");
const ENTRIES = [
  { name: "do-md-mcp", args: (flags) => [DO_MD_MCP, ...flags] },
  { name: "do-md mcp", args: (flags) => [DO_MD, "mcp", ...flags] },
];

async function withRoot(fn) {
  const root = await fs.mkdtemp(path.join(tmpdir(), "do-md-mcp-bin-"));
  try {
    await fs.writeFile(path.join(root, "ok.md"), "# Hello\n");
    await fs.writeFile(path.join(root, "bad.md"), "not a heading\n");
    await fs.writeFile(path.join(root, "tpl.md"), '# {% doc.line().as("title") %}\n');
    await fs.writeFile(path.join(root, "loop.tpl.md"), "{% while (true) {} %}\n");
    await fn(root);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

async function useEntry(entry, flags, fn) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: entry.args(flags),
    stderr: "pipe",
  });
  const client = new Client({ name: "do-md-binary-test", version: "1.0.0" });
  try {
    await client.connect(transport);
    return await fn(client);
  } finally {
    await client.close();
  }
}

function payload(result) {
  assert.equal(result.content[0]?.type, "text");
  return JSON.parse(result.content[0].text);
}

test("both package binaries expose the same official MCP server", async () => {
  await withRoot(async (root) => {
    const results = [];
    for (const entry of ENTRIES) {
      results.push(await useEntry(entry, ["--root", root], async (client) => {
        const tools = await client.listTools();
        const result = await client.callTool({
          name: "validate",
          arguments: { file: "ok.md", template: "tpl.md" },
        });
        return { tools: tools.tools.map((tool) => tool.name), payload: payload(result) };
      }));
    }
    assert.deepEqual(results[0], results[1]);
    assert.deepEqual(results[0].tools, ["validate", "export", "create", "set", "render", "match", "query"]);
    assert.deepEqual(results[0].payload, { ok: true, errors: [] });
  });
});

test("both binaries require a valid root", () => {
  const missing = path.join(tmpdir(), `do-md-missing-${process.pid}`);
  for (const entry of ENTRIES) {
    for (const flags of [[], ["--root", missing]]) {
      const result = spawnSync(process.execPath, entry.args(flags), { encoding: "utf8", windowsHide: true });
      assert.equal(result.status, 1, entry.name);
      assert.match(result.stderr, /--root/, entry.name);
      assert.equal(result.stdout, "", entry.name);
    }
  }
});

test("both binaries enforce root scoping and maxInputBytes", async () => {
  await withRoot(async (root) => {
    for (const entry of ENTRIES) {
      await useEntry(entry, ["--root", root], async (client) => {
        const escaped = payload(await client.callTool({
          name: "validate",
          arguments: { file: "../secret.md", template: "tpl.md" },
        }));
        assert.equal(escaped.errors[0].code, ERROR_CODES.DO_MD_USER_ERROR, entry.name);
      });
      await useEntry(entry, ["--root", root, "--max-input-bytes", "1"], async (client) => {
        const limited = payload(await client.callTool({
          name: "validate",
          arguments: { file: "ok.md", template: "tpl.md" },
        }));
        assert.equal(limited.errors[0].code, ERROR_CODES.DO_MD_USER_ERROR, entry.name);
      });
    }
  });
});

test("both binaries apply no-snippets and terminate runaway templates", async () => {
  await withRoot(async (root) => {
    for (const entry of ENTRIES) {
      await useEntry(entry, ["--root", root, "--no-snippets", "--timeout-ms", "25"], async (client) => {
        const mismatch = payload(await client.callTool({
          name: "validate",
          arguments: { file: "bad.md", template: "tpl.md" },
        }));
        assert.equal(mismatch.errors[0].snippet, null, entry.name);

        const timeout = payload(await client.callTool({
          name: "validate",
          arguments: { file: "ok.md", template: "loop.tpl.md" },
        }));
        assert.equal(timeout.errors[0].code, MCP_CODES.DO_MD_TIMEOUT, entry.name);
      });
    }
  });
});
