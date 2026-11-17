import test from "node:test";
import assert from "node:assert/strict";
import { inspect } from "node:util";
import { Console } from "node:console";
import { PassThrough } from "node:stream";
import stringWidth from "string-width";
import { formatDiagnostic, SyntaxError, Template } from "../sources/index.mjs";
import { sourceLocation } from "../sources/SourceMap.mjs";

function diagnostic(text, start, end = null, options = {}) {
  return new SyntaxError({ code: "DO_MD_TEMPLATE_ERROR", message: "Unexpected token '='", locations: [
    sourceLocation("schema.md.template", text, start, end, { role: "template", ...options }),
  ] });
}

test("formatDiagnostic renders exact source points with one-based gutters", () => {
  const source = "heading\n\n{%\nconst = 1;\n%}";
  const error = diagnostic(source, source.indexOf("="));
  assert.equal(formatDiagnostic(error), [
    "schema.md.template:4:7: Unexpected token '='",
    "",
    "4 | const = 1;",
    "  |       ^",
  ].join("\n"));
  assert.equal(String(error), formatDiagnostic(error.toDiagnostic()));
});

test("ranges underline their span, with an explicit multiline endpoint", () => {
  assert.equal(formatDiagnostic(diagnostic("one two three", 4, 7)).split("\n").at(-1), "  |     ^~~");
  const error = diagnostic("one\ntwo\nthree", 1, 8);
  assert.match(formatDiagnostic(error), /1 \| one\n  \|  \^~ range ends at 3:1$/);
});

test("processing context is not rendered as an exact error position", () => {
  const error = diagnostic("value", 2, null, { role: "document", relation: "processing", precision: "context" });
  assert.equal(formatDiagnostic(error).split("\n").at(-1), "  |   ~ processing context");
});

test("all related frames are readable and generated frames are opt-in", () => {
  const error = diagnostic("const = 1;", 6);
  error.locations.unshift(sourceLocation("generated:example", "const = 1;", 6, null, { role: "generated" }));
  error.locations.push(sourceLocation("workflow.md", "# Workflow\nconst = 1;", 17));
  error.locations.push(sourceLocation("input.md", "invalid", 0, 7, { relation: "processing", precision: "range" }));
  const output = formatDiagnostic(error);
  assert.match(output, /^input.md:1:1: Unexpected token/);
  assert.match(output, /document: workflow.md:2:7\n\n2 \| const = 1;/);
  assert.match(output, /template: schema.md.template:1:7\n\n1 \| const = 1;/);
  assert.doesNotMatch(output, /generated:/);
  assert.match(formatDiagnostic(error, { includeGenerated: true }), /generated: generated:example:1:7/);
  error.locations.push(structuredClone(error.locations[1]));
  assert.equal(formatDiagnostic(error).split("template: schema.md.template").length - 1, 1);
});

test("tab stops and Unicode display widths align markers with source text", () => {
  for (const prefix of ["\t", "\t\t", "😀 ", "界 ", "e\u0301 ", "👩‍💻\t"]) {
    const output = formatDiagnostic(diagnostic(`${prefix}=`, prefix.length));
    const [line, marker] = output.split("\n").slice(-2);
    assert.doesNotMatch(line, /\t/);
    assert.equal(stringWidth(line.slice(line.indexOf("|") + 2, line.indexOf("="))),
      marker.indexOf("^") - marker.indexOf("|") - 2, prefix);
  }
});

test("long lines are cropped around the marker and large ranges stay bounded", () => {
  const text = "😀".repeat(150) + "=" + "x".repeat(150);
  const output = formatDiagnostic(diagnostic(text, 300, text.length));
  const [line, marker] = output.split("\n").slice(-2);
  assert.match(line, /….*=.*…/);
  assert.ok(stringWidth(line) <= 106);
  assert.ok(marker.length <= 106);
  assert.equal(stringWidth(line.slice(0, line.indexOf("="))), marker.indexOf("^"));
});

test("empty snippets, missing snippets and missing locations have useful fallbacks", () => {
  const empty = diagnostic("", 0);
  assert.equal(formatDiagnostic(empty), "schema.md.template:1:1: Unexpected token '='\n\n1 | \n  | ^");
  empty.locations[0].snippet = null;
  assert.equal(formatDiagnostic(empty), "schema.md.template:1:1: Unexpected token '='");
  assert.equal(formatDiagnostic(new SyntaxError("no template")), "no template");
  const unknown = diagnostic("value", 1);
  unknown.locations[0].source = null;
  assert.match(formatDiagnostic(unknown), /^<unknown>:1:2:/);
  unknown.locations[0].role = "generated";
  assert.equal(formatDiagnostic(unknown), "Unexpected token '='");
  assert.match(formatDiagnostic(unknown, { includeGenerated: true }), /1 \| value/);
});

test("terminal controls are escaped and ANSI is explicit", () => {
  const error = diagnostic("a\x1b[31mb =", 9);
  const plain = formatDiagnostic(error);
  assert.doesNotMatch(plain, /\x1b/);
  assert.match(plain, /a\\u001b\[31mb =/);
  const colored = formatDiagnostic(error, { colors: true });
  assert.match(colored, /\x1b\[/);
  assert.equal(inspect(error, { colors: false }), plain);
  assert.equal(inspect(error, { colors: true }), colored);
});

test("console.error uses the formatter without changing stacks, causes or JSON diagnostics", () => {
  const cause = new Error("native cause");
  const error = diagnostic("const = 1;", 6);
  error.cause = cause;
  const stack = error.stack;
  const before = error.toDiagnostic();
  const output = new PassThrough();
  let stderr = "";
  output.on("data", (chunk) => { stderr += chunk; });
  new Console({ stdout: output, stderr: output, colorMode: false }).error(error);
  assert.equal(stderr, `${formatDiagnostic(error)}\n`);
  assert.equal(error.stack, stack);
  assert.equal(error.cause, cause);
  assert.deepEqual(error.toDiagnostic(), before);
  assert.match(inspect(error, { customInspect: false }), /native cause/);
  output.end();
});

test("real compilation errors display the mapped template rather than generated JS", () => {
  assert.throws(() => Template.wrap("text\n{%\nconst = 1;\n%}", "broken.md.template"), (error) => {
    assert.equal(String(error), "broken.md.template:3:7: Unexpected token\n\n3 | const = 1;\n  |       ^");
    assert.doesNotMatch(String(error), /generated:|sources\/Template/);
    return true;
  });
});
