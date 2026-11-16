# Release notes: the basic round trip

`document.md` is the source, `template.md.template` describes its structure, and
`data.json` is the expected parsed context. Literal headings and punctuation must
match; bound fields become JSON values. Modifiers trim fields and reject empty ones.

Run from this directory:

```sh
do-md validate document.md template.md.template
do-md export document.md template.md.template --save context.json
do-md create roundtrip.md template.md.template --data context.json --force
do-md set roundtrip.md template.md.template --key version --value 2.0.0 --out next-release.md
```

`context.json` equals `data.json`. `roundtrip.md` equals the original document.
`next-release.md` has `# 2.0.0`; the date and changes remain unchanged. The source
`document.md` is never modified by these commands. `--force` allows repeating the
create command for this generated output.

In the source checkout, use `node ../../bin/do-md.mjs` instead of `do-md`.
