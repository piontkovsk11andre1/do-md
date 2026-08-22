import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Reader } from "../sources/Reader.mjs";
import { Template } from "../sources/Template.mjs";
import { Writer } from "../sources/Writer.mjs";
import { normalizeDocument } from "../sources/commands/helpers.mjs";

const fixturesRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "conformance");

export const REQUIRED_FIXTURES = [
  "example-adr",
  "example-kitchen-sink",
  "release-notes",
  "chapters",
  "mutation-byte-stable",
  "mutation-array-resize",
  "crlf-input",
  "bom-input",
];

export const RUNTIME_FIXTURES = ["release-notes", "chapters", "example-kitchen-sink"];

export const MUTATION_FIXTURES = [
  {
    name: "mutation-byte-stable",
    source: "release-notes",
    key: "version",
    value: "2.0.0",
    byteStable: true,
    sets: [
      { key: "version", value: "2.0.0-beta" },
      { key: "date", value: "2026-1-1" },
    ],
  },
  {
    name: "mutation-array-resize",
    source: "chapters",
    patch: {
      chapters: [
        { name: "One", intro: "Intro one" },
        { name: "Two", intro: "Intro two" },
        { name: "Three", intro: "Intro three" },
      ],
    },
    byteStable: false,
  },
];

const REQUIRED_FILES = ["template.tpl.md", "input.md", "expected.json", "expected.output.md"];
const MUTATION_FILE = "mutation.json";

export function normalize(text) {
  return normalizeDocument(text);
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function fixtureDir(name) {
  return path.join(fixturesRoot, name);
}

function readFixture(name, file) {
  return fs.readFileSync(path.join(fixtureDir(name), file), "utf8");
}

export function fixtureReady(name) {
  return REQUIRED_FILES.every((file) => fs.existsSync(path.join(fixtureDir(name), file)));
}

export function parseDocument(input, template, file = "input.md") {
  const fn = Template.wrap(template, file);
  const reader = new Reader(normalize(input), { file });
  fn(reader, reader.context, null, {}, null);
  return reader;
}

export function renderDocument(data, template, file = "template.tpl.md") {
  const fn = Template.wrap(template, file);
  const writer = new Writer(cloneJson(data), { file });
  fn(writer, writer.data, writer.data, {}, null);
  return writer.toMarkdown();
}

export function loadFixture(name) {
  return {
    name,
    template: readFixture(name, "template.tpl.md"),
    input: readFixture(name, "input.md"),
    expected: JSON.parse(readFixture(name, "expected.json")),
    expectedOutput: readFixture(name, "expected.output.md"),
  };
}

export function mutationReady(spec) {
  const name = typeof spec === "string" ? spec : spec.name;
  return fixtureReady(name);
}

export function loadMutationFixture(spec) {
  const defaults = typeof spec === "string"
    ? MUTATION_FIXTURES.find((entry) => entry.name === spec) ?? { name: spec }
    : spec;
  const loaded = loadFixture(defaults.name);
  const mutationPath = path.join(fixtureDir(defaults.name), MUTATION_FILE);
  const mutation = fs.existsSync(mutationPath) ? JSON.parse(fs.readFileSync(mutationPath, "utf8")) : {};
  const expectedSetPath = path.join(fixtureDir(defaults.name), "expected-set.json");
  const expectedSetOutputPath = path.join(fixtureDir(defaults.name), "expected-set.output.md");
  const expectedSetsPath = path.join(fixtureDir(defaults.name), "expected-sets.json");
  const expectedSetsOutputPath = path.join(fixtureDir(defaults.name), "expected-sets.output.md");
  return {
    ...defaults,
    ...loaded,
    ...mutation,
    expected: fs.existsSync(expectedSetPath)
      ? JSON.parse(fs.readFileSync(expectedSetPath, "utf8"))
      : loaded.expected,
    expectedOutput: fs.existsSync(expectedSetOutputPath)
      ? fs.readFileSync(expectedSetOutputPath, "utf8")
      : loaded.expectedOutput,
    expectedSets: fs.existsSync(expectedSetsPath)
      ? JSON.parse(fs.readFileSync(expectedSetsPath, "utf8"))
      : undefined,
    expectedSetsOutput: fs.existsSync(expectedSetsOutputPath)
      ? fs.readFileSync(expectedSetsOutputPath, "utf8")
      : undefined,
  };
}
