# Release procedure

1. Review the changelog, [API contract](api-contract.md), migration and dependencies.
2. Run `npm ci`, `npm run check`, `npm run test:runtime` and `npm run bench`.
3. Confirm automatic Linux Node/image CI. Windows and real browsers are deferred
   and available through manual workflow inputs. Record pending checks honestly.
4. Inspect the tarball. Existing release-smoke tests install it outside the checkout
   and exercise both binaries and remote execution.
5. Update version and lockfile together for each new candidate.
6. From an approved clean commit, run `npm run release:candidate`. It verifies the
   checkout and creates a tarball/manifest under `.release/<version>-<commit>/`.
   Completed candidate directories cannot be overwritten. Version, commit, SHA-256,
   npm integrity, runtime and deferred checks are recorded.
7. Publish an approved candidate explicitly with the `next` tag. Stable promotion
   requires reviewed candidate feedback and the deferred verification results.

No check/generator/candidate command commits, tags, pushes or publishes. There is
no automatic publication hook. A dirty checkout cannot become a frozen candidate.

## Types

The compilation, cursor, Reader/Writer/Slot and command vertical uses strict checked
JSDoc and generated declarations. Editor, Markdown parsing and transports retain
reviewed declarations with strict consumer tests. Do not weaken checkJs with
blanket any/ts-nocheck to claim coverage. Generated declarations use the project's
formatter, so formatting and declaration-drift checks agree.

## Docker artifact

The pinned Node/Alpine runtime includes all required resources, including skills/.
`docker build --target verification .` executes CLI validation, Skill reads, MCP
resource/tool calls and HTTP health as the non-root image user. The final stage
does not contain the smoke script. `npm run test:runtime` exercises the same program
in a checkout; it is not evidence of an image build. Linux image CI owns that gate.

## Benchmarks and developer artifacts

Compare `npm run bench --silent` JSON on the same runtime/machine. Timings inform
review, not cross-machine pass/fail thresholds. Browser build, serve and packed-test
runs own separate `.browser/<operation>-<unique>/` directories. Build/pack retain
their printed artifacts; serve cleans up its directory; failed tests retain results
but remove transient installed dependencies. Process helpers bound time/output and
cancel their owned child groups. No shared dist directory is overwritten.
