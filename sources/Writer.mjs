import { isDeepStrictEqual } from "node:util";

import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

import { Slot, registerBinding } from "./Slot.mjs";
import { makeTemplateError, makeUserError } from "./SyntaxError.mjs";

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

const DEFAULT_OPTIONS = {
  bullet: "-",
  orderedDelim: ".",
  fence: "`",
  headingStyle: "atx",
  tightLists: true,
  tablePadding: true,
  eol: "\n",
};

function normalizeEol(text, eol) {
  const replacement = eol === "\r\n" || eol === "\r" ? eol : "\n";
  return String(text).replace(/\r\n|\r|\n/g, replacement);
}

function isDataObject(value) {
  return value != null && typeof value === "object";
}

function clampLevel(level) {
  const n = Number(level);
  if (!Number.isInteger(n)) {
    return 1;
  }
  return Math.min(6, Math.max(1, n));
}

function textNode(value) {
  return { type: "text", value: String(value ?? "") };
}

function stripNode(node) {
  if (node == null || typeof node !== "object") {
    return node;
  }
  if (Array.isArray(node)) {
    return node.map(stripNode);
  }
  const out = {};
  for (const [key, value] of Object.entries(node)) {
    if (key === "position") {
      continue;
    }
    out[key] = stripNode(value);
  }
  return out;
}

function schemaFromOptions(options) {
  return options?.schema?.safeParse ? options.schema : options?.safeParse ? options : null;
}

function listNodeFromTree(value) {
  if (value == null || typeof value !== "object" || Array.isArray(value) || !Array.isArray(value.items)) {
    throw makeUserError("listTree value must be an object with an items array");
  }
  const ordered = value.ordered === true;
  const start = ordered ? Number(value.start ?? 1) : null;
  if (ordered && (!Number.isInteger(start) || start < 0)) {
    throw makeUserError("listTree start must be a non-negative integer");
  }
  return {
    type: "list",
    ordered,
    start,
    tight: value.tight !== false,
    children: value.items.map((item) => {
      if (item == null || typeof item !== "object" || !Array.isArray(item.children)) {
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

function frontmatterValue(value, options) {
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    throw makeUserError("frontmatter value must be an object");
  }
  const structured =
    value.format === "yaml" &&
    Object.hasOwn(value, "data") &&
    Object.hasOwn(value, "raw") &&
    Object.hasOwn(value, "content");
  let data = structured ? value.data : value;
  if (data == null || typeof data !== "object" || Array.isArray(data)) {
    throw makeUserError("frontmatter data must be an object");
  }
  const schema = schemaFromOptions(options);
  if (schema) {
    const result = schema.safeParse(data);
    if (!result?.success) {
      throw makeUserError(`frontmatter validation failed${result?.error?.message ? `: ${result.error.message}` : ""}`);
    }
    if (!Object.hasOwn(result, "data")) {
      throw makeUserError("frontmatter validation succeeded without data");
    }
    data = result.data;
  }
  const raw = structured ? (value.raw ?? value.content) : null;
  let retainedRaw = false;
  if (typeof raw === "string") {
    try {
      const parsed = parseYaml(raw);
      retainedRaw = isDeepStrictEqual(parsed == null && raw.trim() === "" ? {} : parsed, data);
    } catch {
      // Invalid retained raw is replaced by canonical YAML below.
    }
  }
  const source = retainedRaw && typeof value.source === "string" ? value.source : null;
  const body = retainedRaw ? raw : stringifyYaml(data);
  const separator = body.endsWith("\n") || body.endsWith("\r") ? "" : "\n";
  return {
    node: { type: "frontmatter", format: "yaml", raw: body, content: body, data: stripNode(data) },
    markdown: source ?? `---\n${body}${separator}---`,
  };
}

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

function bufferLength(buffer) {
  let length = 0;
  for (const chunk of buffer) {
    length += String(chunk).length;
  }
  return length;
}

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

function escapeLinkDestination(url) {
  const text = String(url ?? "");
  if (/[\s()]/.test(text)) {
    return `<${text.replace(/[<>]/g, "")}>`;
  }
  return text;
}

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

function serializeLink(node) {
  const text = serializeInlines(node.children ?? [textNode(node.text)]);
  const dest = escapeLinkDestination(node.url);
  return `[${text}](${dest}${serializeTitle(node.title)})`;
}

function serializeImage(node) {
  const alt = node.alt ?? serializeInlines(node.children);
  const dest = escapeLinkDestination(node.url);
  return `![${alt}](${dest}${serializeTitle(node.title)})`;
}

function serializeAutolink(node) {
  const url = String(node.url ?? node);
  if (node.kind === "email" || url.startsWith("mailto:")) {
    return `<${url.replace(/^mailto:/, "")}>`;
  }
  return `<${url}>`;
}

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
      if (node.children) {
        return serializeInlines(node.children);
      }
      return node.value == null ? "" : String(node.value);
  }
}

function serializeHeading(node, options) {
  const level = clampLevel(node.level);
  const text = serializeInlines(node.children);
  if (options.headingStyle === "setext" && level <= 2 && text) {
    const underline = (level === 1 ? "=" : "-").repeat(Math.max(text.length, 3));
    return `${text}\n${underline}`;
  }
  return text ? `${"#".repeat(level)} ${text}` : "#".repeat(level);
}

function fenceChar(options) {
  return options.fence === "~" || options.fence === "~~~" ? "~" : "`";
}

function codeBlockInfo(node) {
  if (node.language == null || node.language === "") {
    return "";
  }
  const language = String(node.language);
  const meta = typeof node.meta === "string" ? node.meta : "";
  return meta === "" ? language : `${language} ${meta}`;
}

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
  while (lines.some((line) => {
    const re = ch === "`" ? new RegExp(`^\`{${length},}[ \t]*$`) : new RegExp(`^~{${length},}[ \t]*$`);
    return re.test(line);
  })) {
    length += 1;
  }
  const fence = ch.repeat(length);
  const info = codeBlockInfo(node);
  return `${fence}${info}\n${value}\n${fence}`;
}

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

function indentNonList(text, indent) {
  if (!indent) {
    return text;
  }
  return text
    .split("\n")
    .map((line) => (line === "" ? line : indent + line))
    .join("\n");
}

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
      return indentNonList(serializeBlock(child, options, { indent: contentIndent, tight: useTight }), contentIndent);
    });
    parts.push([firstChunk, ...restChunks].join(useTight ? "\n" : "\n\n"));
  }
  return parts.join(useTight ? "\n" : "\n\n");
}

function escapeTableCell(text) {
  return String(text ?? "").replace(/\|/g, "\\|");
}

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

function serializeTableData(headers, rows, align, options) {
  if (!Array.isArray(headers) || headers.length === 0) {
    throw makeUserError("table headers must be a non-empty array");
  }
  const normalizedAlign = headers.map((_, index) => align?.[index] ?? null);
  const normalizedRows = [];
  for (const row of rows ?? []) {
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

function serializeTable(node, options) {
  const headers = tableCellsToStrings(node.headers);
  const rows = (node.rows ?? []).map((row) => tableCellsToStrings(row));
  return serializeTableData(headers, rows, node.align, options);
}

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
        { type: "list", ordered: false, start: null, tight: options.tightLists !== false, children: [node] },
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
      if (node.children) {
        return serializeInlines(node.children);
      }
      return node.value == null ? "" : String(node.value);
  }
}

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

function paragraphFromText(text) {
  const value = String(text ?? "");
  if (!value) {
    return { type: "paragraph", children: [] };
  }
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

function headingNode(level, text) {
  return { type: "heading", level: clampLevel(level), children: text ? [textNode(text)] : [] };
}

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

function tableNodeFromData(headers, rows, align) {
  const toCell = (text) => ({ children: text ? [textNode(text)] : [] });
  return {
    type: "table",
    align: headers.map((_, index) => align?.[index] ?? null),
    headers: headers.map(toCell),
    rows: rows.map((row) => row.map(toCell)),
  };
}

function linkNode(url, text, title) {
  return {
    type: "link",
    url: String(url ?? ""),
    title: title == null ? null : String(title),
    children: [textNode(text ?? "")],
  };
}

function imageNode(url, alt, title) {
  return {
    type: "image",
    url: String(url ?? ""),
    title: title == null ? null : String(title),
    alt: String(alt ?? ""),
  };
}

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

export class Writer {
  constructor(data = {}, options = {}) {
    if (!isDataObject(data)) {
      throw makeUserError("data must be an object");
    }

    this.data = data;
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.context = data;
    this.buffer = [];
    this.nodes = [];
    this.current = null;
    this.bindings = new Map();
    this.regionMap = [];
    this.regionPathPrefix = "";
    this.optionalMode = false;
    this.repeatIndex = undefined;
    this.file = options.file ?? options.path ?? null;
    this._parent = null;
    this._optionalFrame = null;
    this._repeatMissed = false;
  }

  write(text = "") {
    this.buffer.push(normalizeEol(text, this.options.eol));
    return this;
  }

  writeRaw(text = "") {
    this.buffer.push(String(text));
    return this;
  }

  literal(text) {
    this.write(text ?? "");
    return this;
  }

  line() {
    return new Slot(this, { leafType: "line" });
  }

  text(_limiter) {
    return new Slot(this, { leafType: "text" });
  }

  until(_limiter) {
    return new Slot(this, { leafType: "text" });
  }

  regexp(_re) {
    return new Slot(this, { leafType: "text" });
  }

  heading(level) {
    const slot = new Slot(this, { leafType: "heading" });
    slot.headingLevel = level == null ? 1 : clampLevel(level);
    return slot;
  }

  paragraph() {
    return new Slot(this, { leafType: "paragraph" });
  }

  list() {
    return new Slot(this, { leafType: "list" });
  }

  listTree() {
    return new Slot(this, { leafType: "listTree" });
  }

  frontmatter(options = {}) {
    const slot = new Slot(this, { leafType: "frontmatter" });
    slot.frontmatterOptions = options;
    return slot;
  }

  rawUntil(_limiter) {
    return new Slot(this, { leafType: "rawUntil" });
  }

  rawUntilElement(type) {
    if (type !== "list") {
      throw makeTemplateError('rawUntilElement type must be "list"');
    }
    return new Slot(this, { leafType: "rawUntilElement" });
  }

  rawBlock() {
    return new Slot(this, { leafType: "rawBlock" });
  }

  rawRest() {
    return new Slot(this, { leafType: "rawRest" });
  }

  table() {
    return new Slot(this, { leafType: "table" });
  }

  codeBlock() {
    return new Slot(this, { leafType: "codeBlock" });
  }

  blockQuote() {
    return new Slot(this, { leafType: "blockQuote" });
  }

  thematicBreak() {
    return new Slot(this, { leafType: "thematicBreak" });
  }

  htmlBlock() {
    return new Slot(this, { leafType: "htmlBlock" });
  }

  link() {
    return new Slot(this, { leafType: "link" });
  }

  image() {
    return new Slot(this, { leafType: "image" });
  }

  autolink() {
    return new Slot(this, { leafType: "autolink" });
  }

  codeSpan() {
    return new Slot(this, { leafType: "codeSpan" });
  }

  checkbox() {
    return new Slot(this, { leafType: "checkbox" });
  }

  query(fn) {
    if (typeof fn !== "function") {
      throw makeTemplateError("query requires a callback");
    }
    fn(this);
    return this;
  }

  skipUntilHeading(_predicate) {
    return false;
  }

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

  optional(fn) {
    if (typeof fn !== "function") {
      this.optionalMode = true;
      return this;
    }

    const savedBuffer = this.buffer;
    const savedNodes = this.nodes;
    const savedCurrent = this.current;
    const savedOptional = this.optionalMode;
    const savedFrame = this._optionalFrame;
    const regionStart = this.regionMap.length;
    const outputStart = bufferLength(savedBuffer);

    this.buffer = [];
    this.nodes = [];
    this.current = null;
    this.optionalMode = true;
    this._optionalFrame = { missed: false, bound: 0 };

    try {
      fn(this);
      const ok = !this._optionalFrame.missed && this._optionalFrame.bound > 0;
      if (ok) {
        shiftRegions(this.regionMap, regionStart, outputStart);
        savedBuffer.push(...this.buffer);
        savedNodes.push(...this.nodes);
      } else {
        this.regionMap.length = regionStart;
      }
      return ok;
    } catch (error) {
      this.regionMap.length = regionStart;
      throw error;
    } finally {
      this.buffer = savedBuffer;
      this.nodes = savedNodes;
      this.current = savedCurrent;
      this.optionalMode = savedOptional;
      this._optionalFrame = savedFrame;
    }
  }

  scope(key, fn) {
    registerBinding(this, key, "as");
    const items = this.data != null && typeof this.data === "object" ? this.data[key] : undefined;
    const path = this.regionPathPrefix ? `${this.regionPathPrefix}.${key}` : String(key);
    const start = bufferLength(this.buffer);
    const elements = [];
    if (items === undefined || items === null || (Array.isArray(items) && items.length === 0)) {
      this.regionMap.push({ key: path, path, outputOffsetStart: start, outputOffsetEnd: start, elements });
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
      fn(this._forkChild(items[index], elementPath), index);
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

  repeat(fn) {
    const savedIndex = this.repeatIndex;
    let stopped = false;
    try {
      for (let index = 0; index < MAX_ITERATIONS; index++) {
        const savedBuffer = this.buffer;
        const savedNodes = this.nodes;
        const savedCurrent = this.current;
        const regionStart = this.regionMap.length;
        const outputStart = bufferLength(savedBuffer);
        this.buffer = [];
        this.nodes = [];
        this.current = null;
        this.repeatIndex = index;
        this._repeatMissed = false;

        let result;
        try {
          result = fn(this, index);
        } catch (error) {
          this.regionMap.length = regionStart;
          this.buffer = savedBuffer;
          this.nodes = savedNodes;
          this.current = savedCurrent;
          throw error;
        }

        const missed = this._repeatMissed;
        const chunks = this.buffer;
        const newNodes = this.nodes;
        this.buffer = savedBuffer;
        this.nodes = savedNodes;
        this.current = savedCurrent;

        if (result === false || missed) {
          this.regionMap.length = regionStart;
          stopped = true;
          break;
        }
        shiftRegions(this.regionMap, regionStart, outputStart);
        this.buffer.push(...chunks);
        this.nodes.push(...newNodes);
      }
    } finally {
      this.repeatIndex = savedIndex;
    }
    if (!stopped) {
      throw makeTemplateError("max scope iterations exceeded");
    }
  }

  emitBoundValue(slot, value) {
    const text = this.serializeSlotValue(slot, value);
    if (text !== "") {
      const retainedFrontmatter = slot.leafType === "frontmatter" && value?.source === text;
      if (["rawUntil", "rawUntilElement", "rawBlock", "rawRest"].includes(slot.leafType) || retainedFrontmatter) {
        this.writeRaw(text);
      } else {
        this.write(text);
      }
    }
    this.recordSlotNode(slot, value);
  }

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
        return serializeList(listNodeFromItems(value.map((item) => String(item ?? "")), this.options), this.options);
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

  serializeTableValue(value) {
    if (value == null || typeof value !== "object" || Array.isArray(value)) {
      throw makeUserError("table value must be an object");
    }
    return serializeTableData(value.headers, value.rows ?? [], value.align, this.options);
  }

  serializeCodeBlockValue(value) {
    if (value == null || typeof value !== "object" || Array.isArray(value)) {
      throw makeUserError("codeBlock value must be an object");
    }
    return serializeCodeBlock(
      {
        type: "code_block",
        language: value.language ?? null,
        meta: typeof value.meta === "string" ? value.meta : "",
        value: value.value ?? "",
        fenced: true,
      },
      this.options,
    );
  }

  serializeLinkValue(value) {
    if (value == null || typeof value !== "object" || Array.isArray(value)) {
      throw makeUserError("link value must be an object");
    }
    return serializeLink(linkNode(value.url, value.text, value.title));
  }

  serializeImageValue(value) {
    if (value == null || typeof value !== "object" || Array.isArray(value)) {
      throw makeUserError("image value must be an object");
    }
    return serializeImage(imageNode(value.url, value.alt, value.title));
  }

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
        this.nodes.push(listNodeFromItems(value.map((item) => String(item ?? "")), this.options));
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
      case "table":
        this.closeCurrent();
        this.nodes.push(
          tableNodeFromData(
            value.headers.map((cell) => String(cell ?? "")),
            (value.rows ?? []).map((row) => {
              const next = row.map((cell) => String(cell ?? ""));
              while (next.length < value.headers.length) {
                next.push("");
              }
              return next.slice(0, value.headers.length);
            }),
            value.align,
          ),
        );
        return;
      case "codeBlock":
        this.closeCurrent();
        this.nodes.push({
          type: "code_block",
          language: value.language ?? null,
          meta: typeof value.meta === "string" ? value.meta : "",
          value: value.value ?? "",
          fenced: true,
        });
        return;
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
        this.pushInline(linkNode(value.url, value.text, value.title));
        return;
      case "image":
        this.pushInline(imageNode(value.url, value.alt, value.title));
        return;
      case "autolink":
        this.pushInline(typeof value === "string" ? autolinkNode(value) : autolinkNode(value.url));
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

  writeHeading(level, text) {
    this.closeCurrent();
    this.ensureBlockStart();
    const node = headingNode(level, text);
    this.write(`${serializeHeading(node, this.options)}\n\n`);
    this.nodes.push(node);
    return this;
  }

  writeParagraph(text) {
    this.closeCurrent();
    this.ensureBlockStart();
    const node = paragraphFromText(text);
    this.write(`${serializeInlines(node.children)}\n\n`);
    this.nodes.push(node);
    return this;
  }

  writeText(text) {
    const value = String(text ?? "");
    this.write(value);
    if (value) {
      this.pushInline(textNode(value));
    }
    return this;
  }

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

  writeList(items) {
    if (!Array.isArray(items)) {
      throw makeUserError("list value must be an array");
    }
    this.closeCurrent();
    this.ensureBlockStart();
    const node = listNodeFromItems(items.map((item) => String(item ?? "")), this.options);
    this.write(`${serializeList(node, this.options)}\n\n`);
    this.nodes.push(node);
    return this;
  }

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

  writeCodeBlock(value, language) {
    this.closeCurrent();
    this.ensureBlockStart();
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

  writeBlockQuote(value) {
    this.closeCurrent();
    this.ensureBlockStart();
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

  writeHtmlBlock(value) {
    this.closeCurrent();
    this.ensureBlockStart();
    const node = { type: "html_block", value: String(value ?? "") };
    this.write(`${node.value}\n\n`);
    this.nodes.push(node);
    return this;
  }

  writeLink(href, text, title) {
    const node = linkNode(href, text, title);
    this.write(serializeLink(node));
    this.pushInline(node);
    return this;
  }

  writeImage(src, alt, title) {
    const node = imageNode(src, alt, title);
    this.write(serializeImage(node));
    this.pushInline(node);
    return this;
  }

  writeAutolink(url) {
    const node = autolinkNode(url);
    this.write(serializeAutolink(node));
    this.pushInline(node);
    return this;
  }

  writeCodeSpan(value) {
    const node = { type: "code_span", value: String(value ?? "") };
    this.write(serializeCodeSpan(node.value));
    this.pushInline(node);
    return this;
  }

  writeEmphasis(text) {
    const node = { type: "emphasis", children: [textNode(text)] };
    this.write(serializeInline(node));
    this.pushInline(node);
    return this;
  }

  writeStrong(text) {
    const node = { type: "strong", children: [textNode(text)] };
    this.write(serializeInline(node));
    this.pushInline(node);
    return this;
  }

  writeCheckbox(checked) {
    const text = checked ? "[x]" : "[ ]";
    this.write(text);
    this.pushInline(textNode(text));
    return this;
  }

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
    if (BLOCK_TYPES.has(node.type)) {
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

  toAst() {
    this.closeCurrent();
    return { type: "document", children: this.nodes.slice() };
  }

  ensureParagraph() {
    if (this.current?.type === "paragraph") {
      return;
    }
    this.closeCurrent();
    this.current = { type: "paragraph", children: [] };
  }

  pushInline(node) {
    this.ensureParagraph();
    const last = this.current.children[this.current.children.length - 1];
    if (node.type === "text" && last?.type === "text") {
      last.value += node.value;
      return;
    }
    this.current.children.push(node);
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
