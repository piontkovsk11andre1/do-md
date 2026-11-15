# GitHub / Gitea Update Review

## Comparison

Reviewed on 2026-11-15:

- GitHub `main`: `0b6a87cc8b9d6fb7c300aef94e88533c509b4ecf`.
- Gitea `main`: `6f8eed935e7118299cd2396bf63fac5bab16f31f`.
- Gitea `code-block-info`: `152281edd697e7b52b3bf30396d511144c898346`.

The repositories have separate Git histories. GitHub's source tree matches
Gitea's `70e3b07` tree exactly, before the two feature patches below. The update
ports their source, declarations, reference changes, and tests onto GitHub's
history.

## Patches Missing From GitHub

1. `015b247`: `rawUntilElement("list")`, merged in Gitea PR #1. Captures the
   byte-exact gap before a top-level list and composes with `listTree()`, repeat,
   raw writing, and span-local editing.
2. `152281e`: code-fence info remainder as `meta`, in open Gitea PR #2. Preserves
   opaque metadata through parsing, writing, AST values, and edits. Missing
   metadata remains accepted by the writer and editor.

The original Gitea patch made list discovery sensitive to whether the cursor
was inside a line or at its beginning. Line-boundary cursors inside enclosing
blocks could expose fake or nested lists. The port fixes this by searching the
full document's top-level AST and adds regression coverage for fences,
frontmatter, quotes, and existing lists.

## Dependency Refresh

The baseline lockfile reported nine affected packages via `npm audit`, including
the directly pinned MCP SDK and Zod. This update moves the SDK to 1.32.2 and Zod
to 4.6.7 and refreshes dependencies within the other declared version ranges.
The updated dependency tree reports no known vulnerabilities at review time.
The shipped MCP server uses stdio; HTTP-specific dependency advisories do not
by themselves demonstrate an exposed HTTP service in do-md.

## Review Scope

The quick review covers the imported Reader/Writer/Editor behavior, command
parsing and query flow, MCP path scoping and worker dispatch, declarations,
generated reference discoverability, and the existing regression/release suite.
This is a focused maintenance review, not an exhaustive correctness or security
audit. The package and MCP server version are updated to 1.4.0, including the
subsequently requested HTTP execution service and remote-dispatch MCP mode;
these local updates are not evidence of GitHub or npm publication.

## Verification

- Full Node test suite after HTTP implementation: 693 passed, no failures or skips.
- Includes strict NodeNext declaration compilation, real MCP SDK stdio clients,
  CLI command coverage, conformance round trips, edit/conflict tests, generated
  reference checks, and npm pack plus isolated global-install smoke tests.
- `npm audit`: zero known vulnerabilities in the updated dependency tree.
- `git diff --check`: passed.
- HTTP coverage includes all commands, both remote MCP binaries, server-side
  roots without a client-side copy, remote reference resources through a URL
  prefix, deadlines/disconnects, worker shutdown, bounded bodies/responses,
  directory/symlink/glob containment, and atomic concurrent creation.
- Installed-package smoke tests start the real `serve` process and use both
  installed MCP proxies.
- Docker image build and container shared-mount checks remain pending on the
  host; this agent has no Docker socket.

Code-block captures add `meta` even when empty. Existing writer/editor values
without it remain supported, but strict schemas, object comparisons, and typed
code-block literals may need the additional field. Only top-level list scanning
is implemented by `rawUntilElement`; unknown element types remain errors.
