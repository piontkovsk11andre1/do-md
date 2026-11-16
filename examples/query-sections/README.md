# Repeated section queries

The document has three `## Target` sections with unrelated content between them.
The template marks one non-empty query region; query-all searches subsequent
suffixes and reports positions relative to the original document.

```sh
do-md query document.md query.md.template
do-md query document.md query.md.template --all
```

The first command returns one object with `start`, `end`, and
`context.content: "First target: prepare the release."`.

The second returns an array of three matches in document order. Their content is:

1. `First target: prepare the release.`
2. `Second target: verify the package.`
3. `Third target: publish the changelog.`

Each source range begins at its `## Target` heading and ends after its paragraph.
The Notes section is not selected. Neither command edits the source. This is a
query over the shown structure, not a general heading selector or regular-expression
search inside code blocks.

In the source checkout, use `node ../../bin/do-md.mjs` instead of `do-md`.
