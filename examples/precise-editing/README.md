# Precise edits

Change a checkbox and a table cell without rewriting the surrounding document:

```sh
do-md set document.md template.md.template --key 'tasks.items[0].checked' --value true --out checked.md
do-md set checked.md template.md.template --key 'settings.rows[0][1]' --value production --out updated.md
```

`checked.md` equals `expected.checked.md`: only the first `[ ]` becomes `[x]`.
`updated.md` equals `expected.updated.md`: the target cell is `production`, with
the existing checkbox change retained. The original `document.md` stays unchanged.

`rawUntilElement` keeps preamble content opaque while finding the list. Bound
`listTree` checkboxes have exact source spans. The table is a separate bound
region; changing it may normalize table formatting, but does not reformat prose.
The preamble's double space and the entire footer survive both edits.

For application-level read/modify/save workflows, the library's `Editor` also
tracks revisions and rejects conflicting writes. These commands demonstrate
content preservation, not a transaction spanning two separate CLI invocations.

In the source checkout, use `node ../../bin/do-md.mjs` instead of `do-md`.
