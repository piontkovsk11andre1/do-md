import test from "node:test";
import assert from "node:assert/strict";

import { handleExport } from "../../../sources/MCP/tools/export.mjs";
import { exportDoc } from "../../../sources/commands/exportDoc.mjs";
import { RUNTIME_FIXTURES, fixtureReady, loadFixture } from "../../conformance-helpers.mjs";
import { cloneIo, fixtureFiles, snapshot, toolContext, trackWrites } from "./helpers.mjs";

test("MCP export tool module exists", () => {
  assert.equal(typeof handleExport, "function");
});

for (const name of RUNTIME_FIXTURES) {
  const define = fixtureReady(name) ? test : test.skip;

  define(`MCP export matches exportDoc() context on ${name}`, async () => {
    const fixture = loadFixture(name);
    const files = fixtureFiles(fixture);
    const mcpIo = cloneIo(files);
    const cmdIo = cloneIo(files);
    const writes = trackWrites(mcpIo);
    const before = snapshot(mcpIo);
    const options = { maxInputBytes: 1_048_576 };
    const mcp = await handleExport(
      { file: "input.md", template: "template.tpl.md" },
      toolContext(mcpIo),
    );
    const cmd = await exportDoc({
      io: cmdIo,
      file: "input.md",
      template: "template.tpl.md",
      savePath: "expected.json",
      cwd: "/",
      options,
    });

    assert.equal(mcp.ok, cmd.ok);
    assert.equal(mcp.ok, true);
    assert.deepEqual(mcp.context, cmd.context);
    assert.deepEqual(mcp.context, fixture.expected);
    assert.deepEqual(mcp.errors, cmd.errors);
    assert.deepEqual(Object.keys(mcp).sort(), ["context", "errors", "ok"]);
    assert.equal(Object.hasOwn(mcp, "exitCode"), false);
    assert.deepEqual(writes, []);
    assert.deepEqual(snapshot(mcpIo), before);
    assert.equal(cmdIo.entries.has("/expected.json"), true);
  });
}

test("MCP export parse failure matches exportDoc() and writes nothing", async () => {
  const fixture = loadFixture("release-notes");
  const files = {
    "/template.tpl.md": fixture.template,
    "/input.md": "not a heading\n",
  };
  const mcpIo = cloneIo(files);
  const cmdIo = cloneIo(files);
  const writes = trackWrites(mcpIo);
  const mcp = await handleExport(
    { file: "input.md", template: "template.tpl.md" },
    toolContext(mcpIo),
  );
  const cmd = await exportDoc({
    io: cmdIo,
    file: "input.md",
    template: "template.tpl.md",
    savePath: "expected.json",
    cwd: "/",
    options: { maxInputBytes: 1_048_576 },
  });

  assert.equal(mcp.ok, cmd.ok);
  assert.equal(mcp.ok, false);
  assert.equal(mcp.context, null);
  assert.deepEqual(mcp.errors, cmd.errors);
  assert.deepEqual(writes, []);
  assert.equal(cmdIo.entries.has("/expected.json"), false);
});
