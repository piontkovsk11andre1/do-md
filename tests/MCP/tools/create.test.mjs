import test from "node:test";
import assert from "node:assert/strict";

import { handleCreate } from "../../../sources/MCP/tools/create.mjs";
import { create } from "../../../sources/commands/create.mjs";
import { RUNTIME_FIXTURES, fixtureReady, loadFixture } from "../../conformance-helpers.mjs";
import { cloneIo, cloneJson, fixtureFiles, snapshot, toolContext, trackWrites } from "./helpers.mjs";

test("MCP create tool module exists", () => {
  assert.equal(typeof handleCreate, "function");
});

for (const name of RUNTIME_FIXTURES) {
  const define = fixtureReady(name) ? test : test.skip;

  define(`MCP create output matches create() and expected.output.md on ${name}`, async () => {
    const fixture = loadFixture(name);
    const files = fixtureFiles(fixture);
    const mcpIo = cloneIo(files);
    const cmdIo = cloneIo(files);
    const writes = trackWrites(mcpIo);
    const before = snapshot(mcpIo);
    const options = { maxInputBytes: 1_048_576 };
    const data = cloneJson(fixture.expected);
    const mcp = await handleCreate(
      { template: "template.tpl.md", data },
      toolContext(mcpIo),
    );
    const cmd = await create({
      io: cmdIo,
      file: "created.md",
      template: "template.tpl.md",
      data: cloneJson(fixture.expected),
      cwd: "/",
      options,
    });

    assert.equal(mcp.ok, cmd.ok);
    assert.equal(mcp.ok, true);
    assert.equal(mcp.output, cmd.output);
    assert.equal(mcp.output, fixture.expectedOutput);
    assert.equal(mcp.wrote, null);
    assert.deepEqual(mcp.errors, cmd.errors);
    assert.deepEqual(Object.keys(mcp).sort(), ["errors", "ok", "output", "wrote"]);
    assert.equal(Object.hasOwn(mcp, "exitCode"), false);
    assert.deepEqual(writes, []);
    assert.deepEqual(snapshot(mcpIo), before);
    assert.equal(cmdIo.entries.has("/created.md"), true);
  });

  define(`MCP create writes the same dest as create() on ${name}`, async () => {
    const fixture = loadFixture(name);
    const files = fixtureFiles(fixture);
    const mcpIo = cloneIo(files);
    const cmdIo = cloneIo(files);
    const options = { maxInputBytes: 1_048_576 };
    const mcp = await handleCreate(
      { template: "template.tpl.md", data: cloneJson(fixture.expected), file: "created.md" },
      toolContext(mcpIo),
    );
    const cmd = await create({
      io: cmdIo,
      file: "created.md",
      template: "template.tpl.md",
      data: cloneJson(fixture.expected),
      cwd: "/",
      options,
    });

    assert.equal(mcp.ok, cmd.ok);
    assert.equal(mcp.output, cmd.output);
    assert.equal(mcp.output, fixture.expectedOutput);
    assert.equal(mcp.wrote, "created.md");
    assert.equal(await mcpIo.readFileAsync("/created.md"), await cmdIo.readFileAsync("/created.md"));
  });
}

test("MCP create.force defaults to false", async () => {
  const fixture = loadFixture("release-notes");
  const files = {
    ...fixtureFiles(fixture),
    "/created.md": "# keep me\n",
  };
  const omittedIo = cloneIo(files);
  const explicitIo = cloneIo(files);
  const cmdIo = cloneIo(files);
  const args = { template: "template.tpl.md", data: cloneJson(fixture.expected), file: "created.md" };
  const omitted = await handleCreate(args, toolContext(omittedIo));
  const explicit = await handleCreate({ ...args, force: false }, toolContext(explicitIo));
  const cmd = await create({
    io: cmdIo,
    file: "/created.md",
    template: "/template.tpl.md",
    data: cloneJson(fixture.expected),
    cwd: "/",
    options: { maxInputBytes: 1_048_576 },
  });

  assert.equal(omitted.ok, cmd.ok);
  assert.equal(explicit.ok, cmd.ok);
  assert.equal(omitted.ok, false);
  assert.equal(omitted.wrote, null);
  assert.equal(explicit.wrote, null);
  assert.equal(omitted.errors[0].code, cmd.errors[0].code);
  assert.equal(explicit.errors[0].code, cmd.errors[0].code);
  assert.deepEqual(omitted.errors[0].locations, cmd.errors[0].locations);
  assert.equal(await omittedIo.readFileAsync("/created.md"), "# keep me\n");
  assert.equal(await explicitIo.readFileAsync("/created.md"), "# keep me\n");
});

test("MCP create file omission returns inline output only", async () => {
  const fixture = loadFixture("release-notes");
  const files = fixtureFiles(fixture);
  const mcpIo = cloneIo(files);
  const writes = trackWrites(mcpIo);
  const before = snapshot(mcpIo);
  const mcp = await handleCreate(
    { template: "template.tpl.md", data: cloneJson(fixture.expected) },
    toolContext(mcpIo),
  );

  assert.equal(mcp.ok, true);
  assert.equal(mcp.output, fixture.expectedOutput);
  assert.equal(mcp.wrote, null);
  assert.deepEqual(Object.keys(mcp).sort(), ["errors", "ok", "output", "wrote"]);
  assert.deepEqual(writes, []);
  assert.deepEqual(snapshot(mcpIo), before);
});

test("MCP create force overwrite matches create()", async () => {
  const fixture = loadFixture("release-notes");
  const files = {
    ...fixtureFiles(fixture),
    "/created.md": "# old\n",
  };
  const mcpIo = cloneIo(files);
  const cmdIo = cloneIo(files);
  const mcp = await handleCreate(
    {
      template: "template.tpl.md",
      data: cloneJson(fixture.expected),
      file: "created.md",
      force: true,
    },
    toolContext(mcpIo),
  );
  const cmd = await create({
    io: cmdIo,
    file: "created.md",
    template: "template.tpl.md",
    data: cloneJson(fixture.expected),
    force: true,
    cwd: "/",
    options: { maxInputBytes: 1_048_576 },
  });

  assert.equal(mcp.ok, cmd.ok);
  assert.equal(mcp.ok, true);
  assert.equal(mcp.output, cmd.output);
  assert.equal(mcp.wrote, "created.md");
  assert.equal(await mcpIo.readFileAsync("/created.md"), await cmdIo.readFileAsync("/created.md"));
});
