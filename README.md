# @p10i/do-md

Markdown template runtime and editing utilities. One template describes a
document's shape; the same template validates, extracts, generates, and
mutates it.

ESM only. Requires Node 20+.

## Install

```
npm install -g @p10i/do-md
```

This package ships two binaries: `do-md` (CLI) and `do-md-mcp` (MCP server).

## Commands

```
do-md validate <file> <template>
do-md create   <file> <template> --data <ctx.json> [--force]
do-md export   <file> <template> --save <ctx.json>
do-md set      <file> <template> [--key k --value v] [--patch <patch.json>] [--out <file>]
do-md render   <file> <parse-template> <render-template> <out-file>
do-md match    <file> <templates> [--all]
do-md query    <file> <template> [--all]
do-md serve    --root <dir> [--host 127.0.0.1] [--port 8080]
```

Use `do-md <command> --help` for command details. The complete template
reference is shipped in [`docs/template-language.md`](docs/template-language.md)
and is also available without filesystem access:

```
do-md help template
do-md help template query
do-md help template --format markdown
do-md help template --format json
```

MCP clients can read `do-md://reference/template-language` or
`do-md://reference/template-language.json`, or call the `reference` tool.
Maintained templates and documents are in [`examples/`](examples/).

### Template

Templates use the `.md.template` naming convention. Explicit template paths may
have any extension; directory discovery uses `*.md.template`.

Create `release.md.template`:

```
# {% doc.line().as("version") %}

Released on {% doc.until(".").as("date") %}.

## Changes

{% doc.list().as("changes") %}
```

### Validate

```
$ do-md validate release.md release.md.template
$ echo $?
0
```

A mismatch prints `<file>:<line>:<column>: <message>` and exits `2`.
`validate` does not modify any file.

### Export

```
$ do-md export release.md release.md.template --save release.json
```

Writes pretty-printed captured context JSON. Overwrites an existing save path.

### Create

```
$ do-md create release-2.md release.md.template --data release.json
```

Writes Markdown from JSON. Never reads the target file. Exits `1` if the
target exists unless `--force` is given.

### Set

```
$ do-md set release.md release.md.template --key version --value 2.0.0
```

Rewrites only mutated slots. Same-type scalar replacements leave the rest of
the file byte-identical.

### Render

```
$ do-md render release.md release.md.template other.md.template out.txt
```

Parses with the first template and writes through the second. Never modifies
the input. Neither template nor output path is inferred.

### Match

```
$ do-md match release.md "templates/**/*.md.template"
```

Finds templates that parse and fully consume the input. `<templates>` may be a
single template, a directory, or a glob. Directories recursively search
`*.md.template`. Candidates are sorted; the first matching path is printed by
default and `--all` prints every match. Invalid candidates are skipped. No
match exits `2`.

### Query

```
$ do-md query document.md query.md.template --all
```

Query templates consume the complete source slice while marking exactly one
result region with `doc.query()`. Raw operations can ignore content around the
region:

```md
{%
doc.rawUntil("## Target")
doc.query((match) => {
  match.literal("## Target\n\n")
  match.paragraph().as("content")
})
doc.rawRest()
%}
```

The first non-overlapping occurrence is returned by default. `--all` resumes
at the previous region's end and returns every occurrence. Each result includes
its document-relative `start`, `end`, and captured `context`. No match exits
`2`.

## Library

```js
import {
    validate,
    create,
    exportDoc,
    set,
    render,
    match,
    query,
    Template,
    Reader,
    Writer,
    Parser,
    Slot,
    Editor,
    SyntaxError,
    NodeFilesystem,
    Virtual,
    Fetch,
} from "@p10i/do-md"
```

`exportDoc` is the library name for `do-md export`. Concrete modules are also
reachable as `@p10i/do-md/sources/Reader.mjs` (and the other top-level
`sources/*.mjs` files) for tree-shaking.

### Structured Markdown

Templates can capture nested lists without flattening their block structure:

```md
{% doc.listTree().as("tasks") %}
```

The value contains `ordered`, `start`, `tight`, and `items`. Each item contains
its `checked` state and Markdown AST `children`, including nested lists. The
existing `doc.list()` remains available for flat `string[]` values.

YAML frontmatter can be captured and validated with any schema exposing a
`safeParse(value)` method, including Zod schemas:

```md
{% doc.frontmatter({ schema: options.frontmatterSchema }).as("metadata") %}
```

Frontmatter is recognized only at the start of a document. Unchanged raw YAML
is retained; changed structured data is serialized as YAML.

Opaque source regions are available when a template must preserve syntax that
do-md should not parse:

```md
{% doc.rawUntil("## Generated").as("preamble") %}## Generated

{% doc.rawBlock().as("customBlock") %}
{% doc.rawRest().as("trailing") %}
```

Raw values are emitted without Markdown normalization. Successful command
parses must consume the complete document; non-whitespace trailing content is
reported as a parse error.

To skip arbitrary content before each top-level list, use
`doc.rawUntilElement("list")` followed by `doc.listTree()`:

```md
{%
doc.repeat((item) => {
  item.rawUntilElement("list")
  item.listTree().asArray("lists")
})
doc.rawRest()
%}
```

Only `"list"` is supported. Lists inside fences, quotes, frontmatter, or other
lists are not treated as top-level matches. The capture can be an empty string
when the cursor is already at a list. A miss lets `repeat()` stop cleanly; an
unbound writer call emits nothing, while a bound raw capture is emitted exactly.

### Code Fence Metadata

`doc.codeBlock()` returns `{ language, meta, value }`. For a fence opened with
`js module id=example`, `language` is `"js"` and `meta` is the opaque string
`"module id=example"`; do-md does not interpret its tokens. Language-only,
unlabelled, and indented blocks have `meta: ""`.

Writers and edits accept values without `meta` for compatibility. When present,
`meta` must be a string, and it is emitted after the language with a separating
space. If the language is empty or null, metadata is not emitted. Parsed values
and code-block AST nodes now include the additional `meta` property, so update
strict object comparisons, schemas, and TypeScript object literals accordingly.

### Safe Editing

`Editor` retains BOMs, line endings, whitespace, and final-newline state.
Scalar edits and structural edits to lists, tables, and template scopes replace
only their recorded source spans. Opaque content outside those spans remains
unchanged.

Writes use atomic replacement when the I/O adapter supports it. `Editor.open()`
captures a content revision and `save()` rejects concurrent changes with
`DO_MD_CONFLICT`; use `save({ force: true })` only for an intentional overwrite.
The built-in `NodeFilesystem` and `Virtual` adapters implement snapshot and
atomic-write APIs:

```js
const { content, revision } = await io.readFileSnapshotAsync(path)
await io.writeFileAtomicAsync(path, nextContent, {
    expectedRevision: revision,
})
```

The package includes strict ESM TypeScript declarations for the root API and
all exported `sources/*.mjs` subpaths.

Agents and applications can inspect the same reference programmatically:

```js
import {
  templateLanguage,
  describeTemplateFunction,
  renderTemplateReference,
} from "@p10i/do-md"
```

## MCP

The bundled MCP server uses the official Model Context Protocol SDK over
stdio. Your agent launches it as a child process. By default it executes
commands locally; it can also dispatch them to a running HTTP execution service.

Configure an MCP-capable agent with the equivalent of:

```json
{
  "mcpServers": {
    "do-md": {
      "command": "do-md-mcp",
      "args": ["--root", "/absolute/path/to/project"]
    }
  }
}
```

The server can also be started directly from either binary:

```
do-md-mcp --root <dir> [--max-input-bytes <n>] [--timeout-ms <n>] [--no-snippets]
do-md mcp --root <dir> [--max-input-bytes <n>] [--timeout-ms <n>] [--no-snippets]
```

For remote execution, add host/port or a full HTTP(S) URL:

```sh
do-md-mcp --host do-md --port 8080 --root /workspace/project
do-md mcp --url https://tools.example.com/do-md/ --root /workspace/project
```

The agent still speaks MCP over stdio; the proxy sends JSON command requests
over HTTP. In remote mode, `--root` is a directory on the **server**, and no
client-side copy of the files is required. Use relative paths in tool arguments.
Remote failures never fall back to local execution. Template-language resources
are fetched from the remote service so they describe the executing version.

`--root` is required and must exist locally in local mode or on the server in
remote mode. Tools are `validate`, `export`,
`create`, `set`, `render`, `match`, `query`, and `reference`. The server also
publishes Markdown and JSON template-language resources at the URIs above.

### HTTP Execution Service

```sh
do-md serve --root /workspace --host 0.0.0.0 --port 8080
```

The listener defaults to `127.0.0.1:8080`. The web API supports the same seven
document commands as the CLI, plus `reference`. All document, template, and
output paths refer to the service's filesystem and stay inside the selected
directory under its configured root.

```sh
curl http://127.0.0.1:8080/v1/commands/export \
  -H 'Content-Type: application/json' \
  -d '{"directory":"project","params":{"file":"notes.md","template":"notes.md.template"}}'
```

For shared host/container files, bind-mount the project into the service and
configure MCP's remote root using that container path. The package includes a
`Dockerfile` and `compose.example.yaml`; see [HTTP API and Docker usage](docs/http-api.md)
for routes, options, limits, lifecycle, and the shared-filesystem contract.

The import-safe server facade is also available to applications:

```js
import { createServer } from "@p10i/do-md/sources/HttpServer.mjs"

const server = createServer({ root: "/workspace", port: 8080 })
await server.start()
// On application shutdown:
await server.close()
```

## Exit codes

| Code | Meaning                                  | Error `code`           |
|------|------------------------------------------|------------------------|
| `0`  | Success                                  | —                      |
| `1`  | User error (bad arguments, missing file) | `DO_MD_USER_ERROR`     |
| `2`  | Parse / validation error in the document | `DO_MD_PARSE_ERROR`    |
| `3`  | Template error (wrap or runtime)         | `DO_MD_TEMPLATE_ERROR` |
| `4`  | I/O error or concurrent-write conflict  | `DO_MD_IO_ERROR`, `DO_MD_CONFLICT` |

## License

MIT
