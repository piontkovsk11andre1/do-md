# Dependency and implementation decisions

## JavaScript parsing and stacks

Acorn locates syntax errors only after the engine rejects a template body. A
function wrapper reproduces parameter/return grammar, and its prefix is removed
before mapping. Native causes are preserved. `error-stack-parser` handles stack
syntax; the Node adapter then selects an exact generated identity and subtracts
V8's two Function-constructor wrapper lines. Runtime matrix tests cover this ABI.

## Source maps

The internal map records both exact copies and whole provenance ranges, with
explicit gaps. Source Map v3 encodes points and does not directly express the
precision/range contract needed for generated literal calls and processing data.
Consequently the map algorithms remain domain code. They use indexed sources,
binary segment lookup, immutable validated inputs and composition property tests.
Adding a v3 projection later would be an interoperability feature, not a reason
to discard the richer internal representation.

## Error rendering

Chalk owns ANSI styling; string-width owns terminal cell measurement and
Intl.Segmenter keeps graphemes intact. do-md owns the small layout policy because
its diagnostics may contain only one snippet, distinguish context from exact
positions, and carry several provenance frames. General code-frame libraries
normally expect a full source string and conventional point diagnostics. A new
renderer dependency should prove equivalence against these cases before replacing
the existing presentation tests. No renderer is used for JSON serialization.

## JSON, YAML, discovery and MCP

Zod defines external command and diagnostic schemas. YAML parsing/serialization
uses `yaml`; file discovery uses `glob`; CLI parsing uses `yargs`. MCP uses
the official SDK. Keep dependencies responsible for their own formats/protocols
instead of recreating them with local regexes or handwritten dispatch protocols.
Version changes are validated by behavior and packed installation, not by tests
that freeze the manifest's exact dependency list.

The 2.0 dependency review replaces fast-glob's vulnerable micromatch/picomatch
chain with glob. Discovery still returns sorted absolute files and does not
recursively follow directory symlinks. Audit results are checked against the
actual lockfile; a clean audit is not a substitute for behavioral tests.

## Markdown dialect

Reader/Markdown implements the block and inline constructs exposed by the language
reference: headings, paragraphs, lists and nested task items, tables, fenced and
indented code, quotes, links/images, HTML, and YAML frontmatter. Code-fence info
strings retain `language` and uninterpreted `meta`. Raw leaves preserve opaque text.

This is a template-oriented dialect, not a claim of full CommonMark conformance.
The parser is retained because precise source offsets and partial consumption are
part of the editing contract. Replacing it with a general Markdown AST library
requires conformance tests for those ranges and retained text, not merely similar
rendered HTML. Fixtures and executable examples describe the supported behavior.

## Toolchain and supported runtimes

2.0 targets maintained Node lines beginning with 22.13. ESLint 10 and Prettier
enforce source quality. TypeScript 7 is invoked through its stable CLI rather
than the experimental compiler JS API. fast-check supplies seeded properties;
benchmarks use Node's performance API without additional measurement frameworks.
