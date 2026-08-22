import test from "node:test";
import assert from "node:assert/strict";

import {
  RUNTIME_FIXTURES,
  fixtureReady,
  loadFixture,
  normalize,
  parseDocument,
  renderDocument,
} from "./conformance-helpers.mjs";

for (const name of RUNTIME_FIXTURES) {
  const define = fixtureReady(name) ? test : test.skip;

  define(`conformance-runtime/${name} parse`, () => {
    const { template, input, expected } = loadFixture(name);
    const reader = parseDocument(input, template, `${name}/input.md`);
    assert.equal(reader.errors.length, 0, reader.errors.map((err) => err.message).join("; "));
    assert.deepEqual(reader.context, expected);
  });

  define(`conformance-runtime/${name} render`, () => {
    const { template, expected, expectedOutput } = loadFixture(name);
    const output = renderDocument(expected, template, `${name}/template.tpl.md`);
    assert.equal(normalize(output), normalize(expectedOutput));
  });

  define(`conformance-runtime/${name} roundtrip-1`, () => {
    const { template, expected } = loadFixture(name);
    const rendered = renderDocument(expected, template, `${name}/template.tpl.md`);
    const reader = parseDocument(rendered, template, `${name}/rendered.md`);
    assert.equal(reader.errors.length, 0, reader.errors.map((err) => err.message).join("; "));
    assert.deepEqual(reader.context, expected);
  });

  define(`conformance-runtime/${name} roundtrip-2`, () => {
    const { template, input } = loadFixture(name);
    const reader = parseDocument(input, template, `${name}/input.md`);
    assert.equal(reader.errors.length, 0, reader.errors.map((err) => err.message).join("; "));
    const rendered = renderDocument(reader.context, template, `${name}/template.tpl.md`);
    assert.equal(normalize(rendered), normalize(input));
  });
}
