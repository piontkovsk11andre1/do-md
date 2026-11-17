# Diagnostics and source maps

## Diagnostic contract

Errors expose `toDiagnostic()`; failed command results contain the same JSON
objects in `errors`. CLI JSON, MCP, and HTTP preserve this structure:

```json
{
  "code": "DO_MD_TEMPLATE_ERROR",
  "message": "Unexpected token",
  "locations": [
    {
      "role": "template",
      "relation": "origin",
      "source": "/templates/action.md.template",
      "range": {
        "start": { "offset": 15, "line": 4, "column": 7 },
        "end": null
      },
      "precision": "exact",
      "snippet": "const = 1;"
    }
  ]
}
```

The example shows a template location. Real compiled-template failures also
include a `generated` location. Further mappings append their own locations.

- `role`: `generated`, `template`, or `document`.
- `relation`: `origin` for code provenance; `processing` for input data.
- `source`: a filename or source identifier; `null` when unknown.
- `range`: half-open `[start, end)`. `end: null` means a point without a known
  endpoint. Offsets are zero-based **UTF-16 code units**, matching JS strings.
  Lines and columns are one-based. Cursor-only locations may have `offset: null`.
- `precision`: `exact` for copied source, `range` for a corresponding span,
  or `context` for a processing cursor rather than an exact error position.
- `snippet`: the original source line (`""` for a known empty line), or `null`
  when unavailable or omitted.

No known position is represented by `locations: []`. Unmapped generated code
keeps its generated location without inventing an original position. Errors
keep their original exception in `cause`; `cause` and JS stacks are not part
of the serialized diagnostic contract.

**API change:** diagnostics now use `locations` exclusively. Top-level `file`,
`line`, `column`, and `snippet` fields have been removed. Consumers should read
locations directly or use `primaryLocation(diagnostic)`. It chooses the last
processing location, then the outermost non-generated origin, or returns `null`.

Text CLI output shows the primary location and related non-generated locations.
Use `--json` for the complete chain, including generated JavaScript. Service
`--no-snippets` removes snippets from **every** location while retaining ranges.

## Human-readable output

CLI text, `String(error)` and Node's `console.error(error)` use the same code-frame
formatter:

```text
schema.md.template:4:7: Unexpected token

4 | const = 1;
  |       ^
```

Exact points use `^`; ranges use `^~~~`. Multiline ranges show their first source
line and explicit endpoint. A reader cursor is marked `~ processing context`
instead of claiming an exact error position. Related template/document locations
get their own frames. Tabs expand to four-column stops; Unicode display widths
are accounted for. Long lines are cropped around the marker with ellipses.

The public formatter also accepts serialized diagnostics:

```js
import { formatDiagnostic } from '@p10i/do-md';

const plain = formatDiagnostic(diagnostic);
const detailed = formatDiagnostic(diagnostic, {
  colors: true,
  includeGenerated: true,
});
```

Plain output is the default. CLI colors require a color-capable stderr TTY and
respect `NO_COLOR` and `TERM=dumb`. Node inspection uses the inspector's `colors`
option. Generated locations are hidden by default; `includeGenerated: true`
includes their frames for debugging.

Formatting uses only the existing diagnostic: it does not read files or mutate
the error. Missing snippets still show location headers. Raw JS `error.stack`,
`error.cause`, and `toDiagnostic()` remain available; Node's
`inspect(error, { customInspect: false })` shows the standard error inspection.

## Template compilation

```js
import { Template } from '@p10i/do-md';

const { code, sourceMap } = Template.compile(templateText, {
  file: '/templates/action.md.template',
});
```

Each compilation has a unique generated source identifier. `Template.wrap()`
uses a unique `sourceURL`, retains the compilation in a WeakMap, and maps errors
automatically. `Template.compilation(fn)` returns that compilation, or `null`
for functions it does not own. Instance methods `compile()` and `wrap()` use
the instance's source and filename.

JS inside `{% … %}` maps character-for-character, including CRLF and Unicode.
Literal text becomes a generated `doc.literal(...)` call and maps to the whole
original text range. Trimmed block-boundary newlines, escaped delimiters and
template BOMs retain original offsets. `renderBlocks()` uses this same compiler.

Compilation failures are parsed with Acorn to locate the syntax error, using
the same function-body context as execution. Acorn runs only after the Function
constructor fails. Runtime frames are mapped through the same compilation map;
Node/V8's Function-constructor wrapper offset is accounted for. If an engine
failure cannot be localized, no exact template coordinate is fabricated.

Reader mismatches, binding failures and validator exceptions retain template
origins. A failed slot supplies its input-document range. An arbitrary JS error
between reader operations supplies the reader cursor with `precision: 'context'`.
Writer failures do not invent an input-document range. Nested templates keep
the origins of both the inner and outer executions.

## Mapping an extracted template back to Markdown

The application extracting a template owns the extraction map. This example
uses one contiguous slice; indentation removal requires a segment per copied
run, as demonstrated by the integration tests.

```js
import { Template, createSourceMap, mapDiagnostic } from '@p10i/do-md';

const markdown = '# Workflow\n\n```template\n{% const = 1; %}\n```\n';
const start = markdown.indexOf('{%');
const end = markdown.indexOf('\n```', start);
const templateText = markdown.slice(start, end);
const extractionMap = createSourceMap({
  generated: { source: 'extracted.md.template', text: templateText },
  original: { source: 'workflow.md', text: markdown },
  segments: [{
    generatedStart: 0,
    generatedEnd: templateText.length,
    originalStart: start,
    originalEnd: end,
    kind: 'exact',
  }],
});

try {
  Template.wrap(templateText, extractionMap.generated.source);
} catch (error) {
  const diagnostic = mapDiagnostic(error, extractionMap);
  // generated JS → extracted.md.template → workflow.md
  console.log(diagnostic.locations);
}
```

`mapDiagnostic()` accepts a diagnostic or an error exposing `toDiagnostic()`.
It returns a new diagnostic, preserving existing locations, mapping the latest
matching source, and appending one location. Unmapped positions remain unchanged.
Repeated application of the same map does not duplicate a location. Mapping
also preserves the `origin`/`processing` relation and does not increase precision.

To propagate a mapped error through another JavaScript boundary, wrap the new
diagnostic and preserve the caught error as its cause:

```js
import { SyntaxError, mapDiagnostic } from '@p10i/do-md';

// Inside the caller's catch block:
throw new SyntaxError(mapDiagnostic(error, extractionMap), { cause: error });
```

The next layer can apply its own map in the same way. Serialized command results
can instead map their `errors` array directly, without creating JS Error objects.

## Source-map API

`createSourceMap({ generated, original, segments })` validates and copies a map.
Each source is `{ source: string, text: string }`; each segment is:

```js
{
  generatedStart: 0, generatedEnd: 10,
  originalStart: 20, originalEnd: 30,
  kind: 'exact',
}
```

Segments must be ordered, non-overlapping and in bounds. `exact` segments have
equal generated/original lengths. `range` segments map any generated position
in the segment to its complete original range. Gaps represent unmapped code.

- `mapPosition(map, offset)` returns a location, or `null`.
- `mapRange(map, { start, end })` maps an entire span, or returns `null` when
  it crosses an unmapped or non-monotonic region. Removed intervening text
  broadens precision to `range`.
- `composeSourceMaps(inner, outer)` maps `inner.generated` to `outer.original`.
  Intermediate source identifiers **and text** must match. Exact segments are
  split at outer boundaries; gaps and range precision are preserved.
- `sourcePoint(text, offset)` converts a UTF-16 offset to a source point.
- `sourceOffset(text, { line, column })` returns the offset, or `null` for an
  invalid coordinate. Both helpers recognize LF, CRLF and CR.

Maps retain source text for coordinate and snippet resolution. They are ordinary
server/application objects, not part of serialized command errors. The mapping
helpers do not execute code or read files.
