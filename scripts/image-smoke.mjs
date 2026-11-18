import assert from "node:assert/strict";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createServer } from "../sources/HTTP/index.mjs";
import { readSkill } from "../sources/Skill.mjs";

// This file is copied into the verification image under scripts/. It validates
// the actual non-root runtime and packaged resources, without host bind mounts.
const base = new URL("../", import.meta.url);
const cli = new URL("bin/do-md.mjs", base);
const mcp = new URL("bin/do-md-mcp.mjs", base);
const root = await mkdtemp(join(tmpdir(), "do-md-image-"));
const execute = promisify(execFile);
let server;
let client;
let httpClient;
try {
  await access(new URL("LICENSE", base));
  await access(new URL("README.md", base));
  await writeFile(join(root, "document.md"), "# Image\n");
  await writeFile(join(root, "shape.md.template"), '# {% doc.line().as("title") %}\n');
  const { stdout: validation } = await execute(
    process.execPath,
    [fileURLToPath(cli), "validate", "document.md", "shape.md.template", "--json"],
    { cwd: root },
  );
  assert.equal(JSON.parse(validation).ok, true);
  const { stdout: skill } = await execute(process.execPath, [fileURLToPath(cli), "skill"], {
    cwd: root,
  });
  assert.equal(skill, await readSkill());
  assert.match(skill, /name: do-md/);

  client = new Client({ name: "image-smoke", version: "1.0.0" });
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [fileURLToPath(mcp), "--root", root],
      stderr: "pipe",
    }),
  );
  const resource = await client.readResource({ uri: "do-md://skills/do-md" });
  assert.equal(resource.contents[0].text, skill);
  const result = await client.callTool({
    name: "validate",
    arguments: { file: "document.md", template: "shape.md.template" },
  });
  assert.equal(JSON.parse(result.content[0].text).ok, true);

  server = await createServer({ root, host: "127.0.0.1", port: 0, mcp: true }).start();
  const health = await fetch(`http://127.0.0.1:${server.port}/healthz`);
  assert.equal(health.status, 200);
  assert.equal((await health.json()).ok, true);
  httpClient = new Client({ name: "image-http-smoke", version: "1" });
  await httpClient.connect(
    new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${server.port}/mcp`)),
  );
  assert.equal((await httpClient.listTools()).tools.length, 9);
  assert.equal(
    (await httpClient.readResource({ uri: "do-md://skills/do-md" })).contents[0].text,
    skill,
  );
  assert.equal(
    JSON.parse(
      (
        await httpClient.callTool({
          name: "validate",
          arguments: { file: "document.md", template: "shape.md.template" },
        })
      ).content[0].text,
    ).ok,
    true,
  );
  process.stdout.write(
    "Runtime smoke passed: CLI, Skill, stdio/Streamable HTTP MCP resource/tool and HTTP health.\n",
  );
} finally {
  await httpClient?.close();
  await client?.close();
  await server?.close();
  await rm(root, { recursive: true, force: true });
}
