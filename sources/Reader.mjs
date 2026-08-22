import { Parser } from "./Parser.mjs";
import { Slot, registerBinding } from "./Slot.mjs";
import { makeTemplateError, makeUserError } from "./SyntaxError.mjs";
import * as MarkdownParser from "./Reader/Markdown.mjs";

const MAX_ITERATIONS = 10000;

function newlineLength(text, index) {
  if (text[index] === "\r" && text[index + 1] === "\n") {
    return 2;
  }
  if (text[index] === "\n" || text[index] === "\r") {
    return 1;
  }
  return 0;
}

function cloneData(value) {
  if (Array.isArray(value)) {
    return value.map(cloneData);
  }
  if (value && typeof value === "object") {
    const out = {};
    for (const [key, item] of Object.entries(value)) {
      out[key] = cloneData(item);
    }
    return out;
  }
  return value;
}

function paragraphEnd(text) {
  const match = /\r?\n[ \t]*\r?\n/.exec(text);
  if (match) {
    return match.index;
  }
  if (text.endsWith("\r\n")) {
    return text.length - 2;
  }
  if (text.endsWith("\n") || text.endsWith("\r")) {
    return text.length - 1;
  }
  return text.length;
}

export class Reader extends Parser {
  constructor(source = "", options = {}) {
    super(source, options);
    this.source = String(source);
    this.context = {};
    this.data = null;
    this.slotMap = [];
    this.bindings = new Map();
    this.slotPathPrefix = "";
    this._matchedBinds = 0;
    this._usedAsArray = false;
    this._switchToRequiredOnMatch = false;
    this._firstFailed = false;
    this._seenOp = false;
  }

  static fromMarkdown(source, options = {}) {
    return MarkdownParser.parseMarkdown(source, options);
  }

  parseDocument() {
    return MarkdownParser.parseMarkdown(this.inputSourceText);
  }

  literal(text) {
    return this.parse(text);
  }

  line() {
    const start = this.offset;
    const remaining = this.remaining();
    if (remaining.length === 0) {
      this._noteMiss();
      if (!this.optionalMode) {
        this.error("expected line");
      }
      return new Slot(this, {
        leafType: "line",
        value: null,
        matched: false,
        sourceOffsetStart: start,
        sourceOffsetEnd: start,
      });
    }

    let end = 0;
    while (end < remaining.length && !newlineLength(remaining, end)) {
      end += 1;
    }

    this.offset += end;
    this.char += end;
    this._noteMatch();
    return new Slot(this, {
      leafType: "line",
      value: remaining.slice(0, end),
      matched: true,
      sourceOffsetStart: start,
      sourceOffsetEnd: this.offset,
    });
  }

  until(limiter) {
    return this.parseUntil(limiter);
  }

  regexp(re) {
    return this.parseRegExp(re);
  }

  text(limiter) {
    const start = this.offset;
    const remaining = this.remaining();
    const end = paragraphEnd(remaining);
    const region = remaining.slice(0, end);
    if (limiter != null && String(limiter).length) {
      const index = region.indexOf(String(limiter));
      if (index < 0) {
        return this._failSlot("text", `expected ${JSON.stringify(String(limiter))}`, start);
      }
      this.advanceTo(start + index);
      this._noteMatch();
      return new Slot(this, {
        leafType: "text",
        value: region.slice(0, index),
        matched: true,
        sourceOffsetStart: start,
        sourceOffsetEnd: this.offset,
      });
    }
    if (remaining.length === 0) {
      return this._failSlot("text", "expected text", start);
    }
    this.advanceTo(start + end);
    this._noteMatch();
    return new Slot(this, {
      leafType: "text",
      value: region,
      matched: true,
      sourceOffsetStart: start,
      sourceOffsetEnd: this.offset,
    });
  }

  heading(level) {
    return this._blockLeaf("heading", "heading", (node) => {
      if (level != null && node.level !== level) {
        return null;
      }
      return MarkdownParser.flattenInlines(node.children);
    }, level == null ? "expected heading" : `expected heading(${level})`);
  }

  paragraph() {
    return this._blockLeaf("paragraph", "paragraph", (node) => MarkdownParser.flattenInlines(node.children));
  }

  list() {
    return this._blockLeaf("list", "list", (node) => (node.children ?? []).map((item) => MarkdownParser.flattenNode(item)));
  }

  table() {
    const start = this.offset;
    if (!this._atBlockBoundary()) {
      return this._failSlot("table", "expected table", start);
    }
    const block = MarkdownParser.parseNextBlock(this.inputSourceText, this.offset);
    if (!block || block.type !== "table") {
      return this._failSlot("table", "expected table", start);
    }
    if (!block.headers.length) {
      return this._failSlot("table", "expected table with headers", start);
    }
    if (block.extraCells) {
      throw makeUserError("table row has extra cells", {
        file: this.file,
        line: this._line,
        column: this.char,
      });
    }
    this.advanceTo(block.position.end.offset);
    this._noteMatch();
    return new Slot(this, {
      leafType: "table",
      value: {
        headers: block.headers.map((cell) => MarkdownParser.flattenInlines(cell.children)),
        rows: block.rows.map((row) => row.map((cell) => MarkdownParser.flattenInlines(cell.children))),
        align: block.align.slice(),
      },
      matched: true,
      sourceOffsetStart: block.position.start.offset,
      sourceOffsetEnd: block.position.end.offset,
      node: block,
    });
  }

  codeBlock() {
    return this._blockLeaf("code_block", "codeBlock", (node) => ({
      language: node.language,
      value: node.value,
    }));
  }

  blockQuote() {
    if (this._atBlockBoundary()) {
      return this._blockLeaf("block_quote", "blockQuote", (node) => MarkdownParser.flattenNode(node));
    }
    const start = this.offset;
    if (!this._afterQuoteMarker()) {
      return this._failSlot("blockQuote", "expected blockQuote", start);
    }
    const remaining = this.remaining();
    if (remaining.length === 0) {
      return this._failSlot("blockQuote", "expected blockQuote", start);
    }
    let end = 0;
    while (end < remaining.length && !newlineLength(remaining, end)) {
      end += 1;
    }
    this.offset += end;
    this.char += end;
    this._noteMatch();
    return new Slot(this, {
      leafType: "blockQuote",
      value: remaining.slice(0, end),
      matched: true,
      sourceOffsetStart: start,
      sourceOffsetEnd: this.offset,
    });
  }

  thematicBreak() {
    return this._blockLeaf("thematic_break", "thematicBreak", () => true);
  }

  htmlBlock() {
    return this._blockLeaf("html_block", "htmlBlock", (node) => node.value);
  }

  link() {
    return this._inlineLeaf("link", "link", (node) => ({
      url: node.url,
      text: MarkdownParser.flattenInlines(node.children),
      title: node.title,
    }));
  }

  image() {
    return this._inlineLeaf("image", "image", (node) => ({
      url: node.url,
      alt: node.alt,
      title: node.title,
    }));
  }

  autolink() {
    return this._inlineLeaf("autolink", "autolink", (node) => node.url);
  }

  codeSpan() {
    return this._inlineLeaf("codeSpan", "codeSpan", (node) => node.value);
  }

  checkbox() {
    const start = this.offset;
    const parsed = MarkdownParser.parseCheckboxAt(this.inputSourceText, this.offset);
    if (!parsed) {
      return this._failSlot("checkbox", "expected checkbox", start);
    }
    this.advanceTo(start + parsed.length);
    this._noteMatch();
    return new Slot(this, {
      leafType: "checkbox",
      value: parsed.value,
      matched: true,
      sourceOffsetStart: start,
      sourceOffsetEnd: this.offset,
    });
  }

  optional(fn) {
    if (typeof fn !== "function") {
      this.optionalMode = true;
      return this;
    }
    const snap = this._snapshotState();
    const bindsBefore = this._matchedBinds;
    this.optionalMode = true;
    this._switchToRequiredOnMatch = false;
    this._firstFailed = false;
    this._seenOp = false;
    fn(this);
    const bound = this._matchedBinds > bindsBefore;
    const requiredError = this.errors.length > snap.errors.length;
    const firstFailed = this._firstFailed;
    if (bound && !requiredError && !firstFailed) {
      this.optionalMode = snap.optionalMode;
      this._switchToRequiredOnMatch = snap.switchToRequiredOnMatch;
      this._firstFailed = snap.firstFailed;
      this._seenOp = snap.seenOp;
      this._noteMatch();
      return true;
    }
    this._restoreState(snap);
    return false;
  }

  scope(key, fn) {
    registerBinding(this, key, "as");
    this.context[key] = [];
    for (let index = 0; index < MAX_ITERATIONS; index++) {
      const child = this.fork();
      child.slotPathPrefix = this.slotPathPrefix ? `${this.slotPathPrefix}.${key}[${index}]` : `${key}[${index}]`;
      child._beginIteration();
      fn(child, index);
      if (!child._shouldCommit()) {
        break;
      }
      this.context[key].push(child.context);
      this._adoptCursor(child);
      this.slotMap.push(...child.slotMap);
    }
    if (this.context[key].length >= MAX_ITERATIONS) {
      throw makeTemplateError("max scope iterations exceeded");
    }
    if (this.context[key].length > 0) {
      this._matchedBinds = (this._matchedBinds ?? 0) + 1;
      this._noteMatch();
    }
  }

  repeat(fn) {
    const committed = [];
    const parentMode = this.optionalMode;
    const parentSwitch = this._switchToRequiredOnMatch;
    const parentFirst = this._firstFailed;
    const parentSeen = this._seenOp;
    for (let index = 0; index < MAX_ITERATIONS; index++) {
      const snap = this._snapshotState();
      this._beginIteration();
      const result = fn(this, index);
      const requiredError = this.errors.length > snap.errors.length;
      if (result === false || this._firstFailed || requiredError) {
        this._restoreState(snap);
        break;
      }
      committed.push(cloneData(this.context));
    }
    this.optionalMode = parentMode;
    this._switchToRequiredOnMatch = parentSwitch;
    this._firstFailed = parentFirst;
    this._seenOp = parentSeen;
    if (committed.length >= MAX_ITERATIONS) {
      throw makeTemplateError("max scope iterations exceeded");
    }
    if (committed.length > 0) {
      this._noteMatch();
    }
    return committed;
  }

  skipUntilHeading(predicate) {
    const start = this.snapshotCursor();
    const headings = MarkdownParser.collectHeadings(this.parseDocument());
    for (const node of headings) {
      const offset = node.position?.start?.offset ?? 0;
      if (offset < this.offset) {
        continue;
      }
      const text = MarkdownParser.flattenInlines(node.children);
      const info = { level: node.level, text, node };
      let matched = predicate == null;
      if (!matched && typeof predicate === "string") {
        matched = text.includes(predicate);
      } else if (!matched && typeof predicate === "function") {
        matched = predicate(info);
      }
      if (matched) {
        this.advanceTo(offset);
        return true;
      }
    }
    if (this.optionalMode) {
      this.restoreCursor(start);
      return false;
    }
    this.advanceTo(this.inputSourceText.length);
    this.error("expected heading");
    return false;
  }

  recordSlotBinding(slot, mode) {
    const prefix = this.slotPathPrefix ?? "";
    const name = String(slot.path ?? "");
    let key;
    if (mode === "asArray") {
      const values = this.context?.[name];
      const index = Array.isArray(values) ? Math.max(0, values.length - 1) : 0;
      key = prefix ? `${prefix}.${name}[${index}]` : `${name}[${index}]`;
    } else {
      key = prefix ? `${prefix}.${name}` : name;
    }
    const entry = {
      key,
      leafType: slot.leafType,
      sourceOffsetStart: Number(slot.sourceOffsetStart ?? 0),
      sourceOffsetEnd: Number(slot.sourceOffsetEnd ?? 0),
      isArrayElement: mode === "asArray",
    };
    if (slot.leafType === "heading") {
      const level = slot.headingLevel ?? slot.node?.level;
      if (level != null) {
        entry.headingLevel = Number(level);
      }
    }
    this.slotMap.push(entry);
    if (slot.exists) {
      this._matchedBinds = (this._matchedBinds ?? 0) + 1;
    }
    if (mode === "asArray") {
      this._usedAsArray = true;
    }
  }

  fork() {
    const child = new Reader(this.inputSourceText, this.options);
    child.offset = this.offset;
    child._line = this._line;
    child.char = this.char;
    child.file = this.file;
    child.data = null;
    child.slotPathPrefix = this.slotPathPrefix;
    return child;
  }

  _beginIteration() {
    this.optionalMode = true;
    this._switchToRequiredOnMatch = true;
    this._firstFailed = false;
    this._seenOp = false;
    this._usedAsArray = false;
  }

  _shouldCommit() {
    return !this._firstFailed && this._matchedBinds > 0 && this.errors.length === 0;
  }

  _noteMatch() {
    this._seenOp = true;
    if (this._switchToRequiredOnMatch) {
      this.optionalMode = false;
      this._switchToRequiredOnMatch = false;
    }
  }

  _noteMiss() {
    if (!this._seenOp) {
      this._firstFailed = true;
    }
    this._seenOp = true;
  }

  _atBlockBoundary() {
    if (this.offset === 0) {
      return true;
    }
    const prev = this.inputSourceText[this.offset - 1];
    return prev === "\n" || prev === "\r";
  }

  _afterQuoteMarker() {
    let index = this.offset - 1;
    const text = this.inputSourceText;
    if (index >= 0 && text[index] === " ") {
      index -= 1;
    }
    return index >= 0 && text[index] === ">";
  }

  _failSlot(leafType, message, start) {
    this._noteMiss();
    if (!this.optionalMode) {
      this.error(message);
    }
    return new Slot(this, {
      leafType,
      value: null,
      matched: false,
      sourceOffsetStart: start,
      sourceOffsetEnd: start,
    });
  }

  _blockLeaf(nodeType, leafType, unwrap, message = `expected ${leafType}`) {
    const start = this.offset;
    if (!this._atBlockBoundary()) {
      return this._failSlot(leafType, message, start);
    }
    const block = MarkdownParser.parseNextBlock(this.inputSourceText, this.offset);
    if (!block || block.type !== nodeType) {
      return this._failSlot(leafType, message, start);
    }
    const value = unwrap(block);
    if (value == null) {
      return this._failSlot(leafType, message, start);
    }
    this.advanceTo(block.position.end.offset);
    this._noteMatch();
    return new Slot(this, {
      leafType,
      value,
      matched: true,
      sourceOffsetStart: block.position.start.offset,
      sourceOffsetEnd: block.position.end.offset,
      node: block,
    });
  }

  _inlineLeaf(kind, leafType, unwrap) {
    const start = this.offset;
    const node = MarkdownParser.parseInlineLeaf(this.inputSourceText, this.offset, this._line, this.char, kind);
    if (!node) {
      return this._failSlot(leafType, `expected ${leafType}`, start);
    }
    this.advanceTo(node.position.end.offset);
    this._noteMatch();
    return new Slot(this, {
      leafType,
      value: unwrap(node),
      matched: true,
      sourceOffsetStart: node.position.start.offset,
      sourceOffsetEnd: node.position.end.offset,
      node,
    });
  }

  _adoptCursor(child) {
    this.offset = child.offset;
    this._line = child._line;
    this.char = child.char;
  }

  _snapshotState() {
    return {
      cursor: this.snapshotCursor(),
      optionalMode: this.optionalMode,
      errors: this.errors.slice(),
      context: cloneData(this.context),
      bindings: new Map(this.bindings),
      slotMap: this.slotMap.slice(),
      matchedBinds: this._matchedBinds,
      usedAsArray: this._usedAsArray,
      switchToRequiredOnMatch: this._switchToRequiredOnMatch,
      firstFailed: this._firstFailed,
      seenOp: this._seenOp,
    };
  }

  _restoreState(snap) {
    this.restoreCursor(snap.cursor);
    this.optionalMode = snap.optionalMode;
    this.errors = snap.errors;
    this.context = snap.context;
    this.bindings = snap.bindings;
    this.slotMap = snap.slotMap;
    this._matchedBinds = snap.matchedBinds;
    this._usedAsArray = snap.usedAsArray;
    this._switchToRequiredOnMatch = snap.switchToRequiredOnMatch;
    this._firstFailed = snap.firstFailed;
    this._seenOp = snap.seenOp;
  }
}
