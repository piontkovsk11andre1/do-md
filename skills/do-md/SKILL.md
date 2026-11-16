---
name: do-md
description: Create, validate, query, transform, and precisely edit Markdown documents using do-md templates. Use when extracting structured data from Markdown, maintaining reusable document formats, updating checkboxes or tables, or generating another file from parsed Markdown.
license: MIT
compatibility: Requires Node.js 20 or newer and the @p10i/do-md package, or a configured do-md MCP server.
---

# do-md

Use do-md to describe a document's structure with a template, inspect its parsed
data, and then query, edit, or transform it. Markdown documents are data. Templates
contain trusted JavaScript and are not sandboxed.

## Discover the installed interface

- CLI: `do-md --help`, `do-md reference`, and `do-md reference listTree`.
- MCP: inspect tool definitions and call `reference` with an optional `topic`.
- The reference is also available as `do-md://reference/template-language` and
  `do-md://reference/template-language.json` MCP resources.
- Read the installed reference rather than guessing method names or value shapes.
  CLI reference defaults to JSON; use `--format markdown` or `--format text` for reading.

When using MCP, paths are relative to the configured root. In remote mode, that
root and the files are on the execution server, not necessarily on your machine.
Use the reference supplied by that server. Do not switch to local writes after a
remote error.

## Recommended workflow

1. Inspect the source documents before creating or changing a template. Identify
   stable structure and content that must remain opaque.
2. Look for an existing template. `do-md match document.md templates --all` searches
   the directory for `*.md.template`; an explicit glob can select other filenames.
3. Choose the command for the actual task:
   - `validate`: check a whole document against a template, without writing.
   - `export`: extract the parsed context. CLI needs `--save`; MCP can return it inline.
   - `query`: locate one or all occurrences with original-document offsets.
   - `set` or library `Editor`: change selected data while retaining unrelated bytes.
   - `create`: write a document from a template and JSON data.
   - `render`: read with one template and generate output with another.
4. Write the smallest template that expresses the observed structure. Keep literal
   headings and delimiters explicit. Use `.md.template` for Markdown templates.
5. Validate, then export and inspect the actual JSON before building consumers or
   selecting mutation paths. Do not assume nested-list or table layouts.
6. Resolve diagnostics and repeat validation. A failed parse is not an empty result.
   Use CLI `--json` or MCP error fields for structured diagnostics.
7. For edits, prefer `--out` when first checking the result. Compare output with the
   source, then intentionally save to the desired destination. Revalidate and check
   that unrelated content is preserved.
8. Report the operation, output files, and checks actually performed.

## Template rules that matter

`{% ... %}` blocks are JavaScript, not expression interpolation. Surrounding text
is matched by Reader or emitted literally by Writer. To insert generated source,
call a Writer method such as `doc.writeRaw(...)` inside a block.

- Bind values with `.as("key")` or `.asArray("key")`. An unbound slot is discarded;
  modifiers such as `.validate(...)` take effect when binding.
- Account for whitespace between block reads. Use literal separators or
  `allowNewlinesAndWhitespaces()` deliberately.
- A full parse must consume non-whitespace input. Use `rawRest()` only for content
  intentionally outside the semantic contract, not to conceal malformed sections.
- `list()` returns flat strings; `listTree()` preserves nested blocks and checkbox
  state. A non-checkbox entry has `checked: null`, not false.
- `table()` returns headers, rows, and align. Cells are strings; convert types explicitly.
- `codeBlock()` returns language, meta, and value. Meta is the remaining fence info
  string; do-md does not interpret `module`, `id=`, or other application markers.
- `frontmatter()` exposes structured YAML under `data` and retains raw content.
- `query()` marks exactly one non-empty region; `--all` repeats the search.
- After optional/repeated parsing, use the Reader's current `doc.context` when
  accessing accumulated bindings rather than retaining a stale context reference.

## Editing and generation

Prefer bound slots and Editor/set over whole-file string replacement. Inspect
exported data before using paths such as `tasks.items[0].checked` or
`settings.rows[0][1]`. A structural table edit may normalize that table's formatting;
do not promise preservation inside a regenerated region. Editor revision checks
reject conflicting saves; do not bypass them with force without an explicit reason.

Do not overwrite an existing destination with `create --force` unless intended.
Generated output can be Markdown, JavaScript, or other text. Encode data inserted
into JavaScript with `JSON.stringify` rather than pasting document strings as code.
`render` generates a file but never executes it. Running generated code is a
separate action, not evidence that parsing or validation succeeded.

## Examples

The package ships [five tested walkthroughs](../../examples/README.md): release
notes, repeated section queries, structured document parsing, precise editing, and
Markdown-to-JavaScript generation. Read the relevant example's README, input,
template, and expected output rather than copying an unrelated large template.

For the authoritative method reference use `do-md reference` or MCP `reference`;
this skill describes the workflow, not a separate version of the language.
