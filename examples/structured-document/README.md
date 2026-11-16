# Structured document data

This example reads a project document containing YAML frontmatter, a GFM table, a
nested task list and a shell code fence.

```sh
do-md validate document.md template.md.template
do-md export document.md template.md.template --save context.json
```

`context.json` should equal `expected.json`. Inspect these actual value shapes:

- `metadata.data` contains the YAML object; retained raw YAML is also available.
- `settings.headers`, `settings.rows`, and `settings.align` describe the table.
  Cell values remain strings: `"2"` is not automatically converted to a number.
- `tasks.items[0].checked` is false. Its children preserve paragraph and nested
  list blocks; nested list items retain their own checkbox states.
- `command` has language `sh`, empty `meta`, and value `npm test`.

The template is strict about the shown sections. The code fence is data and is
**not executed**. do-md does not assign workflow meaning to checkbox items.

In the source checkout, use `node ../../bin/do-md.mjs` instead of `do-md`.
