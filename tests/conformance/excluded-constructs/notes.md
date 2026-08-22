Excluded v1 Markdown constructs from `design/current/04-markdown-ast.md`.

Not modeled as special AST node types:

- Reference-style links and link reference definitions
- Footnotes
- Definition lists
- Hard-break HTML entities (`&nbsp;`, and similar)
- Multi-line Setext bodies (only the last line becomes the heading)

These parse as ordinary `text` / `paragraph` / `heading` nodes. They are not rejected unless another documented leaf contract says so (for example a zero-header `table()`).
