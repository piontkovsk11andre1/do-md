import test from "node:test";
import assert from "node:assert/strict";

import * as io from "../../sources/IO/index.mjs";
import { NodeFilesystem, Virtual, Fetch } from "../../sources/IO/index.mjs";

test("IO index exports constructors", () => {
  assert.deepEqual(Object.keys(io).sort(), [
    "Fetch",
    "IO",
    "NodeFilesystem",
    "Virtual",
    "createConflictError",
    "createContentRevision",
    "createIoError",
  ]);
  assert.equal(typeof NodeFilesystem, "function");
  assert.equal(typeof Virtual, "function");
  assert.equal(typeof Fetch, "function");
});
