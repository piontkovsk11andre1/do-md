import test from "node:test";
import assert from "node:assert/strict";

import * as commands from "../../sources/commands/index.mjs";

test("commands index exports functions", () => {
  assert.deepEqual(Object.keys(commands).sort(), ["create", "exportDoc", "match", "render", "set", "validate"]);
  assert.equal(typeof commands.validate, "function");
  assert.equal(typeof commands.create, "function");
  assert.equal(typeof commands.exportDoc, "function");
  assert.equal(typeof commands.set, "function");
  assert.equal(typeof commands.render, "function");
  assert.equal(typeof commands.match, "function");
});
