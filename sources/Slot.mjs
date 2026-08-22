import { locationFromStack, makeParseError, makeTemplateError, makeUserError } from "./SyntaxError.mjs";

function ownerMode(owner) {
  if (!owner) {
    return "none";
  }
  if (typeof owner.parse === "function" || owner.inputSourceText != null) {
    return "reader";
  }
  if (
    owner.data !== undefined ||
    Array.isArray(owner.buffer) ||
    typeof owner.write === "function" ||
    typeof owner.emitBoundValue === "function"
  ) {
    return "writer";
  }
  if (owner.context && typeof owner.context === "object") {
    return "reader";
  }
  return "none";
}

function locationFromOwner(owner) {
  if (!owner) {
    return {};
  }
  return {
    file: owner.file ?? owner.path ?? null,
    line: typeof owner.line === "number" ? owner.line : owner._line,
    column: owner.char ?? owner.column,
  };
}

function throwTemplateError(message) {
  const err = makeTemplateError(message);
  const loc = locationFromStack(err.stack);
  if (loc.file) {
    err.file = loc.file;
  }
  err.line = loc.line;
  err.column = loc.column;
  throw err;
}

export function registerBinding(owner, key, mode) {
  if (!owner) {
    return;
  }
  if (!owner.bindings) {
    owner.bindings = new Map();
  }
  const prev = owner.bindings.get(key);
  if (prev === undefined) {
    owner.bindings.set(key, mode);
    return;
  }
  if (prev !== mode) {
    throwTemplateError(`cannot mix .as and .asArray for ${JSON.stringify(key)}`);
  }
  if (mode === "as") {
    throwTemplateError(`key ${JSON.stringify(key)} is already bound`);
  }
}

function readWriterSource(owner, key, mode) {
  const data = owner.data ?? owner.context;
  if (data == null || typeof data !== "object") {
    return { missing: true };
  }
  if (mode === "asArray") {
    if (owner.repeatIndex == null) {
      return { missing: true };
    }
    const arr = data[key];
    if (arr == null) {
      return { missing: true };
    }
    if (!Array.isArray(arr)) {
      throwTemplateError(`key ${JSON.stringify(key)} is not an array`);
    }
    if (owner.repeatIndex >= arr.length || arr[owner.repeatIndex] === undefined) {
      return { missing: true };
    }
    return { value: arr[owner.repeatIndex] };
  }
  if (data[key] === undefined) {
    return { missing: true };
  }
  return { value: data[key] };
}

function isEmpty(value) {
  if (Array.isArray(value)) {
    return value.length === 0;
  }
  return !value;
}

function joinSlotPath(prefix, key) {
  if (!prefix) {
    return key;
  }
  return `${prefix}.${key}`;
}

function recordSlotMap(owner, slot, mode) {
  if (typeof owner.recordSlotBinding === "function") {
    owner.recordSlotBinding(slot, mode);
    return;
  }
  if (!Array.isArray(owner.slotMap)) {
    return;
  }
  const prefix = owner.slotPathPrefix ?? "";
  let key;
  if (mode === "asArray") {
    const index = Array.isArray(owner.context?.[slot.path]) ? owner.context[slot.path].length - 1 : 0;
    key = joinSlotPath(prefix, `${slot.path}[${index}]`);
  } else {
    key = joinSlotPath(prefix, slot.path);
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
  owner.slotMap.push(entry);
  if (slot.exists) {
    owner._matchedBinds = (owner._matchedBinds ?? 0) + 1;
  }
  if (mode === "asArray") {
    owner._usedAsArray = true;
  }
}

function emitValue(owner, slot, value) {
  if (typeof owner.emitBoundValue === "function") {
    owner.emitBoundValue(slot, value);
    return;
  }
  const text = value == null ? "" : String(value);
  if (Array.isArray(owner.buffer)) {
    owner.buffer.push(text);
    return;
  }
  if (typeof owner.write === "function") {
    owner.write(text);
  }
}

export class Slot {
  constructor(pathOrOwner = "", options = {}) {
    const ownerIsFirst = pathOrOwner != null && typeof pathOrOwner === "object";
    const opts = ownerIsFirst ? { owner: pathOrOwner, ...options } : options;
    const path = ownerIsFirst ? (opts.path ?? "") : pathOrOwner;

    this.path = path == null ? "" : String(path);
    this.leafType = opts.leafType ?? "value";
    this.value = opts.value === undefined ? null : opts.value;
    this.owner = opts.owner ?? null;
    this.sourceOffsetStart = opts.sourceOffsetStart ?? null;
    this.sourceOffsetEnd = opts.sourceOffsetEnd ?? null;
    this.node = opts.node ?? null;
    this.exists = false;

    this._matched = opts.matched ?? this.value != null;
    this._trim = false;
    this._notEmpty = false;
    this._validators = [];
    this._hasDefault = false;
    this._defaultValue = undefined;
    this._bound = false;
    this._bindMode = null;
  }

  trim() {
    this._trim = true;
    return this;
  }

  notEmpty() {
    this._notEmpty = true;
    return this;
  }

  validate(fn) {
    if (typeof fn === "function") {
      this._validators.push(fn);
    }
    return this;
  }

  default(value) {
    this._hasDefault = true;
    this._defaultValue = value;
    return this;
  }

  as(key) {
    return this._bind(key, "as");
  }

  asArray(key) {
    return this._bind(key, "asArray");
  }

  _bind(key, mode) {
    if (this._bound) {
      throwTemplateError("slot is already bound");
    }
    this._bound = true;
    this._bindMode = mode;
    this.path = String(key);

    const owner = this.owner;
    const kind = ownerMode(owner);
    registerBinding(owner, this.path, mode);

    let sourceMissing;
    let source;
    if (kind === "writer") {
      const read = readWriterSource(owner, this.path, mode);
      sourceMissing = read.missing === true;
      source = read.value;
      this.exists = !sourceMissing;
      if (mode === "asArray" && sourceMissing) {
        if (typeof owner.noteWriterMiss === "function") {
          owner.noteWriterMiss(mode);
        }
        this.value = undefined;
        return this;
      }
    } else {
      source = this.value;
      sourceMissing = !this._matched;
      this.exists = this._matched;
    }

    let value = sourceMissing ? undefined : source;
    if (sourceMissing && this._hasDefault) {
      value = this._defaultValue;
    }

    if (this._trim && typeof value === "string") {
      value = value.trim();
    }

    for (const fn of this._validators) {
      if (fn(value) === false) {
        throw makeUserError("validation failed", locationFromOwner(owner));
      }
    }

    if (this._notEmpty && isEmpty(value) && !owner?.optionalMode) {
      if (kind === "writer") {
        throwTemplateError(`slot ${JSON.stringify(this.path)} is empty`);
      }
      const err =
        typeof owner?.error === "function"
          ? owner.error("value is empty")
          : makeParseError("value is empty", locationFromOwner(owner));
      throw err;
    }

    this.value = value;

    if (kind === "reader" && owner.context) {
      if (mode === "asArray") {
        (owner.context[this.path] ??= []).push(value);
      } else {
        owner.context[this.path] = value;
      }
      recordSlotMap(owner, this, mode);
    } else if (kind === "writer") {
      if (sourceMissing && !this._hasDefault && typeof owner.noteWriterMiss === "function") {
        owner.noteWriterMiss(mode);
      }
      if (value !== undefined) {
        if (typeof owner.noteWriterBind === "function") {
          owner.noteWriterBind();
        }
        emitValue(owner, this, value);
      }
    }

    return this;
  }
}
