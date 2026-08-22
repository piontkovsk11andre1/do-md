import test from "node:test";
import assert from "node:assert/strict";

import { create } from "../sources/commands/create.mjs";
import { exportDoc } from "../sources/commands/exportDoc.mjs";
import { set } from "../sources/commands/set.mjs";
import { Editor } from "../sources/Editor.mjs";
import { Virtual } from "../sources/IO/Virtual.mjs";
import {
  MUTATION_FIXTURES,
  REQUIRED_FIXTURES,
  fixtureReady,
  loadFixture,
  loadMutationFixture,
  mutationReady,
  normalize,
} from "./conformance-helpers.mjs";

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function fixtureIo(name) {
  const fixture = loadFixture(name);
  const io = new Virtual({
    [`/${name}/template.tpl.md`]: fixture.template,
    [`/${name}/input.md`]: fixture.input,
  });
  return {
    ...fixture,
    io,
    file: `/${name}/input.md`,
    template: `/${name}/template.tpl.md`,
  };
}

for (const name of REQUIRED_FIXTURES) {
  const define = fixtureReady(name) ? test : test.skip;

  define(`conformance/${name} parse`, async () => {
    const { io, file, template, expected } = fixtureIo(name);
    const result = await exportDoc({
      io,
      file,
      template,
      savePath: `/${name}/expected.json`,
    });
    assert.equal(result.ok, true, result.errors.map((err) => err.message).join("; "));
    assert.deepEqual(result.context, expected);
  });

  define(`conformance/${name} render`, async () => {
    const { io, template, expected, expectedOutput } = fixtureIo(name);
    const result = await create({
      io,
      file: `/${name}/created.md`,
      template,
      data: cloneJson(expected),
    });
    assert.equal(result.ok, true, result.errors.map((err) => err.message).join("; "));
    assert.equal(result.output, expectedOutput);
  });

  define(`conformance/${name} roundtrip-1`, async () => {
    const { io, template, expected } = fixtureIo(name);
    const rendered = await create({
      io,
      file: `/${name}/rendered.md`,
      template,
      data: cloneJson(expected),
    });
    assert.equal(rendered.ok, true, rendered.errors.map((err) => err.message).join("; "));
    const parsed = await exportDoc({
      io,
      file: `/${name}/rendered.md`,
      template,
      savePath: `/${name}/roundtrip-1.json`,
    });
    assert.equal(parsed.ok, true, parsed.errors.map((err) => err.message).join("; "));
    assert.deepEqual(parsed.context, expected);
  });

  define(`conformance/${name} roundtrip-2`, async () => {
    const { io, file, template, input } = fixtureIo(name);
    const parsed = await exportDoc({
      io,
      file,
      template,
      savePath: `/${name}/roundtrip-2.json`,
    });
    assert.equal(parsed.ok, true, parsed.errors.map((err) => err.message).join("; "));
    const rendered = await create({
      io,
      file: `/${name}/roundtrip-2.md`,
      template,
      data: cloneJson(parsed.context),
    });
    assert.equal(rendered.ok, true, rendered.errors.map((err) => err.message).join("; "));
    assert.equal(rendered.output, normalize(input));
  });
}

for (const spec of MUTATION_FIXTURES) {
  const define = mutationReady(spec) ? test : test.skip;

  define(`conformance/${spec.name} set`, async () => {
    const fixture = loadMutationFixture(spec);
    const io = new Virtual({
      [`/${fixture.name}/template.tpl.md`]: fixture.template,
      [`/${fixture.name}/input.md`]: fixture.input,
    });
    const file = `/${fixture.name}/input.md`;
    const template = `/${fixture.name}/template.tpl.md`;
    const result = await set({
      io,
      file,
      template,
      key: fixture.key,
      value: fixture.value,
      patch: fixture.patch,
    });
    assert.equal(result.ok, true, result.errors.map((err) => err.message).join("; "));
    assert.deepEqual(result.context, fixture.expected);
    assert.equal(normalize(result.output), normalize(fixture.expectedOutput));

    if (fixture.byteStable) {
      const editor = await Editor.open({ io: new Virtual({ [file]: fixture.input, [template]: fixture.template }), file, template });
      const slot = editor.slotMap.find((entry) => entry.key === fixture.key);
      assert.ok(slot);
      const written = await io.readFileAsync(file);
      const replacement = String(fixture.value);
      assert.equal(written.slice(0, slot.sourceOffsetStart), fixture.input.slice(0, slot.sourceOffsetStart));
      assert.equal(written.slice(slot.sourceOffsetStart + replacement.length), fixture.input.slice(slot.sourceOffsetEnd));
    }
  });

  if (Array.isArray(spec.sets) && spec.sets.length > 0) {
    define(`conformance/${spec.name} multiple-scalar-splices`, async () => {
      const fixture = loadMutationFixture(spec);
      const io = new Virtual({
        [`/${fixture.name}/template.tpl.md`]: fixture.template,
        [`/${fixture.name}/input.md`]: fixture.input,
      });
      const file = `/${fixture.name}/input.md`;
      const template = `/${fixture.name}/template.tpl.md`;
      const editor = await Editor.open({ io, file, template });
      for (const mutation of fixture.sets) {
        editor.set(mutation.key, mutation.value);
      }
      const output = editor.render();
      await editor.save();
      assert.deepEqual(editor.context, fixture.expectedSets);
      assert.equal(normalize(output), normalize(fixture.expectedSetsOutput));

      if (fixture.byteStable) {
        const replacements = fixture.sets.map((mutation) => {
          const slot = editor.slotMap.find((entry) => entry.key === mutation.key);
          assert.ok(slot, mutation.key);
          return {
            start: slot.sourceOffsetStart,
            end: slot.sourceOffsetEnd,
            value: String(mutation.value),
          };
        });
        let expected = fixture.input;
        for (const { start, end, value } of replacements.sort((a, b) => b.start - a.start)) {
          expected = expected.slice(0, start) + value + expected.slice(end);
        }
        assert.equal(await io.readFileAsync(file), expected);
      }
    });
  }
}
