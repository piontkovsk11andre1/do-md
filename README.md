# @p10i/do-md

Markdown template runtime and editing utilities. One template describes a
document's shape; the same template validates, extracts, generates, and
mutates it.

ESM only. Requires Node 20+. Core parsing, writing, templates, commands, and
slots use Node's standard library only.

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

## Library

```js
import {
    validate,
    create,
    exportDoc,
    set,
    render,
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
`create`, `set`, and `render`.

## Exit codes

| Code | Meaning                                  | Error `code`           |
|------|------------------------------------------|------------------------|
| `0`  | Success                                  | —                      |
| `1`  | User error (bad arguments, missing file) | `DO_MD_USER_ERROR`     |
| `2`  | Parse / validation error in the document | `DO_MD_PARSE_ERROR`    |
| `3`  | Template error (wrap or runtime)         | `DO_MD_TEMPLATE_ERROR` |
| `4`  | I/O error (permission denied, disk full) | `DO_MD_IO_ERROR`       |

## License

MIT
