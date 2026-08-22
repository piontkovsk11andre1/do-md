Structural full-re-render fallback from `chapters` + `set --patch` that adds a chapter.

Array-length and scope-cardinality changes do not splice. Formatting may canonicalize; the resulting structure and data must still parse.

Reuse the `chapters` template as-is.
