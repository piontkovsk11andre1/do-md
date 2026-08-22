Realistic ADR fixture from `design/current/Example.md.template`.

Covers `scope`, `optional`, `repeat`, `checkbox`, `link`, `list`, and `codeBlock`.

Open-callback `{% %}` bodies are written as JavaScript blocks so literals run on the child cursor, matching `tests/conformance/chapters` and `example-kitchen-sink`. Decision titles use `heading(3)` so a later `## Action items` heading misses the next scope iteration. Optional headings sit on the same line as the `{% optional %}` tag so they still match after a greedy `\n\n` literal.

Edits to the canonical Example.md.template require a matching fixture update.
