# do-md

**One Markdown template for validation, extraction, generation, and precise editing.**

do-md combines literal Markdown with small JavaScript blocks. The same template
can read a document into data or write a document from that data. Editing uses
recorded source ranges to preserve unrelated text.

This checkout prepares **2.0.0-rc.3**. See the [changelog](CHANGELOG.md) and
[migration guide](docs/migration-2.md) for breaking changes.

## Install

Node integrations require **Node.js 22.13+**. The package is ESM-only; modern
browsers use `@p10i/do-md/browser` without Node polyfills.

```sh
npm install @p10i/do-md
# For the standalone CLI and MCP binaries:
npm install -g @p10i/do-md
```

## A template in a minute

Create `release.md.template`:

```text
# {% doc.line().as("version") %}

{% doc.list().as("changes") %}
```

It describes a document such as:

```markdown
# 2.0.0

- Preserve surrounding Markdown when editing.
- Report errors against the original template.
```

```sh
do-md validate release.md release.md.template
do-md export release.md release.md.template --save release.json
do-md set release.md release.md.template --key version --value '"2.0.1"'
do-md create generated.md release.md.template --data '{"version":"2.0.0","changes":["First release"]}'
```

Templates are trusted JavaScript. `{% ... %}` contains real JS; literal text is
matched by Reader and emitted by Writer. A leaf becomes data only when bound
with `.as()` or `.asArray()`. Unbound writer leaves emit nothing.

## Commands

```text
do-md validate <file> <template>
do-md create   <file> <template> --data <ctx.json> [--force]
do-md export   <file> <template> --save <ctx.json>
do-md set      <file> <template> [--key k --value v] [--patch <patch.json>]
do-md render   <file> <parse-template> <render-template> <out-file>
do-md match    <file> <templates> [--all]
do-md query    <file> <template> [--all]
do-md reference [topic] [--format json|markdown|text]
do-md skill
do-md help [command]
```

`help` explains command usage. `reference` is the template-language reference;
JSON is the default, matching MCP. `skill` prints the bundled English
[Agent Skill](skills/do-md/SKILL.md); it does not install it.

Template directory discovery selects `.md.template` files. Explicit template
paths can use another extension, including JavaScript output templates.
`--json` emits structured command results; successful output and errors use
stdout and stderr respectively. Exit codes are 0 for success, 1 for user errors,
2 for document mismatches, 3 for template errors, and 4 for I/O or write conflicts.

## JavaScript API

```js
import { NodeFilesystem, validate, exportDoc, set } from "@p10i/do-md";

const io = new NodeFilesystem();
const input = { io, file: "release.md", template: "release.md.template" };
const validation = await validate(input);
const parsed = await exportDoc(input);
await set({ ...input, key: "version", value: "2.0.1" });
```

Document mismatches return failed results. Template and I/O exceptions reject;
catch `DoMdError` to inspect `code`, `locations`, and `cause`. Its
`toDiagnostic()` returns transport-safe JSON. `String(error)`, `console.error(error)`
and CLI text share a code-frame formatter:

```text
release.md.template:4:7: Unexpected token

4 | const = 1;
  |       ^
```

The root also exports `Template`, `CompiledTemplate`, `Reader`, `Writer`, `Slot`,
`Parser`, `Editor`, `SourceText`, `SourceMap`, `Virtual`, `Fetch`, `DoMdError`,
diagnostic/source-map helpers, the language reference, and `readSkill()`.

Public integration entries are `@p10i/do-md/io`, `/http`, `/mcp`, and `/markdown`.
Private `sources/*` imports are not supported. ESM declarations accompany each
public entry. See the [API and ownership guide](docs/architecture.md).

## Editing guarantees

`Editor` replaces recorded spans, preserving bytes outside them: BOMs, line
endings, comments, whitespace and final-newline state. A changed structured
element can be normalized; for example, a changed table may be reserialized.

`Editor.open()` captures a content revision. `save()` rejects stale revisions
with `DO_MD_CONFLICT`; `force: true` is an explicit overwrite. The supplied
filesystem and in-memory adapters support snapshots and atomic writes.

## Browser slice

```js
import { Fetch, Virtual, Editor, exportDoc } from "@p10i/do-md/browser";

const result = await exportDoc({
  io: new Fetch(),
  cwd: "https://example.com/documents/",
  file: "release.md",
  template: "release.md.template",
});
```

Omitted `savePath` returns data without writing. Fetch and Virtual use the same
portable core as Node. `npm run browser:serve` starts the interactive example;
`browser:pack` checks a polyfill-free tarball build, and `test:browser` runs real
Chromium/Firefox/WebKit checks. Compilation needs CSP permission for `new Function()`.
See [browser documentation](docs/browser.md) for API and verification details.

## MCP and HTTP

Configure an MCP client to launch:

```sh
do-md-mcp --root /absolute/path/to/project
# Equivalent:
do-md mcp --root /absolute/path/to/project
```

Tools: `validate`, `export`, `create`, `set`, `render`, `match`, `query`,
`reference`, and `skill`. Resources include the language reference and
`do-md://skills/do-md`. JSON language entries match CLI `reference` output.

For remote execution:

```sh
do-md serve --root /workspace --host 127.0.0.1 --port 8080
do-md-mcp --url http://127.0.0.1:8080 --root /workspace/project
```

The MCP proxy uses server-side paths and does not fall back to local execution.
For clients that support native remote MCP, enable Streamable HTTP on the same
service and connect directly to `http://127.0.0.1:8080/mcp`:

```sh
do-md serve --root /workspace/project --port 8080 --mcp
```

This endpoint exposes the same nine tools and three resources as stdio MCP.
It shares the HTTP service's root, worker limits, cancellation and shutdown.
See [HTTP integration](docs/http-api.md) for endpoints, limits, cancellation and
write semantics. Templates execute trusted code; filesystem scoping is not a
JavaScript sandbox.

## Documentation

- [Template-language reference](docs/template-language.md)
- [Five executable walkthroughs](examples/README.md)
- [Diagnostics and source mapping](docs/diagnostics.md)
- [Browser entry and playground](docs/browser.md)
- [Architecture and ownership](docs/architecture.md)
- [Dependency decisions and Markdown dialect](docs/design-decisions.md)
- [Migration from 1.x](docs/migration-2.md)
- [Candidate API contract](docs/api-contract.md)
- [Contributing](CONTRIBUTING.md) · [Release procedure](docs/releasing.md)

## Development

```sh
npm ci
npm run check
npm run bench
```

Checks cover formatting, lint, generated declarations/reference, strict consumer
types, behavioral tests and isolated packed installs. Benchmarks report timings
without machine-dependent pass/fail thresholds. Linux CI exercises supported Node
release lines and the Docker runtime. Windows and real-browser jobs are manual
and deferred; they are not claimed as verified by local checks.

MIT licensed. Report reproducible issues through the
[issue tracker](https://github.com/piontkovsk11andre1/do-md/issues).
