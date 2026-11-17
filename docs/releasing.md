# Release procedure

1. Review the changelog, public exports, migration guide and dependency changes.
2. Run `npm ci`, `npm run check`, `npm run bench` and `npm pack --dry-run`.
3. Confirm CI succeeds on the supported Node matrix and Windows. Local Linux
   verification alone is not evidence of a passing Windows run.
4. Inspect the packed artifact and install it in an unrelated directory. The
   release-smoke tests automate this for both binaries and remote execution.
5. Update the candidate version and lockfile together when preparing another RC.
6. Publish an approved candidate explicitly with the `next` dist-tag. Promote a
   stable version only after candidate feedback and reviewed release notes.

Publishing, pushing commits and creating tags are maintainer actions, not effects
of `test`, `check`, `types`, `docs`, `bench` or `pack`. There is no automatic publish
hook. The current checkout is a release candidate, not a record of npm publication.

## Type migration policy

The new source-map/iteration core is checked JavaScript with generated declarations.
The older document engine retains reviewed declarations with strict consumer
tests. Migrate an entire cohesive subsystem at a time; do not weaken `checkJs`
with blanket `any` or `@ts-nocheck` just to claim full-project coverage.

## Benchmark comparisons

Save JSON from `npm run bench --silent` before and after a hot-path change on the
same runtime/machine. Review indexed lookup, many-segment maps, compilation and
large-document editing. Timings are evidence for review, not cross-machine CI
thresholds. Keep input sizes and warmup policy in the benchmark source.
