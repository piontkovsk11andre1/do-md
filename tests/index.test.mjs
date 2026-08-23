import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import * as api from "../sources/index.mjs";
import * as commands from "../sources/commands/index.mjs";
import * as io from "../sources/IO/index.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const indexPath = path.join(root, "sources/index.mjs");

const EXPECTED_PUBLIC_EXPORTS = [
  "create",
  "describeTemplateFunction",
  "Editor",
  "exportDoc",
  "Fetch",
  "match",
  "listTemplateFunctions",
  "NodeFilesystem",
  "Parser",
  "query",
  "Reader",
  "render",
  "renderTemplateReference",
  "set",
  "Slot",
  "SyntaxError",
  "Template",
  "templateLanguage",
  "validate",
  "Virtual",
  "Writer",
];

const FORBIDDEN_PUBLIC_EXPORTS = [
  "bootstrap",
  "createIoError",
  "createServer",
  "ERROR_CODES",
  "execute",
  "handleCreate",
  "handleExport",
  "handleRender",
  "handleSet",
  "handleValidate",
  "IO",
  "lookupSlot",
  "McpServer",
  "parseArgv",
  "registerBinding",
  "renderBlocks",
  "Server",
  "Shell",
  "TEMPLATE_ENTRYPOINT",
  "TEMPLATE_SOURCE_URL",
  "USAGE",
  "SchemaDoc",
  "MockDoc",
  "DiffDoc",
  "QueryDoc",
  "LinterDoc",
  "CoverageDoc",
  "FormDoc",
  "HtmlDoc",
  "TextDoc",
  "PhpDoc",
  "SqlDoc",
  "RstDoc",
];

test("public API exports are present", () => {
  const actual = Object.keys(api).sort();
  assert.deepEqual(actual, [...EXPECTED_PUBLIC_EXPORTS].sort());
});

test("root package import has no default export", () => {
  assert.equal(Object.hasOwn(api, "default"), false);
});

test("root package import does not expose internals", () => {
  for (const name of FORBIDDEN_PUBLIC_EXPORTS) {
    assert.equal(Object.hasOwn(api, name), false, name);
  }
});

test("public API re-exports command functions from commands/index.mjs", () => {
  assert.equal(api.validate, commands.validate);
  assert.equal(api.create, commands.create);
  assert.equal(api.exportDoc, commands.exportDoc);
  assert.equal(api.set, commands.set);
  assert.equal(api.render, commands.render);
  assert.equal(api.match, commands.match);
  assert.equal(api.query, commands.query);
});

test("public API re-exports IO adapters from IO/index.mjs", () => {
  assert.equal(api.NodeFilesystem, io.NodeFilesystem);
  assert.equal(api.Virtual, io.Virtual);
  assert.equal(api.Fetch, io.Fetch);
});

test("documented public exports have the expected kinds", () => {
  for (const name of ["validate", "create", "exportDoc", "set", "render", "match", "query", "describeTemplateFunction", "listTemplateFunctions", "renderTemplateReference"]) {
    assert.equal(typeof api[name], "function", name);
  }
  for (const name of [
    "Template",
    "Reader",
    "Writer",
    "Parser",
    "Slot",
    "Editor",
    "SyntaxError",
    "NodeFilesystem",
    "Virtual",
    "Fetch",
  ]) {
    assert.equal(typeof api[name], "function", name);
  }
  assert.equal(typeof api.templateLanguage, "object");
});

test("index.mjs re-exports named bindings only", async () => {
  const text = await fs.readFile(indexPath, "utf8");
  assert.doesNotMatch(text, /export\s+\*/);
  assert.doesNotMatch(text, /export\s+default\b/);
  assert.doesNotMatch(text, /export\s*\{[^}]*\bas\s+default\b/);
});
