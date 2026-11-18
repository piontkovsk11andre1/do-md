# Changelog

## 2.0.0-rc.3 — unreleased

- Add optional standard Streamable HTTP MCP at `/mcp` with `do-md serve --mcp`.
- Reuse one MCP tool/resource registration factory for stdio and HTTP transports.
- Share HTTP root scoping, worker concurrency, execution/input limits and shutdown.
- Retain per-client protocol sessions for cancellation, with bounded body readers,
  response sizes and session lifetime/admission.
- Validate browser Origins through the explicit `--mcp-origin` / `mcpAllowedOrigins` allowlist.
- Add SDK-client integration coverage for native tools/resources, writes, limits,
  cross-session cancellation, shared overload and session/worker shutdown.

## 2.0.0-rc.2

### Contract and runtime fixes

- Fresh-session reset/source replacement, canonical seek coordinates and lifecycle guards during reads.
- Shared cursor kernel without the Parser numeric-line / Reader line-leaf inheritance conflict.
- Stable plain error inspection; no import-time prototype patching.
- Strict checked JSDoc/generated declarations across compilation, Reader, Writer, Slot and all document commands.
- Pinned Docker base, packaged Skill files and a non-root image-verification stage.
- Invocation-owned build/test artifacts, bounded subprocesses and cancellation.
- Candidate API contract and clean-commit tarball/hash manifests.
- Windows and real-browser CI deliberately deferred to manual workflow inputs.

### Browser slice

- Portable `/browser` entry, Fetch/Virtual workflows, plain diagnostics and a playground.
- Packed-artifact graph checks and prepared Chromium/Firefox/WebKit scenarios.
- Optional `exportDoc.savePath` for read-only extraction.
- UTF-8 BOM preservation and byte-returning adapters without Buffer.

## 2.0.0-rc.1 — unpublished development checkpoint

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
