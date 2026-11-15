import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createServer, request as httpRequest } from "node:http";
import { Client as McpClient } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { Server } from "../sources/HTTP/Server.mjs";
import { Client, remoteUrl } from "../sources/HTTP/Client.mjs";
import { parseArgv } from "../sources/HttpServer.mjs";
import { parseArgv as mcpArgv } from "../sources/MCP/Server.mjs";
import { startServe } from "./http-helpers.mjs";
import { TOOL_NAMES } from "../sources/Service/Definitions.mjs";
import { getEventListeners } from "node:events";

async function fixture(fn, options = {}) {
  const root = await mkdtemp(join(tmpdir(), "do-md-http-"));
  const project = join(root, "project");
  let server;
  try {
    await mkdir(project);
    await writeFile(join(project, "doc.md"), "# Hello\n");
    await writeFile(join(project, "main.tpl.md"), '# {% doc.line().as("title") %}\n');
    await writeFile(join(project, "other.tpl.md"), 'Title: {% doc.line().as("title") %}\n');
    await writeFile(join(project, "query.tpl.md"), '{% doc.query(d => { d.literal("# "); d.line().as("title") }); doc.rawRest() %}');
    await writeFile(join(root, "outside.md"), "# Outside\n");
    server = await new Server({ root, port: 0, ...options }).start();
    const url = `http://127.0.0.1:${server.port}`;
    const call = async (name, params, extra = {}) => {
      const response = await fetch(`${url}/v1/commands/${name}`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ directory: project, params, ...extra }),
      });
      return { status: response.status, result: await response.json() };
    };
    await fn({ root, project, server, url, call });
  } finally {
    await server?.close();
    await rm(root, { recursive: true, force: true });
  }
}

test("serve and remote MCP arguments are strict and preserve the local default", () => {
  assert.equal(remoteUrl({}), null);
  assert.equal(remoteUrl({ host: "service" }), "http://service:8080/");
  assert.equal(remoteUrl({ port: 9000 }), "http://127.0.0.1:9000/");
  assert.equal(remoteUrl({ url: "https://host/prefix" }), "https://host/prefix/");
  assert.equal(mcpArgv(["--root", "/remote", "--host", "service", "--port", "8081"]).port, 8081);
  for (const options of [{ url: "https://h", host: "h" }, { url: "file:///tmp" }, { url: "http://u:p@h" }, { port: 0 }, { host: "http://host" }]) {
    assert.throws(() => remoteUrl(options));
  }
  for (const args of [["--unknown"], ["--root"], ["--port", "-1"], ["--timeout-ms", "0"], ["--max-concurrency", "1.5"]]) assert.throws(() => parseArgv(args));
});

test("HTTP executes all document commands with CLI-equivalent data and side effects", async () => {
  await fixture(async ({ project, url, call }) => {
    const health = await (await fetch(`${url}/healthz`)).json();
    assert.equal(health.ok, true);
    assert.equal(health.version, "1.4.0");
    const capabilities = await (await fetch(`${url}/v1/capabilities`)).json();
    assert.equal(capabilities.commands.length, 8);
    assert.equal(capabilities.commands[0].inputSchema.additionalProperties, false);
    const params = { file: "doc.md", template: "main.tpl.md" };
    const valid = await call("validate", params);
    assert.equal(valid.status, 200);
    assert.equal(valid.result.exitCode, 0);
    assert.equal(valid.result.ok, true);
    const exported = await call("export", { ...params, savePath: "data.json" });
    assert.deepEqual(exported.result.context, { title: "Hello" });
    assert.deepEqual(JSON.parse(await readFile(join(project, "data.json"), "utf8")), { title: "Hello" });
    const created = await call("create", { template: "main.tpl.md", file: "created.md", data: { title: "Created" } });
    assert.equal(created.result.wrote, "created.md");
    assert.equal(await readFile(join(project, "created.md"), "utf8"), "# Created\n");
    assert.equal((await call("create", { template: "main.tpl.md", data: { title: "Inline" } })).result.wrote, null);
    assert.equal((await call("create", { template: "main.tpl.md", file: "created.md", data: { title: "Overwrite" } })).result.ok, false);
    const rendered = await call("render", { ...params, parseTemplate: params.template, renderTemplate: "other.tpl.md", outFile: "out.md", template: undefined });
    assert.equal(rendered.result.output, "Title: Hello\n");
    assert.equal(await readFile(join(project, "out.md"), "utf8"), "Title: Hello\n");
    const dry = await call("set", { ...params, key: "title", value: "Dry", dryRun: true });
    assert.equal(dry.result.output, "# Dry\n");
    assert.equal(await readFile(join(project, "doc.md"), "utf8"), "# Hello\n");
    const matched = await call("match", { file: "doc.md", templates: "*.tpl.md", all: true });
    assert.ok(matched.result.matches.some((path) => path.endsWith("main.tpl.md")));
    const queried = await call("query", { file: "doc.md", template: "query.tpl.md", all: true });
    assert.deepEqual(queried.result.matches[0].context, { title: "Hello" });
    const reference = await call("reference", { topic: "rawUntilElement", format: "markdown" });
    assert.match(reference.result.reference, /rawUntilElement/);
    const set = await call("set", { ...params, key: "title", value: "Saved" });
    assert.equal(set.result.wrote, "doc.md");
    assert.equal(await readFile(join(project, "doc.md"), "utf8"), "# Saved\n");
    const invalid = await call("validate", { file: "out.md", template: "main.tpl.md" });
    assert.equal(invalid.status, 200);
    assert.equal(invalid.result.exitCode, 2);
  });
});

test("selected directory scopes all paths, globs, outputs and template I/O", async () => {
  await fixture(async ({ root, project, call }) => {
    for (const file of ["../outside.md", join(root, "outside.md")]) {
      const result = await call("validate", { file, template: "main.tpl.md" });
      assert.equal(result.result.ok, false);
      assert.match(result.result.errors[0].message, /escapes/);
    }
    assert.equal((await call("create", { template: "main.tpl.md", data: { title: "No" }, file: "../escaped.md" })).result.ok, false);
    assert.equal((await call("export", { file: "doc.md", template: "main.tpl.md", savePath: "../escaped.json" })).result.ok, false);
    assert.equal((await call("match", { file: "doc.md", templates: "../*.md" })).result.ok, false);
    assert.equal((await call("validate", { file: "doc.md", template: "main.tpl.md" }, { directory: "../elsewhere" })).status, 400);
    await writeFile(join(project, "io.tpl.md"), '{% doc.literal(io.resolvePath(options.outside, "outside.md")); %}');
    const io = await call("validate", { file: "doc.md", template: "io.tpl.md", options: { outside: root } });
    assert.equal(io.result.ok, false);
    assert.match(io.result.errors[0].message, /escapes/);
    if (process.platform !== "win32") {
      await symlink(root, join(project, "escape"));
      const escaped = await call("validate", { file: "escape/outside.md", template: "main.tpl.md" });
      assert.equal(escaped.result.ok, false);
      assert.equal((await call("create", { template: "main.tpl.md", data: {}, file: "escape/new.md" })).result.ok, false);
      const glob = await call("match", { file: "doc.md", templates: "escape/*.md" });
      assert.equal(glob.result.ok, false);
    }
  });
});

test("HTTP rejects invalid transports and cannot relax server limits", async () => {
  await fixture(async ({ url, call, project }) => {
    assert.equal((await fetch(`${url}/v1/commands/nope`, { method: "POST" })).status, 404);
    assert.equal((await fetch(`${url}/v1/commands/validate`)).status, 405);
    const bad = await fetch(`${url}/v1/commands/validate`, { method: "POST", headers: { "content-type": "application/json" }, body: "{" });
    assert.equal(bad.status, 400);
    assert.equal((await call("validate", { extra: true })).status, 400);
    const large = await fetch(`${url}/v1/commands/validate`, { method: "POST", headers: { "content-type": "application/json" }, body: "x".repeat(2048) });
    assert.equal(large.status, 413);
    await writeFile(join(project, "large.md"), "# " + "x".repeat(100));
    const result = await call("validate", { file: "large.md", template: "main.tpl.md" }, { limits: { maxInputBytes: 100000 } });
    assert.equal(result.result.ok, false);
    assert.match(result.result.errors[0].message, /maxInputBytes/);
    const parse = await call("validate", { file: "doc.md", template: "other.tpl.md" }, { limits: { noSnippets: false } });
    assert.equal(parse.result.errors[0].snippet, null);
  }, { maxBodyBytes: 1024, maxInputBytes: 80, noSnippets: true });
});

test("timeouts, overload, process.exit and cancellation leave the HTTP service usable", async () => {
  await fixture(async ({ project, server, url, call }) => {
    await writeFile(join(project, "loop.tpl.md"), "{% while (true) {} %}");
    await writeFile(join(project, "exit.tpl.md"), "{% process.exit(7) %}");
    const looping = call("validate", { file: "doc.md", template: "loop.tpl.md" });
    for (let i = 0; server.calls.size === 0 && i < 200; i++) await new Promise((done) => setTimeout(done, 5));
    assert.ok(server.calls.size > 0);
    assert.equal((await call("reference", {})).status, 503);
    assert.equal((await looping).status, 504);
    assert.equal((await call("validate", { file: "doc.md", template: "exit.tpl.md" })).status, 500);
    const abort = new AbortController();
    const cancelled = fetch(`${url}/v1/commands/validate`, { method: "POST", headers: { "content-type": "application/json" }, signal: abort.signal, body: JSON.stringify({ directory: project, params: { file: "doc.md", template: "loop.tpl.md" } }) });
    for (let i = 0; server.calls.size === 0 && i < 200; i++) await new Promise((done) => setTimeout(done, 5));
    assert.ok(server.calls.size > 0);
    abort.abort();
    await assert.rejects(cancelled);
    for (let i = 0; server.calls.size && i < 200; i++) await new Promise((done) => setTimeout(done, 5));
    assert.equal(server.calls.size, 0);
    assert.equal((await call("reference", {})).status, 200);
  }, { maxConcurrency: 1, timeoutMs: 500 });
});

test("oversized HTTP output is an explicit error", async () => {
  await fixture(async ({ call }) => {
    const result = await call("reference", {});
    assert.equal(result.status, 500);
    assert.match(result.result.errors[0].message, /maxResponseBytes/);
  }, { maxResponseBytes: 1024 });
});

test("an incomplete request body has a deadline and releases its admission slot", async () => {
  await fixture(async ({ url, server }) => {
    await new Promise((done, reject) => {
      const request = httpRequest(`${url}/v1/commands/validate`, { method: "POST", headers: { "content-type": "application/json" } }, (response) => {
        let body = "";
        response.on("data", (chunk) => { body += chunk; });
        response.once("end", () => {
          try { assert.equal(response.statusCode, 408); assert.match(JSON.parse(body).errors[0].message, /timed out/); done(); }
          catch (error) { reject(error); }
          finally { request.destroy(); }
        });
      });
      request.on("error", reject);
      request.write("{");
    });
    assert.equal(server.calls.size, 0);
  }, { maxConcurrency: 1, timeoutMs: 300 });
});

test("concurrent creates retain atomic no-overwrite semantics", async () => {
  await fixture(async ({ project, call }) => {
    const results = await Promise.all(["First", "Second"].map((title) => call("create", { template: "main.tpl.md", file: "race.md", data: { title } })));
    assert.equal(results.filter(({ result }) => result.ok).length, 1);
    assert.ok(["# First\n", "# Second\n"].includes(await readFile(join(project, "race.md"), "utf8")));
  });
});

test("HTTP shutdown cancels active workers and remote cancellation cleans up listeners", async () => {
  await fixture(async ({ project, url, server }) => {
    await writeFile(join(project, "loop.tpl.md"), "{% while (true) {} %}");
    const client = new Client({ url, root: "project" });
    await client.connect();
    const controller = new AbortController();
    const pending = client.call("validate", { file: "doc.md", template: "loop.tpl.md" }, controller.signal);
    for (let i = 0; server.calls.size === 0 && i < 200; i++) await new Promise((done) => setTimeout(done, 5));
    controller.abort();
    const cancelled = await pending;
    assert.equal(cancelled.ok, false);
    assert.equal(cancelled.errors[0].code, "DO_MD_TIMEOUT");
    assert.equal(getEventListeners(controller.signal, "abort").length, 0);
    for (let i = 0; server.calls.size && i < 200; i++) await new Promise((done) => setTimeout(done, 5));
    assert.equal(server.calls.size, 0);
    const shutdownCall = client.call("validate", { file: "doc.md", template: "loop.tpl.md" });
    for (let i = 0; server.calls.size === 0 && i < 200; i++) await new Promise((done) => setTimeout(done, 5));
    assert.ok(server.calls.size);
    await server.close();
    assert.equal((await shutdownCall).ok, false);
    assert.equal(server.calls.size, 0);
  });
});

test("real MCP proxies use both binaries and server-side roots, resources and writes", async () => {
  await fixture(async ({ root, project }) => {
    const service = await startServe(root);
    const clientCwd = await mkdtemp(join(tmpdir(), "do-md-no-local-copy-"));
    try {
      await assert.rejects(access(join(clientCwd, "doc.md")));
      for (const entry of [[resolve("bin/do-md.mjs"), "mcp"], [resolve("bin/do-md-mcp.mjs")]]) {
        const transport = new StdioClientTransport({ command: process.execPath, args: [...entry, "--root", "project", "--host", "127.0.0.1", "--port", String(service.port)], cwd: clientCwd, stderr: "pipe" });
        const client = new McpClient({ name: "http-tests", version: "1" });
        try {
          await client.connect(transport);
          assert.equal((await client.listTools()).tools.length, 8);
          const valid = await client.callTool({ name: "validate", arguments: { file: "doc.md", template: "main.tpl.md" } });
          assert.deepEqual(JSON.parse(valid.content[0].text), { ok: true, errors: [] });
          for (const [name, args] of [
            ["export", { file: "doc.md", template: "main.tpl.md" }],
            ["set", { file: "doc.md", template: "main.tpl.md", key: "title", value: "Dry", dryRun: true }],
            ["render", { file: "doc.md", parseTemplate: "main.tpl.md", renderTemplate: "other.tpl.md", outFile: "remote-output.md", dryRun: true }],
            ["match", { file: "doc.md", templates: "*.tpl.md" }],
            ["query", { file: "doc.md", template: "query.tpl.md", all: true }],
            ["reference", { topic: "rawUntilElement" }],
          ]) {
            const result = await client.callTool({ name, arguments: args });
            assert.equal(result.isError, false, JSON.stringify(result));
          }
          const made = await client.callTool({ name: "create", arguments: { file: "remote.md", template: "main.tpl.md", data: { title: "Remote" }, force: true } });
          assert.equal(made.isError, false);
          assert.equal(await readFile(join(project, "remote.md"), "utf8"), "# Remote\n");
          const resource = await client.readResource({ uri: "do-md://reference/template-language" });
          assert.match(resource.contents[0].text, /rawUntilElement/);
          const json = await client.readResource({ uri: "do-md://reference/template-language.json" });
          assert.ok(JSON.parse(json.contents[0].text));
          const rejected = await client.callTool({ name: "validate", arguments: { file: "../outside.md", template: "main.tpl.md" } });
          assert.equal(rejected.isError, true);
        } finally { await client.close(); }
      }
    } finally { await service.close(); await rm(clientCwd, { recursive: true, force: true }); }
  });
});

test("remote client rejects incompatible or malformed services and never retries writes", async () => {
  let calls = 0;
  let mode = "version";
  const fake = createServer((request, response) => {
    calls++;
    response.writeHead(200, { "content-type": "application/json" });
    response.end(mode === "json" ? "{" : mode === "large" ? "x".repeat(4096) : JSON.stringify(mode === "version" ? { apiVersion: 9000, ok: true } : { apiVersion: 1, ok: true, exitCode: 0, errors: [] }));
  });
  await new Promise((done) => fake.listen(0, "127.0.0.1", done));
  try {
    const client = new Client({ root: "/no-local-directory", host: "127.0.0.1", port: fake.address().port });
    await assert.rejects(() => client.connect(), /incompatible/);
    const failed = await client.call("set", {});
    assert.equal(failed.ok, false);
    assert.match(failed.errors[0].message, /not retried/);
    assert.equal(calls, 2);
    mode = "shape";
    assert.equal((await client.call("create", {})).ok, false);
    mode = "json";
    assert.equal((await client.call("validate", {})).ok, false);
    mode = "large";
    client.maxResponseBytes = 1024;
    assert.match((await client.call("validate", {})).errors[0].message, /maxResponseBytes/);
  } finally { fake.closeAllConnections(); await new Promise((done) => fake.close(done)); }
});

test("closing the MCP proxy cancels its active remote worker", async () => {
  await fixture(async ({ project, server }) => {
    await writeFile(join(project, "loop.tpl.md"), "{% while (true) {} %}");
    const transport = new StdioClientTransport({ command: process.execPath, args: [resolve("bin/do-md-mcp.mjs"), "--root", "project", "--host", "127.0.0.1", "--port", String(server.port)], stderr: "pipe" });
    const client = new McpClient({ name: "closing-client", version: "1" });
    try {
      await client.connect(transport);
      const running = client.callTool({ name: "validate", arguments: { file: "doc.md", template: "loop.tpl.md" } }).catch(() => null);
      for (let i = 0; server.calls.size === 0 && i < 200; i++) await new Promise((done) => setTimeout(done, 5));
      assert.ok(server.calls.size > 0);
      await client.close();
      await running;
      for (let i = 0; server.calls.size && i < 200; i++) await new Promise((done) => setTimeout(done, 5));
      assert.equal(server.calls.size, 0);
    } finally { await client.close(); }
  });
});

test("remote MCP resources come from the remote version through a URL prefix", async () => {
  const seen = [];
  const fake = createServer(async (request, response) => {
    seen.push(request.url);
    response.writeHead(200, { "content-type": "application/json" });
    if (request.url.startsWith("/prefix/v1/capabilities")) {
      response.end(JSON.stringify({ ok: true, apiVersion: 1, version: "remote-version", commands: TOOL_NAMES.map((name) => ({ name })), limits: { timeoutMs: 30000 } }));
      return;
    }
    let body = "";
    for await (const chunk of request) body += chunk;
    const { params } = JSON.parse(body);
    response.end(JSON.stringify({ ok: true, apiVersion: 1, exitCode: 0, errors: [], reference: params.format === "json" ? { remote: true } : "REMOTE REFERENCE" }));
  });
  await new Promise((done) => fake.listen(0, "127.0.0.1", done));
  const transport = new StdioClientTransport({ command: process.execPath, args: [resolve("bin/do-md-mcp.mjs"), "--root", "/not-present-on-this-machine", "--url", `http://127.0.0.1:${fake.address().port}/prefix`], stderr: "pipe" });
  const client = new McpClient({ name: "prefix-client", version: "1" });
  try {
    await client.connect(transport);
    const markdown = await client.readResource({ uri: "do-md://reference/template-language" });
    assert.equal(markdown.contents[0].text, "REMOTE REFERENCE");
    const json = await client.readResource({ uri: "do-md://reference/template-language.json" });
    assert.deepEqual(JSON.parse(json.contents[0].text), { remote: true });
    assert.ok(seen.every((path) => path.startsWith("/prefix/v1/")));
  } finally { await client.close(); fake.closeAllConnections(); await new Promise((done) => fake.close(done)); }
});
