const functions = [
  ["literal", "text", "doc.literal(text)", "Consumes or emits literal template text.", "doc", 'doc.literal("Status: ")'],
  ["line", "text", "doc.line()", "Captures or emits text up to the next newline.", "string", 'doc.line().as("title")'],
  ["until", "text", "doc.until(limiter)", "Captures raw text from the cursor up to a literal limiter.", "string", 'doc.until(".").as("date")'],
  ["regexp", "text", "doc.regexp(pattern)", "Matches a regular expression at the current cursor.", "string", 'doc.regexp(/v\\d+\\.\\d+/).as("version")'],
  ["text", "text", "doc.text(limiter?)", "Captures text inside the current Markdown paragraph.", "string", 'doc.text(";").as("summary")'],
  ["rawUntil", "opaque", "doc.rawUntil(limiter)", "Captures byte-exact source up to a literal limiter.", "string", 'doc.rawUntil("## Generated").as("preamble")'],
  ["rawUntilElement", "opaque", "doc.rawUntilElement(type)", "Captures byte-exact source up to the next top-level list.", "string", 'doc.rawUntilElement("list")'],
  ["rawBlock", "opaque", "doc.rawBlock()", "Captures one byte-exact Markdown block.", "string", 'doc.rawBlock().as("customBlock")'],
  ["rawRest", "opaque", "doc.rawRest()", "Captures all remaining source exactly.", "string", 'doc.rawRest().as("trailing")'],
  ["heading", "block", "doc.heading(level?)", "Parses or writes a complete ATX or Setext heading.", "string", 'doc.heading(2).as("section")'],
  ["paragraph", "block", "doc.paragraph()", "Parses or writes one Markdown paragraph.", "string", 'doc.paragraph().as("description")'],
  ["list", "block", "doc.list()", "Parses or writes a flat Markdown list.", "string[]", 'doc.list().as("changes")'],
  ["listTree", "block", "doc.listTree()", "Preserves nested list structure and task checkbox state.", "ListTreeValue", 'doc.listTree().as("plan")'],
  ["frontmatter", "block", "doc.frontmatter(options?)", "Parses YAML frontmatter at document start and optionally validates it with safeParse.", "FrontmatterValue", 'doc.frontmatter({ schema }).as("metadata")'],
  ["table", "block", "doc.table()", "Parses or writes a GFM pipe table with alignment.", "TableValue", 'doc.table().as("matrix")'],
  ["codeBlock", "block", "doc.codeBlock()", "Parses or writes fenced or indented code blocks.", "CodeBlockValue", 'doc.codeBlock().as("example")'],
  ["blockQuote", "block", "doc.blockQuote()", "Parses or writes a Markdown block quote.", "string", 'doc.blockQuote().as("quotation")'],
  ["thematicBreak", "block", "doc.thematicBreak()", "Matches or writes a thematic break.", "true", 'doc.thematicBreak().as("divider")'],
  ["htmlBlock", "block", "doc.htmlBlock()", "Captures or emits an HTML block.", "string", 'doc.htmlBlock().as("widget")'],
  ["link", "inline", "doc.link()", "Parses or writes an inline Markdown link.", "LinkValue", 'doc.link().as("homepage")'],
  ["image", "inline", "doc.image()", "Parses or writes a Markdown image.", "ImageValue", 'doc.image().as("diagram")'],
  ["autolink", "inline", "doc.autolink()", "Parses or writes an angle-bracket URL or email autolink.", "string", 'doc.autolink().as("contact")'],
  ["codeSpan", "inline", "doc.codeSpan()", "Parses or writes an inline code span.", "string", 'doc.codeSpan().as("command")'],
  ["checkbox", "inline", "doc.checkbox()", "Parses or writes a three-character task marker.", "boolean", 'doc.checkbox().asArray("done")'],
  ["optional", "control", "doc.optional(callback?)", "Makes a block optional and rolls back Reader state when it does not commit.", "boolean | doc", 'doc.optional((part) => part.line().as("owner"))'],
  ["scope", "control", "doc.scope(key, callback)", "Repeats a structured child context and binds the committed objects as an array.", "void", 'doc.scope("chapters", (chapter) => chapter.heading(2).as("title"))'],
  ["repeat", "control", "doc.repeat(callback)", "Repeats bindings, typically with asArray(), until the next iteration misses.", "context[] | void", 'doc.repeat((item) => item.line().asArray("lines"))'],
  ["skipUntilHeading", "control", "doc.skipUntilHeading(predicate?)", "Moves a Reader to the next matching heading; Writer treats it as a no-op.", "boolean", 'doc.skipUntilHeading("Appendix")'],
  ["query", "control", "doc.query(callback)", "Marks one non-empty source region for the query command.", "doc", 'doc.query((match) => match.paragraph().as("content"))'],
].map(([name, category, signature, summary, value, example]) => Object.freeze({ name, category, signature, summary, value, example }));

const modifiers = [
  ["as", ".as(key)", "Binds the slot value to a context key.", 'doc.line().as("title")'],
  ["asArray", ".asArray(key)", "Appends the value at the current repeat index.", 'doc.line().asArray("items")'],
  ["trim", ".trim()", "Trims string values before validation and binding.", 'doc.line().trim().as("name")'],
  ["default", ".default(value)", "Supplies a value when Writer data is undefined or an optional Reader slot misses.", 'doc.line().default("draft").as("status")'],
  ["validate", ".validate(fn)", "Requires the callback to accept the transformed value.", 'doc.line().validate((value) => value !== "invalid").as("status")'],
  ["notEmpty", ".notEmpty()", "Rejects empty strings and arrays.", 'doc.paragraph().notEmpty().as("body")'],
  ["exists", ".exists", "Reports whether a Reader slot matched or Writer data was defined.", "const found = doc.optional().line().exists"],
].map(([name, signature, summary, example]) => Object.freeze({ name, signature, summary, example }));

const valueShapes = Object.freeze({
  ListTreeValue: "{ ordered: boolean, start: number | null, tight: boolean, items: Array<{ checked: boolean | null, children: MarkdownBlockNode[] }> }",
  FrontmatterValue: "{ format: 'yaml', raw: string, content: string, data: object, source?: string }",
  TableValue: "{ headers: string[], rows: string[][], align: Array<'left' | 'right' | 'center' | null> }",
  CodeBlockValue: "{ language: string | null, meta: string, value: string }",
  LinkValue: "{ url: string, text: string, title: string | null }",
  ImageValue: "{ url: string, alt: string, title: string | null }",
});

const examples = Object.freeze([
  Object.freeze({
    name: "release-notes",
    summary: "Parse and render a release document.",
    template: '# {% doc.line().as("version") %}\n\n## Changes\n\n{% doc.list().as("changes") %}',
  }),
  Object.freeze({
    name: "optional-metadata",
    summary: "Commit an optional block only when its slots bind.",
    template: '{% doc.optional((part) => { part.literal("Owner: "); part.line().trim().notEmpty().as("owner") }) %}',
  }),
  Object.freeze({
    name: "query",
    summary: "Find non-overlapping target sections with do-md query.",
    template: '{% doc.rawUntil("## Target"); doc.query((match) => { match.literal("## Target\\n\\n"); match.paragraph().as("content") }); doc.rawRest() %}',
  }),
]);

export const templateLanguage = Object.freeze({
  version: "1.0",
  syntax: Object.freeze({
    blocks: "JavaScript inside {% and %}; surrounding text is passed to doc.literal().",
    escaping: "Use \\{% and \\%} for literal delimiters.",
    trust: "Templates are trusted JavaScript and are not sandboxed.",
    consumption: "Normal parsing starts at offset zero and must consume all non-whitespace content.",
    boundaries: "Block leaves must begin at a Markdown block boundary.",
  }),
  globals: Object.freeze([
    Object.freeze({ name: "doc", summary: "Reader while parsing and Writer while rendering." }),
    Object.freeze({ name: "ctx", summary: "Current context object." }),
    Object.freeze({ name: "data", summary: "Writer input data, or null while reading." }),
    Object.freeze({ name: "options", summary: "Command and serializer options." }),
    Object.freeze({ name: "io", summary: "Optional I/O adapter supplied by the caller." }),
  ]),
  functions: Object.freeze(functions),
  modifiers: Object.freeze(modifiers),
  valueShapes,
  advanced: Object.freeze({
    reader: Object.freeze(["reset", "remaining", "snapshotCursor", "restoreCursor", "advanceTo", "required", "error", "parse", "parseRegExp", "parseUntil", "parseOneOf", "allowWhitespaces", "allowNewlines", "allowNewlinesAndWhitespaces", "parseDocument", "assertConsumed", "fork"]),
    writer: Object.freeze(["write", "append", "toMarkdown", "toString", "toAst", "serializeSlotValue", "serializeTableValue", "serializeCodeBlockValue", "serializeLinkValue", "serializeImageValue", "writeHeading", "writeParagraph", "writeText", "writeLine", "writeNewline", "writeList", "writeTable", "writeCodeBlock", "writeBlockQuote", "writeThematicBreak", "writeHtmlBlock", "writeLink", "writeImage", "writeAutolink", "writeCodeSpan", "writeEmphasis", "writeStrong", "writeCheckbox"]),
  }),
  examples,
  caveats: Object.freeze([
    "Reader whitespace in literal template text follows Parser whitespace rules rather than matching byte-for-byte.",
    "text(limiter) searches only inside the current paragraph; until(limiter) is cursor-based.",
    "frontmatter is recognized only at document offset zero.",
    "Duplicate bindings and mixing as()/asArray() for one key are template errors.",
    "Raw values bypass Markdown and line-ending normalization.",
    "Query templates must define exactly one non-empty doc.query() region.",
  ]),
});

export function listTemplateFunctions() {
  return templateLanguage.functions.map((entry) => entry.name);
}

export function describeTemplateFunction(name) {
  const key = String(name ?? "").replace(/^doc\./, "");
  return templateLanguage.functions.find((entry) => entry.name === key) ??
    templateLanguage.modifiers.find((entry) => entry.name === key.replace(/^\./, "")) ?? null;
}

function markdownForEntry(entry) {
  const value = entry.value ? `\n\nValue: \`${entry.value}\`.` : "";
  const example = entry.example ? `\n\nExample:\n\n\`\`\`js\n${entry.example}\n\`\`\`` : "";
  return `### \`${entry.signature}\`\n\n${entry.summary}${value}${example}`;
}

export function renderTemplateReference({ topic = null, format = "text" } = {}) {
  const entry = topic == null ? null : describeTemplateFunction(topic);
  if (topic != null && !entry) {
    return null;
  }
  const selected = entry ?? templateLanguage;
  if (format === "json") {
    return JSON.stringify(selected, null, 2);
  }
  if (entry) {
    return format === "markdown"
      ? markdownForEntry(entry)
      : `${entry.signature}\n${entry.summary}${entry.value ? `\nValue: ${entry.value}` : ""}${entry.example ? `\nExample: ${entry.example}` : ""}`;
  }
  const sections = [
    "# do-md Template Language",
    "",
    templateLanguage.syntax.blocks,
    "",
    "## Syntax",
    "",
    ...Object.entries(templateLanguage.syntax).map(([name, value]) => `- **${name}**: ${value}`),
    "",
    "## Runtime Globals",
    "",
    ...templateLanguage.globals.map((item) => `- \`${item.name}\`: ${item.summary}`),
    "",
    "## Functions",
    "",
    ...templateLanguage.functions.flatMap((item) => [markdownForEntry(item), ""]),
    "## Slot Modifiers",
    "",
    ...templateLanguage.modifiers.flatMap((item) => [markdownForEntry(item), ""]),
    "## Value Shapes",
    "",
    ...Object.entries(templateLanguage.valueShapes).map(([name, shape]) => `- \`${name}\`: \`${shape}\``),
    "",
    "## Examples",
    "",
    ...templateLanguage.examples.flatMap((item) => [`### ${item.name}`, "", item.summary, "", "```md", item.template, "```", ""]),
    "## Advanced API",
    "",
    `Reader/Parser methods: ${templateLanguage.advanced.reader.map((name) => `\`${name}\``).join(", ")}.`,
    "",
    `Direct Writer methods: ${templateLanguage.advanced.writer.map((name) => `\`${name}\``).join(", ")}.`,
    "",
    "## Caveats",
    "",
    ...templateLanguage.caveats.map((item) => `- ${item}`),
  ];
  const markdown = sections.join("\n").trimEnd();
  return format === "markdown" ? markdown : markdown.replace(/^#+\s*/gm, "").replace(/`/g, "");
}
