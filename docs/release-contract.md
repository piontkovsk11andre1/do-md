# 2.0 release contract

The release preserves the template language and command model: a single template
drives Reader, Writer, validation, extraction and precise editing. Its public
contracts are exercised through the package root, declared subpaths, CLI and MCP.

## Invariants

- Source offsets are UTF-16 indices; ranges are half-open and bounded by a source.
- Source-map composition never increases precision or bridges an unmapped gap.
- A compiled template owns its generated identity, executable and source map.
- A failed optional attempt restores cursor, context, bindings and metadata.
- An iteration commits only after its required operations succeed.
- Editing preserves bytes outside the recorded replacement ranges.
- Mutations use revision checks and atomic replacement where the adapter supports them.
- Diagnostics preserve all mapped origins, distinguish processing context, and serialize uniformly across transports.
- External JSON is validated at a transport boundary, not repeatedly inside domain algorithms.

## Release gates

Run `npm run check`, then `npm run bench`. CI runs the behavioral and packed-install
tests on supported Linux Node versions and checks the Docker image. Windows is
explicitly deferred/manual. Generated reference and declarations
must be reproducible. The tarball must work outside this checkout, without dev
dependencies or private source imports. Review `CHANGELOG.md` and the migration
guide before publishing a release candidate. Publication is an explicit maintainer
operation; local checks do not publish, push or create tags.

Browser builds can be checked with `npm run browser:pack`. Real-engine verification
is deferred/manual and required before claiming a browser-verified release.

The rc.2 surface is fixed in [api-contract](api-contract.md). An approved clean
commit can be frozen with `npm run release:candidate`; it never mutates Git or publishes.
