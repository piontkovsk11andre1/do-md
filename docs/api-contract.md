# Public contract — 2.0.0-rc.2

This candidate's supported surface is fixed here. Incompatible changes after a
candidate is frozen require a new candidate number and migration notes. Public
entry exports, generated declarations and executable compatibility tests are the
reviewed contract. Underscore/internal helpers are not public API.

## Entries

| Entry                    | Supported use                                                             |
| ------------------------ | ------------------------------------------------------------------------- |
| `@p10i/do-md`            | Node commands/classes, adapters, reference and Skill reader               |
| `/browser`               | Portable commands/classes, Fetch/Virtual, plain diagnostics and reference |
| `/io`                    | Node filesystem, portable adapters and revision helpers                   |
| `/http`                  | HTTP execution server factory and remote client                           |
| `/mcp`                   | MCP server integration                                                    |
| `/markdown`              | Positioned Markdown parsing and flattening                                |
| `/skills/do-md/SKILL.md` | Bundled English Agent Skill text                                          |
| `/package.json`          | Package metadata                                                          |

Private `sources/*` imports are closed. Node requires 22.13+. Browser execution
remains candidate-level until the deferred real-engine checks pass.

## Command results and effects

Document commands take an explicit adapter and return
`{ok, exitCode, output, context, errors}`. `ok` discriminates the result. Success
has exit code 0 and no errors. Failed results are documented ordinary outcomes.

| Command     | Failed result                         | Exceptions                                                            | Writes                                           |
| ----------- | ------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------ |
| `validate`  | Document mismatch: 2                  | Invalid arguments, template failures, I/O                             | Never                                            |
| `exportDoc` | Document mismatch: 2                  | Invalid arguments, template failures, I/O                             | Only with savePath, after successful parse       |
| `create`    | Existing destination without force: 1 | Invalid arguments, template failures, I/O or atomic creation conflict | Destination only                                 |
| `set`       | No mutation: 1; document mismatch: 2  | Invalid paths/values, template failures, I/O or stale revision        | Input or explicit out                            |
| `render`    | Input mismatch: 2                     | Invalid arguments, template failures, I/O                             | Explicit outFile, after parse/render             |
| `match`     | No matching template: 2               | Invalid arguments or source/discovery I/O                             | Never; unreadable/invalid candidates are skipped |
| `query`     | No occurrence: 2                      | Invalid region, arguments, template failures or I/O                   | Never                                            |

Default paths belong to adapters: disk uses its working directory, Virtual its
keys and Fetch URL/browser bases. CLI export still requires `--save`; library/MCP
extraction may be read-only. Services implement dry runs through adapters.

## Read sessions and cursors

Parser and Reader share a cursor kernel. Reader is not a subclass of the public
Parser leaf API. `Parser.line` is a numeric read-only alias; `Reader.line()` is a
leaf. Both expose canonical `lineNumber` and `char` coordinates.

| Operation                                | Contract                                                                                                                                    |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| seek(offset), position/offset assignment | Move only the cursor; retain data/bindings/metadata. Validate integer bounds and recompute coordinates from the index.                      |
| snapshotCursor / restoreCursor           | Save/restore an offset, not a session. Serialized line/column fields cannot introduce drift.                                                |
| reset()                                  | Restart the same source with fresh context, bindings, errors, modes and Reader slot/region/query maps. Reuse the source index; return this. |
| replaceSource(text, {file?})             | Atomically install a new source/index and fresh session. Filename defaults to the current one; return this.                                 |
| source assignment                        | Equivalent to replacing the source with the current filename. Old bindings never survive.                                                   |

Source/index/filename and derived coordinates are read-only. Only the canonical
offset is writable. Reset/replacement are rejected during compiled execution,
speculative callbacks and reader validators. Failed attempts restore their state;
successful Reader iterations must consume input. Snapshots copy plain template
data (scalars, arrays, records), not arbitrary application class instances. Forks
share source ownership but own their read state.

## Templates and bindings

Template.compile returns an owning CompiledTemplate. Code/map inspection is
available before native compilation. toFunction compiles a reusable five-argument
adapter. execute(doc, context, data, options, io) is synchronous and returns the
template's unknown JS return value; commands do not await promises returned by
template code. Templates are trusted executable JavaScript.

Slots configure transformations and bind eagerly once via as/asArray. The pipeline
is default, trim, validators, notEmpty. Duplicate scalar keys and mixed bindings
fail. Reader populates context/spans; Writer reads data and emits text. Structured
leaves use the documented value shapes. Unbound Writer leaves emit nothing.

## Diagnostics and editing

DoMdError preserves cause and serializes `{code, message, locations}`. Its plain
inspection/toString is stable across imports. Node's explicit formatter can add
ANSI; imports never patch the error prototype. See [diagnostics](diagnostics.md)
for roles, precision and UTF-16 ranges. Source maps/text are immutable; diagnostic
data is detached.

Editor captures an initial revision. Mutations do not write; render composes text;
save commits through adapter revision/atomic capabilities. Unchanged spans retain
their bytes; changed structured values may normalize. Filesystem conflict guarantees
are cooperative and adapter-dependent. Fetch is read-only; Virtual uses synchronous CAS.

## Candidate identity

`npm run release:candidate` requires a clean checkout and records the verified
commit, version, tarball SHA-256, npm integrity and runtime in a manifest. Completed
candidate directories are not overwritten. It never commits, tags, pushes or
publishes. Windows and browser verification are manual/deferred; image verification
is a separate CI gate. Pending checks must not be represented as passing.
