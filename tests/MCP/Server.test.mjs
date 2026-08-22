import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

import {
  DEFAULT_MAX_INPUT_BYTES,
  DEFAULT_TIMEOUT_MS,
  MCP_CODES,
  parseArgv,
  resolveRoot,
  Server,
  TOOL_NAMES,
  mcpDiagnostic,
  stripDiagnosticSnippets,
  toMcpDiagnostic,
} from "../../sources/MCP/Server.mjs";
import { ERROR_CODES, makeParseError, makeUserError } from "../../sources/SyntaxError.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const MCP_BIN = path.join(ROOT, "bin/do-md-mcp.mjs");
const V1_TOOLS = ["validate", "export", "create", "set", "render", "match", "query"];

async function withRoot(fn) {
  const root = await fs.mkdtemp(path.join(tmpdir(), "do-md-sdk-"));
  try {
    await fs.writeFile(path.join(root, "ok.md"), "# Hello\n");
    await fs.writeFile(path.join(root, "bad.md"), "not a heading\n");
    await fs.writeFile(path.join(root, "tpl.md"), '# {% doc.line().as("title") %}\n');
    await fs.writeFile(path.join(root, "match.tpl.md"), '# {% doc.line().as("title") %}\n');
    await fs.writeFile(
      path.join(root, "query.tpl.md"),
      '{% doc.rawUntil("# "); doc.query((match) => { match.literal("# "); match.line().as("title") }); doc.rawRest() %}',
    );
    await fn(root);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

async function withClient(root, fn, args = []) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [MCP_BIN, "--root", root, ...args],
    stderr: "pipe",
  });
  let stderr = "";
  transport.stderr?.setEncoding("utf8");
  transport.stderr?.on("data", (chunk) => { stderr += chunk; });
  const client = new Client({ name: "do-md-test", version: "1.0.0" });
  try {
    await client.connect(transport);
    await fn(client, () => stderr);
  } finally {
    await client.close();
  }
}

function payload(result) {
  assert.equal(result.content[0]?.type, "text");
  return JSON.parse(result.content[0].text);
}

test("MCP uses the official SDK and exposes all supported tools", async () => {
  const source = await fs.readFile(path.join(ROOT, "sources/MCP/Server.mjs"), "utf8");
  assert.match(source, /@modelcontextprotocol\/sdk\/server\/mcp\.js/);
  assert.match(source, /@modelcontextprotocol\/sdk\/server\/stdio\.js/);
  assert.deepEqual(TOOL_NAMES, V1_TOOLS);
  assert.deepEqual(new Server().toolNames(), V1_TOOLS);
});

test("MCP startup options are strict and resource limits cannot be disabled accidentally", () => {
  assert.equal(DEFAULT_MAX_INPUT_BYTES, 1_048_576);
  assert.equal(DEFAULT_TIMEOUT_MS, 30_000);
  assert.deepEqual(parseArgv(["--root", "/tmp/root", "--max-input-bytes=2048", "--timeout-ms", "10", "--no-snippets"]), {
    root: "/tmp/root",
    maxInputBytes: 2048,
    timeoutMs: 10,
    noSnippets: true,
  });
  for (const args of [
    ["--timeout-ms", "-1"],
    ["--timeout-ms", "1.5"],
    ["--max-input-bytes", "nope"],
    ["--root"],
    ["--unknown"],
  ]) {
    assert.throws(() => parseArgv(args));
  }
});

test("diagnostic helpers preserve the MCP result contract", () => {
  const diagnostic = mcpDiagnostic(MCP_CODES.DO_MD_TIMEOUT, "line 1\nline 2", { file: "a.md" });
  assert.equal(diagnostic.code, MCP_CODES.DO_MD_TIMEOUT);
  assert.equal(diagnostic.message, "line 1 line 2");
  assert.equal(diagnostic.file, "a.md");
  assert.equal(stripDiagnosticSnippets([{ ...diagnostic, snippet: "secret" }])[0].snippet, null);
  assert.equal(toMcpDiagnostic(makeUserError("bad")).code, ERROR_CODES.DO_MD_USER_ERROR);
  assert.equal(toMcpDiagnostic(new Error("boom")).code, MCP_CODES.DO_MD_INTERNAL_ERROR);
});

test("direct tool adapter maps command failures and timeouts", async () => {
  const parsed = new Server({
    handlers: { validate: async () => ({ ok: false, errors: [makeParseError("bad", { file: "doc.md" })] }) },
  });
  const result = await parsed.callTool("validate", {});
  assert.equal(result.ok, false);
  assert.equal(result.errors[0].code, ERROR_CODES.DO_MD_PARSE_ERROR);

  const timeout = new Server({ timeoutMs: 5, handlers: { validate: () => new Promise(() => {}) } });
  const timedOut = await timeout.callTool("validate", {});
  assert.equal(timedOut.errors[0].code, MCP_CODES.DO_MD_TIMEOUT);
});

test("root is mandatory, existing, and canonical", async () => {
  await assert.rejects(() => resolveRoot(null), /--root is required/);
  await assert.rejects(() => resolveRoot(path.join(tmpdir(), `missing-${process.pid}`)), /does not exist/);
  await withRoot(async (root) => {
    assert.equal(await resolveRoot(root), await fs.realpath(root));
  });
});

test("official SDK client negotiates, lists, and invokes tools", async () => {
  await withRoot(async (root) => {
    await withClient(root, async (client, stderr) => {
      const listed = await client.listTools();
      assert.deepEqual(listed.tools.map((tool) => tool.name), V1_TOOLS);
      for (const tool of listed.tools) {
        assert.equal(tool.inputSchema.type, "object");
        assert.equal(tool.inputSchema.additionalProperties, false);
      }

      const valid = await client.callTool({
        name: "validate",
        arguments: { file: "ok.md", template: "tpl.md" },
      });
      assert.equal(valid.isError, false);
      assert.deepEqual(payload(valid), { ok: true, errors: [] });

      const matched = await client.callTool({
        name: "match",
        arguments: { file: "ok.md", templates: "*.tpl.md" },
      });
      assert.equal(matched.isError, false);
      const matchResult = payload(matched);
      assert.equal(matchResult.ok, true);
      assert.equal(matchResult.matches.length, 1);
      assert.match(matchResult.matches[0], /match\.tpl\.md$/);
      assert.deepEqual(matchResult.errors, []);

      const queried = await client.callTool({
        name: "query",
        arguments: { file: "ok.md", template: "query.tpl.md" },
      });
      assert.equal(queried.isError, false);
      assert.deepEqual(payload(queried), {
        ok: true,
        matches: [{ start: 0, end: 7, context: { title: "Hello" } }],
        errors: [],
      });

      const invalid = await client.callTool({
        name: "validate",
        arguments: { file: "ok.md", template: "tpl.md", extra: true },
      });
      assert.equal(invalid.isError, true);
      assert.match(invalid.content[0].text, /validation/i);
      assert.equal(stderr(), "");
    });
  });
});

test("worker isolation keeps template stdout and process.exit out of the MCP transport", async () => {
  await withRoot(async (root) => {
    await fs.writeFile(
      path.join(root, "noisy.tpl.md"),
      '{% console.log("template noise"); process.stdout.write("more noise\\n"); %}# {% doc.line().as("title") %}\n',
    );
    await fs.writeFile(path.join(root, "exit.tpl.md"), "{% process.exit(7); %}\n");
    await withClient(root, async (client, stderr) => {
      const noisy = await client.callTool({
        name: "validate",
        arguments: { file: "ok.md", template: "noisy.tpl.md" },
      });
      assert.equal(payload(noisy).ok, true);
      assert.match(stderr(), /template noise/);

      const exited = await client.callTool({
        name: "validate",
        arguments: { file: "ok.md", template: "exit.tpl.md" },
      });
      assert.equal(exited.isError, true);
      assert.equal(payload(exited).errors[0].code, MCP_CODES.DO_MD_INTERNAL_ERROR);
      assert.deepEqual((await client.listTools()).tools.map((tool) => tool.name), V1_TOOLS);
    });
  });
});

test("server timeout terminates runaway template execution and remains usable", async () => {
  await withRoot(async (root) => {
    await fs.writeFile(path.join(root, "loop.tpl.md"), "{% while (true) {} %}\n");
    await withClient(root, async (client) => {
      const timedOut = await client.callTool({
        name: "validate",
        arguments: { file: "ok.md", template: "loop.tpl.md" },
      });
      assert.equal(timedOut.isError, true);
      assert.equal(payload(timedOut).errors[0].code, MCP_CODES.DO_MD_TIMEOUT);

      const valid = await client.callTool({
        name: "validate",
        arguments: { file: "ok.md", template: "tpl.md" },
      });
      assert.equal(payload(valid).ok, true);
    }, ["--timeout-ms", "500"]);
  });
});
