Chapters fixture from the nested-scope example in `design/current/03-template-language.md`.

Uses `scope` only. Root title is a byte-level `line()` after a `# ` literal. Each chapter binds `heading(2)` and `paragraph` on the child reader.

Scope body is JavaScript so literals run on the child cursor. Template-emitted `doc.literal` inside `{% %}` would touch the parent cursor.
