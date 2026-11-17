import test from "node:test";
import assert from "node:assert/strict";

import { handleMatch } from "../../../sources/MCP/tools/match.mjs";
import { Virtual } from "../../../sources/IO/Virtual.mjs";
import { ERROR_CODES } from "../../../sources/DoMdError.mjs";

const io = new Virtual({
  "/root/doc.md": "# Hello\n",
  "/root/templates/a.md.template": '# {% doc.line().as("title") %}\n',
  "/root/templates/b.md.template": '# {% doc.line().as("heading") %}\n',
});

test("MCP match returns first or all matching templates", async () => {
  const first = await handleMatch(
    { file: "doc.md", templates: "templates" },
    { io, root: "/root" },
  );
  assert.deepEqual(first, { ok: true, matches: ["/root/templates/a.md.template"], errors: [] });

  const all = await handleMatch(
    { file: "doc.md", templates: "templates/**/*.md.template", all: true },
    { io, root: "/root" },
  );
  assert.deepEqual(all.matches, ["/root/templates/a.md.template", "/root/templates/b.md.template"]);
});

test("MCP match reports no match as a parse error", async () => {
  const result = await handleMatch(
    { file: "doc.md", templates: "missing/**/*.md.template" },
    { io, root: "/root" },
  );
  assert.equal(result.ok, false);
  assert.deepEqual(result.matches, []);
  assert.equal(result.errors[0].code, ERROR_CODES.DO_MD_PARSE_ERROR);
});
