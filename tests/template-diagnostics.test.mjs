import test from "node:test";
import assert from "node:assert/strict";
import {
  Template,
  Virtual,
  validate,
  create,
  query,
  createSourceMap,
  composeSourceMaps,
  mapDiagnostic,
  mapPosition,
  sourcePoint,
} from "../sources/index.mjs";

const templateLocation = (error) => error.locations.find((l) => l.role === "template");
function caught(fn) {
  try {
    fn();
  } catch (error) {
    return error;
  }
  assert.fail("expected a template error");
}

for (const newline of ["\n", "\r\n", "\r"]) {
  test(`syntax and runtime positions survive literals and ${JSON.stringify(newline)}`, () => {
    const prefix = ["😀 heading", "", "{%", ""].join(newline);
    const syntax = `${prefix}const = 1;${newline}%}`;
    const compileError = caught(() => Template.wrap(syntax, "action.md.template"));
    const syntaxLocation = templateLocation(compileError);
    assert.deepEqual(syntaxLocation.range.start, sourcePoint(syntax, syntax.indexOf("=")));
    assert.equal(syntaxLocation.precision, "exact");
    assert.ok(compileError.cause instanceof globalThis.SyntaxError);
    const runtime = `${prefix}throw new Error("boom");${newline}%}`;
    const error = caught(() => Template.wrap(runtime, "action.md.template")({ literal() {} }));
    assert.deepEqual(
      templateLocation(error).range.start,
      sourcePoint(runtime, runtime.indexOf("new Error")),
    );
    assert.equal(error.cause.message, "boom");
    assert.equal(error.toDiagnostic().locations.length, 2);
    assert.equal(Object.hasOwn(error.toDiagnostic(), "file"), false);
  });
}

test("syntax errors in strings, parentheses and split blocks keep template locations", () => {
  for (const source of [
    "{% const x = 'unterminated %}",
    "{% const x = (1; %}",
    "{% if (true) { %}body{% else } %}",
    "{% const x = ( %}",
  ]) {
    const error = caught(() => Template.wrap(source, "bad.md.template"));
    const location = templateLocation(error);
    assert.equal(error.code, "DO_MD_TEMPLATE_ERROR");
    assert.equal(location.source, "bad.md.template");
    assert.ok(location.range.start.offset >= 0 && location.range.start.offset <= source.length);
  }
  assert.doesNotThrow(() => Template.wrap("{% return; %}"));
  assert.doesNotThrow(() => Template.wrap("{% if (true) { %}body{% } %}"));
});

test("BOM and escaped delimiters retain original offsets", () => {
  const source = "\uFEFF\\{% literal \\%}\n{% throw new Error('boom'); %}";
  const error = caught(() => Template.wrap(source, "bom.md.template")({ literal() {} }));
  assert.deepEqual(
    templateLocation(error).range.start,
    sourcePoint(source, source.indexOf("new Error")),
  );
});

test("generated literal failures map to their original text range", () => {
  const source = "first\nsecond\n{% return; %}";
  const error = caught(() =>
    Template.wrap(
      source,
      "literal.md.template",
    )({
      literal() {
        throw new Error("literal");
      },
    }),
  );
  const location = templateLocation(error);
  assert.equal(location.precision, "range");
  assert.equal(location.range.start.offset, 0);
  assert.equal(location.range.end.offset, source.indexOf("{%"));
});

test("same-name compilations have distinct provenance and maps", () => {
  const a = Template.wrap("{% throw new Error('a'); %}", "same.md.template");
  const b = Template.wrap("\n{% throw new Error('b'); %}", "same.md.template");
  assert.notEqual(
    Template.compilation(a).sourceMap.generated.source,
    Template.compilation(b).sourceMap.generated.source,
  );
  assert.equal(templateLocation(caught(() => a({}))).range.start.line, 1);
  assert.equal(templateLocation(caught(() => b({ literal() {} }))).range.start.line, 2);
});

test("native errors with causes map the thrown error rather than its cause", () => {
  const source = "{%\nconst cause = new Error('cause');\nthrow new Error('outer', {cause});\n%}";
  const error = caught(() => Template.wrap(source, "cause.md.template")({}));
  assert.equal(templateLocation(error).range.start.line, 3);
  assert.equal(error.cause.message, "outer");
  assert.equal(error.cause.cause.message, "cause");
});

test("nested template failures retain both origins and the native cause", () => {
  const inner = Template.wrap("{% throw new Error('inner'); %}", "inner.md.template");
  const outer = Template.wrap("{% io.inner(doc); %}", "outer.md.template");
  const error = caught(() => outer({}, {}, null, {}, { inner }));
  assert.equal(error.cause.message, "inner");
  assert.deepEqual(
    error.locations.filter((l) => l.role === "template").map((l) => l.source),
    ["inner.md.template", "outer.md.template"],
  );
});

test("an indented fenced template maps through extraction back to Markdown", () => {
  const markdown = "# Workflow\n\n  ```template\n  {%\n  const = 1;\n  %}\n  ```\n";
  const text = "{%\nconst = 1;\n%}\n";
  let offset = 0;
  const segments = text.split(/(?<=\n)/).map((line) => {
    const originalStart = markdown.indexOf(`  ${line}`, offset) + 2;
    const segment = {
      generatedStart: offset,
      generatedEnd: offset + line.length,
      originalStart,
      originalEnd: originalStart + line.length,
      kind: "exact",
    };
    offset += line.length;
    return segment;
  });
  const extraction = createSourceMap({
    generated: { source: "extracted.md.template", text },
    original: { source: "workflow.md", text: markdown },
    segments,
  });
  const compiled = Template.compile(text, { file: extraction.generated.source });
  const error = caught(() => Template.wrap(text, extraction.generated.source));
  const original = error.toDiagnostic();
  const diagnostic = mapDiagnostic(original, extraction);
  const location = diagnostic.locations.at(-1);
  assert.equal(location.source, "workflow.md");
  assert.deepEqual(location.range.start, sourcePoint(markdown, markdown.indexOf("=")));
  assert.equal(location.precision, "exact");
  assert.equal(original.locations.length, 2);
  const direct = composeSourceMaps(compiled.sourceMap, extraction);
  const generatedOffset = compiled.code.indexOf("=");
  assert.deepEqual(mapPosition(direct, generatedOffset).range.start, location.range.start);
});

test("validators, bindings and arbitrary runtime errors include processing locations", async () => {
  const document = "# hello\n";
  const templates = [
    "{% doc.heading(1).validate(() => false).as('title'); %}",
    "{% doc.heading(1).validate(() => {throw new Error('validator');}).as('title'); %}",
    "{% doc.heading(1).as('title'); doc.line().as('title'); %}",
    "{% doc.heading(1).as('title'); throw new Error('after heading'); %}",
  ];
  for (const source of templates) {
    const io = new Virtual({ "/input.md": document, "/schema.md.template": source });
    await assert.rejects(
      validate({ io, file: "/input.md", template: "/schema.md.template" }),
      (error) => {
        assert.equal(templateLocation(error).source, "/schema.md.template");
        const processing = error.locations.find((l) => l.relation === "processing");
        assert.equal(processing.source, "/input.md");
        if (source.includes("validate")) {
          assert.equal(processing.precision, "range");
          assert.equal(processing.range.start.offset, 0);
          assert.ok(processing.range.end.offset >= 7);
        } else {
          assert.ok(processing.range.start.offset >= 0);
        }
        return true;
      },
    );
  }
});

test("accumulated mismatches contain processing and template locations", async () => {
  const io = new Virtual({
    "/input.md": "not a heading\n",
    "/schema.md.template": "{% doc.heading(1).as('title'); %}",
  });
  const result = await validate({ io, file: "/input.md", template: "/schema.md.template" });
  assert.equal(result.ok, false);
  assert.equal(
    result.errors[0].locations.find((l) => l.relation === "processing").source,
    "/input.md",
  );
  assert.equal(templateLocation(result.errors[0]).source, "/schema.md.template");
});

test("BOM input, nested readers and query slices keep document offsets", async () => {
  const input = "\uFEFF# hello\nwrong\n";
  const io = new Virtual({
    "/input.md": input,
    "/schema.md.template":
      "{% doc.scope('item', child => child.heading(1).validate(() => false).as('title')); %}",
  });
  await assert.rejects(
    validate({ io, file: "/input.md", template: "/schema.md.template" }),
    (error) => {
      assert.equal(error.locations.find((l) => l.relation === "processing").range.start.offset, 1);
      return true;
    },
  );
  const source = "a\nb\n";
  const queryTemplate =
    "{% doc.query(d => {d.line().validate(v => {if (v === 'b') throw new Error('second'); return true;}).as('line'); d.literal('\\n');}); doc.rawRest(); %}";
  await assert.rejects(
    query({
      io: new Virtual({ "/input.md": source, "/query.md.template": queryTemplate }),
      file: "/input.md",
      template: "/query.md.template",
      all: true,
    }),
    (error) => {
      const processing = error.locations.find((l) => l.relation === "processing");
      assert.equal(processing.range.start.line, 2);
      assert.equal(processing.range.start.offset, 2);
      return true;
    },
  );
});

test("writer failures carry template origins without inventing input documents", async () => {
  const io = new Virtual({ "/schema.md.template": "{% throw new Error('writer'); %}" });
  await assert.rejects(
    create({ io, file: "/out.md", template: "/schema.md.template", data: {} }),
    (error) => {
      assert.equal(templateLocation(error).source, "/schema.md.template");
      assert.ok(error.locations.every((l) => l.relation === "origin"));
      return true;
    },
  );
});
