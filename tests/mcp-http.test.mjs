import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { request } from "node:http";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Server } from "../sources/HTTP/Server.mjs";
import { parseArgv } from "../sources/HttpServer.mjs";
import { TOOL_NAMES } from "../sources/Service/Definitions.mjs";
import { startServe } from "./http-helpers.mjs";
import { stableDiagnostics } from "./diagnostics.helpers.mjs";

async function fixture(t, options = {}) {
  const root = await mkdtemp(join(tmpdir(), "do-md-mcp-http-"));
  await writeFile(join(root, "doc.md"), "# Hello\n");
  await writeFile(join(root, "main.md.template"), '# {% doc.line().as("title") %}\n');
  await writeFile(join(root, "report.md.template"), 'Title: {% doc.line().as("title") %}\n');
  await writeFile(
    join(root, "query.md.template"),
    '{% doc.query(d=>{d.literal("# ");d.line().as("title")});doc.rawRest();%}',
  );
  await writeFile(join(root, "loop.md.template"), "{% while(true){} %}");
  const server = await new Server({ root, port: 0, mcp: true, ...options }).start();
  const clients = [];
  t.after(async () => {
    await Promise.allSettled(clients.map((client) => client.close()));
    await server.close();
    await rm(root, { recursive: true, force: true });
  });
  const url = `http://127.0.0.1:${server.port}`;
  async function connect() {
    const client = new Client({ name: "do-md-http-test", version: "1" });
    const transport = new StreamableHTTPClientTransport(new URL(url + "/mcp"));
    clients.push(client);
    await client.connect(transport);
    return { client, transport };
  }
  return { root, server, url, connect };
}
function payload(result) {
  assert.equal(result.content[0].type, "text");
  return JSON.parse(result.content[0].text);
}
async function waitFor(predicate) {
  const start = Date.now();
  while (!predicate()) {
    assert.ok(Date.now() - start < 3000, "condition did not settle");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

test("native MCP is opt-in and serve flags remain strict", async (t) => {
  assert.equal(parseArgv(["--mcp"]).mcp, true);
  assert.deepEqual(
    parseArgv(["--mcp", "--mcp-origin", "https://one.example", "--mcp-origin=https://two.example"])
      .mcpAllowedOrigins,
    ["https://one.example", "https://two.example"],
  );
  for (const argv of [["--mcp=true"], ["--mcp-origin"], ["--mcp-origin", "--mcp"]]) {
    assert.throws(() => parseArgv(argv));
  }
  const { url } = await fixture(t, { mcp: false });
  assert.equal((await fetch(url + "/mcp")).status, 404);
});

test("standard Streamable HTTP negotiates all tools and all resources", async (t) => {
  const { connect, server } = await fixture(t);
  const { client } = await connect();
  assert.deepEqual(
    (await client.listTools()).tools.map((tool) => tool.name),
    TOOL_NAMES,
  );
  const resources = (await client.listResources()).resources;
  assert.deepEqual(
    resources.map((resource) => resource.uri),
    [
      "do-md://reference/template-language",
      "do-md://reference/template-language.json",
      "do-md://skills/do-md",
    ],
  );
  const reference = payload(
    await client.callTool({ name: "reference", arguments: { format: "markdown" } }),
  );
  assert.equal(
    (await client.readResource({ uri: resources[0].uri })).contents[0].text,
    reference.reference,
  );
  assert.deepEqual(
    JSON.parse((await client.readResource({ uri: resources[1].uri })).contents[0].text),
    payload(await client.callTool({ name: "reference", arguments: { format: "json" } })).reference,
  );
  assert.equal(
    (await client.readResource({ uri: resources[2].uri })).contents[0].text,
    payload(await client.callTool({ name: "skill", arguments: {} })).skill,
  );
  assert.equal(server.calls.size, 0);
});

test("all document tools preserve results and side effects through the native endpoint", async (t) => {
  const { connect, root } = await fixture(t);
  const { client } = await connect();
  const call = async (name, args) => payload(await client.callTool({ name, arguments: args }));
  const args = { file: "doc.md", template: "main.md.template" };
  assert.equal((await call("validate", args)).ok, true);
  assert.deepEqual((await call("export", args)).context, { title: "Hello" });
  assert.deepEqual((await call("export", { ...args, savePath: "data.json" })).context, {
    title: "Hello",
  });
  assert.deepEqual(JSON.parse(await readFile(join(root, "data.json"), "utf8")), { title: "Hello" });
  assert.equal(
    (
      await call("create", {
        file: "created.md",
        template: args.template,
        data: { title: "Created" },
      })
    ).ok,
    true,
  );
  assert.equal(await readFile(join(root, "created.md"), "utf8"), "# Created\n");
  assert.equal((await call("set", { ...args, key: "title", value: "Updated" })).ok, true);
  assert.equal(await readFile(join(root, "doc.md"), "utf8"), "# Updated\n");
  assert.equal(
    (
      await call("render", {
        file: "doc.md",
        parseTemplate: args.template,
        renderTemplate: "report.md.template",
        outFile: "rendered.md",
      })
    ).output,
    "Title: Updated\n",
  );
  assert.ok(
    (await call("match", { file: "doc.md", templates: "m*.md.template", all: true })).matches.some(
      (path) => path.endsWith("main.md.template"),
    ),
  );
  assert.equal(
    (await call("query", { file: "doc.md", template: "query.md.template", all: true })).matches[0]
      .context.title,
    "Updated",
  );
});

test("root scoping, input caps, snippet stripping and execution timeouts apply to native MCP", async (t) => {
  const { connect } = await fixture(t, { timeoutMs: 1500, noSnippets: true });
  const { client } = await connect();
  const escaped = payload(
    await client.callTool({
      name: "validate",
      arguments: { file: "../outside.md", template: "main.md.template" },
    }),
  );
  assert.equal(escaped.ok, false);
  assert.match(escaped.errors[0].message, /escapes/);
  const broken = payload(
    await client.callTool({
      name: "validate",
      arguments: { file: "doc.md", template: "report.md.template" },
    }),
  );
  assert.equal(broken.ok, false);
  assert.ok(broken.errors[0].locations.every((location) => location.snippet === null));
  const timeout = payload(
    await client.callTool({
      name: "validate",
      arguments: { file: "doc.md", template: "loop.md.template" },
    }),
  );
  assert.equal(timeout.errors[0].code, "DO_MD_TIMEOUT");
  const limited = await fixture(t, { maxInputBytes: 4 });
  const second = await limited.connect();
  const result = payload(
    await second.client.callTool({
      name: "validate",
      arguments: {
        file: "doc.md",
        template: "main.md.template",
        options: { maxInputBytes: 100000 },
      },
    }),
  );
  assert.equal(result.ok, false);
  assert.match(result.errors[0].message, /maxInputBytes|exceeds/);
});

test("MCP shares REST execution capacity while cancellation remains available", async (t) => {
  const { connect, url, server } = await fixture(t, { maxConcurrency: 1, timeoutMs: 5000 });
  const { client } = await connect();
  const observer = await connect();
  const abort = new AbortController();
  const running = client.callTool(
    { name: "validate", arguments: { file: "doc.md", template: "loop.md.template" } },
    undefined,
    { signal: abort.signal },
  );
  const cancelled = assert.rejects(running);
  await waitFor(() => server.calls.size === 1);
  const rest = await fetch(url + "/v1/commands/validate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ params: { file: "doc.md", template: "main.md.template" } }),
  });
  assert.equal(rest.status, 503);
  const busy = payload(
    await observer.client.callTool({
      name: "validate",
      arguments: { file: "doc.md", template: "main.md.template" },
    }),
  );
  assert.equal(busy.ok, false);
  assert.match(busy.errors[0].message, /busy/);
  abort.abort();
  await cancelled;
  await waitFor(() => server.calls.size === 0);
  assert.equal(
    payload(
      await observer.client.callTool({
        name: "validate",
        arguments: { file: "doc.md", template: "main.md.template" },
      }),
    ).ok,
    true,
  );
});

test("cancellation is scoped to the correct MCP session and shutdown drains workers", async (t) => {
  const { connect, server } = await fixture(t, { maxConcurrency: 2, timeoutMs: 5000 });
  const first = await connect(),
    second = await connect();
  const a = new AbortController(),
    b = new AbortController();
  const args = { name: "validate", arguments: { file: "doc.md", template: "loop.md.template" } };
  const callA = first.client.callTool(args, undefined, { signal: a.signal });
  const rejectedA = assert.rejects(callA);
  const callB = second.client.callTool(args, undefined, { signal: b.signal });
  let settledB = false;
  const observedB = callB.then(
    (value) => {
      settledB = true;
      return value;
    },
    (error) => {
      settledB = true;
      throw error;
    },
  );
  observedB.catch(() => {});
  await waitFor(() => server.calls.size === 2);
  a.abort();
  await rejectedA;
  await waitFor(() => server.calls.size === 1);
  assert.equal(settledB, false);
  const stopped = observedB.catch(() => null);
  await server.close();
  await stopped;
  assert.equal(server.calls.size, 0);
  assert.equal(server.mcpEndpoint.records.size, 0);
  assert.equal(server.mcpEndpoint.sessions.size, 0);
});

test("MCP enforces request and response byte caps without leaking oversized payloads", async (t) => {
  const { connect } = await fixture(t, { maxBodyBytes: 1024, maxResponseBytes: 1024 });
  const { client } = await connect();
  await assert.rejects(
    client.callTool({
      name: "create",
      arguments: { template: "main.md.template", data: { title: "x".repeat(3000) } },
    }),
    /maxBodyBytes|413/,
  );
  await assert.rejects(
    client.readResource({ uri: "do-md://reference/template-language" }),
    /maxResponseBytes/,
  );
});

test("MCP Origin checks, protocol methods and session termination are bounded", async (t) => {
  const { url, connect, server } = await fixture(t, {
    mcpAllowedOrigins: ["https://allowed.example"],
  });
  assert.equal(
    (
      await fetch(url + "/mcp", {
        method: "POST",
        headers: { Origin: "https://wrong.example", "content-type": "application/json" },
        body: "{}",
      })
    ).status,
    403,
  );
  const invalid = await fetch(url + "/mcp", {
    method: "POST",
    headers: { Origin: "https://allowed.example", "content-type": "application/json" },
    body: "not JSON",
  });
  assert.equal(invalid.status, 400);
  assert.equal((await invalid.json()).error.code, -32700);
  const uninitialized = await fetch(url + "/mcp", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 7, method: "tools/list" }),
  });
  assert.equal(uninitialized.status, 400);
  assert.equal((await uninitialized.json()).error.code, -32600);
  assert.equal((await fetch(url + "/mcp")).status, 405);
  assert.equal(
    (await fetch(url + "/mcp", { method: "DELETE", headers: { "mcp-session-id": "unknown" } }))
      .status,
    404,
  );
  const { client, transport } = await connect();
  assert.equal(server.mcpEndpoint.sessions.size, 1);
  await transport.terminateSession();
  await client.close();
  await waitFor(() => server.mcpEndpoint.records.size === 0);
  assert.equal(server.mcpEndpoint.sessions.size, 0);
});

test("the serve CLI publishes a connectable MCP endpoint", async () => {
  const root = await mkdtemp(join(tmpdir(), "do-md-mcp-cli-"));
  let child, client;
  try {
    child = await startServe(root, undefined, ["--mcp"]);
    client = new Client({ name: "cli-test", version: "1" });
    await client.connect(new StreamableHTTPClientTransport(new URL(child.url + "/mcp")));
    assert.equal((await client.listTools()).tools.length, 9);
  } finally {
    await client?.close();
    await child?.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("native MCP preserves the same diagnostic chains as REST", async (t) => {
  const { root, url, connect } = await fixture(t);
  const { client } = await connect();
  for (const template of [
    "{% const = 1; %}",
    '{% doc.heading(1).validate(()=>{throw new Error("invalid heading");}).as("title"); %}',
  ]) {
    await writeFile(join(root, "broken.md.template"), template);
    const params = { file: "doc.md", template: "broken.md.template" };
    const rest = await (
      await fetch(url + "/v1/commands/validate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ params }),
      })
    ).json();
    const native = payload(await client.callTool({ name: "validate", arguments: params }));
    assert.equal(native.ok, false);
    assert.deepEqual(stableDiagnostics(native.errors), stableDiagnostics(rest.errors));
  }
});

test("incomplete MCP bodies have a deadline and bounded reader admission", async (t) => {
  const { url, server, connect } = await fixture(t, { timeoutMs: 500, maxConcurrency: 1 });
  const requests = [];
  function incomplete() {
    let req;
    const result = new Promise((resolve, reject) => {
      req = request(
        url + "/mcp",
        {
          method: "POST",
          headers: { "content-type": "application/json", "content-length": "128" },
        },
        (response) => {
          response.resume();
          response.once("end", () => resolve(response.statusCode));
        },
      );
      req.once("error", reject);
      req.write("{");
    });
    requests.push(req);
    return result;
  }
  try {
    const first = incomplete(),
      second = incomplete();
    await waitFor(() => server.mcpEndpoint.readers.size === 2);
    const response = await fetch(url + "/mcp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    assert.equal(response.status, 503);
    assert.deepEqual(await Promise.all([first, second]), [408, 408]);
    await waitFor(() => server.mcpEndpoint.readers.size === 0);
    const { client } = await connect();
    assert.equal((await client.listTools()).tools.length, 9);
  } finally {
    for (const req of requests) {
      req.destroy();
    }
  }
});
