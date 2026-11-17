import test from "node:test";
import assert from "node:assert/strict";

import { match } from "../../sources/commands/match.mjs";
import { Virtual } from "../../sources/IO/Virtual.mjs";
import { ERROR_CODES } from "../../sources/DoMdError.mjs";

const files = {
  "/doc.md": "# Hello\n",
  "/templates/a.md.template": '# {% doc.line().as("title") %}\n',
  "/templates/nested/b.md.template": '# {% doc.line().as("heading") %}\n',
  "/templates/broken.md.template": "{% invalid javascript %}",
  "/templates/no.md.template": "plain text\n",
  "/templates/ignored.md": '# {% doc.line().as("ignored") %}\n',
};

test("match returns the first sorted matching template from a directory", async () => {
  const result = await match({ io: new Virtual(files), file: "/doc.md", templates: "/templates" });
  assert.equal(result.ok, true);
  assert.equal(result.output, "/templates/a.md.template");
  assert.deepEqual(result.context, { matches: ["/templates/a.md.template"] });
});

test("match all returns every match from a glob and skips invalid candidates", async () => {
  const result = await match({
    io: new Virtual(files),
    file: "/doc.md",
    templates: "/templates/**/*.md.template",
    all: true,
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.context.matches, [
    "/templates/a.md.template",
    "/templates/nested/b.md.template",
  ]);
  assert.equal(result.output, result.context.matches.join("\n"));
});

test("match returns a parse-style failure when no template matches", async () => {
  const result = await match({
    io: new Virtual(files),
    file: "/doc.md",
    templates: "/templates/no.md.template",
  });
  assert.equal(result.ok, false);
  assert.equal(result.exitCode, 2);
  assert.deepEqual(result.context, { matches: [] });
  assert.equal(result.errors[0].code, ERROR_CODES.DO_MD_PARSE_ERROR);
  assert.match(result.errors[0].message, /no matching template/);
});

test("match validates arguments and requires discovery support", async () => {
  await assert.rejects(
    () => match({ io: new Virtual(files), templates: "/templates" }),
    /missing file/,
  );
  const io = new Virtual(files);
  io.globAsync = undefined;
  await assert.rejects(
    () => match({ io, file: "/doc.md", templates: "/templates" }),
    /does not support template discovery/,
  );
});
