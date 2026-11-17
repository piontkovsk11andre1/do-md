import test from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";
import { DiagnosticSchema } from "../sources/Service/Definitions.mjs";
import {
  SourceText,
  SourceMap,
  Template,
  Reader,
  Writer,
  Editor,
  Virtual,
} from "../sources/index.mjs";

const textArbitrary = fc
  .array(fc.constantFrom("a", " ", "\t", "\n", "\r", "\r\n", "😀", "界", "e\u0301"), {
    maxLength: 80,
  })
  .map((parts) => parts.join(""));
const properties = { seed: 20261117, numRuns: 250 };

test("wire diagnostics accept domain locations and reject invalid range endpoints", () => {
  const diagnostic = {
    code: "DO_MD_PARSE_ERROR",
    message: "bad",
    locations: [new SourceText("value", "input.md").location(0, 5)],
  };
  assert.equal(DiagnosticSchema.safeParse(diagnostic).success, true);
  diagnostic.locations[0].range.start.offset = null;
  assert.equal(DiagnosticSchema.safeParse(diagnostic).success, true);
  diagnostic.locations[0].range.end.offset = null;
  assert.equal(DiagnosticSchema.safeParse(diagnostic).success, false);
});

test("every valid UTF-16 offset roundtrips through source coordinates", () => {
  fc.assert(
    fc.property(textArbitrary, (text) => {
      const source = new SourceText(text, "input.md");
      for (let offset = 0; offset <= text.length; offset++) {
        const point = source.pointAt(offset);
        assert.equal(source.offsetAt(point.line, point.column), offset);
      }
    }),
    properties,
  );
});

test("composed exact maps agree with sequential mappings at every boundary", () => {
  fc.assert(
    fc.property(
      fc.string({ minLength: 1, maxLength: 80 }),
      fc.nat(50),
      fc.nat(50),
      (text, first, second) => {
        const middle = "-".repeat(first) + text;
        const outerText = "_".repeat(second) + middle;
        const inner = new SourceMap({
          generated: { source: "js", text },
          original: { source: "template", text: middle },
          segments: [
            {
              generatedStart: 0,
              generatedEnd: text.length,
              originalStart: first,
              originalEnd: first + text.length,
              kind: "exact",
            },
          ],
        });
        const outer = new SourceMap({
          generated: inner.original,
          original: { source: "document", text: outerText },
          segments: [
            {
              generatedStart: 0,
              generatedEnd: middle.length,
              originalStart: second,
              originalEnd: second + middle.length,
              kind: "exact",
            },
          ],
        });
        const composed = inner.compose(outer);
        for (let offset = 0; offset <= text.length; offset++) {
          assert.deepEqual(composed.mapPosition(offset), outer.mapPosition(first + offset));
        }
        assert.throws(() => {
          composed.segments[0].originalStart = 99;
        }, TypeError);
      },
    ),
    properties,
  );
});

test("heading edits preserve all untouched source bytes across line endings", async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.constantFrom("\n", "\r\n", "\r"),
      fc.string({ maxLength: 100 }),
      async (eol, raw) => {
        const suffix = `<!-- opaque -->${eol}${raw}${eol}`;
        const io = new Virtual({
          "/doc.md": `# Old${eol}${suffix}`,
          "/shape.md.template": '# {% doc.line().as("title") %}\n{% doc.rawRest(); %}',
        });
        const editor = await Editor.open({ io, file: "/doc.md", template: "/shape.md.template" });
        editor.set("title", "New");
        assert.equal(editor.render(), `# New${eol}${suffix}`);
      },
    ),
    properties,
  );
});

test("composition preserves arbitrary gaps in either map", () => {
  fc.assert(
    fc.property(
      fc.array(fc.tuple(fc.boolean(), fc.boolean()), { minLength: 1, maxLength: 30 }),
      (coverage) => {
        const text = "x".repeat(coverage.length);
        const inner = new SourceMap({
          generated: { source: "js", text },
          original: { source: "template", text },
          segments: coverage.flatMap(([present], index) =>
            present
              ? [
                  {
                    generatedStart: index,
                    generatedEnd: index + 1,
                    originalStart: index,
                    originalEnd: index + 1,
                    kind: "exact",
                  },
                ]
              : [],
          ),
        });
        const outer = new SourceMap({
          generated: inner.original,
          original: { source: "document", text: " x".repeat(coverage.length) },
          segments: coverage.flatMap(([, present], index) =>
            present
              ? [
                  {
                    generatedStart: index,
                    generatedEnd: index + 1,
                    originalStart: index * 2 + 1,
                    originalEnd: index * 2 + 2,
                    kind: "exact",
                  },
                ]
              : [],
          ),
        });
        const composed = inner.compose(outer);
        for (let offset = 0; offset <= text.length; offset++) {
          const middle = inner.mapPosition(offset);
          assert.deepEqual(
            composed.mapPosition(offset),
            middle ? outer.mapPosition(middle.range.start.offset) : null,
          );
        }
        if (coverage.some(([a, b]) => !a || !b)) {
          assert.equal(composed.mapRange({ start: 0, end: text.length }), null);
        }
      },
    ),
    properties,
  );
});

test("Reader optional exceptions restore context, bindings, cursor and mode", () => {
  const reader = new Reader("one\ntwo");
  assert.throws(
    () =>
      reader.optional((doc) => {
        doc.line().as("value");
        throw new Error("abort");
      }),
    /abort/,
  );
  assert.equal(reader.offset, 0);
  assert.equal(reader.optionalMode, false);
  assert.deepEqual(reader.context, {});
  assert.equal(reader.bindings.size, 0);
  reader.line().as("value");
  assert.equal(reader.context.value, "one");
});

test("Writer optional rollback restores bindings and nested optional commits count", () => {
  const writer = new Writer({ value: "ok" });
  assert.equal(
    writer.optional((doc) => doc.line().as("missing")),
    false,
  );
  writer.line().as("missing");
  assert.equal(
    writer.optional((outer) => outer.optional((inner) => inner.line().as("value"))),
    true,
  );
  assert.equal(writer.toMarkdown(), "ok");
});

test("Writer rejected repeat attempts do not leak output or scalar bindings", () => {
  const writer = new Writer({ values: ["one"] });
  writer.repeat((doc, index) => {
    doc.line().asArray("values");
    if (index === 1) {
      doc.line().as("absent");
    }
  });
  writer.line().as("absent");
  assert.equal(writer.toMarkdown(), "one");
});

test("CompiledTemplate owns reusable execution and immutable source maps", () => {
  const compiled = Template.compile('{% doc.line().as("title"); %}', { file: "shape.md.template" });
  const reader = new Reader("value");
  compiled.execute(reader, reader.context, null);
  assert.equal(reader.context.title, "value");
  assert.equal(Template.compilation(compiled.toFunction()), compiled);
  assert.equal(compiled.toFunction(), compiled.toFunction());
  assert.throws(() => {
    compiled.sourceMap.segments.push({});
  }, TypeError);
});

test("changing a parser source refreshes its coordinate index and forks share it", () => {
  const reader = new Reader("old", { file: "input.md" });
  reader.source = "new\nvalue";
  reader.reset();
  reader.literal("new\n");
  reader.literal("missing");
  assert.equal(reader.errors[0].locations[0].snippet, "value");
  assert.equal(reader.errors[0].locations[0].range.start.line, 2);
  assert.equal(reader.fork().sourceText, reader.sourceText);
});
