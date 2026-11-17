# Changelog

## 2.0.0-rc.1 — unreleased

### Breaking changes

- Require Node.js 22.13 or newer.
- Rename the library error to `DoMdError`; native JS SyntaxError remains available as a cause.
- Replace flat diagnostic coordinates with `{ code, message, locations }`.
- Replace unrestricted `sources/*` package imports with documented public entries.
- Require custom Slot owners to declare reader/writer `mode`.
- Reject Reader repeat/scope iterations that succeed without consuming input.
- Remove `help template`; use `reference` for language documentation.
- Discover directory templates by `.md.template` naming.

### Added

- Chained source maps, syntax/runtime locations, processing spans and code frames.
- Immutable SourceText/SourceMap and reusable CompiledTemplate domain objects.
- English Agent Skill, matching CLI/MCP references and executable examples.
- Generated checked-JSDoc declarations for the source-map and iteration core.
- Formatting/lint/type/reference release gates, seeded invariants and benchmarks.
- Explicit public integration entries and Linux/Windows runtime CI.

### Fixed

- Restore Reader optional/repeat state when callbacks throw.
- Roll back Writer binding registries and region metadata after rejected attempts.
- Count nested optional Writer bindings and preserve enclosing repeat state.

See [migration](docs/migration-2.md). This candidate has not been published by
the development workflow.
