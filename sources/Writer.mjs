import { equalData } from "./DataEquality.mjs";

import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

import { Slot, registerBinding } from "./Slot.mjs";
import { makeTemplateError, makeUserError } from "./DoMdError.mjs";
import { schemaFromOptions } from "./Schema.mjs";

/** @typedef {import('./types.d.mts').MarkdownNode} MarkdownNode */
/** @typedef {import('./types.d.mts').MarkdownInlineNode} InlineNode */
/** @typedef {import('./types.d.mts').MarkdownBlockNode} BlockNode */
/** @typedef {import('./types.d.mts').WriterOptions} WriterOptions */
/** @typedef {import('./RuntimeContracts.d.mts').SlotDescription} SlotDescription */
/** @typedef {{missed: boolean, bound: number}} OptionalFrame */

const MAX_ITERATIONS = 10000;

const BLOCK_TYPES = new Set([
  "heading",
  "paragraph",
  "thematic_break",
  "code_block",
  "block_quote",
  "list",
  "list_item",
  "table",
  "html_block",
  "frontmatter",
  "raw",
]);
/** @param {MarkdownNode} node @returns {node is BlockNode} */
function isBlock(node) {
  return BLOCK_TYPES.has(node.type);
}

/** @type {WriterOptions} */
const DEFAULT_OPTIONS = {
  bullet: "-",
  orderedDelim: ".",
  fence: "`",
  headingStyle: "atx",
  tightLists: true,
  tablePadding: true,
  eol: "\n",
};

/** @param {unknown} text @param {unknown} eol */
function normalizeEol(text, eol) {
  const replacement = eol === "\r\n" || eol === "\r" ? eol : "\n";
  return String(text).replace(/\r\n|\r|\n/g, replacement);
}

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function isDataObject(value) {
  return value != null && typeof value === "object";
}

/** @param {unknown} level @returns {import('./types.d.mts').HeadingNode['level']} */
function clampLevel(level) {
  const n = Number(level);
  if (!Number.isInteger(n)) {
    return 1;
  }
  return /** @type {import('./types.d.mts').HeadingNode['level']} */ (Math.min(6, Math.max(1, n)));
}

/** @param {unknown} value @returns {import('./types.d.mts').TextNode} */
function textNode(value) {
  return { type: "text", value: String(value ?? "") };
}

/** Copy plain AST/data values without source positions. @template T @param {T} node @returns {T} */
function stripNode(node) {
  if (node == null || typeof node !== "object") {
    return node;
  }
  if (Array.isArray(node)) {
    return /** @type {T} */ (node.map(stripNode));
  }
  /** @type {Record<string, unknown>} */
  const out = {};
  for (const [key, value] of Object.entries(node)) {
    if (key === "position") {
      continue;
    }
    out[key] = stripNode(value);
  }
  return /** @type {T} */ (out);
}

/** @param {unknown} value @returns {import('./types.d.mts').ListNode} */
function listNodeFromTree(value) {
  if (!isDataObject(value) || Array.isArray(value) || !Array.isArray(value.items)) {
    throw makeUserError("listTree value must be an object with an items array");
  }
  const ordered = value.ordered === true;
  const start = ordered ? Number(value.start ?? 1) : null;
  if (ordered && (start == null || !Number.isInteger(start) || start < 0)) {
    throw makeUserError("listTree start must be a non-negative integer");
  }
  return {
    type: "list",
    ordered,
    start,
    tight: value.tight !== false,
    children: value.items.map((item) => {
      if (!isDataObject(item) || !Array.isArray(item.children)) {
        throw makeUserError("listTree items must contain a children array");
      }
      if (item.checked != null && typeof item.checked !== "boolean") {
        throw makeUserError("listTree item checked must be a boolean or null");
      }
      return {
        type: "list_item",
        checked: item.checked ?? null,
        children: stripNode(item.children),
      };
    }),
  };
}

/** @param {unknown} value @param {unknown} options
 * @returns {{node: import('./types.d.mts').FrontmatterNode, markdown: string}} */
function frontmatterValue(value, options) {
  if (!isDataObject(value) || Array.isArray(value)) {
    throw makeUserError("frontmatter value must be an object");
  }
  const structured =
    value.format === "yaml" &&
    Object.hasOwn(value, "data") &&
    Object.hasOwn(value, "raw") &&
    Object.hasOwn(value, "content");
  let data = frontmatterData(structured ? value.data : value);
  const schema = schemaFromOptions(options);
  if (schema) {
    const result = schema.safeParse(data);
    if (!result?.success) {
      throw makeUserError(
        `frontmatter validation failed${result?.error?.message ? `: ${result.error.message}` : ""}`,
      );
    }
    if (!Object.hasOwn(result, "data")) {
      throw makeUserError("frontmatter validation succeeded without data");
    }
    data = frontmatterData(result.data);
  }
  const raw = structured ? (value.raw ?? value.content) : null;
  let retainedRaw = false;
  if (typeof raw === "string") {
    try {
      const parsed = parseYaml(raw);
      retainedRaw = equalData(parsed == null && raw.trim() === "" ? {} : parsed, data);
    } catch {
      // Invalid retained raw is replaced by canonical YAML below.
    }
  }
  const source = retainedRaw && typeof value.source === "string" ? value.source : null;
  const body = retainedRaw && typeof raw === "string" ? raw : stringifyYaml(data);
  const separator = body.endsWith("\n") || body.endsWith("\r") ? "" : "\n";
  return {
    node: { type: "frontmatter", format: "yaml", raw: body, content: body, data: stripNode(data) },
    markdown: source ?? `---\n${body}${separator}---`,
  };
}

/** @param {unknown} value @returns {Record<string, unknown>} */
function frontmatterData(value) {
  if (!isDataObject(value) || Array.isArray(value)) {
    throw makeUserError("frontmatter data must be an object");
  }
  return value;
}

/** @param {string[]} buffer @param {string} suffix */
function bufferEndsWith(buffer, suffix) {
  if (!suffix) {
    return true;
  }
  let tail = "";
  for (let i = buffer.length - 1; i >= 0 && tail.length < suffix.length; i--) {
    tail = String(buffer[i]) + tail;
  }
  return tail.endsWith(suffix);
}

/** @param {string[]} buffer */
function bufferLength(buffer) {
  let length = 0;
  for (const chunk of buffer) {
    length += String(chunk).length;
  }
  return length;
}

/** @param {import('./types.d.mts').OutputRegionMetadata[]} regions @param {number} start @param {number} offset */
function shiftRegions(regions, start, offset) {
  for (let i = start; i < regions.length; i++) {
    const region = regions[i];
    region.outputOffsetStart += offset;
    region.outputOffsetEnd += offset;
    for (const element of region.elements) {
      element.outputOffsetStart += offset;
      element.outputOffsetEnd += offset;
    }
  }
}

/** @param {readonly InlineNode[] | null | undefined} nodes @returns {string} */
function serializeInlines(nodes) {
  if (!nodes) {
    return "";
  }
  let out = "";
  for (const node of nodes) {
    out += serializeInline(node);
  }
  return out;
}

/** @param {unknown} value */
function serializeCodeSpan(value) {
  const text = String(value ?? "");
  let ticks = 1;
  while (text.includes("`".repeat(ticks))) {
    ticks += 1;
  }
  const fence = "`".repeat(ticks);
  let inner = text;
  if (text.startsWith("`") || text.endsWith("`")) {
    inner = ` ${text} `;
  } else if (text.length >= 2 && text.startsWith(" ") && text.endsWith(" ") && text.trim() !== "") {
    inner = ` ${text} `;
  }
  return `${fence}${inner}${fence}`;
}

/** @param {unknown} url */
function escapeLinkDestination(url) {
  const text = String(url ?? "");
  if (/[\s()]/.test(text)) {
    return `<${text.replace(/[<>]/g, "")}>`;
  }
  return text;
}

/** @param {unknown} title */
function serializeTitle(title) {
  if (title == null || title === "") {
    return "";
  }
  const text = String(title);
  if (!text.includes('"')) {
    return ` "${text}"`;
  }
  if (!text.includes("'")) {
    return ` '${text}'`;
  }
  return ` (${text.replace(/[()]/g, "")})`;
}

/** @param {import('./types.d.mts').LinkNode | import('./types.d.mts').LinkValue} node */
function serializeLink(node) {
  const text = serializeInlines("children" in node ? node.children : [textNode(node.text)]);
  const dest = escapeLinkDestination(node.url);
  return `[${text}](${dest}${serializeTitle(node.title)})`;
}

/** @param {import('./types.d.mts').ImageNode | import('./types.d.mts').ImageValue} node */
function serializeImage(node) {
  const alt = node.alt ?? "";
  const dest = escapeLinkDestination(node.url);
  return `![${alt}](${dest}${serializeTitle(node.title)})`;
}

/** @param {unknown} node */
function serializeAutolink(node) {
  const url = String(isDataObject(node) ? (node.url ?? node) : node);
  if ((isDataObject(node) && node.kind === "email") || url.startsWith("mailto:")) {
    return `<${url.replace(/^mailto:/, "")}>`;
  }
  return `<${url}>`;
}

/** @param {InlineNode | string | null} node @returns {string} */
function serializeInline(node) {
  if (node == null) {
    return "";
  }
  if (typeof node === "string") {
    return node;
  }
  switch (node.type) {
    case "text":
      return node.value ?? "";
    case "code_span":
      return serializeCodeSpan(node.value ?? "");
    case "emphasis":
      return `*${serializeInlines(node.children)}*`;
    case "strong":
      return `**${serializeInlines(node.children)}**`;
    case "link":
      return serializeLink(node);
    case "image":
      return serializeImage(node);
    case "autolink":
      return serializeAutolink(node);
    case "hard_break":
      return "  \n";
    case "soft_break":
      return "\n";
    case "html_inline":
      return node.value ?? "";
    default:
      throw makeUserError("unsupported inline node");
  }
}

/** @param {import('./types.d.mts').HeadingNode} node @param {WriterOptions} options */
function serializeHeading(node, options) {
  const level = clampLevel(node.level);
  const text = serializeInlines(node.children);
  if (options.headingStyle === "setext" && level <= 2 && text) {
    const underline = (level === 1 ? "=" : "-").repeat(Math.max(text.length, 3));
    return `${text}\n${underline}`;
  }
  return text ? `${"#".repeat(level)} ${text}` : "#".repeat(level);
}

/** @param {WriterOptions} options */
function fenceChar(options) {
  return options.fence === "~" || options.fence === "~~~" ? "~" : "`";
}

/** @param {import('./types.d.mts').CodeBlockNode} node */
function codeBlockInfo(node) {
  if (node.language == null || node.language === "") {
    return "";
  }
  const language = String(node.language);
  const meta = typeof node.meta === "string" ? node.meta : "";
  return meta === "" ? language : `${language} ${meta}`;
}

/** @param {import('./types.d.mts').CodeBlockNode} node @param {WriterOptions} options */
function serializeCodeBlock(node, options) {
  const value = node.value ?? "";
  if (node.fenced === false) {
    return String(value)
      .split("\n")
      .map((line) => (line ? `    ${line}` : ""))
      .join("\n");
  }
  const ch = fenceChar(options);
  let length = 3;
  const lines = String(value).split("\n");
  while (
    lines.some((line) => {
      const re =
        ch === "`" ? new RegExp(`^\`{${length},}[ \t]*$`) : new RegExp(`^~{${length},}[ \t]*$`);
      return re.test(line);
    })
  ) {
    length += 1;
  }
  const fence = ch.repeat(length);
  const info = codeBlockInfo(node);
  return `${fence}${info}\n${value}\n${fence}`;
}

/** @param {import('./types.d.mts').BlockQuoteNode} node @param {WriterOptions} options @returns {string} */
function serializeBlockQuote(node, options) {
  const inner = serializeBlocks(node.children ?? [], options);
  if (!inner) {
    return ">";
  }
  const lines = inner.split("\n");
  if (lines[lines.length - 1] === "") {
    lines.pop();
  }
  return lines.map((line) => (line === "" ? ">" : `> ${line}`)).join("\n");
}

/** @param {string} text @param {string} indent */
function indentNonList(text, indent) {
  if (!indent) {
    return text;
  }
  return text
    .split("\n")
    .map((line) => (line === "" ? line : indent + line))
    .join("\n");
}

/** @param {import('./types.d.mts').ListNode} node @param {WriterOptions} options @param {string} [indent] @returns {string} */
function serializeList(node, options, indent = "") {
  const bullet = options.bullet || "-";
  const delim = options.orderedDelim || ".";
  const useTight = node.tight != null ? node.tight : options.tightLists !== false;
  let number = node.start == null ? 1 : Number(node.start);
  const parts = [];
  for (const item of node.children ?? []) {
    const marker = node.ordered ? `${number}${delim}` : bullet;
    number += 1;
    const contentIndent = `${indent}${" ".repeat(String(marker).length + 1)}`;
    let checkbox = "";
    if (item.checked === true) {
      checkbox = "[x] ";
    } else if (item.checked === false) {
      checkbox = "[ ] ";
    }
    const children = item.children ?? [];
    if (children.length === 0) {
      parts.push(`${indent}${marker} ${checkbox}`.trimEnd());
      continue;
    }
    const first = children[0];
    let head = "";
    let rest = children;
    if (first.type === "paragraph") {
      head = serializeInlines(first.children);
      rest = children.slice(1);
    }
    const prefix = `${indent}${marker} ${checkbox}`;
    let firstChunk = `${prefix}${head}`.trimEnd();
    if (head.includes("\n")) {
      firstChunk = `${prefix}${head}`
        .split("\n")
        .map((line, index) => (index === 0 ? line : contentIndent + line))
        .join("\n");
    }
    if (!rest.length) {
      parts.push(firstChunk);
      continue;
    }
    const restChunks = rest.map((child) => {
      if (child.type === "list") {
        return serializeBlock(child, options, { indent: contentIndent, tight: useTight });
      }
      return indentNonList(
        serializeBlock(child, options, { indent: contentIndent, tight: useTight }),
        contentIndent,
      );
    });
    parts.push([firstChunk, ...restChunks].join(useTight ? "\n" : "\n\n"));
  }
  return parts.join(useTight ? "\n" : "\n\n");
}

/** @param {unknown} text */
function escapeTableCell(text) {
  return String(text ?? "").replace(/\|/g, "\\|");
}

/** @param {string} text @param {number} width @param {import('./types.d.mts').TableAlignment} align */
function padCell(text, width, align) {
  if (align === "right") {
    return text.padStart(width);
  }
  if (align === "center") {
    const extra = width - text.length;
    const left = Math.floor(Math.max(0, extra) / 2);
    return " ".repeat(left) + text + " ".repeat(Math.max(0, extra - left));
  }
  return text.padEnd(width);
}

/** @param {number} width @param {import('./types.d.mts').TableAlignment} align */
function separatorCell(width, align) {
  const w = Math.max(3, width);
  if (align === "left") {
    return `:${"-".repeat(w - 1)}`;
  }
  if (align === "right") {
    return `${"-".repeat(w - 1)}:`;
  }
  if (align === "center") {
    return `:${"-".repeat(w - 2)}:`;
  }
  return "-".repeat(w);
}

/** @param {unknown} value @returns {import('./types.d.mts').TableAlignment} */
function tableAlignment(value) {
  return value === "left" || value === "right" || value === "center" ? value : null;
}

/** @param {unknown} headers @param {unknown} rows @param {unknown} align @param {WriterOptions} options */
function serializeTableData(headers, rows, align, options) {
  if (!Array.isArray(headers) || headers.length === 0) {
    throw makeUserError("table headers must be a non-empty array");
  }
  /** @type {import('./types.d.mts').TableAlignment[]} */
  const normalizedAlign = headers.map((_, index) =>
    tableAlignment(Array.isArray(align) ? align[index] : null),
  );
  const normalizedRows = [];
  const sourceRows = rows ?? [];
  if (!Array.isArray(sourceRows)) {
    throw makeUserError("table rows must be an array");
  }
  for (const row of sourceRows) {
    if (!Array.isArray(row)) {
      throw makeUserError("table row must be an array");
    }
    if (row.length > headers.length) {
      throw makeUserError("table row has extra cells");
    }
    const next = row.map((cell) => String(cell ?? ""));
    while (next.length < headers.length) {
      next.push("");
    }
    normalizedRows.push(next);
  }
  const headerTexts = headers.map((cell) => escapeTableCell(cell));
  const rowTexts = normalizedRows.map((row) => row.map((cell) => escapeTableCell(cell)));
  const pad = options.tablePadding !== false;
  const widths = headers.map((_, index) => {
    let width = headerTexts[index].length;
    for (const row of rowTexts) {
      width = Math.max(width, row[index].length);
    }
    return Math.max(3, width);
  });
  /** @param {string[]} cells */
  const formatRow = (cells) => {
    const body = cells
      .map((cell, index) => (pad ? padCell(cell, widths[index], normalizedAlign[index]) : cell))
      .join(pad ? " | " : "|");
    return pad ? `| ${body} |` : `|${body}|`;
  };
  const sep = normalizedAlign
    .map((value, index) => separatorCell(pad ? widths[index] : 3, value))
    .join(pad ? " | " : "|");
  const sepLine = pad ? `| ${sep} |` : `|${sep}|`;
  return [formatRow(headerTexts), sepLine, ...rowTexts.map(formatRow)].join("\n");
}

/** @param {readonly (import('./types.d.mts').TableCell | string | null)[] | undefined} cells */
function tableCellsToStrings(cells) {
  return (cells ?? []).map((cell) => {
    if (cell == null) {
      return "";
    }
    if (typeof cell === "string") {
      return cell;
    }
    return serializeInlines(cell.children);
  });
}

/** @param {import('./types.d.mts').TableNode} node @param {WriterOptions} options */
function serializeTable(node, options) {
  const headers = tableCellsToStrings(node.headers);
  const rows = (node.rows ?? []).map((row) => tableCellsToStrings(row));
  return serializeTableData(headers, rows, node.align, options);
}

/** @param {MarkdownNode | null} node @param {WriterOptions} options
 * @param {{indent?: string, tight?: boolean}} [ctx] @returns {string} */
function serializeBlock(node, options, ctx = {}) {
  if (!node || typeof node !== "object") {
    return "";
  }
  switch (node.type) {
    case "heading":
      return serializeHeading(node, options);
    case "paragraph":
      return serializeInlines(node.children);
    case "thematic_break":
      return "---";
    case "code_block":
      return serializeCodeBlock(node, options);
    case "block_quote":
      return serializeBlockQuote(node, options);
    case "list":
      return serializeList(node, options, ctx.indent ?? "");
    case "list_item":
      return serializeList(
        {
          type: "list",
          ordered: false,
          start: null,
          tight: options.tightLists !== false,
          children: [node],
        },
        options,
        ctx.indent ?? "",
      );
    case "table":
      return serializeTable(node, options);
    case "html_block":
      return node.value ?? "";
    case "frontmatter": {
      const body = node.raw ?? node.content ?? stringifyYaml(node.data ?? {});
      const separator = body.endsWith("\n") || body.endsWith("\r") ? "" : "\n";
      return `---\n${body}${separator}---`;
    }
    case "raw":
      return node.value ?? "";
    case "document":
      return serializeBlocks(node.children ?? [], options);
    default:
      return serializeInline(node);
  }
}

/** @param {readonly BlockNode[]} nodes @param {WriterOptions} options @returns {string} */
function serializeBlocks(nodes, options) {
  const parts = [];
  for (const node of nodes ?? []) {
    const text = serializeBlock(node, options);
    if (text !== "") {
      parts.push(text.replace(/\n+$/, ""));
    }
  }
  return parts.join("\n\n");
}

/** @param {unknown} text @returns {import('./types.d.mts').ParagraphNode} */
function paragraphFromText(text) {
  const value = String(text ?? "");
  if (!value) {
    return { type: "paragraph", children: [] };
  }
  /** @type {InlineNode[]} */
  const children = [];
  const lines = value.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]) {
      children.push(textNode(lines[i]));
    }
    if (i < lines.length - 1) {
      children.push({ type: "soft_break" });
    }
  }
  return { type: "paragraph", children };
}

/** @param {unknown} level @param {unknown} text @returns {import('./types.d.mts').HeadingNode} */
function headingNode(level, text) {
  return { type: "heading", level: clampLevel(level), children: text ? [textNode(text)] : [] };
}

/** @param {unknown[]} items @param {WriterOptions} options @returns {import('./types.d.mts').ListNode} */
function listNodeFromItems(items, options) {
  return {
    type: "list",
    ordered: false,
    start: null,
    tight: options.tightLists !== false,
    children: items.map((item) => ({
      type: "list_item",
      checked: null,
      children: [paragraphFromText(item)],
    })),
  };
}

/** @param {string[]} headers @param {string[][]} rows @param {import('./types.d.mts').TableAlignment[] | undefined} align @returns {import('./types.d.mts').TableNode} */
function tableNodeFromData(headers, rows, align) {
  /** @param {string} text */
  const toCell = (text) => ({ children: text ? [textNode(text)] : [] });
  return {
    type: "table",
    align: headers.map((_, index) => tableAlignment(align?.[index])),
    headers: headers.map(toCell),
    rows: rows.map((row) => row.map(toCell)),
  };
}

/** @param {unknown} url @param {unknown} text @param {unknown} title @returns {import('./types.d.mts').LinkNode} */
function linkNode(url, text, title) {
  return {
    type: "link",
    url: String(url ?? ""),
    title: title == null ? null : String(title),
    children: [textNode(text ?? "")],
  };
}

/** @param {unknown} url @param {unknown} alt @param {unknown} title @returns {import('./types.d.mts').ImageNode} */
function imageNode(url, alt, title) {
  return {
    type: "image",
    url: String(url ?? ""),
    title: title == null ? null : String(title),
    alt: String(alt ?? ""),
  };
}

/** @param {unknown} url @returns {import('./types.d.mts').AutolinkNode} */
function autolinkNode(url) {
  const href = String(url ?? "");
  const email = href.startsWith("mailto:");
  return {
    type: "autolink",
    url: href,
    kind: email ? "email" : "url",
    children: [textNode(email ? href.slice("mailto:".length) : href)],
  };
}

/**
 * One speculative output transaction. Only commit appends chunks and shifts
 * region offsets into the parent buffer. Rollback also restores bindings and
 * enclosing optional counters, so failed attempts leave no observable residue.
 */
class OutputFrame {
  /** @param {Writer} writer */
  constructor(writer) {
    this.writer = writer;
    this.buffer = writer.buffer;
    this.nodes = writer.nodes;
    this.current = writer.current;
    this.bindings = new Map(writer.bindings);
    this.regionStart = writer.regionMap.length;
    this.outputStart = bufferLength(writer.buffer);
    this.repeatMissed = writer._repeatMissed;
    this.optional = writer._optionalFrame;
    this.optionalState = this.optional ? { ...this.optional } : null;
    writer.buffer = [];
    writer.nodes = [];
    writer.current = null;
  }

  /** @param {boolean} commit */
  finish(commit) {
    const writer = this.writer;
    if (commit) {
      shiftRegions(writer.regionMap, this.regionStart, this.outputStart);
      this.buffer.push(...writer.buffer);
      this.nodes.push(...writer.nodes);
    } else {
      writer.regionMap.length = this.regionStart;
      writer.bindings = this.bindings;
      if (this.optional) {
        Object.assign(this.optional, this.optionalState);
      }
    }
    writer.buffer = this.buffer;
    writer.nodes = this.nodes;
    writer.current = this.current;
    writer._repeatMissed = this.repeatMissed;
  }
}

/**
 * Render data through the same slot protocol as Reader. Bound values emit text;
 * optional/repeat frames stage buffers and regions before committing output.
 * Raw slots bypass EOL normalization to preserve retained source bytes.
 * @template {Record<string, unknown>} [TData=Record<string, unknown>]
 */
export class Writer {
  /** @returns {'writer'} */
  get mode() {
    return "writer";
  }
  /** @param {TData} [data] @param {WriterOptions} [options] */
  constructor(data = /** @type {TData} */ ({}), options = {}) {
    if (!isDataObject(data)) {
      throw makeUserError("data must be an object");
    }

    this.data = data;
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.context = data;
    /** @type {string[]} */
    this.buffer = [];
    /** @type {BlockNode[]} */
    this.nodes = [];
    /** @type {import('./types.d.mts').ParagraphNode | null} */
    this.current = null;
    /** @type {Map<string, import('./RuntimeContracts.d.mts').BindingMode>} */
    this.bindings = new Map();
    /** @type {import('./types.d.mts').OutputRegionMetadata[]} */
    this.regionMap = [];
    this.regionPathPrefix = "";
    this.optionalMode = false;
    /** @type {number | undefined} */
    this.repeatIndex = undefined;
    this.file = options.file ?? options.path ?? null;
    /** @internal @type {Writer | null} */
    this._parent = null;
    /** @internal @type {OptionalFrame | null} */
    this._optionalFrame = null;
    /** @internal */
    this._repeatMissed = false;
  }

  /** @param {unknown} [text] */
  write(text = "") {
    this.buffer.push(normalizeEol(text, this.options.eol));
    return this;
  }

  /** @param {unknown} [text] */
  writeRaw(text = "") {
    this.buffer.push(String(text));
    return this;
  }

  /** @param {unknown} text */
  literal(text) {
    this.write(text ?? "");
    return this;
  }

  /** @returns {Slot<string>} */
  line() {
    return new Slot(this, { leafType: "line" });
  }

  /** @param {unknown} [_limiter] @returns {Slot<string>} */
  text(_limiter) {
    return new Slot(this, { leafType: "text" });
  }

  /** @param {unknown} [_limiter] @returns {Slot<string>} */
  until(_limiter) {
    return new Slot(this, { leafType: "text" });
  }

  /** @param {RegExp | string} [_re] @returns {Slot<string>} */
  regexp(_re) {
    return new Slot(this, { leafType: "text" });
  }

  /** @param {number} [level] @returns {Slot<string>} */
  heading(level) {
    /** @type {Slot<string>} */
    const slot = new Slot(this, { leafType: "heading" });
    slot.headingLevel = level == null ? 1 : clampLevel(level);
    return slot;
  }

  /** @returns {Slot<string>} */
  paragraph() {
    return new Slot(this, { leafType: "paragraph" });
  }

  /** @returns {Slot<string[]>} */
  list() {
    return new Slot(this, { leafType: "list" });
  }

  /** @returns {Slot<import('./types.d.mts').ListTreeValue>} */
  listTree() {
    return new Slot(this, { leafType: "listTree" });
  }

  /** @template {Record<string, unknown>} [T=Record<string, unknown>]
   * @param {import('./types.d.mts').SafeParseSchema<T> | {schema?: import('./types.d.mts').SafeParseSchema<T>}} [options]
   * @returns {Slot<import('./types.d.mts').FrontmatterValue<T> | T>} */
  frontmatter(options = {}) {
    /** @type {Slot<import('./types.d.mts').FrontmatterValue<T> | T>} */
    const slot = new Slot(this, { leafType: "frontmatter" });
    slot.frontmatterOptions = options;
    return slot;
  }

  /** @param {unknown} [_limiter] @returns {Slot<string>} */
  rawUntil(_limiter) {
    return new Slot(this, { leafType: "rawUntil" });
  }

  /** @param {unknown} type @returns {Slot<string>} */
  rawUntilElement(type) {
    if (type !== "list") {
      throw makeTemplateError('rawUntilElement type must be "list"');
    }
    return new Slot(this, { leafType: "rawUntilElement" });
  }

  /** @returns {Slot<string>} */
  rawBlock() {
    return new Slot(this, { leafType: "rawBlock" });
  }

  /** @returns {Slot<string>} */
  rawRest() {
    return new Slot(this, { leafType: "rawRest" });
  }

  /** @returns {Slot<import('./types.d.mts').TableValue>} */
  table() {
    return new Slot(this, { leafType: "table" });
  }

  /** @returns {Slot<import('./types.d.mts').CodeBlockValue>} */
  codeBlock() {
    return new Slot(this, { leafType: "codeBlock" });
  }

  /** @returns {Slot<string>} */
  blockQuote() {
    return new Slot(this, { leafType: "blockQuote" });
  }

  /** @returns {Slot<true>} */
  thematicBreak() {
    return new Slot(this, { leafType: "thematicBreak" });
  }

  /** @returns {Slot<string>} */
  htmlBlock() {
    return new Slot(this, { leafType: "htmlBlock" });
  }

  /** @returns {Slot<import('./types.d.mts').LinkValue>} */
  link() {
    return new Slot(this, { leafType: "link" });
  }

  /** @returns {Slot<import('./types.d.mts').ImageValue>} */
  image() {
    return new Slot(this, { leafType: "image" });
  }

  /** @returns {Slot<string>} */
  autolink() {
    return new Slot(this, { leafType: "autolink" });
  }

  /** @returns {Slot<string>} */
  codeSpan() {
    return new Slot(this, { leafType: "codeSpan" });
  }

  /** @returns {Slot<boolean>} */
  checkbox() {
    return new Slot(this, { leafType: "checkbox" });
  }

  /** @param {(writer: this) => void} fn */
  query(fn) {
    if (typeof fn !== "function") {
      throw makeTemplateError("query requires a callback");
    }
    fn(this);
    return this;
  }

  /** @param {unknown} [_predicate] @returns {false} */
  skipUntilHeading(_predicate) {
    return false;
  }

  /** @param {import('./RuntimeContracts.d.mts').BindingMode} mode */
  noteWriterMiss(mode) {
    if (mode === "asArray") {
      this._repeatMissed = true;
      return;
    }
    if (this._optionalFrame) {
      this._optionalFrame.missed = true;
    }
  }

  noteWriterBind() {
    if (this._optionalFrame) {
      this._optionalFrame.bound += 1;
    }
  }

  /** @internal @param {Record<string, unknown>} element @param {string} path @returns {Writer} */
  _forkChild(element, path) {
    const child = new Writer(element, this.options);
    child.buffer = this.buffer;
    child.nodes = this.nodes;
    child.regionMap = this.regionMap;
    child.regionPathPrefix = path;
    child.optionalMode = this.optionalMode;
    child._optionalFrame = this._optionalFrame;
    child._parent = this;
    child.file = this.file;
    return child;
  }

  /** Stage optional output; commit only a successful branch with bound data. */
  /** @overload @returns {this} */
  /** @overload @param {(writer: this) => void} fn @returns {boolean} */
  /** @param {((writer: this) => void)} [fn] @returns {this | boolean} */
  optional(fn) {
    if (typeof fn !== "function") {
      this.optionalMode = true;
      return this;
    }

    const savedOptional = this.optionalMode;
    const savedFrame = this._optionalFrame;
    const frame = new OutputFrame(this);
    this.optionalMode = true;
    this._optionalFrame = { missed: false, bound: 0 };
    let committed = false;
    try {
      fn(this);
      const ok = !this._optionalFrame.missed && this._optionalFrame.bound > 0;
      if (ok && savedFrame) {
        savedFrame.bound += this._optionalFrame.bound;
      }
      committed = ok;
      return ok;
    } finally {
      frame.finish(committed);
      this.optionalMode = savedOptional;
      this._optionalFrame = savedFrame;
    }
  }

  /** Child scopes share committed output but own independent binding registries. */
  /** @param {keyof TData & string} key @param {(writer: Writer, index: number) => void} fn */
  scope(key, fn) {
    registerBinding(this, key, "as");
    const items = this.data != null && typeof this.data === "object" ? this.data[key] : undefined;
    const path = this.regionPathPrefix ? `${this.regionPathPrefix}.${key}` : String(key);
    const start = bufferLength(this.buffer);
    /** @type {import('./types.d.mts').OutputRegionElement[]} */
    const elements = [];
    if (items === undefined || items === null || (Array.isArray(items) && items.length === 0)) {
      this.regionMap.push({
        key: path,
        path,
        outputOffsetStart: start,
        outputOffsetEnd: start,
        elements,
      });
      return;
    }
    if (!Array.isArray(items)) {
      throw makeTemplateError(`key ${JSON.stringify(key)} is not an array`);
    }
    const count = items.length;
    if (count >= MAX_ITERATIONS) {
      throw makeTemplateError("max scope iterations exceeded");
    }
    for (let index = 0; index < count; index++) {
      const elementStart = bufferLength(this.buffer);
      const elementPath = `${path}[${index}]`;
      const element = items[index];
      if (!isDataObject(element)) {
        throw makeUserError("data must be an object");
      }
      fn(this._forkChild(element, elementPath), index);
      elements.push({
        path: elementPath,
        outputOffsetStart: elementStart,
        outputOffsetEnd: bufferLength(this.buffer),
      });
    }
    this.regionMap.push({
      key: path,
      path,
      outputOffsetStart: start,
      outputOffsetEnd: bufferLength(this.buffer),
      elements,
    });
  }

  /** Each array iteration stages output; a missing binding discards only that attempt. */
  /** @param {(writer: this, index: number) => unknown} fn */
  repeat(fn) {
    const savedIndex = this.repeatIndex;
    const savedMissed = this._repeatMissed;
    let stopped = false;
    try {
      for (let index = 0; index < MAX_ITERATIONS; index++) {
        const frame = new OutputFrame(this);
        this.repeatIndex = index;
        this._repeatMissed = false;

        let committed = false;
        try {
          const result = fn(this, index);
          committed = result !== false && !this._repeatMissed;
          if (!committed) {
            stopped = true;
            break;
          }
        } finally {
          frame.finish(committed);
        }
      }
    } finally {
      this.repeatIndex = savedIndex;
      this._repeatMissed = savedMissed;
    }
    if (!stopped) {
      throw makeTemplateError("max scope iterations exceeded");
    }
  }

  /** @param {SlotDescription} slot @param {unknown} value */
  emitBoundValue(slot, value) {
    const text = this.serializeSlotValue(slot, value);
    if (text !== "") {
      const retainedFrontmatter =
        slot.leafType === "frontmatter" && isDataObject(value) && value.source === text;
      if (
        ["rawUntil", "rawUntilElement", "rawBlock", "rawRest"].includes(slot.leafType) ||
        retainedFrontmatter
      ) {
        this.writeRaw(text);
      } else {
        this.write(text);
      }
    }
    this.recordSlotNode(slot, value);
  }

  /** @param {SlotDescription} slot @param {unknown} value @returns {string} */
  serializeSlotValue(slot, value) {
    switch (slot?.leafType) {
      case "heading":
        return serializeHeading(headingNode(slot.headingLevel ?? 1, value), this.options);
      case "paragraph":
      case "blockQuote":
      case "htmlBlock":
      case "line":
      case "text":
      case "rawUntil":
      case "rawUntilElement":
      case "rawBlock":
      case "rawRest":
        return value == null ? "" : String(value);
      case "list":
        if (!Array.isArray(value)) {
          throw makeUserError("list value must be an array");
        }
        return serializeList(
          listNodeFromItems(
            value.map((item) => String(item ?? "")),
            this.options,
          ),
          this.options,
        );
      case "listTree":
        return serializeList(listNodeFromTree(value), this.options);
      case "frontmatter":
        return frontmatterValue(value, slot.frontmatterOptions).markdown;
      case "table":
        return this.serializeTableValue(value);
      case "codeBlock":
        return this.serializeCodeBlockValue(value);
      case "thematicBreak":
        return "---";
      case "link":
        return this.serializeLinkValue(value);
      case "image":
        return this.serializeImageValue(value);
      case "autolink":
        return serializeAutolink(typeof value === "string" ? { url: value } : value);
      case "codeSpan":
        return serializeCodeSpan(value);
      case "checkbox":
        return value ? "[x]" : "[ ]";
      default:
        return value == null ? "" : String(value);
    }
  }

  /** @param {unknown} value */
  serializeTableValue(value) {
    if (!isDataObject(value) || Array.isArray(value)) {
      throw makeUserError("table value must be an object");
    }
    return serializeTableData(value.headers, value.rows ?? [], value.align, this.options);
  }

  /** @param {unknown} value */
  serializeCodeBlockValue(value) {
    if (!isDataObject(value) || Array.isArray(value)) {
      throw makeUserError("codeBlock value must be an object");
    }
    return serializeCodeBlock(
      {
        type: "code_block",
        language: value.language == null ? null : String(value.language),
        meta: typeof value.meta === "string" ? value.meta : "",
        value: String(value.value ?? ""),
        fenced: true,
      },
      this.options,
    );
  }

  /** @param {unknown} value */
  serializeLinkValue(value) {
    if (!isDataObject(value) || Array.isArray(value)) {
      throw makeUserError("link value must be an object");
    }
    return serializeLink(linkNode(value.url, value.text, value.title));
  }

  /** @param {unknown} value */
  serializeImageValue(value) {
    if (!isDataObject(value) || Array.isArray(value)) {
      throw makeUserError("image value must be an object");
    }
    return serializeImage(imageNode(value.url, value.alt, value.title));
  }

  /** Record only after serializeSlotValue has validated the dynamic binding.
   * @private @param {SlotDescription} slot @param {unknown} value */
  recordSlotNode(slot, value) {
    switch (slot?.leafType) {
      case "heading":
        this.closeCurrent();
        this.nodes.push(headingNode(slot.headingLevel ?? 1, value));
        return;
      case "paragraph":
        this.closeCurrent();
        this.nodes.push(paragraphFromText(value));
        return;
      case "list":
        this.closeCurrent();
        this.nodes.push(
          listNodeFromItems(
            /** @type {unknown[]} */ (value).map((item) => String(item ?? "")),
            this.options,
          ),
        );
        return;
      case "listTree":
        this.closeCurrent();
        this.nodes.push(listNodeFromTree(value));
        return;
      case "frontmatter":
        this.closeCurrent();
        this.nodes.push(frontmatterValue(value, slot.frontmatterOptions).node);
        return;
      case "rawUntil":
      case "rawUntilElement":
      case "rawBlock":
      case "rawRest":
        this.closeCurrent();
        this.nodes.push({ type: "raw", value: String(value ?? "") });
        return;
      case "table": {
        const table = /** @type {import('./types.d.mts').TableValue} */ (value);
        this.closeCurrent();
        this.nodes.push(
          tableNodeFromData(
            table.headers.map((cell) => String(cell ?? "")),
            (table.rows ?? []).map((row) => {
              const next = row.map((cell) => String(cell ?? ""));
              while (next.length < table.headers.length) {
                next.push("");
              }
              return next.slice(0, table.headers.length);
            }),
            table.align,
          ),
        );
        return;
      }
      case "codeBlock": {
        const block = /** @type {import('./types.d.mts').CodeBlockValue} */ (value);
        this.closeCurrent();
        this.nodes.push({
          type: "code_block",
          language: block.language == null ? null : String(block.language),
          meta: typeof block.meta === "string" ? block.meta : "",
          value: String(block.value ?? ""),
          fenced: true,
        });
        return;
      }
      case "blockQuote":
        this.closeCurrent();
        this.nodes.push({
          type: "block_quote",
          children: [paragraphFromText(value)],
        });
        return;
      case "thematicBreak":
        this.closeCurrent();
        this.nodes.push({ type: "thematic_break" });
        return;
      case "htmlBlock":
        this.closeCurrent();
        this.nodes.push({ type: "html_block", value: String(value ?? "") });
        return;
      case "link":
        {
          const link = /** @type {import('./types.d.mts').LinkValue} */ (value);
          this.pushInline(linkNode(link.url, link.text, link.title));
        }
        return;
      case "image":
        {
          const image = /** @type {import('./types.d.mts').ImageValue} */ (value);
          this.pushInline(imageNode(image.url, image.alt, image.title));
        }
        return;
      case "autolink":
        this.pushInline(
          typeof value === "string"
            ? autolinkNode(value)
            : autolinkNode(isDataObject(value) ? value.url : value),
        );
        return;
      case "codeSpan":
        this.pushInline({ type: "code_span", value: String(value ?? "") });
        return;
      case "checkbox":
        this.pushInline(textNode(value ? "[x]" : "[ ]"));
        return;
      default:
        this.pushInline(textNode(value));
    }
  }

  /** @param {number} level @param {unknown} text */
  writeHeading(level, text) {
    this.closeCurrent();
    this.ensureBlockStart();
    const node = headingNode(level, text);
    this.write(`${serializeHeading(node, this.options)}\n\n`);
    this.nodes.push(node);
    return this;
  }

  /** @param {unknown} text */
  writeParagraph(text) {
    this.closeCurrent();
    this.ensureBlockStart();
    const node = paragraphFromText(text);
    this.write(`${serializeInlines(node.children)}\n\n`);
    this.nodes.push(node);
    return this;
  }

  /** @param {unknown} text */
  writeText(text) {
    const value = String(text ?? "");
    this.write(value);
    if (value) {
      this.pushInline(textNode(value));
    }
    return this;
  }

  /** @param {unknown} text */
  writeLine(text) {
    this.writeText(text);
    this.write("\n");
    if (this.current?.type === "paragraph") {
      this.current.children.push({ type: "soft_break" });
    }
    return this;
  }

  writeNewline(count = 1) {
    this.closeCurrent();
    this.write("\n".repeat(count));
    return this;
  }

  /** @param {unknown[]} items */
  writeList(items) {
    if (!Array.isArray(items)) {
      throw makeUserError("list value must be an array");
    }
    this.closeCurrent();
    this.ensureBlockStart();
    const node = listNodeFromItems(
      items.map((item) => String(item ?? "")),
      this.options,
    );
    this.write(`${serializeList(node, this.options)}\n\n`);
    this.nodes.push(node);
    return this;
  }

  /** @param {import('./types.d.mts').TableValue} table */
  writeTable(table) {
    this.closeCurrent();
    this.ensureBlockStart();
    const markdown = this.serializeTableValue(table);
    const rows = (table.rows ?? []).map((row) => {
      if (row.length > table.headers.length) {
        throw makeUserError("table row has extra cells");
      }
      const next = row.map((cell) => String(cell ?? ""));
      while (next.length < table.headers.length) {
        next.push("");
      }
      return next;
    });
    const node = tableNodeFromData(
      table.headers.map((cell) => String(cell ?? "")),
      rows,
      table.align,
    );
    this.write(`${markdown}\n\n`);
    this.nodes.push(node);
    return this;
  }

  /** @param {unknown} value @param {unknown} [language] */
  writeCodeBlock(value, language) {
    this.closeCurrent();
    this.ensureBlockStart();
    /** @type {import('./types.d.mts').CodeBlockNode} */
    const node = {
      type: "code_block",
      language: language == null || language === "" ? null : String(language),
      meta: "",
      value: String(value ?? ""),
      fenced: true,
    };
    this.write(`${serializeCodeBlock(node, this.options)}\n\n`);
    this.nodes.push(node);
    return this;
  }

  /** @param {unknown} value */
  writeBlockQuote(value) {
    this.closeCurrent();
    this.ensureBlockStart();
    /** @type {import('./types.d.mts').BlockQuoteNode} */
    const node = { type: "block_quote", children: [paragraphFromText(value)] };
    this.write(`${serializeBlockQuote(node, this.options)}\n\n`);
    this.nodes.push(node);
    return this;
  }

  writeThematicBreak() {
    this.closeCurrent();
    this.ensureBlockStart();
    this.write("---\n\n");
    this.nodes.push({ type: "thematic_break" });
    return this;
  }

  /** @param {unknown} value */
  writeHtmlBlock(value) {
    this.closeCurrent();
    this.ensureBlockStart();
    /** @type {import('./types.d.mts').HtmlBlockNode} */
    const node = { type: "html_block", value: String(value ?? "") };
    this.write(`${node.value}\n\n`);
    this.nodes.push(node);
    return this;
  }

  /** @param {unknown} href @param {unknown} text @param {unknown} [title] */
  writeLink(href, text, title) {
    const node = linkNode(href, text, title);
    this.write(serializeLink(node));
    this.pushInline(node);
    return this;
  }

  /** @param {unknown} src @param {unknown} alt @param {unknown} [title] */
  writeImage(src, alt, title) {
    const node = imageNode(src, alt, title);
    this.write(serializeImage(node));
    this.pushInline(node);
    return this;
  }

  /** @param {unknown} url */
  writeAutolink(url) {
    const node = autolinkNode(url);
    this.write(serializeAutolink(node));
    this.pushInline(node);
    return this;
  }

  /** @param {unknown} value */
  writeCodeSpan(value) {
    /** @type {import('./types.d.mts').CodeSpanNode} */
    const node = { type: "code_span", value: String(value ?? "") };
    this.write(serializeCodeSpan(node.value));
    this.pushInline(node);
    return this;
  }

  /** @param {unknown} text */
  writeEmphasis(text) {
    /** @type {import('./types.d.mts').EmphasisNode} */
    const node = { type: "emphasis", children: [textNode(text)] };
    this.write(serializeInline(node));
    this.pushInline(node);
    return this;
  }

  /** @param {unknown} text */
  writeStrong(text) {
    /** @type {import('./types.d.mts').EmphasisNode} */
    const node = { type: "strong", children: [textNode(text)] };
    this.write(serializeInline(node));
    this.pushInline(node);
    return this;
  }

  /** @param {unknown} checked */
  writeCheckbox(checked) {
    const text = checked ? "[x]" : "[ ]";
    this.write(text);
    this.pushInline(textNode(text));
    return this;
  }

  /** @param {MarkdownNode | null} node */
  append(node) {
    if (node == null) {
      return this;
    }
    if (node.type === "document") {
      for (const child of node.children ?? []) {
        this.append(child);
      }
      return this;
    }
    if (isBlock(node)) {
      this.closeCurrent();
      this.ensureBlockStart();
      const markdown = serializeBlock(node, this.options);
      if (markdown !== "") {
        this.write(markdown);
      }
      this.ensureBlankLine();
      this.nodes.push(stripNode(node));
      return this;
    }
    this.write(serializeInline(node));
    this.pushInline(stripNode(node));
    return this;
  }

  toMarkdown() {
    return this.buffer.join("");
  }

  toString() {
    return this.toMarkdown();
  }

  /** @returns {import('./types.d.mts').DocumentNode} */
  toAst() {
    this.closeCurrent();
    return { type: "document", children: this.nodes.slice() };
  }

  ensureParagraph() {
    if (this.current?.type === "paragraph") {
      return this.current;
    }
    this.closeCurrent();
    this.current = { type: "paragraph", children: [] };
    return this.current;
  }

  /** @param {InlineNode} node */
  pushInline(node) {
    const current = this.ensureParagraph();
    const last = current.children[current.children.length - 1];
    if (node.type === "text" && last?.type === "text") {
      last.value += node.value;
      return;
    }
    current.children.push(node);
  }

  closeCurrent() {
    if (!this.current) {
      return;
    }
    if (this.current.type === "paragraph") {
      this.nodes.push(this.current);
    }
    this.current = null;
  }

  ensureBlockStart() {
    if (!this.buffer.length) {
      return;
    }
    if (!bufferEndsWith(this.buffer, "\n")) {
      this.write("\n");
    }
  }

  ensureBlankLine() {
    if (!this.buffer.length) {
      return;
    }
    if (bufferEndsWith(this.buffer, "\n\n")) {
      return;
    }
    if (bufferEndsWith(this.buffer, "\n")) {
      this.write("\n");
      return;
    }
    this.write("\n\n");
  }
}
