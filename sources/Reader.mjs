import { CursorParser } from "./CursorParser.mjs";
import { Slot, registerBinding } from "./Slot.mjs";
import { attachSource, makeTemplateError, makeUserError, isDiagnosticError } from "./DoMdError.mjs";
import { schemaFromOptions } from "./Schema.mjs";
import { IterationState } from "./Reader/IterationState.mjs";
import * as MarkdownParser from "./Reader/Markdown.mjs";

const MAX_ITERATIONS = 10000;
/** @typedef {import('./types.d.mts').MarkdownBlockNode} MarkdownBlockNode */
/** @typedef {import('./types.d.mts').SlotMetadata} SlotMetadata */
/** @typedef {import('./RuntimeContracts.d.mts').SlotDescription} SlotDescription */

/** @param {string} text @param {number} index */
function newlineLength(text, index) {
  if (text[index] === "\r" && text[index + 1] === "\n") {
    return 2;
  }
  if (text[index] === "\n" || text[index] === "\r") {
    return 1;
  }
  return 0;
}

/** Clone plain context/AST data. @template T @param {T} value @returns {T} */
function cloneData(value) {
  if (Array.isArray(value)) {
    return /** @type {T} */ (value.map(cloneData));
  }
  if (value && typeof value === "object") {
    /** @type {Record<string, unknown>} */
    const out = {};
    for (const [key, item] of Object.entries(value)) {
      out[key] = cloneData(item);
    }
    return /** @type {T} */ (out);
  }
  return value;
}

/** @template T @param {T} value @returns {T} */
function stripPositions(value) {
  if (Array.isArray(value)) {
    return /** @type {T} */ (value.map(stripPositions));
  }
  if (value && typeof value === "object") {
    /** @type {Record<string, unknown>} */
    const out = {};
    for (const [key, item] of Object.entries(value)) {
      if (key !== "position") {
        out[key] = stripPositions(item);
      }
    }
    return /** @type {T} */ (out);
  }
  return value;
}

/** @param {import('./types.d.mts').ListNode} node @returns {import('./types.d.mts').ListTreeValue} */
function listTreeValue(node) {
  return {
    ordered: node.ordered,
    start: node.start,
    tight: node.tight,
    items: (node.children ?? []).map((item) => ({
      checked: item.checked,
      children: stripPositions(item.children ?? []),
    })),
  };
}

/** @param {string} text */
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

/**
 * Stateful template reader. Slots and regions refer to the untouched input;
 * forks share source ownership but commit their cursor and metadata explicitly.
 * Optional/repeated attempts are transactions over the state snapshotted below.
 * @template {Record<string, unknown>} [TContext=Record<string, unknown>]
 * @extends {CursorParser<TContext>}
 */
export class Reader extends CursorParser {
  /** @type {SlotMetadata[]} */
  slotMap = [];
  /** @type {import('./types.d.mts').RegionMetadata[]} */
  regionMap = [];
  /** @type {import('./types.d.mts').QueryRegionMetadata[]} */
  queryMap = [];
  data = null;
  slotPathPrefix = "";
  /** @internal */
  _matchedBinds = 0;
  /** @internal */
  _usedAsArray = false;
  /** @internal */
  _iteration = new IterationState();
  /** @internal */
  _queryActive = false;
  /** @param {unknown} [source] @param {import('./types.d.mts').ReaderOptions} [options] */
  constructor(source = "", options = {}) {
    super(source, options);
    this._resetReaderState();
  }

  /** Reset session-owned data; source/index ownership stays in the cursor kernel. @internal */
  _resetReaderState() {
    this.data = null;
    this.slotMap = [];
    this.regionMap = [];
    this.queryMap = [];
    this.slotPathPrefix = "";
    this._matchedBinds = 0;
    this._usedAsArray = false;
    this._iteration = new IterationState();
    this._queryActive = false;
  }

  reset() {
    super.reset();
    this._resetReaderState();
    return this;
  }

  /** @param {unknown} [source] @param {import('./types.d.mts').ReaderOptions} [options] */
  static fromMarkdown(source, options = {}) {
    try {
      return MarkdownParser.parseMarkdown(source);
    } catch (error) {
      if (options.file && isDiagnosticError(error)) {
        attachSource(error, options.file);
      }
      throw error;
    }
  }

  parseDocument() {
    try {
      return MarkdownParser.parseMarkdown(this.inputSourceText);
    } catch (error) {
      if (this.file && isDiagnosticError(error)) {
        attachSource(error, this.file);
      }
      throw error;
    }
  }

  /** @param {unknown} text */
  literal(text) {
    return this.parse(text);
  }

  /** @returns {Slot<string>} */
  line() {
    const start = this.offset;
    const remaining = this.remaining();
    if (remaining.length === 0) {
      this._noteMiss();
      if (!this.optionalMode) {
        this.error("expected line");
      }
      return this._unmatched("line", start);
    }

    let end = 0;
    while (end < remaining.length && !newlineLength(remaining, end)) {
      end += 1;
    }

    this.seek(this.offset + end);
    this._noteMatch();
    return new Slot(this, {
      leafType: "line",
      value: remaining.slice(0, end),
      matched: true,
      sourceOffsetStart: start,
      sourceOffsetEnd: this.offset,
    });
  }

  /** @param {unknown} limiter */
  until(limiter) {
    return this.parseUntil(limiter);
  }

  /** @param {unknown} limiter */
  rawUntil(limiter) {
    return this._rawRange("rawUntil", String(limiter ?? ""));
  }

  /** @param {unknown} type @returns {Slot<string>} */
  rawUntilElement(type) {
    if (type !== "list") {
      throw makeTemplateError('rawUntilElement type must be "list"');
    }
    const start = this.offset;
    const list = MarkdownParser.findNextListBlock(this.inputSourceText, start);
    const end = list?.position?.start?.offset;
    if (!list || end == null || !Number.isInteger(end) || end < start) {
      this._noteMiss();
      return this._unmatched("rawUntilElement", start);
    }
    if (end !== start) {
      this.advanceTo(end);
    }
    this._noteMatch();
    return new Slot(this, {
      leafType: "rawUntilElement",
      value: this.inputSourceText.slice(start, end),
      matched: true,
      sourceOffsetStart: start,
      sourceOffsetEnd: end,
    });
  }

  /** @returns {Slot<string>} */
  rawBlock() {
    const start = this.offset;
    if (!this._atBlockBoundary()) {
      return this._failSlot("rawBlock", "expected raw block", start);
    }
    const block = MarkdownParser.parseNextBlock(this.inputSourceText, start);
    if (!block || block.position.start.offset !== start) {
      return this._failSlot("rawBlock", "expected raw block", start);
    }
    this.advanceTo(block.position.end.offset);
    this._noteMatch();
    return new Slot(this, {
      leafType: "rawBlock",
      value: this.inputSourceText.slice(start, this.offset),
      matched: true,
      sourceOffsetStart: start,
      sourceOffsetEnd: this.offset,
      node: block,
    });
  }

  rawRest() {
    const start = this.offset;
    const value = this.remaining();
    this.advanceTo(this.inputSourceText.length);
    this._noteMatch();
    return new Slot(this, {
      leafType: "rawRest",
      value,
      matched: true,
      sourceOffsetStart: start,
      sourceOffsetEnd: this.offset,
    });
  }

  /** @param {RegExp | string} re */
  regexp(re) {
    return this.parseRegExp(re);
  }

  /** @param {unknown} [limiter] @returns {Slot<string>} */
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

  /** @param {1 | 2 | 3 | 4 | 5 | 6} [level] */
  heading(level) {
    return this._blockLeaf(
      "heading",
      "heading",
      (node) => {
        if (level != null && node.level !== level) {
          return null;
        }
        return MarkdownParser.flattenInlines(node.children);
      },
      level == null ? "expected heading" : `expected heading(${level})`,
    );
  }

  paragraph() {
    return this._blockLeaf("paragraph", "paragraph", (node) =>
      MarkdownParser.flattenInlines(node.children),
    );
  }

  list() {
    return this._blockLeaf("list", "list", (node) =>
      (node.children ?? []).map((item) => MarkdownParser.flattenNode(item)),
    );
  }

  listTree() {
    return this._blockLeaf("list", "listTree", listTreeValue, "expected list");
  }

  /** @template {Record<string, unknown>} [T=Record<string, unknown>]
   * @param {import('./types.d.mts').SafeParseSchema<T> | {schema?: import('./types.d.mts').SafeParseSchema<T>}} [options]
   * @returns {Slot<import('./types.d.mts').FrontmatterValue<T>>} */
  frontmatter(options = {}) {
    const start = this.offset;
    if (start !== 0) {
      return this._failSlot("frontmatter", "expected frontmatter at document start", start);
    }
    let node;
    try {
      node = MarkdownParser.parseFrontmatter(this.inputSourceText);
    } catch (error) {
      if (this.file && isDiagnosticError(error)) {
        attachSource(error, this.file);
      }
      throw error;
    }
    if (!node) {
      return this._failSlot("frontmatter", "expected YAML frontmatter", start);
    }
    /** @type {import('./types.d.mts').SafeParseSchema<T> | null} */
    const schema = schemaFromOptions(options);
    let data = node.data;
    if (schema) {
      const result = schema.safeParse(data);
      if (!result?.success) {
        const error = this.error(
          `frontmatter validation failed${result?.error?.message ? `: ${result.error.message}` : ""}`,
        );
        throw error;
      }
      if (!Object.hasOwn(result, "data")) {
        const error = this.error("frontmatter validation succeeded without data");
        throw error;
      }
      data = result.data;
    }
    /** @type {import('./types.d.mts').FrontmatterValue<T>} */
    const value = {
      format: "yaml",
      raw: node.raw,
      content: node.content,
      data: /** @type {T} */ (data),
    };
    Object.defineProperty(value, "source", { value: node.source, enumerable: false });
    this.advanceTo(node.position.end.offset);
    this._noteMatch();
    return new Slot(this, {
      leafType: "frontmatter",
      value,
      matched: true,
      sourceOffsetStart: node.position.start.offset,
      sourceOffsetEnd: node.position.end.offset,
      node,
    });
  }

  /** @returns {Slot<import('./types.d.mts').TableValue>} */
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
        rows: block.rows.map((row) =>
          row.map((cell) => MarkdownParser.flattenInlines(cell.children)),
        ),
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
      meta: typeof node.meta === "string" ? node.meta : "",
      value: node.value,
    }));
  }

  /** @returns {Slot<string>} */
  blockQuote() {
    if (this._atBlockBoundary()) {
      return this._blockLeaf("block_quote", "blockQuote", (node) =>
        MarkdownParser.flattenNode(node),
      );
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
    this.seek(this.offset + end);
    this._noteMatch();
    return new Slot(this, {
      leafType: "blockQuote",
      value: remaining.slice(0, end),
      matched: true,
      sourceOffsetStart: start,
      sourceOffsetEnd: this.offset,
    });
  }

  /** @returns {Slot<true>} */
  thematicBreak() {
    return this._blockLeaf("thematic_break", "thematicBreak", () => /** @type {true} */ (true));
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

  /** @returns {Slot<boolean>} */
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

  /** @param {(reader: this) => void} fn */
  query(fn) {
    if (typeof fn !== "function") {
      throw makeTemplateError("query requires a callback");
    }
    if (this._queryActive) {
      throw makeTemplateError("query regions cannot be nested");
    }
    const start = this.offset;
    this._queryActive = true;
    try {
      this._withCallback(fn, this);
    } finally {
      this._queryActive = false;
    }
    this.queryMap.push({
      sourceOffsetStart: start,
      sourceOffsetEnd: this.offset,
    });
    return this;
  }

  /** Commit a callback only if it binds data without a first miss or required error. */
  /** @overload @returns {this} */
  /** @overload @param {(reader: this) => void} fn @returns {boolean} */
  /** @param {((reader: this) => void)} [fn] @returns {this | boolean} */
  optional(fn) {
    if (typeof fn !== "function") {
      this.optionalMode = true;
      return this;
    }
    const snap = this._snapshotState();
    const bindsBefore = this._matchedBinds;
    this.optionalMode = true;
    this._iteration.begin(false);
    try {
      this._withCallback(fn, this);
    } catch (error) {
      this._restoreState(snap);
      throw error;
    }
    const bound = this._matchedBinds > bindsBefore;
    const requiredError = this.errors.length > snap.errors.length;
    const firstFailed = this._iteration.firstFailed;
    if (bound && !requiredError && !firstFailed) {
      this.optionalMode = snap.optionalMode;
      this._iteration = snap.iteration;
      this._noteMatch();
      return true;
    }
    this._restoreState(snap);
    return false;
  }

  /** Parse independent child contexts, adopting metadata only for a complete child. */
  /** @param {string} key @param {(reader: Reader, index: number) => void} fn */
  scope(key, fn) {
    registerBinding(this, key, "as");
    /** @type {Record<string, unknown>[]} */
    const contexts = [];
    this._setContextValue(key, contexts);
    const path = this.slotPathPrefix ? `${this.slotPathPrefix}.${key}` : String(key);
    const start = this.offset;
    /** @type {import('./types.d.mts').RegionElement[]} */
    const elements = [];
    for (let index = 0; index < MAX_ITERATIONS; index++) {
      const child = this.fork();
      child.slotPathPrefix = `${path}[${index}]`;
      child._beginIteration();
      this._withCallback(() => child._withCallback(fn, child, index));
      if (!child._shouldCommit()) {
        break;
      }
      if (child.offset === this.offset) {
        throw makeTemplateError("scope iteration must consume input");
      }
      contexts.push(child.context);
      elements.push({
        path: child.slotPathPrefix,
        sourceOffsetStart: this.offset,
        sourceOffsetEnd: child.offset,
      });
      this._adoptCursor(child);
      this.slotMap.push(...child.slotMap);
      this.regionMap.push(...child.regionMap);
    }
    if (contexts.length >= MAX_ITERATIONS) {
      throw makeTemplateError("max scope iterations exceeded");
    }
    if (contexts.length > 0) {
      this._matchedBinds = (this._matchedBinds ?? 0) + 1;
      this._noteMatch();
    }
    this.regionMap.push({
      key: path,
      path,
      sourceOffsetStart: start,
      sourceOffsetEnd: this.offset,
      elements,
    });
  }

  /** Roll back a rejected attempt; always restore the enclosing iteration policy. */
  /** @param {(reader: this, index: number) => unknown} fn @returns {TContext[]} */
  repeat(fn) {
    const committed = [];
    const parentMode = this.optionalMode;
    const parentIteration = this._iteration.clone();
    try {
      for (let index = 0; index < MAX_ITERATIONS; index++) {
        const snap = this._snapshotState();
        this._beginIteration();
        let result;
        try {
          result = this._withCallback(fn, this, index);
        } catch (error) {
          this._restoreState(snap);
          throw error;
        }
        const requiredError = this.errors.length > snap.errors.length;
        if (result === false || this._iteration.firstFailed || requiredError) {
          this._restoreState(snap);
          break;
        }
        if (this.offset === snap.cursor.offset) {
          this._restoreState(snap);
          throw makeTemplateError("repeat iteration must consume input");
        }
        committed.push(cloneData(this.context));
      }
    } finally {
      this.optionalMode = parentMode;
      this._iteration = parentIteration;
    }
    if (committed.length >= MAX_ITERATIONS) {
      throw makeTemplateError("max scope iterations exceeded");
    }
    if (committed.length > 0) {
      this._noteMatch();
    }
    return committed;
  }

  /** @param {string | ((heading: {level: number, text: string, node: import('./types.d.mts').HeadingNode}) => boolean)} [predicate] */
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

  assertConsumed({ trailingWhitespace = true } = {}) {
    const remaining = this.remaining();
    if (remaining === "" || (trailingWhitespace && /^\s*$/.test(remaining))) {
      if (remaining) {
        this.advanceTo(this.inputSourceText.length);
      }
      return true;
    }
    this.error("unexpected trailing content");
    return false;
  }

  /** @param {SlotDescription} slot @param {import('./RuntimeContracts.d.mts').BindingMode} mode */
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
    /** @type {SlotMetadata} */
    const entry = {
      key,
      leafType: slot.leafType,
      sourceOffsetStart: Number(slot.sourceOffsetStart ?? 0),
      sourceOffsetEnd: Number(slot.sourceOffsetEnd ?? 0),
      isArrayElement: mode === "asArray",
    };
    if (slot.leafType === "heading") {
      const level =
        slot.headingLevel ?? (slot.node?.type === "heading" ? slot.node.level : undefined);
      if (level != null) {
        entry.headingLevel = Number(level);
      }
    }
    if (slot.leafType === "listTree" && slot.node?.type === "list") {
      /** @type {SlotMetadata[]} */
      const checkboxSlots = [];
      /** @type {import('./types.d.mts').ListTreeItemMetadata[]} */
      const items = [];
      entry.items = items;
      /** @param {import('./types.d.mts').ListItemNode} item @param {string} itemKey */
      const visitItem = (item, itemKey) => {
        /** @type {import('./types.d.mts').ListTreeItemMetadata} */
        const metadata = {
          key: itemKey,
          sourceOffsetStart: Number(item.position?.start?.offset ?? slot.sourceOffsetStart ?? 0),
          sourceOffsetEnd: Number(item.position?.end?.offset ?? slot.sourceOffsetEnd ?? 0),
          checked: null,
        };
        if (item.checkboxPosition) {
          metadata.checked = {
            key: `${itemKey}.checked`,
            sourceOffsetStart: Number(item.checkboxPosition.start.offset),
            sourceOffsetEnd: Number(item.checkboxPosition.end.offset),
          };
          checkboxSlots.push({
            ...metadata.checked,
            leafType: "checkbox",
            isArrayElement: false,
          });
        }
        items.push(metadata);
        for (const [childIndex, child] of (item.children ?? []).entries()) {
          if (child.type !== "list") {
            continue;
          }
          for (const [nestedIndex, nestedItem] of (child.children ?? []).entries()) {
            visitItem(nestedItem, `${itemKey}.children[${childIndex}].children[${nestedIndex}]`);
          }
        }
      };
      for (const [index, item] of (slot.node.children ?? []).entries()) {
        visitItem(item, `${key}.items[${index}]`);
      }
      this.slotMap.push(entry, ...checkboxSlots);
    } else {
      this.slotMap.push(entry);
    }
    if (slot.exists) {
      this._matchedBinds = (this._matchedBinds ?? 0) + 1;
    }
    if (mode === "asArray") {
      this._usedAsArray = true;
    }
  }

  /** @returns {Reader} */
  fork() {
    const child = new Reader(this.inputSourceText, {
      ...this.options,
      sourceText: this.sourceText,
    });
    child.seek(this.offset);
    child.diagnosticSource = this.diagnosticSource;
    child.diagnosticOffsetBase = this.diagnosticOffsetBase;
    child.data = null;
    child.slotPathPrefix = this.slotPathPrefix;
    return child;
  }

  /** @internal */
  _beginIteration() {
    this.optionalMode = true;
    this._iteration.begin();
    this._usedAsArray = false;
  }

  /** @internal */
  _shouldCommit() {
    return !this._iteration.firstFailed && this._matchedBinds > 0 && this.errors.length === 0;
  }

  /** @internal */
  _noteMatch() {
    if (this._iteration.match()) {
      this.optionalMode = false;
    }
  }

  /** @internal */
  _noteMiss() {
    this._iteration.miss();
  }

  /** @internal */
  _atBlockBoundary() {
    if (this.offset === 0) {
      return true;
    }
    const prev = this.inputSourceText[this.offset - 1];
    return prev === "\n" || prev === "\r";
  }

  /** @internal */
  _afterQuoteMarker() {
    let index = this.offset - 1;
    const text = this.inputSourceText;
    if (index >= 0 && text[index] === " ") {
      index -= 1;
    }
    return index >= 0 && text[index] === ">";
  }

  /** @internal @template T @param {import('./types.d.mts').LeafType} leafType @param {string} message @param {number} start @returns {Slot<T>} */
  _failSlot(leafType, message, start) {
    this._noteMiss();
    if (!this.optionalMode) {
      this.error(message);
    }
    return this._unmatched(leafType, start);
  }

  /** @internal @template T @param {import('./types.d.mts').LeafType} leafType @param {number} start @returns {Slot<T>} */
  _unmatched(leafType, start) {
    /** @type {import('./RuntimeContracts.d.mts').SlotOptions<T>} */
    const options = {
      leafType,
      value: null,
      matched: false,
      sourceOffsetStart: start,
      sourceOffsetEnd: start,
    };
    return new Slot(this, options);
  }

  /** @internal @param {import('./types.d.mts').LeafType} leafType @param {string} limiter @returns {Slot<string>} */
  _rawRange(leafType, limiter) {
    const start = this.offset;
    const index = this.remaining().indexOf(limiter);
    if (index < 0) {
      return this._failSlot(leafType, `expected ${JSON.stringify(limiter)}`, start);
    }
    this.advanceTo(start + index);
    this._noteMatch();
    return new Slot(this, {
      leafType,
      value: this.inputSourceText.slice(start, this.offset),
      matched: true,
      sourceOffsetStart: start,
      sourceOffsetEnd: this.offset,
    });
  }

  /** @internal @template {MarkdownBlockNode['type']} K @template T
   * @param {K} nodeType @param {import('./types.d.mts').LeafType} leafType
   * @param {(node: Extract<MarkdownBlockNode, {type: K}>) => T | null} unwrap @param {string} [message] @returns {Slot<T>} */
  _blockLeaf(nodeType, leafType, unwrap, message = `expected ${leafType}`) {
    const start = this.offset;
    if (!this._atBlockBoundary()) {
      return this._failSlot(leafType, message, start);
    }
    const block = MarkdownParser.parseNextBlock(this.inputSourceText, this.offset);
    if (!block || block.type !== nodeType) {
      return this._failSlot(leafType, message, start);
    }
    const value = unwrap(/** @type {Extract<MarkdownBlockNode, {type: K}>} */ (block));
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

  /** @internal @template {keyof import('./Reader/Markdown.mjs').InlineLeafNodes} K @template T
   * @param {K} kind @param {import('./types.d.mts').LeafType} leafType
   * @param {(node: import('./Reader/Markdown.mjs').InlineLeafNodes[K]) => T} unwrap @returns {Slot<T>} */
  _inlineLeaf(kind, leafType, unwrap) {
    const start = this.offset;
    const node = MarkdownParser.parseInlineLeaf(
      this.inputSourceText,
      this.offset,
      this._line,
      this.char,
      kind,
    );
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

  /** @internal @param {Reader} child */
  _adoptCursor(child) {
    this.seek(child.offset);
  }

  /** @internal @returns {import('./ReaderState.d.mts').ReaderState<TContext>} */
  _snapshotState() {
    return {
      cursor: this.snapshotCursor(),
      optionalMode: this.optionalMode,
      errors: this.errors.slice(),
      context: cloneData(this.context),
      bindings: new Map(this.bindings),
      slotMap: this.slotMap.slice(),
      regionMap: this.regionMap.slice(),
      queryMap: this.queryMap.slice(),
      matchedBinds: this._matchedBinds,
      usedAsArray: this._usedAsArray,
      iteration: this._iteration.clone(),
    };
  }

  /** @internal @param {import('./ReaderState.d.mts').ReaderState<TContext>} snap */
  _restoreState(snap) {
    this.restoreCursor(snap.cursor);
    this.optionalMode = snap.optionalMode;
    this.errors = snap.errors;
    this.context = snap.context;
    this.bindings = snap.bindings;
    this.slotMap = snap.slotMap;
    this.regionMap = snap.regionMap;
    this.queryMap = snap.queryMap;
    this._matchedBinds = snap.matchedBinds;
    this._usedAsArray = snap.usedAsArray;
    this._iteration = snap.iteration;
  }
}
