# Contributing

Use Node.js 22.13 or newer and install with `npm ci`. Read
[architecture](docs/architecture.md) and [release contracts](docs/release-contract.md)
before changing parsing, rendering, source mapping or edits.

## Local workflow

```sh
npm run format
npm run lint
npm run types
npm run docs
npm run check
npm run bench
```

`npm run check` is read-only with respect to tracked artifacts. Generated
declarations and reference documentation are committed so the packed runtime
needs no build step. Golden documents and template fixtures are excluded from
automatic formatting; change their bytes only as part of an intentional behavior
change and explain why.

## Code review expectations

- Explain ownership, invariants and effects in class/method documentation.
- Comment why a non-obvious algorithm or state transition exists.
- Validate external data at its boundary, then use explicit internal contracts.
- Keep optional/repeat rollback behavior and exact editing spans covered.
- Add regression tests for observable behavior, not implementation spelling.
- Keep public exports explicit. Update migration notes for incompatible changes.
- Include benchmark comparisons when changing indexing or hot parsing paths.

For a bug report, provide Node/platform versions, a minimal document/template,
the command or API call, and actual/expected output. Existing examples are useful
starting points. New language features should update the authoritative registry
and include a runnable walkthrough or focused conformance fixture.

The project uses MIT licensing. Small, focused pull requests are easiest to review.
