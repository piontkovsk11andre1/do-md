Initial subset of `design/current/Example.kitchen-sink.md.template`.

Covers every bound leaf, structural method, and slot modifier from the canonical template. `{# #}` documentation comments are omitted because they are not a compiler block flavor and would be emitted as literals.

`skipUntilHeading("§14")` sits immediately before the §14 heading literal so Writer's no-op and Reader's advance agree when there is no interstitial content. Input omits anything between §13 and §14.

The `scope` body is a JavaScript block that calls `chapter.literal`, matching `tests/conformance/chapters`. The open-callback form would emit `doc.literal` on the parent while slot calls run on the child.
