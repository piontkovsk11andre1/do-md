import path from "node:path";
import fs from "node:fs/promises";
import test from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import { create } from "../sources/commands/create.mjs";
import { exportDoc } from "../sources/commands/exportDoc.mjs";
import { set } from "../sources/commands/set.mjs";
import { validate } from "../sources/commands/validate.mjs";
import { Editor } from "../sources/Editor.mjs";
import { Fetch } from "../sources/IO/Fetch.mjs";
import { NodeFilesystem } from "../sources/IO/NodeFilesystem.mjs";
import { Virtual } from "../sources/IO/Virtual.mjs";
import { Reader } from "../sources/Reader.mjs";
import {
  createIoError,
  createConflictError,
  ERROR_CODES,
  fromNativeError,
  locationFromStack,
  makeNotImplementedError,
  makeParseError,
  makeTemplateError,
  DoMdError,
  primaryLocation,
} from "../sources/DoMdError.mjs";
import { Template } from "../sources/Template.mjs";
import { Writer } from "../sources/Writer.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MCP_ONLY_CODES = ["DO_MD_TIMEOUT", "DO_MD_INTERNAL_ERROR"];
const LINE_TEMPLATE = '{% doc.line().as("title") %}\n';
const HEADING_TEMPLATE = '# {% doc.line().as("title") %}\n';

function isLibraryCode(code) {
  return Object.values(ERROR_CODES).includes(code);
}

function assertLibraryError(err, code, location = {}) {
  assert.equal(err.code, code);
  assert.ok(!MCP_ONLY_CODES.includes(err.code));
  assert.ok(Array.isArray(err.locations));
  const position = err.locations.find((l) => l.source === location.file) ?? primaryLocation(err);
  for (const l of err.locations) {
    assert.ok(Number.isInteger(l.range.start.line) && l.range.start.line >= 1);
    assert.ok(Number.isInteger(l.range.start.column) && l.range.start.column >= 1);
  }
  assert.equal(typeof err.message, "string");
  assert.match(err.message, /^[^\r\n]*$/);
  if (location.file !== undefined) {
    assert.equal(position?.source, location.file);
  }
  if (location.line !== undefined) {
    assert.equal(position?.range.start.line, location.line);
  }
  if (location.column !== undefined) {
    assert.equal(position?.range.start.column, location.column);
  }
  if (Object.hasOwn(location, "snippet")) {
    assert.equal(position?.snippet, location.snippet);
  }
}

function assertLiveDiagnostic(err, expected) {
  assertLibraryError(err, expected.code, expected);
  const position = primaryLocation(err);
  assert.ok(position.snippet === null || typeof position.snippet === "string");
  const diagnostic = typeof err.toDiagnostic === "function" ? err.toDiagnostic() : err;
  assert.equal(diagnostic.code, expected.code);
  assert.equal(primaryLocation(diagnostic).range.start.line, expected.line);
  assert.equal(primaryLocation(diagnostic).range.start.column, expected.column);
  assert.equal(primaryLocation(diagnostic).source, expected.file);
  assert.equal(primaryLocation(diagnostic).snippet, expected.snippet);
  assert.equal(typeof diagnostic.message, "string");
  assert.match(diagnostic.message, /^[^\r\n]*$/);
}

async function collectMjs(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectMjs(full)));
    } else if (entry.name.endsWith(".mjs")) {
      files.push(full);
    }
  }
  return files;
}

function isCorePackageFile(file) {
  const rel = path.relative(ROOT, file).replaceAll("\\", "/");
  if (
    rel.startsWith("sources/MCP/") ||
    rel.startsWith("sources/HTTP/") ||
    rel.startsWith("sources/Service/") ||
    rel === "sources/McpServer.mjs" ||
    rel === "sources/HttpServer.mjs"
  ) {
    return false;
  }
  return rel.startsWith("sources/") || rel === "bin/do-md.mjs";
}

test("domain errors include a not implemented helper", () => {
  const err = makeNotImplementedError("alpha");
  assert.ok(err instanceof Error);
  assert.ok(err instanceof DoMdError);
  assert.equal(err.code, ERROR_CODES.DO_MD_USER_ERROR);
  assert.match(err.message, /not implemented/);
});

test("DoMdError is a Diagnostic plus a JS Error", () => {
  const err = new DoMdError({
    code: ERROR_CODES.DO_MD_PARSE_ERROR,
    message: "literal mismatch",
    file: "notes.md",
    line: 4,
    column: 2,
    snippet: "# Title",
  });

  assert.ok(err instanceof Error);
  assert.deepEqual(err.toDiagnostic(), {
    code: ERROR_CODES.DO_MD_PARSE_ERROR,
    message: "literal mismatch",
    locations: [
      {
        role: "document",
        relation: "processing",
        source: "notes.md",
        range: { start: { offset: null, line: 4, column: 2 }, end: null },
        precision: "context",
        snippet: "# Title",
      },
    ],
  });
});

test("path and char aliases populate file and column", () => {
  const err = new DoMdError("missing heading", {
    code: ERROR_CODES.DO_MD_PARSE_ERROR,
    path: "doc.md",
    line: 3,
    char: 8,
  });

  assert.equal(primaryLocation(err).source, "doc.md");
  assert.equal(primaryLocation(err).range.start.line, 3);
  assert.equal(primaryLocation(err).range.start.column, 8);
});

test("missing location is represented by an empty chain", () => {
  const err = new DoMdError("unknown");
  assert.equal(err.code, ERROR_CODES.DO_MD_USER_ERROR);
  assert.deepEqual(err.locations, []);
  assert.equal(primaryLocation(err), null);
});

test("library error codes are the only exported codes", () => {
  assert.deepEqual(ERROR_CODES, {
    DO_MD_USER_ERROR: "DO_MD_USER_ERROR",
    DO_MD_PARSE_ERROR: "DO_MD_PARSE_ERROR",
    DO_MD_TEMPLATE_ERROR: "DO_MD_TEMPLATE_ERROR",
    DO_MD_IO_ERROR: "DO_MD_IO_ERROR",
    DO_MD_CONFLICT: "DO_MD_CONFLICT",
  });
  assert.equal(
    makeParseError("no match", { file: "a.md", line: 2, column: 1 }).code,
    ERROR_CODES.DO_MD_PARSE_ERROR,
  );
  assert.equal(
    makeTemplateError("double bind", { file: "a.tpl.md", line: 5, column: 3 }).code,
    ERROR_CODES.DO_MD_TEMPLATE_ERROR,
  );
  assert.equal(createIoError("ENOENT").code, ERROR_CODES.DO_MD_IO_ERROR);
  assert.equal(createConflictError("stale", { file: "a.md" }).code, ERROR_CODES.DO_MD_CONFLICT);
});

test("locationFromStack prefers the sourceURL template frame", () => {
  const stack = [
    "Error: boom",
    "    at Slot.as (C:\\\\Work\\\\do-md\\\\design\\\\migrations\\\\sources\\\\Slot.mjs:40:7)",
    "    at eval (release.tpl.md:6:11)",
    "    at Template.wrap (C:\\\\Work\\\\do-md\\\\design\\\\migrations\\\\sources\\\\Template.mjs:12:3)",
  ].join("\n");

  assert.deepEqual(locationFromStack(stack, "release.tpl.md"), {
    file: "release.tpl.md",
    line: 6,
    column: 11,
  });
});

test("Diagnostic message is a single line and snippet may be null", () => {
  const err = new DoMdError({
    code: ERROR_CODES.DO_MD_PARSE_ERROR,
    message: "first\nsecond",
    file: "doc.md",
    line: 1,
    column: 1,
  });
  assert.equal(err.message, "first second");
  assert.equal(primaryLocation(err).snippet, null);
  assert.match(err.message, /^[^\r\n]*$/);
});

test("fromNativeError reports template path and line", () => {
  const native = new Error("doc.fizzbuzz is not a function");
  native.stack = [
    "TypeError: doc.fizzbuzz is not a function",
    "    at eval (notes.tpl.md:2:5)",
  ].join("\n");

  const err = fromNativeError(native, { path: "notes.tpl.md" });
  assert.ok(err instanceof DoMdError);
  assert.equal(err.code, ERROR_CODES.DO_MD_TEMPLATE_ERROR);
  assert.equal(primaryLocation(err).source, "notes.tpl.md");
  assert.equal(primaryLocation(err).range.start.line, 2);
  assert.equal(primaryLocation(err).range.start.column, 5);
});

test("MCP-only codes are remapped and absent from ERROR_CODES", () => {
  assert.deepEqual(Object.keys(ERROR_CODES).sort(), [
    "DO_MD_CONFLICT",
    "DO_MD_IO_ERROR",
    "DO_MD_PARSE_ERROR",
    "DO_MD_TEMPLATE_ERROR",
    "DO_MD_USER_ERROR",
  ]);
  for (const code of MCP_ONLY_CODES) {
    assert.equal(Object.hasOwn(ERROR_CODES, code), false);
    assert.equal(new DoMdError({ code, message: "x" }).code, ERROR_CODES.DO_MD_USER_ERROR);
    assert.equal(createIoError("x", code).code, ERROR_CODES.DO_MD_IO_ERROR);
  }
  assert.equal(
    new DoMdError({ code: "DO_MD_STALE_FILE", message: "x" }).code,
    ERROR_CODES.DO_MD_USER_ERROR,
  );
  assert.equal(isLibraryCode(ERROR_CODES.DO_MD_USER_ERROR), true);
});

test("core document sources do not mention service-only error codes", async () => {
  const files = [
    ...(await collectMjs(path.join(ROOT, "sources"))),
    path.join(ROOT, "bin/do-md.mjs"),
  ];
  const hits = [];
  for (const file of files) {
    if (!isCorePackageFile(file)) {
      continue;
    }
    const text = await fs.readFile(file, "utf8");
    for (const code of MCP_ONLY_CODES) {
      if (text.includes(code)) {
        hits.push(`${path.relative(ROOT, file).replaceAll("\\", "/")}: ${code}`);
      }
    }
  }
  assert.deepEqual(hits, []);
});

test("error registry USER sites produce only DO_MD_USER_ERROR", async () => {
  const io = new Virtual({
    "/tpl.md": LINE_TEMPLATE,
    "/doc.md": "Hello\n",
    "/out.md": "keep\n",
    "/list.md": "- a\n",
    "/list.tpl.md": '{% doc.list().as("items") %}\n',
  });

  await assert.rejects(
    () => create({}),
    (err) => {
      assertLibraryError(err, ERROR_CODES.DO_MD_USER_ERROR);
      return true;
    },
  );

  const exists = await create({ io, file: "/out.md", template: "/tpl.md", data: { title: "X" } });
  assert.equal(exists.ok, false);
  assert.equal(exists.exitCode, 1);
  assertLibraryError(exists.errors[0], ERROR_CODES.DO_MD_USER_ERROR, { file: "/out.md" });

  const neither = await set({ io, file: "/doc.md", template: "/tpl.md" });
  assert.equal(neither.ok, false);
  assert.equal(neither.exitCode, 1);
  assertLibraryError(neither.errors[0], ERROR_CODES.DO_MD_USER_ERROR);

  await assert.rejects(
    () => create({ io, file: "/fresh.md", template: "/tpl.md", data: 42 }),
    (err) => {
      assertLibraryError(err, ERROR_CODES.DO_MD_USER_ERROR);
      return true;
    },
  );

  const reader = new Reader("nope", { file: "/doc.md" });
  assert.throws(
    () =>
      reader
        .line()
        .validate(() => false)
        .as("title"),
    (err) => {
      assertLibraryError(err, ERROR_CODES.DO_MD_USER_ERROR, { file: "/doc.md" });
      return true;
    },
  );

  const editor = await Editor.open({ io, file: "/doc.md", template: "/tpl.md" });
  assert.throws(
    () => editor.set("missing", "x"),
    (err) => {
      assertLibraryError(err, ERROR_CODES.DO_MD_USER_ERROR);
      return true;
    },
  );
  const listEditor = await Editor.open({ io, file: "/list.md", template: "/list.tpl.md" });
  assert.throws(
    () => listEditor.set("items", "nope"),
    (err) => {
      assertLibraryError(err, ERROR_CODES.DO_MD_USER_ERROR);
      return true;
    },
  );
  assert.throws(
    () => editor.delete("missing"),
    (err) => {
      assertLibraryError(err, ERROR_CODES.DO_MD_USER_ERROR);
      return true;
    },
  );
  assert.throws(
    () => editor.merge({ ["__proto__"]: { x: 1 } }),
    (err) => {
      assertLibraryError(err, ERROR_CODES.DO_MD_USER_ERROR);
      return true;
    },
  );

  await assert.rejects(
    () => Editor.open({ io, file: "/doc.md", template: "/tpl.md", options: { maxInputBytes: 1 } }),
    (err) => {
      assertLibraryError(err, ERROR_CODES.DO_MD_USER_ERROR, { file: "/doc.md" });
      return true;
    },
  );
});

test("error registry PARSE sites produce only DO_MD_PARSE_ERROR with location", async () => {
  const io = new Virtual({
    "/doc.md": "Goodbye\n",
    "/tpl.md": HEADING_TEMPLATE,
    "/empty.md": "\n",
    "/empty.tpl.md": '{% doc.line().notEmpty().as("title") %}\n',
  });

  const literal = new Reader("Goodbye\n", { file: "/doc.md" });
  literal.parse("# ");
  assert.ok(literal.errors.length > 0);
  assertLibraryError(literal.errors[0], ERROR_CODES.DO_MD_PARSE_ERROR, {
    file: "/doc.md",
    line: 1,
    column: 1,
    snippet: "Goodbye",
  });

  const leaf = new Reader("just a paragraph\n", { file: "/doc.md" });
  leaf.heading(1);
  assert.ok(leaf.errors.length > 0);
  assertLibraryError(leaf.errors[0], ERROR_CODES.DO_MD_PARSE_ERROR, {
    file: "/doc.md",
    snippet: "just a paragraph",
  });

  const empty = new Reader("\n", { file: "/empty.md" });
  assert.throws(
    () => empty.line().notEmpty().as("title"),
    (err) => {
      assertLibraryError(err, ERROR_CODES.DO_MD_PARSE_ERROR, {
        file: "/empty.md",
        line: 1,
        column: 1,
        snippet: "",
      });
      return true;
    },
  );

  const validated = await validate({ io, file: "/doc.md", template: "/tpl.md" });
  assert.equal(validated.ok, false);
  assert.equal(validated.exitCode, 2);
  assertLibraryError(validated.errors[0], ERROR_CODES.DO_MD_PARSE_ERROR, {
    file: "/doc.md",
    snippet: "Goodbye",
  });

  const exported = await exportDoc({
    io,
    file: "/doc.md",
    template: "/tpl.md",
    savePath: "/out.json",
  });
  assert.equal(exported.ok, false);
  assert.equal(exported.exitCode, 2);
  assertLibraryError(exported.errors[0], ERROR_CODES.DO_MD_PARSE_ERROR, {
    file: "/doc.md",
    snippet: "Goodbye",
  });

  const mutated = await set({ io, file: "/doc.md", template: "/tpl.md", key: "title", value: "X" });
  assert.equal(mutated.ok, false);
  assert.equal(mutated.exitCode, 2);
  assertLibraryError(mutated.errors[0], ERROR_CODES.DO_MD_PARSE_ERROR, {
    file: "/doc.md",
    snippet: "Goodbye",
  });

  await assert.rejects(
    () => Editor.open({ io, file: "/doc.md", template: "/tpl.md" }),
    (err) => {
      assertLibraryError(err, ERROR_CODES.DO_MD_PARSE_ERROR, {
        file: "/doc.md",
        snippet: "Goodbye",
      });
      assert.ok(Array.isArray(err.errors));
      assertLibraryError(err.errors[0], ERROR_CODES.DO_MD_PARSE_ERROR, {
        file: "/doc.md",
        snippet: "Goodbye",
      });
      return true;
    },
  );
});

test("live parse diagnostics include snippet and stable location", async () => {
  const midLine = new Reader("abcXYZ\n", { file: "/mid.md" });
  midLine.parse("abc");
  midLine.parse("DEF");
  assert.ok(midLine.errors.length > 0);
  assertLiveDiagnostic(midLine.errors[0], {
    code: ERROR_CODES.DO_MD_PARSE_ERROR,
    file: "/mid.md",
    line: 1,
    column: 4,
    snippet: "abcXYZ",
  });

  const later = new Reader("hello\nworld  \n", { file: "/later.md" });
  later.parse("hello\n");
  later.parse("earth");
  assert.ok(later.errors.length > 0);
  assertLiveDiagnostic(later.errors[0], {
    code: ERROR_CODES.DO_MD_PARSE_ERROR,
    file: "/later.md",
    line: 2,
    column: 1,
    snippet: "world  ",
  });

  const blank = new Reader("\n", { file: "/blank.md" });
  blank.parse("hello");
  assert.ok(blank.errors.length > 0);
  assertLiveDiagnostic(blank.errors[0], {
    code: ERROR_CODES.DO_MD_PARSE_ERROR,
    file: "/blank.md",
    line: 1,
    column: 1,
    snippet: "",
  });

  const io = new Virtual({
    "/doc.md": "# Title\nplain body  \n",
    "/tpl.md": '# {% doc.line().as("title") %}\n{% doc.heading(1).as("other") %}\n',
  });
  const validated = await validate({ io, file: "/doc.md", template: "/tpl.md" });
  assert.equal(validated.ok, false);
  assert.equal(validated.exitCode, 2);
  assertLiveDiagnostic(validated.errors[0], {
    code: ERROR_CODES.DO_MD_PARSE_ERROR,
    file: "/doc.md",
    line: 2,
    column: 1,
    snippet: "plain body  ",
  });

  const exported = await exportDoc({
    io,
    file: "/doc.md",
    template: "/tpl.md",
    savePath: "/out.json",
  });
  assert.equal(exported.ok, false);
  assertLiveDiagnostic(exported.errors[0], {
    code: ERROR_CODES.DO_MD_PARSE_ERROR,
    file: "/doc.md",
    line: 2,
    column: 1,
    snippet: "plain body  ",
  });
});

test("error registry TEMPLATE sites produce only DO_MD_TEMPLATE_ERROR", async () => {
  assert.throws(
    () => Template.wrap("{% const %}", "/bad.tpl.md"),
    (err) => {
      assertLibraryError(err, ERROR_CODES.DO_MD_TEMPLATE_ERROR, { file: "/bad.tpl.md" });
      return true;
    },
  );

  const io = new Virtual({
    "/doc.md": "Hello\n",
    "/tpl.md": "{% doc.fizzbuzz() %}\n",
  });
  await assert.rejects(
    () => validate({ io, file: "/doc.md", template: "/tpl.md" }),
    (err) => {
      assertLibraryError(err, ERROR_CODES.DO_MD_TEMPLATE_ERROR, { file: "/tpl.md" });
      return true;
    },
  );

  const reader = new Reader("one\ntwo");
  reader.line().as("k");
  reader.literal("\n");
  assert.throws(
    () => reader.line().as("k"),
    (err) => {
      assertLibraryError(err, ERROR_CODES.DO_MD_TEMPLATE_ERROR);
      return true;
    },
  );

  const clash = new Reader("one\ntwo");
  clash.line().as("k");
  clash.literal("\n");
  assert.throws(
    () => clash.line().asArray("k"),
    (err) => {
      assertLibraryError(err, ERROR_CODES.DO_MD_TEMPLATE_ERROR);
      return true;
    },
  );

  assert.throws(
    () => new Writer({ chapters: "nope" }).scope("chapters", () => {}),
    (err) => {
      assertLibraryError(err, ERROR_CODES.DO_MD_TEMPLATE_ERROR);
      return true;
    },
  );

  const tooMany = new Array(10000).fill({ name: "x" });
  assert.throws(
    () => new Writer({ chapters: tooMany }).scope("chapters", () => {}),
    (err) => {
      assertLibraryError(err, ERROR_CODES.DO_MD_TEMPLATE_ERROR);
      return true;
    },
  );
});

test("error registry IO sites produce only DO_MD_IO_ERROR", async () => {
  const missingVirtual = new Virtual();
  await assert.rejects(
    () => missingVirtual.readFileAsync("/missing.md"),
    (err) => {
      assertLibraryError(err, ERROR_CODES.DO_MD_IO_ERROR, { file: "/missing.md" });
      return true;
    },
  );
  await assert.rejects(
    () => missingVirtual.statAsync("/missing.md"),
    (err) => {
      assertLibraryError(err, ERROR_CODES.DO_MD_IO_ERROR, { file: "/missing.md" });
      return true;
    },
  );

  const disk = new NodeFilesystem();
  const missing = path.join(tmpdir(), `do-md-missing-${process.pid}-${Date.now()}.md`);
  await assert.rejects(
    () => disk.readFileAsync(missing),
    (err) => {
      assertLibraryError(err, ERROR_CODES.DO_MD_IO_ERROR, { file: missing });
      return true;
    },
  );
  await assert.rejects(
    () => disk.statAsync(missing),
    (err) => {
      assertLibraryError(err, ERROR_CODES.DO_MD_IO_ERROR, { file: missing });
      return true;
    },
  );
  const missingWrite = path.join(
    tmpdir(),
    `do-md-missing-dir-${process.pid}-${Date.now()}`,
    "out.md",
  );
  await assert.rejects(
    () => disk.writeFileAsync(missingWrite, "x"),
    (err) => {
      assertLibraryError(err, ERROR_CODES.DO_MD_IO_ERROR, { file: missingWrite });
      return true;
    },
  );

  const remote = new Fetch();
  await assert.rejects(
    () => remote.writeFileAsync("https://example.com/out.md", "x"),
    (err) => {
      assertLibraryError(err, ERROR_CODES.DO_MD_IO_ERROR, { file: "https://example.com/out.md" });
      return true;
    },
  );
  await assert.rejects(
    () => remote.statAsync("https://example.com/out.md"),
    (err) => {
      assertLibraryError(err, ERROR_CODES.DO_MD_IO_ERROR, { file: "https://example.com/out.md" });
      return true;
    },
  );

  const io = new Virtual({ "/tpl.md": LINE_TEMPLATE });
  await assert.rejects(
    () => create({ io, file: "/out.md", template: "/missing.tpl.md", data: { title: "X" } }),
    (err) => {
      assertLibraryError(err, ERROR_CODES.DO_MD_IO_ERROR);
      return true;
    },
  );
});
