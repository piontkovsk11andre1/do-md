import test from "node:test";
import assert from "node:assert/strict";

import { createServer, parseArgv, run, bootstrap } from "../sources/McpServer.mjs";
import { Server } from "../sources/MCP/Server.mjs";

test("McpServer module exists", () => {
  const server = createServer();
  assert.equal(typeof run, "function");
  assert.equal(typeof bootstrap, "function");
  assert.equal(typeof parseArgv, "function");
  assert.equal(typeof server.start, "function");
  assert.ok(server instanceof Server);
});
