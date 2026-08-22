import test from "node:test";
import assert from "node:assert/strict";

import { handleRender } from "../../../sources/MCP/tools/render.mjs";
import { create } from "../../../sources/commands/create.mjs";
import { render } from "../../../sources/commands/render.mjs";
import { RUNTIME_FIXTURES, fixtureReady, loadFixture } from "../../conformance-helpers.mjs";
import { cloneIo, cloneJson, fixtureFiles, snapshot, toolContext, trackWrites } from "./helpers.mjs";

test("MCP render tool module exists", () => {
  assert.equal(typeof handleRender, "function");
});

for (const name of RUNTIME_FIXTURES) {
  const define = fixtureReady(name) ? test : test.skip;

  define(`MCP render matches render() and create() on ${name}`, async () => {
    const fixture = loadFixture(name);
    const files = fixtureFiles(fixture);
    const mcpIo = cloneIo(files);
    const renderIo = cloneIo(files);
    const createIo = cloneIo(files);
    const options = { maxInputBytes: 1_048_576 };
    const mcp = await handleRender(
      {
        file: "input.md",
        parseTemplate: "template.tpl.md",
        renderTemplate: "template.tpl.md",
        outFile: "out.md",
      },
      toolContext(mcpIo),
    );
    const cmd = await render({
      io: renderIo,
      file: "input.md",
      parseTemplate: "template.tpl.md",
      renderTemplate: "template.tpl.md",
      outFile: "out.md",
      cwd: "/",
      options,
    });
    const created = await create({
      io: createIo,
      file: "created.md",
      template: "template.tpl.md",
      data: cloneJson(fixture.expected),
      cwd: "/",
      options,
    });

    assert.equal(mcp.ok, cmd.ok);
    assert.equal(mcp.ok, true);
    assert.equal(mcp.output, cmd.output);
    assert.equal(mcp.output, created.output);
    assert.equal(mcp.output, fixture.expectedOutput);
    assert.equal(mcp.wrote, "out.md");
    assert.deepEqual(mcp.errors, cmd.errors);
    assert.deepEqual(Object.keys(mcp).sort(), ["errors", "ok", "output", "wrote"]);
    assert.equal(Object.hasOwn(mcp, "exitCode"), false);
    assert.equal(await mcpIo.readFileAsync("/input.md"), files["/input.md"]);
    assert.equal(await mcpIo.readFileAsync("/out.md"), await renderIo.readFileAsync("/out.md"));
  });

  define(`MCP render dryRun returns output without writing on ${name}`, async () => {
    const fixture = loadFixture(name);
    const files = fixtureFiles(fixture);
    const mcpIo = cloneIo(files);
    const renderIo = cloneIo(files);
    const writes = trackWrites(mcpIo);
    const before = snapshot(mcpIo);
    const options = { maxInputBytes: 1_048_576 };
    const mcp = await handleRender(
      {
        file: "input.md",
        parseTemplate: "template.tpl.md",
        renderTemplate: "template.tpl.md",
        outFile: "out.md",
        dryRun: true,
      },
      toolContext(mcpIo),
    );
    const cmd = await render({
      io: renderIo,
      file: "input.md",
      parseTemplate: "template.tpl.md",
      renderTemplate: "template.tpl.md",
      outFile: "out.md",
      cwd: "/",
      options,
    });

    assert.equal(mcp.ok, cmd.ok);
    assert.equal(mcp.output, cmd.output);
    assert.equal(mcp.output, fixture.expectedOutput);
    assert.equal(mcp.wrote, null);
    assert.deepEqual(writes, []);
    assert.deepEqual(snapshot(mcpIo), before);
    assert.equal(renderIo.entries.has("/out.md"), true);
  });
}

test("MCP render dryRun returns wrote: null", async () => {
  const fixture = loadFixture("release-notes");
  const files = fixtureFiles(fixture);
  const mcpIo = cloneIo(files);
  const writes = trackWrites(mcpIo);
  const before = snapshot(mcpIo);
  const mcp = await handleRender(
    {
      file: "input.md",
      parseTemplate: "template.tpl.md",
      renderTemplate: "template.tpl.md",
      outFile: "out.md",
      dryRun: true,
    },
    toolContext(mcpIo),
  );

  assert.equal(mcp.ok, true);
  assert.equal(mcp.output, fixture.expectedOutput);
  assert.equal(mcp.wrote, null);
  assert.deepEqual(Object.keys(mcp).sort(), ["errors", "ok", "output", "wrote"]);
  assert.deepEqual(writes, []);
  assert.deepEqual(snapshot(mcpIo), before);
});

test("MCP render parse failure matches render() and writes nothing", async () => {
  const fixture = loadFixture("release-notes");
  const files = {
    "/template.tpl.md": fixture.template,
    "/input.md": "not a heading\n",
  };
  const mcpIo = cloneIo(files);
  const cmdIo = cloneIo(files);
  const writes = trackWrites(mcpIo);
  const mcp = await handleRender(
    {
      file: "input.md",
      parseTemplate: "template.tpl.md",
      renderTemplate: "template.tpl.md",
      outFile: "out.md",
    },
    toolContext(mcpIo),
  );
  const cmd = await render({
    io: cmdIo,
    file: "input.md",
    parseTemplate: "template.tpl.md",
    renderTemplate: "template.tpl.md",
    outFile: "out.md",
    cwd: "/",
    options: { maxInputBytes: 1_048_576 },
  });

  assert.equal(mcp.ok, cmd.ok);
  assert.equal(mcp.ok, false);
  assert.equal(mcp.output, null);
  assert.equal(mcp.wrote, null);
  assert.deepEqual(mcp.errors, cmd.errors);
  assert.deepEqual(writes, []);
  assert.equal(cmdIo.entries.has("/out.md"), false);
});
