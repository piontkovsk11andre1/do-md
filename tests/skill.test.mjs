import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { readSkill, Reader } from "../sources/index.mjs";
import { handleReference } from "../sources/MCP/tools/reference.mjs";
import { handleSkill } from "../sources/MCP/tools/skill.mjs";

const exec = promisify(execFile);
const cli = fileURLToPath(new URL("../bin/do-md.mjs", import.meta.url));
const packagedSkill = fileURLToPath(new URL("../skills/do-md/SKILL.md", import.meta.url));

test("Agent Skill has portable metadata and one authoritative packaged body", async () => {
  const text = await readFile(packagedSkill, "utf8");
  const reader = new Reader(text);
  reader.frontmatter().as("metadata");
  assert.equal(reader.errors.length, 0);
  const metadata = reader.context.metadata.data;
  assert.equal(metadata.name, "do-md");
  assert.equal(metadata.license, "MIT");
  assert.match(metadata.description, /Markdown/);
  assert.match(metadata.compatibility, /Node\.js 20/);
  assert.equal(await readSkill(), text);
  assert.equal((await handleSkill()).skill, text);
  const { stdout, stderr } = await exec(process.execPath, [cli, "skill"]);
  assert.equal(stderr, "");
  assert.equal(stdout, text);
  assert.equal(createRequire(import.meta.url).resolve("@p10i/do-md/skills/do-md/SKILL.md"), packagedSkill);
});

for (const topic of [undefined, "listTree"]) {
  for (const format of ["json", "markdown", "text"]) {
    test(`CLI reference matches MCP reference: ${topic ?? "whole registry"}, ${format}`, async () => {
      const { stdout } = await exec(process.execPath, [cli, "reference", ...(topic ? [topic] : []), "--format", format]);
      const result = await handleReference({ topic, format });
      assert.equal(result.ok, true);
      if (format === "json") assert.deepEqual(JSON.parse(stdout), result.reference);
      else assert.equal(stdout.trimEnd(), result.reference.trimEnd());
    });
  }
}

test("reference defaults to JSON while help describes commands", async () => {
  const current = await exec(process.execPath, [cli, "reference", "query"]);
  assert.equal(JSON.parse(current.stdout).name, "query");
  const command = await exec(process.execPath, [cli, "help", "query"]);
  assert.match(command.stdout, /do-md query <file> <template>/);
  const usage = await exec(process.execPath, [cli, "reference", "--help"]);
  assert.match(usage.stdout, /do-md reference/);
  const skillUsage = await exec(process.execPath, [cli, "skill", "--help"]);
  assert.match(skillUsage.stdout, /does not install/);
});

test("reference and skill reject unknown topics, formats and extra arguments", async () => {
  for (const args of [["reference", "missing"], ["reference", "--format", "invalid"], ["reference", "query", "table"], ["skill", "extra"], ["help", "template"]]) {
    await assert.rejects(exec(process.execPath, [cli, ...args]), error => error.code === 1 && Boolean(error.stderr));
  }
});
