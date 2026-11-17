import test from "node:test";
import assert from "node:assert/strict";

import { query } from "../../sources/commands/query.mjs";
import { Virtual } from "../../sources/IO/Virtual.mjs";
import { ERROR_CODES } from "../../sources/DoMdError.mjs";

const source = "Intro\n\n## Target\n\nFirst\n\nNoise\n\n## Target\n\nSecond\n\nEnd\n";
const template =
  '{% doc.rawUntil("## Target"); doc.query((match) => { match.literal("## Target\\n\\n"); match.paragraph().as("content") }); doc.rawRest() %}';

function virtual(input = source, queryTemplate = template) {
  return new Virtual({ "/doc.md": input, "/query.tpl.md": queryTemplate });
}

test("query returns the first occurrence with document-relative offsets", async () => {
  const result = await query({ io: virtual(), file: "/doc.md", template: "/query.tpl.md" });
  const start = source.indexOf("## Target");
  const end = start + "## Target\n\nFirst".length;
  assert.equal(result.ok, true);
  assert.deepEqual(result.context.matches, [{ start, end, context: { content: "First" } }]);
  assert.deepEqual(JSON.parse(result.output), result.context.matches[0]);
});

test("query all shifts subsequent occurrence offsets into the original document", async () => {
  const input = `\uFEFF${source}`;
  const result = await query({
    io: virtual(input),
    file: "/doc.md",
    template: "/query.tpl.md",
    all: true,
  });
  const first = input.indexOf("## Target");
  const second = input.indexOf("## Target", first + 1);
  assert.deepEqual(result.context.matches, [
    { start: first, end: first + "## Target\n\nFirst".length, context: { content: "First" } },
    { start: second, end: second + "## Target\n\nSecond".length, context: { content: "Second" } },
  ]);
  assert.deepEqual(JSON.parse(result.output), result.context.matches);
});

test("query returns exit 2 when no occurrence matches", async () => {
  const result = await query({
    io: virtual("No target\n"),
    file: "/doc.md",
    template: "/query.tpl.md",
  });
  assert.equal(result.ok, false);
  assert.equal(result.exitCode, 2);
  assert.deepEqual(result.context, { matches: [] });
  assert.equal(result.errors[0].code, ERROR_CODES.DO_MD_PARSE_ERROR);
});

test("query requires exactly one non-empty query region", async () => {
  await assert.rejects(
    () =>
      query({
        io: virtual("anything", "{% doc.rawRest() %}"),
        file: "/doc.md",
        template: "/query.tpl.md",
      }),
    /exactly one doc\.query region/,
  );
  await assert.rejects(
    () =>
      query({
        io: virtual("anything", "{% doc.query(() => {}); doc.rawRest() %}"),
        file: "/doc.md",
        template: "/query.tpl.md",
      }),
    /must consume content/,
  );
});
