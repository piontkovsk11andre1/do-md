import test from "node:test";
import assert from "node:assert/strict";

import { handleQuery } from "../../../sources/MCP/tools/query.mjs";
import { Virtual } from "../../../sources/IO/Virtual.mjs";
import { ERROR_CODES } from "../../../sources/DoMdError.mjs";

const template =
  '{% doc.rawUntil("target:"); doc.query((match) => { match.literal("target:"); match.line().as("value") }); doc.rawRest() %}';
const io = new Virtual({
  "/root/doc.md": "target:one\nother\ntarget:two\n",
  "/root/no.md": "nothing here\n",
  "/root/query.tpl.md": template,
});

test("MCP query returns first or all shifted matches", async () => {
  const first = await handleQuery(
    { file: "doc.md", template: "query.tpl.md" },
    { io, root: "/root" },
  );
  assert.deepEqual(first.matches, [{ start: 0, end: 10, context: { value: "one" } }]);

  const all = await handleQuery(
    { file: "doc.md", template: "query.tpl.md", all: true },
    { io, root: "/root" },
  );
  assert.deepEqual(all.matches, [
    { start: 0, end: 10, context: { value: "one" } },
    { start: 17, end: 27, context: { value: "two" } },
  ]);
});

test("MCP query reports no occurrence as a parse error", async () => {
  const result = await handleQuery(
    { file: "no.md", template: "query.tpl.md" },
    { io, root: "/root" },
  );
  assert.equal(result.ok, false);
  assert.equal(result.errors[0].code, ERROR_CODES.DO_MD_PARSE_ERROR);
});
