import test from "node:test";
import assert from "node:assert/strict";

import { handleSet } from "../../../sources/MCP/tools/set.mjs";
import { Server } from "../../../sources/MCP/Server.mjs";
import { set } from "../../../sources/commands/set.mjs";
import { ERROR_CODES } from "../../../sources/SyntaxError.mjs";
import { MUTATION_FIXTURES, loadMutationFixture, mutationReady } from "../../conformance-helpers.mjs";
import { cloneIo, fixtureFiles, snapshot, toolContext, trackWrites } from "./helpers.mjs";

const UNSAFE_PATCHES = [
  [{ ["__proto__"]: { polluted: true } }, "__proto__"],
  [{ constructor: { polluted: true } }, "constructor"],
  [{ prototype: { polluted: true } }, "prototype"],
  [{ extra: { ["__proto__"]: { polluted: true } } }, "extra.__proto__"],
  [{ extra: { nested: { constructor: true } } }, "extra.nested.constructor"],
  [{ chapters: [{ prototype: true }] }, "chapters[0].prototype"],
];

test("MCP set tool module exists", () => {
  assert.equal(typeof handleSet, "function");
});

for (const spec of MUTATION_FIXTURES) {
  const define = mutationReady(spec) ? test : test.skip;

  define(`MCP set matches set() on ${spec.name}`, async () => {
    const fixture = loadMutationFixture(spec);
    const files = fixtureFiles(fixture);
    const mcpIo = cloneIo(files);
    const cmdIo = cloneIo(files);
    const options = { maxInputBytes: 1_048_576 };
    const args = { key: fixture.key, value: fixture.value, patch: fixture.patch };
    const mcp = await handleSet(
      { file: "input.md", template: "template.tpl.md", ...args },
      toolContext(mcpIo),
    );
    const cmd = await set({
      io: cmdIo,
      file: "input.md",
      template: "template.tpl.md",
      ...args,
      cwd: "/",
      options,
    });

    assert.equal(mcp.ok, cmd.ok);
    assert.equal(mcp.ok, true);
    assert.equal(mcp.output, cmd.output);
    assert.deepEqual(mcp.context, cmd.context);
    assert.deepEqual(mcp.context, fixture.expected);
    assert.deepEqual(mcp.errors, cmd.errors);
    assert.equal(mcp.wrote, "input.md");
    assert.deepEqual(Object.keys(mcp).sort(), ["context", "errors", "ok", "output", "wrote"]);
    assert.equal(Object.hasOwn(mcp, "exitCode"), false);
    assert.equal(await mcpIo.readFileAsync("/input.md"), await cmdIo.readFileAsync("/input.md"));
  });

  define(`MCP set dryRun returns output without writing on ${spec.name}`, async () => {
    const fixture = loadMutationFixture(spec);
    const files = fixtureFiles(fixture);
    const mcpIo = cloneIo(files);
    const cmdIo = cloneIo(files);
    const writes = trackWrites(mcpIo);
    const before = snapshot(mcpIo);
    const options = { maxInputBytes: 1_048_576 };
    const args = { key: fixture.key, value: fixture.value, patch: fixture.patch };
    const mcp = await handleSet(
      { file: "input.md", template: "template.tpl.md", ...args, dryRun: true },
      toolContext(mcpIo),
    );
    const cmd = await set({
      io: cmdIo,
      file: "input.md",
      template: "template.tpl.md",
      ...args,
      cwd: "/",
      options,
    });

    assert.equal(mcp.ok, cmd.ok);
    assert.equal(mcp.ok, true);
    assert.equal(mcp.output, cmd.output);
    assert.deepEqual(mcp.context, cmd.context);
    assert.equal(mcp.wrote, null);
    assert.deepEqual(writes, []);
    assert.deepEqual(snapshot(mcpIo), before);
    assert.notEqual(await cmdIo.readFileAsync("/input.md"), files["/input.md"]);
  });
}

test("MCP set requires at least one of key or patch", async () => {
  const fixture = loadMutationFixture("mutation-byte-stable");
  const files = fixtureFiles(fixture);
  const mcp = await handleSet(
    { file: "input.md", template: "template.tpl.md" },
    toolContext(cloneIo(files)),
  );
  const cmd = await set({
    io: cloneIo(files),
    file: "input.md",
    template: "template.tpl.md",
    cwd: "/",
    options: { maxInputBytes: 1_048_576 },
  });

  assert.equal(mcp.ok, cmd.ok);
  assert.equal(mcp.ok, false);
  assert.equal(mcp.output, null);
  assert.equal(mcp.wrote, null);
  assert.equal(mcp.context, null);
  assert.deepEqual(mcp.errors, cmd.errors);
  assert.equal(mcp.errors[0].code, ERROR_CODES.DO_MD_USER_ERROR);
});

test("MCP set.out defaults to the input file", async () => {
  const fixture = loadMutationFixture("mutation-byte-stable");
  const files = fixtureFiles(fixture);
  const mcpIo = cloneIo(files);
  const cmdIo = cloneIo(files);
  const mcp = await handleSet(
    {
      file: "input.md",
      template: "template.tpl.md",
      key: fixture.key,
      value: fixture.value,
    },
    toolContext(mcpIo),
  );
  const cmd = await set({
    io: cmdIo,
    file: "input.md",
    template: "template.tpl.md",
    key: fixture.key,
    value: fixture.value,
    cwd: "/",
    options: { maxInputBytes: 1_048_576 },
  });

  assert.equal(mcp.ok, cmd.ok);
  assert.equal(mcp.ok, true);
  assert.equal(mcp.output, cmd.output);
  assert.deepEqual(mcp.context, cmd.context);
  assert.equal(mcp.wrote, "input.md");
  assert.equal(await mcpIo.readFileAsync("/input.md"), await cmdIo.readFileAsync("/input.md"));
  assert.notEqual(await mcpIo.readFileAsync("/input.md"), files["/input.md"]);
});

test("MCP set --out writes the dest and leaves the input unchanged", async () => {
  const fixture = loadMutationFixture("mutation-byte-stable");
  const files = fixtureFiles(fixture);
  const mcpIo = cloneIo(files);
  const cmdIo = cloneIo(files);
  const mcp = await handleSet(
    {
      file: "input.md",
      template: "template.tpl.md",
      key: fixture.key,
      value: fixture.value,
      out: "other.md",
    },
    toolContext(mcpIo),
  );
  const cmd = await set({
    io: cmdIo,
    file: "input.md",
    template: "template.tpl.md",
    key: fixture.key,
    value: fixture.value,
    out: "other.md",
    cwd: "/",
    options: { maxInputBytes: 1_048_576 },
  });

  assert.equal(mcp.ok, cmd.ok);
  assert.equal(mcp.output, cmd.output);
  assert.deepEqual(mcp.context, cmd.context);
  assert.equal(mcp.wrote, "other.md");
  assert.equal(await mcpIo.readFileAsync("/input.md"), files["/input.md"]);
  assert.equal(await mcpIo.readFileAsync("/other.md"), await cmdIo.readFileAsync("/other.md"));
});

test("MCP set rejects __proto__, constructor, and prototype patches as DO_MD_USER_ERROR", async () => {
  const fixture = loadMutationFixture("mutation-byte-stable");
  const files = fixtureFiles(fixture);

  for (const [patch, path] of UNSAFE_PATCHES) {
    const mcpIo = cloneIo(files);
    const cmdIo = cloneIo(files);
    const before = snapshot(mcpIo);
    const server = new Server({
      handlers: {
        set: (params) => handleSet(params, toolContext(mcpIo)),
      },
    });
    const mcp = await server.callTool("set", {
      file: "input.md",
      template: "template.tpl.md",
      patch,
    });

    await assert.rejects(
      () =>
        set({
          io: cmdIo,
          file: "input.md",
          template: "template.tpl.md",
          patch,
          cwd: "/",
          options: { maxInputBytes: 1_048_576 },
        }),
      (err) => {
        assert.equal(err.code, ERROR_CODES.DO_MD_USER_ERROR);
        assert.match(err.message, /unsafe patch key/);
        assert.match(err.message, new RegExp(path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
        return true;
      },
    );

    assert.equal(mcp.ok, false);
    assert.equal(mcp.output, null);
    assert.equal(mcp.wrote, null);
    assert.equal(mcp.context, null);
    assert.equal(Object.hasOwn(mcp, "exitCode"), false);
    assert.deepEqual(Object.keys(mcp).sort(), ["context", "errors", "ok", "output", "wrote"]);
    assert.equal(mcp.errors.length, 1);
    assert.equal(mcp.errors[0].code, ERROR_CODES.DO_MD_USER_ERROR);
    assert.ok(Number.isInteger(mcp.errors[0].line) && mcp.errors[0].line >= 1);
    assert.ok(Number.isInteger(mcp.errors[0].column) && mcp.errors[0].column >= 1);
    assert.match(mcp.errors[0].message, /unsafe patch key/);
    assert.match(mcp.errors[0].message, new RegExp(path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.deepEqual(snapshot(mcpIo), before);
    assert.equal(await cmdIo.readFileAsync("/input.md"), files["/input.md"]);
    assert.equal(Object.hasOwn(Object.prototype, "polluted"), false);
    assert.equal({}.polluted, undefined);
  }
});
