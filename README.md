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
```

### Template

Create `release.tpl.md`:

```
# {% doc.line().as("version") %}

Released on {% doc.until(".").as("date") %}.

## Changes

{% doc.list().as("changes") %}
```

### Validate

```
$ do-md validate release.md release.tpl.md
$ echo $?
0
```

A mismatch prints `<file>:<line>:<column>: <message>` and exits `2`.
`validate` does not modify any file.

### Export

```
$ do-md export release.md release.tpl.md --save release.json
```

Writes pretty-printed captured context JSON. Overwrites an existing save path.

### Create

```
$ do-md create release-2.md release.tpl.md --data release.json
```

Writes Markdown from JSON. Never reads the target file. Exits `1` if the
target exists unless `--force` is given.

### Set

```
$ do-md set release.md release.tpl.md --key version --value 2.0.0
```

Rewrites only mutated slots. Same-type scalar replacements leave the rest of
the file byte-identical.

### Render

```
$ do-md render release.md release.tpl.md other.tpl.md out.txt
```

Parses with the first template and writes through the second. Never modifies
the input. Neither template nor output path is inferred.

### Match

```
$ do-md match release.md "templates/**/*.tpl.md"
```

Finds templates that parse and fully consume the input. `<templates>` may be a
single template, a directory, or a glob. Directories recursively search
`*.tpl.md`. Candidates are sorted; the first matching path is printed by
default and `--all` prints every match. Invalid candidates are skipped. No
match exits `2`.

## Library

```js
import {
    validate,
    create,
    exportDoc,
    set,
    render,
    match,
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

## MCP

The bundled MCP server uses the official Model Context Protocol SDK over local
stdio. Your agent launches it as a child process; it does not open a network
port or run as a background daemon.

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

`--root` is required and must exist. Tools are `validate`, `export`,
`create`, `set`, `render`, and `match`.

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
