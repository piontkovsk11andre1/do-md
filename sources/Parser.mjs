import { makeParseError } from "./SyntaxError.mjs";
import { sourceLocation } from "./SourceMap.mjs";
import { Slot } from "./Slot.mjs";

function newlineLength(text, index) {
  if (text[index] === "\r" && text[index + 1] === "\n") {
    return 2;
  }
  if (text[index] === "\n" || text[index] === "\r") {
    return 1;
  }
  return 0;
}

function isSpace(ch) {
  return ch === " " || ch === "\t";
}

function tokenizeLiteral(text) {
  const tokens = [];
  let index = 0;
  while (index < text.length) {
    if (isSpace(text[index])) {
      const start = index;
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

function snapshot(parser) {
  return {
    offset: parser.offset,
    line: parser._line,
    char: parser.char,
  };
}

function restore(parser, cursor) {
  parser.offset = cursor.offset;
  parser._line = cursor.line;
  parser.char = cursor.char;
}

function advanceTo(parser, end) {
  const text = parser.inputSourceText;
  while (parser.offset < end) {
    const length = newlineLength(text, parser.offset);
    if (length && parser.offset + length <= end) {
      parser.offset += length;
      parser._line += 1;
      parser.char = 1;
      continue;
    }
    parser.offset += 1;
    parser.char += 1;
  }
}

function miss(parser, cursor, message) {
  restore(parser, cursor);
  if (typeof parser._noteMiss === "function") {
    parser._noteMiss();
  }
  if (!parser.optionalMode) {
    parser.error(message);
  }
}

function noteMatch(parser) {
  if (typeof parser._noteMatch === "function") {
    parser._noteMatch();
  }
}

function makeLeafSlot(parser, leafType, value, start, end) {
  return new Slot(parser, {
    leafType,
    value,
    matched: value != null,
    sourceOffsetStart: start,
    sourceOffsetEnd: end,
  });
}

function slotMatched(slot) {
  if (!(slot instanceof Slot)) {
    return false;
  }
  return slot.matched === true || slot._matched === true || slot.value != null;
}

export class Parser {
  constructor(source = "", options = {}) {
    this.inputSourceText = String(source);
    this.options = { ...options };
    this.file = options.file ?? options.path ?? null;
    this.offset = 0;
    this._line = 1;
    this.char = 1;
    this.optionalMode = false;
    this.context = {};
    this.errors = [];
  }

  get line() {
    return this._line;
  }

  set line(value) {
    this._line = value;
  }

  get source() {
    return this.inputSourceText;
  }

  set source(value) {
    this.inputSourceText = String(value);
  }

  get position() {
    return this.offset;
  }

  set position(value) {
    this.offset = value;
  }

  reset() {
    this.offset = 0;
    this._line = 1;
    this.char = 1;
    this.optionalMode = false;
    this.errors = [];
  }

  remaining() {
    return this.inputSourceText.slice(this.offset);
  }

  snapshotCursor() {
    return snapshot(this);
  }

  restoreCursor(cursor) {
    restore(this, cursor);
    return this;
  }

  advanceTo(end) {
    advanceTo(this, end);
    return this;
  }

  optional() {
    this.optionalMode = true;
    return this;
  }

  required() {
    this.optionalMode = false;
    return this;
  }

  error(msg) {
    const text = this.diagnosticSourceText ?? this.inputSourceText;
    const err = makeParseError(msg, { locations: [sourceLocation(this.file, text,
      (this.diagnosticOffsetBase ?? 0) + this.offset, null,
      { role: "document", relation: "processing", precision: "context" })] });
    this.errors.push(err);
    return err;
  }

  parse(literal) {
    const cursor = snapshot(this);
    const end = matchLiteral(this.inputSourceText, this.offset, tokenizeLiteral(String(literal ?? "")));
    if (end < 0) {
      miss(this, cursor, `expected ${JSON.stringify(String(literal ?? ""))}`);
      return this;
    }
    advanceTo(this, end);
    noteMatch(this);
    return this;
  }

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
    while (this.offset < text.length && isSpace(text[this.offset])) {
      this.offset += 1;
      this.char += 1;
    }
    return this;
  }

  allowNewlines() {
    const text = this.inputSourceText;
    while (this.offset < text.length) {
      const length = newlineLength(text, this.offset);
      if (!length) {
        break;
      }
      this.offset += length;
      this._line += 1;
      this.char = 1;
    }
    return this;
  }

  allowNewlinesAndWhitespaces() {
    const text = this.inputSourceText;
    while (this.offset < text.length) {
      if (isSpace(text[this.offset])) {
        this.offset += 1;
        this.char += 1;
        continue;
      }
      const length = newlineLength(text, this.offset);
      if (!length) {
        break;
      }
      this.offset += length;
      this._line += 1;
      this.char = 1;
    }
    return this;
  }

  parseOneOf(...fns) {
    const origin = snapshot(this);
    const originErrors = this.errors.length;
    const originOptional = this.optionalMode;
    for (const fn of fns) {
      const before = snapshot(this);
      const errorCount = this.errors.length;
      const optionalBefore = this.optionalMode;
      const result = typeof fn === "function" ? fn(this) : undefined;
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

  repeat(fn) {
    const slots = [];
    for (;;) {
      const before = snapshot(this);
      const errorCount = this.errors.length;
      const result = typeof fn === "function" ? fn(this) : undefined;
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
