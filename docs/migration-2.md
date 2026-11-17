# Migrating to do-md 2

The template vocabulary and command shape remain familiar. Upgrade the runtime
to Node 22.13+ and update the following integration contracts.

## Errors and diagnostics

Import `DoMdError` instead of the library's former `SyntaxError`. This distinguishes
document/template/I/O errors from native JavaScript syntax exceptions in `cause`.

```js
import { DoMdError, primaryLocation } from "@p10i/do-md";

try {
  // Invoke a command or compiled template.
} catch (error) {
  if (!(error instanceof DoMdError)) throw error;
  const location = primaryLocation(error);
  console.error(error);
  // location?.source; location?.range.start.line; location?.range.start.column
}
```

Wire errors are `{ code, message, locations }`. Read coordinates/snippets from a
location, not top-level `file/line/column/snippet`. A missing location is an empty
chain. A known empty source line is `snippet: ''`; an omitted snippet is `null`.
JSON transport remains plain data. See [diagnostics](diagnostics.md).

## Imports

Use the package root for document classes and commands. Integration subpaths are
`/io`, `/http`, `/mcp` and `/markdown`. For example:

```js
import { Reader, Template, SourceText, SourceMap } from "@p10i/do-md";
import { IO, NodeFilesystem } from "@p10i/do-md/io";
import { createServer, Client } from "@p10i/do-md/http";
```

Imports through `@p10i/do-md/sources/...` now fail explicitly. They were exposing
implementation modules as accidental API. No compatibility wildcard is retained.

## Compilation and maps

`Template.compile()` returns a CompiledTemplate with `code`, `sourceMap`,
`execute()` and `toFunction()`. `Template.wrap()` still returns the five-argument
callable. `Template.compilation(fn)` returns its owning compilation.

Maps are immutable SourceMap instances. `createSourceMap()` and functional mapping
helpers remain supported conveniences. Build a new map rather than mutating its
segments. Reuse SourceText when resolving multiple coordinates in the same text.

## Template and binding conventions

- Directory discovery uses `.md.template`; explicit output-template paths may have another extension.
- `do-md reference [topic]` replaces `help template`; reference JSON entries match MCP.
- Optional and repeat attempts roll back on exceptions as well as normal rejection.
- Reader loops must consume input when successful; empty successful iterations are errors.
- Custom Slot owners must declare `mode: 'reader'` or `'writer'`. Built-in owners provide it automatically.

See the changelog for the complete candidate changes. Review strict comparisons
of parsed code blocks: their value includes `language`, `meta` and `value`.
