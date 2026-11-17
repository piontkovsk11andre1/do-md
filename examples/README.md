# Examples

Run each example's commands from its directory with an installed `do-md`. In this
checkout, replace `do-md` with `node ../../bin/do-md.mjs`. Commands and expected
results are exercised by `tests/examples.test.mjs`.

| Example                                              | Purpose                                                              |
| ---------------------------------------------------- | -------------------------------------------------------------------- |
| [release-notes](release-notes/README.md)             | Validate, extract JSON, create and update a small document           |
| [query-sections](query-sections/README.md)           | Find the first or all repeated sections with source positions        |
| [structured-document](structured-document/README.md) | Read YAML, a table, nested checkboxes and a code fence               |
| [precise-editing](precise-editing/README.md)         | Change a checkbox and table cell without disturbing surrounding text |
| [markdown-to-js](markdown-to-js/README.md)           | Parse Markdown and use a different template to generate JavaScript   |

These are task-sized examples, not a complete syntax tour. The full method
reference is available through `do-md reference`, MCP `reference`, and
`docs/template-language.md`.

## Browser playground

[browser](browser/README.md) demonstrates Fetch loading, in-memory precise edits,
JSON generation, downloads and diagnostic frames. Run `npm run browser:serve`
from the repository root. Its separate real-engine suite is `npm run test:browser`;
the CLI walkthrough tests above do not substitute for that browser verification.
