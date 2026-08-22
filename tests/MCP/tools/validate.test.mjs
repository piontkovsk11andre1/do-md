import test from "node:test";
import assert from "node:assert/strict";

import { handleValidate } from "../../../sources/MCP/tools/validate.mjs";
import { validate } from "../../../sources/commands/validate.mjs";
import { RUNTIME_FIXTURES, fixtureReady, loadFixture } from "../../conformance-helpers.mjs";
import { cloneIo, fixtureFiles, toolContext } from "./helpers.mjs";

test("MCP validate tool module exists", () => {
  assert.equal(typeof handleValidate, "function");
});

for (const name of RUNTIME_FIXTURES) {
  const define = fixtureReady(name) ? test : test.skip;

  define(`MCP validate matches validate() on ${name}`, async () => {
    const fixture = loadFixture(name);
    const files = fixtureFiles(fixture);
    const mcpIo = cloneIo(files);
    const cmdIo = cloneIo(files);
    const options = { maxInputBytes: 1_048_576 };
    const mcp = await handleValidate(
      { file: "input.md", template: "template.tpl.md" },
      toolContext(mcpIo),
    );
    const cmd = await validate({
      io: cmdIo,
      file: "input.md",
      template: "template.tpl.md",
      cwd: "/",
      options,
    });

    assert.equal(mcp.ok, cmd.ok);
    assert.equal(mcp.ok, true);
    assert.deepEqual(mcp.errors, cmd.errors);
    assert.deepEqual(Object.keys(mcp).sort(), ["errors", "ok"]);
    assert.equal(Object.hasOwn(mcp, "exitCode"), false);
  });
}

test("MCP validate parse failure matches validate()", async () => {
  const fixture = loadFixture("release-notes");
  const files = {
    "/template.tpl.md": fixture.template,
    "/input.md": "not a heading\n",
  };
  const mcpIo = cloneIo(files);
  const cmdIo = cloneIo(files);
  const options = { maxInputBytes: 1_048_576 };
  const mcp = await handleValidate(
    { file: "input.md", template: "template.tpl.md" },
    toolContext(mcpIo),
  );
  const cmd = await validate({
    io: cmdIo,
    file: "input.md",
    template: "template.tpl.md",
    cwd: "/",
    options,
  });

  assert.equal(mcp.ok, cmd.ok);
  assert.equal(mcp.ok, false);
  assert.deepEqual(mcp.errors, cmd.errors);
  assert.ok(mcp.errors.length > 0);
  assert.equal(typeof mcp.errors[0].code, "string");
  assert.ok(Number.isInteger(mcp.errors[0].line) && mcp.errors[0].line >= 1);
  assert.ok(Number.isInteger(mcp.errors[0].column) && mcp.errors[0].column >= 1);
});
