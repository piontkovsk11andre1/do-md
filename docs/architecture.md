# Architecture and ownership

## Execution path

```text
Template source → TemplateCompiler → CompiledTemplate
                                         │ execute
                                    Reader / Writer
                                         │ bind
                                        Slot
                                         │
                             context / generated Markdown
                                         │
                               command result / Editor
```

The template language is synchronous JavaScript. Reader and Writer implement the
same leaf/binding vocabulary; they own different state. CLI, MCP and HTTP adapt
the same document commands, rather than implementing separate semantics.

## Domain objects

| Owner              | State and invariant                                                                                                                                            |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SourceText`       | Immutable text, source identity and a single line index. UTF-16 offsets roundtrip through one-based coordinates, including EOF.                                |
| `SourceMap`        | Immutable, validated segments between two SourceText instances. Exact spans preserve offsets; range spans preserve provenance without claiming point accuracy. |
| `Template`         | Author-supplied text and filename. It creates compilation objects.                                                                                             |
| `CompiledTemplate` | Generated code, source map, unique identity, lazy native function and reusable callable adapter.                                                               |
| `Parser`           | Input cursor, required/optional mode and accumulated mismatches.                                                                                               |
| `Reader`           | Parsed context, bindings, slot/region/query metadata and iteration policy.                                                                                     |
| `Writer`           | Input data, output chunks/nodes, binding registry and speculative output frames.                                                                               |
| `Slot`             | One leaf and its delayed transformations, committed eagerly by one binding.                                                                                    |
| `Editor`           | Original source/revision, parsed span metadata and requested replacements.                                                                                     |

Classes protect stateful invariants. Stateless operations such as command adapters
and diagnostic projection remain functions. Slot owners declare `mode: 'reader'`
or `'writer'`; data fields and optional methods are not used to guess their mode.

## Speculative state

Reader's IterationState records whether the first operation matched or missed,
and whether a first match should switch a probe to required mode. A first miss
is sticky. Cursor/context/metadata snapshots belong to Reader, not IterationState.
An explicit optional callback commits only if it bound data and has no required
error. A rejected attempt, or an exception, restores its snapshot. `repeat` also
restores the enclosing policy in `finally`. Repeating without consuming input is
a template error, not a valid infinite sequence of empty matches.

Writer uses OutputFrame transactions. Each attempt stages output chunks/nodes;
commit shifts staged region offsets into the parent output. Rollback restores
bindings, regions and enclosing optional counters, including on exceptions.
Nested optional commits contribute bindings to their parent frame. Scope children
share output storage but have independent data and binding registries.

## Diagnostics

`DoMdError` owns the error code, detached locations and ordinary JS cause.
`Diagnostics` owns location selection/context attachment. `StackTrace` isolates
Node/V8 stack parsing and Function-wrapper offsets. `DiagnosticFormat` owns
terminal display and is the only module needing color/layout libraries.

CompiledTemplate maps runtime frames and accumulated reader mismatches. External
applications append their own origin maps using `mapDiagnostic`. JSON transport
boundaries validate the wire schema with Zod. Presentation never reads files or
changes diagnostic data. See [the diagnostic contract](diagnostics.md).

## Editing and effects

Editing uses source ranges rather than rewriting an entire AST. Unchanged spans
retain their exact original bytes; changed structured values use Writer's
serializer. Filesystem adapters own revision checks and atomic replacement.
Commands validate their arguments, use an injected adapter, and return results;
transport modules own listeners, workers, cancellation and resource limits.
The CLI loads HTTP/MCP protocol stacks only when their command is selected;
ordinary document commands do not initialize the MCP SDK.

## Types and generated artifacts

SourceText, SourceMap and IterationState use checked JSDoc as their declaration
source of truth. `npm run types` emits their `.d.mts` files; `types:check` detects
drift without changing tracked files. Other modules retain reviewed declarations,
checked through the strict consumer fixture. This is an explicit incremental
migration: the entire older parser/writer is not yet under `checkJs`.

The language registry generates `docs/template-language.md`. Both generators have
read-only checks. The runtime stays unbundled ESM; consumers do not need a build
step or development dependencies. Contributor tooling does not enter the tarball.
