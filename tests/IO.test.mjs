import test from "node:test";
import assert from "node:assert/strict";

import { IO } from "../sources/IO.mjs";

test("IO interface stub exists", () => {
  const io = new IO();
  assert.equal(typeof io.readFileAsync, "function");
  assert.equal(typeof io.writeFileAsync, "function");
  assert.equal(typeof io.statAsync, "function");
  assert.equal(typeof io.resolvePath, "function");
});
