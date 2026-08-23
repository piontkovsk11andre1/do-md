# do-md Template Language

JavaScript inside {% and %}; surrounding text is passed to doc.literal().

## Syntax

- **blocks**: JavaScript inside {% and %}; surrounding text is passed to doc.literal().
- **escaping**: Use \{% and \%} for literal delimiters.
- **trust**: Templates are trusted JavaScript and are not sandboxed.
- **consumption**: Normal parsing starts at offset zero and must consume all non-whitespace content.
- **boundaries**: Block leaves must begin at a Markdown block boundary.

## Runtime Globals

- `doc`: Reader while parsing and Writer while rendering.
- `ctx`: Current context object.
- `data`: Writer input data, or null while reading.
- `options`: Command and serializer options.
- `io`: Optional I/O adapter supplied by the caller.

## Functions

### `doc.literal(text)`

Consumes or emits literal template text.

Value: `doc`.

Example:

```js
doc.literal("Status: ")
```

### `doc.line()`

Captures or emits text up to the next newline.

Value: `string`.

Example:

```js
doc.line().as("title")
```

### `doc.until(limiter)`

Captures raw text from the cursor up to a literal limiter.

Value: `string`.

Example:

```js
doc.until(".").as("date")
```

### `doc.regexp(pattern)`

Matches a regular expression at the current cursor.

Value: `string`.

Example:

```js
doc.regexp(/v\d+\.\d+/).as("version")
```

### `doc.text(limiter?)`

Captures text inside the current Markdown paragraph.

Value: `string`.

Example:

```js
doc.text(";").as("summary")
```

### `doc.rawUntil(limiter)`

Captures byte-exact source up to a literal limiter.

Value: `string`.

Example:

```js
doc.rawUntil("## Generated").as("preamble")
```

### `doc.rawBlock()`

Captures one byte-exact Markdown block.

Value: `string`.

Example:

```js
doc.rawBlock().as("customBlock")
```

### `doc.rawRest()`

Captures all remaining source exactly.

Value: `string`.

Example:

```js
doc.rawRest().as("trailing")
```

### `doc.heading(level?)`

Parses or writes a complete ATX or Setext heading.

Value: `string`.

Example:

```js
doc.heading(2).as("section")
```

### `doc.paragraph()`

Parses or writes one Markdown paragraph.

Value: `string`.

Example:

```js
doc.paragraph().as("description")
```

### `doc.list()`

Parses or writes a flat Markdown list.

Value: `string[]`.

Example:

```js
doc.list().as("changes")
```

### `doc.listTree()`

Preserves nested list structure and task checkbox state.

Value: `ListTreeValue`.

Example:

```js
doc.listTree().as("plan")
```

### `doc.frontmatter(options?)`

Parses YAML frontmatter at document start and optionally validates it with safeParse.

Value: `FrontmatterValue`.

Example:

```js
doc.frontmatter({ schema }).as("metadata")
```

### `doc.table()`

Parses or writes a GFM pipe table with alignment.

Value: `TableValue`.

Example:

```js
doc.table().as("matrix")
```

### `doc.codeBlock()`

Parses or writes fenced or indented code blocks.

Value: `CodeBlockValue`.

Example:

```js
doc.codeBlock().as("example")
```

### `doc.blockQuote()`

Parses or writes a Markdown block quote.

Value: `string`.

Example:

```js
doc.blockQuote().as("quotation")
```

### `doc.thematicBreak()`

Matches or writes a thematic break.

Value: `true`.

Example:

```js
doc.thematicBreak().as("divider")
```

### `doc.htmlBlock()`

Captures or emits an HTML block.

Value: `string`.

Example:

```js
doc.htmlBlock().as("widget")
```

### `doc.link()`

Parses or writes an inline Markdown link.

Value: `LinkValue`.

Example:

```js
doc.link().as("homepage")
```

### `doc.image()`

Parses or writes a Markdown image.

Value: `ImageValue`.

Example:

```js
doc.image().as("diagram")
```

### `doc.autolink()`

Parses or writes an angle-bracket URL or email autolink.

Value: `string`.

Example:

```js
doc.autolink().as("contact")
```

### `doc.codeSpan()`

Parses or writes an inline code span.

Value: `string`.

Example:

```js
doc.codeSpan().as("command")
```

### `doc.checkbox()`

Parses or writes a three-character task marker.

Value: `boolean`.

Example:

```js
doc.checkbox().asArray("done")
```

### `doc.optional(callback?)`

Makes a block optional and rolls back Reader state when it does not commit.

Value: `boolean | doc`.

Example:

```js
doc.optional((part) => part.line().as("owner"))
```

### `doc.scope(key, callback)`

Repeats a structured child context and binds the committed objects as an array.

Value: `void`.

Example:

```js
doc.scope("chapters", (chapter) => chapter.heading(2).as("title"))
```

### `doc.repeat(callback)`

Repeats bindings, typically with asArray(), until the next iteration misses.

Value: `context[] | void`.

Example:

```js
doc.repeat((item) => item.line().asArray("lines"))
```

### `doc.skipUntilHeading(predicate?)`

Moves a Reader to the next matching heading; Writer treats it as a no-op.

Value: `boolean`.

Example:

```js
doc.skipUntilHeading("Appendix")
```

### `doc.query(callback)`

Marks one non-empty source region for the query command.

Value: `doc`.

Example:

```js
doc.query((match) => match.paragraph().as("content"))
```

## Slot Modifiers

### `.as(key)`

Binds the slot value to a context key.

Example:

```js
doc.line().as("title")
```

### `.asArray(key)`

Appends the value at the current repeat index.

Example:

```js
doc.line().asArray("items")
```

### `.trim()`

Trims string values before validation and binding.

Example:

```js
doc.line().trim().as("name")
```

### `.default(value)`

Supplies a value when Writer data is undefined or an optional Reader slot misses.

Example:

```js
doc.line().default("draft").as("status")
```

### `.validate(fn)`

Requires the callback to accept the transformed value.

Example:

```js
doc.line().validate((value) => value !== "invalid").as("status")
```

### `.notEmpty()`

Rejects empty strings and arrays.

Example:

```js
doc.paragraph().notEmpty().as("body")
```

### `.exists`

Reports whether a Reader slot matched or Writer data was defined.

Example:

```js
const found = doc.optional().line().exists
```

## Value Shapes

- `ListTreeValue`: `{ ordered: boolean, start: number | null, tight: boolean, items: Array<{ checked: boolean | null, children: MarkdownBlockNode[] }> }`
- `FrontmatterValue`: `{ format: 'yaml', raw: string, content: string, data: object, source?: string }`
- `TableValue`: `{ headers: string[], rows: string[][], align: Array<'left' | 'right' | 'center' | null> }`
- `CodeBlockValue`: `{ language: string | null, value: string }`
- `LinkValue`: `{ url: string, text: string, title: string | null }`
- `ImageValue`: `{ url: string, alt: string, title: string | null }`

## Examples

### release-notes

Parse and render a release document.

```md
# {% doc.line().as("version") %}

## Changes

{% doc.list().as("changes") %}
```

### optional-metadata

Commit an optional block only when its slots bind.

```md
{% doc.optional((part) => { part.literal("Owner: "); part.line().trim().notEmpty().as("owner") }) %}
```

### query

Find non-overlapping target sections with do-md query.

```md
{% doc.rawUntil("## Target"); doc.query((match) => { match.literal("## Target\n\n"); match.paragraph().as("content") }); doc.rawRest() %}
```

## Advanced API

Reader/Parser methods: `reset`, `remaining`, `snapshotCursor`, `restoreCursor`, `advanceTo`, `required`, `error`, `parse`, `parseRegExp`, `parseUntil`, `parseOneOf`, `allowWhitespaces`, `allowNewlines`, `allowNewlinesAndWhitespaces`, `parseDocument`, `assertConsumed`, `fork`.

Direct Writer methods: `write`, `append`, `toMarkdown`, `toString`, `toAst`, `serializeSlotValue`, `serializeTableValue`, `serializeCodeBlockValue`, `serializeLinkValue`, `serializeImageValue`, `writeHeading`, `writeParagraph`, `writeText`, `writeLine`, `writeNewline`, `writeList`, `writeTable`, `writeCodeBlock`, `writeBlockQuote`, `writeThematicBreak`, `writeHtmlBlock`, `writeLink`, `writeImage`, `writeAutolink`, `writeCodeSpan`, `writeEmphasis`, `writeStrong`, `writeCheckbox`.

## Caveats

- Reader whitespace in literal template text follows Parser whitespace rules rather than matching byte-for-byte.
- text(limiter) searches only inside the current paragraph; until(limiter) is cursor-based.
- frontmatter is recognized only at document offset zero.
- Duplicate bindings and mixing as()/asArray() for one key are template errors.
- Raw values bypass Markdown and line-ending normalization.
- Query templates must define exactly one non-empty doc.query() region.
