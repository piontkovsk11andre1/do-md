import { makeParseError } from "./DoMdError.mjs";
import { SourceText } from "./SourceText.mjs";
import { Slot } from "./Slot.mjs";

/** @typedef {import('./types.d.mts').CursorSnapshot} CursorSnapshot */
/** @typedef {import('./types.d.mts').ReaderOptions} ReaderOptions */
/** @typedef {import('./RuntimeContracts.d.mts').BindingMode} BindingMode */
/** @typedef {{type:'spaces'} | {type:'newlines', count:number} | {type:'text', value:string}} LiteralToken */

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

/** @param {string | undefined} ch */
function isSpace(ch) {
  return ch === " " || ch === "\t";
}

/** @param {string} text @returns {LiteralToken[]} */
function tokenizeLiteral(text) {
  /** @type {LiteralToken[]} */
  const tokens = [];
  let index = 0;
  while (index < text.length) {
    if (isSpace(text[index])) {
      while (index < text.length && isSpace(text[index])) {
        index++;
      }
      tokens.push({ type: "spaces" });
      continue;
    }
    const nl = newlineLength(text, index);
    if (nl) {
      let count = 0;
      while (index < text.length) {
        const length = newlineLength(text, index);
        if (!length) {
          break;
        }
        index += length;
        count++;
      }
      tokens.push({ type: "newlines", count });
      continue;
    }
    const start = index;
    while (index < text.length && !isSpace(text[index]) && !newlineLength(text, index)) {
      index++;
    }
    tokens.push({ type: "text", value: text.slice(start, index) });
  }
  return tokens;
}

/** @param {string} text @param {number} offset @param {LiteralToken[]} tokens */
function matchLiteral(text, offset, tokens) {
  let pos = offset;
  for (const token of tokens) {
    if (token.type === "text") {
      if (text.slice(pos, pos + token.value.length) !== token.value) {
        return -1;
      }
      pos += token.value.length;
      continue;
    }
    if (token.type === "spaces") {
      if (!isSpace(text[pos])) {
        return -1;
      }
      while (pos < text.length && isSpace(text[pos])) {
        pos++;
      }
      continue;
    }
    if (token.count === 1) {
      const length = newlineLength(text, pos);
      if (!length) {
        return -1;
      }
      pos += length;
      continue;
    }
    let count = 0;
    while (pos < text.length) {
      const length = newlineLength(text, pos);
      if (!length) {
        break;
      }
      pos += length;
      count++;
    }
    if (count < 2) {
      return -1;
    }
  }
  return pos;
}

/** @param {CursorParser} parser @returns {CursorSnapshot} */
function snapshot(parser) {
  return {
    offset: parser.offset,
    line: parser._line,
    char: parser.char,
  };
}

/** @param {CursorParser} parser @param {CursorSnapshot} cursor */
function restore(parser, cursor) {
  parser.offset = cursor.offset;
}

/** @param {CursorParser} parser @param {number} end */
function advanceTo(parser, end) {
  parser.offset = end;
}

/** @param {CursorParser} parser @param {CursorSnapshot} cursor @param {string} message */
function miss(parser, cursor, message) {
  restore(parser, cursor);
  parser._noteMiss();
  if (!parser.optionalMode) {
    parser.error(message);
  }
}

/** @param {CursorParser} parser */
function noteMatch(parser) {
  parser._noteMatch();
}

/** @param {CursorParser} parser @param {import('./types.d.mts').LeafType} leafType
 * @param {string | null} value @param {number} start @param {number} end @returns {Slot<string>} */
function makeLeafSlot(parser, leafType, value, start, end) {
  return new Slot(parser, {
    leafType,
    value,
    matched: value != null,
    sourceOffsetStart: start,
    sourceOffsetEnd: end,
  });
}

/** @param {unknown} slot */
function slotMatched(slot) {
  if (!(slot instanceof Slot)) {
    return false;
  }
  return slot._matched === true || slot.value != null;
}

/** Literal cursor kernel with one canonical offset.
 * @template {Record<string, unknown>} [TContext=Record<string, unknown>]
 */
export class CursorParser {
  #sourceText;
  #offset = 0;
  /** @returns {'reader'} */
  get mode() {
    return "reader";
  }
  /** @param {unknown} [source] @param {ReaderOptions} [options] */
  constructor(source = "", options = {}) {
    const text = String(source);
    this.options = { ...options };
    const file = options.file ?? options.path ?? null;
    if (
      options.sourceText != null &&
      (!(options.sourceText instanceof SourceText) ||
        options.sourceText.text !== text ||
        (file != null && options.sourceText.source !== file))
    ) {
      throw new TypeError("shared source index must describe the parser input");
    }
    this.#sourceText = options.sourceText ?? new SourceText(text, file);
    this.diagnosticSource = this.sourceText;
    this.optionalMode = false;
    this.context = /** @type {TContext} */ ({});
    /** @type {import('./DoMdError.mjs').DoMdError[]} */
    this.errors = [];
    /** @type {Map<string, BindingMode>} */
    this.bindings = new Map();
    this.diagnosticOffsetBase = 0;
    /** @internal */
    this._callbackDepth = 0;
  }

  get sourceText() {
    return this.#sourceText;
  }
  get inputSourceText() {
    return this.#sourceText.text;
  }
  get file() {
    return this.#sourceText.source;
  }
  get offset() {
    return this.#offset;
  }
  /** @param {number} value */
  set offset(value) {
    this.#sourceText.pointAt(value);
    this.#offset = value;
  }
  get lineNumber() {
    return this.#sourceText.pointAt(this.#offset).line;
  }
  /** @internal */
  get _line() {
    return this.lineNumber;
  }
  get char() {
    return this.#sourceText.pointAt(this.#offset).column;
  }

  get source() {
    return this.inputSourceText;
  }

  /** @param {unknown} value */
  set source(value) {
    this.replaceSource(value);
  }

  get position() {
    return this.offset;
  }

  /** @param {number} value */
  set position(value) {
    this.offset = value;
  }

  /** Rewind a whole read session; moving only the cursor is seek()/position. */
  reset() {
    this._assertBetweenSessions();
    this.offset = 0;
    this.optionalMode = false;
    this.context = /** @type {TContext} */ ({});
    this.errors = [];
    this.bindings = new Map();
    return this;
  }

  /** Replace input atomically and start a fresh session, including subclass metadata. */
  /** @param {unknown} source @param {{file?: string | null}} [options] */
  replaceSource(source, { file = this.file } = {}) {
    this._assertBetweenSessions();
    const next = new SourceText(String(source), file);
    this.#sourceText = next;
    this.#offset = 0;
    this.diagnosticSource = next;
    this.diagnosticOffsetBase = 0;
    const {
      file: previousFile,
      path: previousPath,
      sourceText: previousIndex,
      ...options
    } = this.options;
    this.options = { ...options, ...(file == null ? {} : { file }), sourceText: next };
    return this.reset();
  }

  /** @param {number} offset */
  seek(offset) {
    this.offset = offset;
    return this;
  }

  /** Dynamic template bindings accumulate in a dictionary before the caller's T is observed. @internal
   * @param {string} key @param {unknown} value */
  _setContextValue(key, value) {
    /** @type {Record<string, unknown>} */ (this.context)[key] = value;
  }

  /** @internal */
  _noteMatch() {}
  /** @internal */
  _noteMiss() {}

  /** @internal */
  _assertBetweenSessions() {
    if (this._callbackDepth > 0) {
      throw new TypeError("reset/replaceSource cannot run inside a parsing callback");
    }
  }

  /** Keep lifecycle changes out of speculative callbacks; parsing and seeking remain allowed. */
  /** @internal @template {unknown[]} A @template R @param {(...args: A) => R} fn @param {A} args @returns {R} */
  _withCallback(fn, ...args) {
    this._callbackDepth++;
    try {
      return fn(...args);
    } finally {
      this._callbackDepth--;
    }
  }

  /** @internal @template R @param {() => R} fn @returns {R} */
  withReadSession(fn) {
    return this._withCallback(fn);
  }

  remaining() {
    return this.inputSourceText.slice(this.offset);
  }

  snapshotCursor() {
    return snapshot(this);
  }

  /** @param {CursorSnapshot} cursor */
  restoreCursor(cursor) {
    restore(this, cursor);
    return this;
  }

  /** @param {number} end */
  advanceTo(end) {
    advanceTo(this, end);
    return this;
  }

  required() {
    this.optionalMode = false;
    return this;
  }

  /** @param {unknown} msg */
  error(msg) {
    const err = makeParseError(msg, {
      locations: [
        this.diagnosticSource.location((this.diagnosticOffsetBase ?? 0) + this.offset, null, {
          role: "document",
          relation: "processing",
          precision: "context",
        }),
      ],
    });
    this.errors.push(err);
    return err;
  }

  /** @param {unknown} literal */
  parse(literal) {
    const cursor = snapshot(this);
    const end = matchLiteral(
      this.inputSourceText,
      this.offset,
      tokenizeLiteral(String(literal ?? "")),
    );
    if (end < 0) {
      miss(this, cursor, `expected ${JSON.stringify(String(literal ?? ""))}`);
      return this;
    }
    advanceTo(this, end);
    noteMatch(this);
    return this;
  }

  /** @param {RegExp | string} re */
  parseRegExp(re) {
    const cursor = snapshot(this);
    const pattern = re instanceof RegExp ? re : new RegExp(re);
    const local = new RegExp(pattern.source, pattern.flags.replace(/[gy]/g, ""));
    const match = local.exec(this.remaining());
    if (!match || match.index !== 0) {
      miss(this, cursor, `expected ${pattern}`);
      return makeLeafSlot(this, "text", null, cursor.offset, cursor.offset);
    }
    const start = this.offset;
    advanceTo(this, start + match[0].length);
    noteMatch(this);
    return makeLeafSlot(this, "text", match[0], start, this.offset);
  }

  /** @param {unknown} limiter */
  parseUntil(limiter) {
    const cursor = snapshot(this);
    const needle = String(limiter ?? "");
    const remaining = this.remaining();
    const index = remaining.indexOf(needle);
    if (index < 0) {
      miss(this, cursor, `expected ${JSON.stringify(needle)}`);
      return makeLeafSlot(this, "text", null, cursor.offset, cursor.offset);
    }
    const start = this.offset;
    advanceTo(this, start + index);
    noteMatch(this);
    return makeLeafSlot(this, "text", remaining.slice(0, index), start, this.offset);
  }

  allowWhitespaces() {
    const text = this.inputSourceText;
    let end = this.offset;
    while (end < text.length && isSpace(text[end])) {
      end++;
    }
    this.offset = end;
    return this;
  }

  allowNewlines() {
    const text = this.inputSourceText;
    let end = this.offset;
    while (end < text.length) {
      const length = newlineLength(text, end);
      if (!length) {
        break;
      }
      end += length;
    }
    this.offset = end;
    return this;
  }

  allowNewlinesAndWhitespaces() {
    const text = this.inputSourceText;
    let end = this.offset;
    while (end < text.length) {
      if (isSpace(text[end])) {
        end++;
        continue;
      }
      const length = newlineLength(text, end);
      if (!length) {
        break;
      }
      end += length;
    }
    this.offset = end;
    return this;
  }

  /** @param {Array<(parser: this) => unknown>} fns @returns {Slot<unknown>} */
  parseOneOf(...fns) {
    const origin = snapshot(this);
    const originErrors = this.errors.length;
    const originOptional = this.optionalMode;
    for (const fn of fns) {
      const before = snapshot(this);
      const errorCount = this.errors.length;
      const optionalBefore = this.optionalMode;
      const result = typeof fn === "function" ? this._withCallback(fn, this) : undefined;
      const advanced = this.offset > before.offset;
      const isSlot = result instanceof Slot;
      const matched = slotMatched(result);
      const newErrors = this.errors.length > errorCount;
      if (!newErrors && (advanced || matched)) {
        noteMatch(this);
        if (isSlot) {
          return result;
        }
        return makeLeafSlot(
          this,
          "text",
          this.inputSourceText.slice(before.offset, this.offset),
          before.offset,
          this.offset,
        );
      }
      restore(this, before);
      this.errors.length = errorCount;
      this.optionalMode = optionalBefore;
    }
    restore(this, origin);
    this.errors.length = originErrors;
    this.optionalMode = originOptional;
    miss(this, origin, "expected one of");
    return makeLeafSlot(this, "text", null, origin.offset, origin.offset);
  }

  /** @internal @param {(parser: this) => unknown} fn @returns {Slot<unknown>[]} */
  _repeatSlots(fn) {
    const slots = [];
    for (;;) {
      const before = snapshot(this);
      const errorCount = this.errors.length;
      const result = typeof fn === "function" ? this._withCallback(fn, this) : undefined;
      if (result === false) {
        restore(this, before);
        this.errors.length = errorCount;
        break;
      }
      const advanced = this.offset > before.offset;
      const isSlot = result instanceof Slot;
      const matched = slotMatched(result);
      const newErrors = this.errors.length > errorCount;
      if (advanced && !newErrors && (!isSlot || matched)) {
        slots.push(
          isSlot
            ? result
            : makeLeafSlot(
                this,
                "text",
                this.inputSourceText.slice(before.offset, this.offset),
                before.offset,
                this.offset,
              ),
        );
        continue;
      }
      restore(this, before);
      if (newErrors || (!advanced && matched)) {
        break;
      }
      miss(this, before, "expected repeat");
      break;
    }
    if (slots.length > 0) {
      noteMatch(this);
    }
    return slots;
  }
}
