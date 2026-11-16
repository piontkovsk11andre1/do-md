# Markdown to JavaScript

Parse a table and generate a standalone JavaScript file using a different output
template:

```sh
do-md export document.md input.md.template --save context.json
do-md render document.md input.md.template report.js.template report.mjs
node report.mjs
```

`context.json` equals `expected.json`. `report.mjs` equals `expected.mjs`.
Node prints:

```json
{"title":"Work inventory","total":5}
```

do-md passes the parsed object to the output template in memory; render does not
read `context.json`. The export command only makes that intermediate object visible.
Literal output-template text becomes JavaScript source. Its `{% ... %}` blocks
insert JSON-encoded values; the document's strings are not pasted as executable
JavaScript expressions.

The output template deliberately uses `.js.template`: explicit template paths may
have any extension. `.md.template` is the Markdown-template convention and default
directory-discovery mask. The output filename is explicitly `report.mjs`.

**do-md generates code but never runs it.** `node report.mjs` is a separate, explicit
step. Templates themselves are trusted JavaScript, not a sandbox.

In the source checkout, use `node ../../bin/do-md.mjs` instead of `do-md`.
