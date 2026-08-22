import test from "node:test";
import assert from "node:assert/strict";

import { handleMatch } from "../../../sources/MCP/tools/match.mjs";
import { Virtual } from "../../../sources/IO/Virtual.mjs";
import { ERROR_CODES } from "../../../sources/SyntaxError.mjs";

const io = new Virtual({
  "/root/doc.md": "# Hello\n",
  "/root/templates/a.tpl.md": '# {% doc.line().as("title") %}\n',
  "/root/templates/b.tpl.md": '# {% doc.line().as("heading") %}\n',
});

test("MCP match returns first or all matching templates", async () => {
  const first = await handleMatch(
    { file: "doc.md", templates: "templates" },
    { io, root: "/root" },
  );
  assert.deepEqual(first, { ok: true, matches: ["/root/templates/a.tpl.md"], errors: [] });

  const all = await handleMatch(
    { file: "doc.md", templates: "templates/**/*.tpl.md", all: true },
    { io, root: "/root" },
  );
  assert.deepEqual(all.matches, ["/root/templates/a.tpl.md", "/root/templates/b.tpl.md"]);
});

test("MCP match reports no match as a parse error", async () => {
  const result = await handleMatch(
    { file: "doc.md", templates: "missing/**/*.tpl.md" },
    { io, root: "/root" },
  );
  assert.equal(result.ok, false);
  assert.deepEqual(result.matches, []);
  assert.equal(result.errors[0].code, ERROR_CODES.DO_MD_PARSE_ERROR);
});
