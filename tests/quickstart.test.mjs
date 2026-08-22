import test from "node:test";
import assert from "node:assert/strict";

import { create } from "../sources/commands/create.mjs";
import { exportDoc } from "../sources/commands/exportDoc.mjs";
import { render } from "../sources/commands/render.mjs";
import { set } from "../sources/commands/set.mjs";
import { validate } from "../sources/commands/validate.mjs";
import { Virtual } from "../sources/IO/Virtual.mjs";
import { loadFixture, normalize } from "./conformance-helpers.mjs";

test("quickstart flow on release-notes: validate, export, create, set, render", async () => {
  const fixture = loadFixture("release-notes");
  const io = new Virtual({
    "/release.md": fixture.input,
    "/release.tpl.md": fixture.template,
    "/other.tpl.md": 'Version: {% doc.line().as("version") %}\n',
  });

  const validated = await validate({
    io,
    file: "/release.md",
    template: "/release.tpl.md",
  });
  assert.deepEqual(validated, {
    ok: true,
    exitCode: 0,
    output: null,
    context: null,
    errors: [],
  });
  assert.equal(await io.readFileAsync("/release.md"), fixture.input);

  const exported = await exportDoc({
    io,
    file: "/release.md",
    template: "/release.tpl.md",
    savePath: "/release.json",
  });
  assert.equal(exported.ok, true);
  assert.equal(exported.exitCode, 0);
  assert.equal(exported.output, null);
  assert.deepEqual(exported.context, fixture.expected);
  assert.deepEqual(exported.errors, []);
  assert.deepEqual(JSON.parse(await io.readFileAsync("/release.json")), fixture.expected);

  const created = await create({
    io,
    file: "/release-2.md",
    template: "/release.tpl.md",
    data: JSON.parse(await io.readFileAsync("/release.json")),
  });
  assert.equal(created.ok, true);
  assert.equal(created.exitCode, 0);
  assert.equal(created.context, null);
  assert.deepEqual(created.errors, []);
  assert.equal(normalize(created.output), normalize(fixture.expectedOutput));
  assert.equal(normalize(await io.readFileAsync("/release-2.md")), normalize(fixture.input));

  const original = await io.readFileAsync("/release.md");
  const rendered = await render({
    io,
    file: "/release.md",
    parseTemplate: "/release.tpl.md",
    renderTemplate: "/other.tpl.md",
    outFile: "/out.txt",
  });
  assert.equal(rendered.ok, true);
  assert.equal(rendered.exitCode, 0);
  assert.deepEqual(rendered.errors, []);
  assert.equal(await io.readFileAsync("/release.md"), original);
  assert.match(await io.readFileAsync("/out.txt"), /Version: 1\.2\.0/);

  const mutated = await set({
    io,
    file: "/release.md",
    template: "/release.tpl.md",
    key: "version",
    value: "2.0.0",
  });
  assert.equal(mutated.ok, true);
  assert.equal(mutated.exitCode, 0);
  assert.equal(mutated.context.version, "2.0.0");
  assert.deepEqual(mutated.errors, []);
  assert.match(mutated.output, /^# 2\.0\.0/m);
  const updated = await io.readFileAsync("/release.md");
  assert.match(updated, /^# 2\.0\.0/m);
  assert.match(updated, /2026-08-22/);
  assert.match(updated, /Added Writer round-trip/);
});
