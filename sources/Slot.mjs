import {
  addProcessingLocation,
  makeParseError,
  makeTemplateError,
  makeUserError,
  isDiagnosticError,
  errorMessage,
} from "./DoMdError.mjs";

/** @typedef {import('./RuntimeContracts.d.mts').SlotOwner} SlotOwner */
/** @typedef {import('./RuntimeContracts.d.mts').BindingMode} BindingMode */
/** @typedef {import('./types.d.mts').SlotMetadata} SlotMetadata */
/** @typedef {import('./RuntimeContracts.d.mts').SlotDescription} SlotDescription */

/** @param {SlotOwner | null} owner */
function locationFromOwner(owner) {
  if (!owner) {
    return {};
  }
  return {
    file: owner.file ?? null,
    line: owner.lineNumber,
    column: owner.char,
  };
}

/** @param {string} message @returns {never} */
function throwTemplateError(message) {
  throw makeTemplateError(message);
}

/** @param {SlotOwner | null | undefined} owner @param {string} key @param {BindingMode} mode */
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

/** @param {SlotOwner} owner @param {string} key @param {BindingMode} mode
 * @returns {{ missing: boolean, value?: unknown }} */
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
    return { missing: false, value: arr[owner.repeatIndex] };
  }
  if (data[key] === undefined) {
    return { missing: true };
  }
  return { missing: false, value: data[key] };
}

/** @param {unknown} value */
function isEmpty(value) {
  if (Array.isArray(value)) {
    return value.length === 0;
  }
  return !value;
}

/** @param {string} prefix @param {string} key */
function joinSlotPath(prefix, key) {
  if (!prefix) {
    return key;
  }
  return `${prefix}.${key}`;
}

/** @param {SlotOwner} owner @param {SlotDescription} slot @param {BindingMode} mode */
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
    const values = owner.context?.[slot.path];
    const index = Array.isArray(values) ? values.length - 1 : 0;
    key = joinSlotPath(prefix, `${slot.path}[${index}]`);
  } else {
    key = joinSlotPath(prefix, slot.path);
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
  owner.slotMap.push(entry);
  if (slot.exists) {
    owner._matchedBinds = (owner._matchedBinds ?? 0) + 1;
  }
  if (mode === "asArray") {
    owner._usedAsArray = true;
  }
}

/** @param {SlotOwner} owner @param {SlotDescription} slot @param {unknown} value */
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

/**
 * An eager binding operation owned by a Reader or Writer. Configuration is applied
 * in the fixed order default → trim → validators → notEmpty at as()/asArray().
 * A slot can bind once; duplicate scalar keys are rejected within its owner scope.
 * @template [T=unknown]
 */
export class Slot {
  /** @type {number | undefined} */
  headingLevel;
  /** @type {unknown} */
  frontmatterOptions;
  /** @param {string | SlotOwner} [pathOrOwner] @param {import('./RuntimeContracts.d.mts').SlotOptions<T>} [options] */
  constructor(pathOrOwner = "", options = {}) {
    const ownerIsFirst = pathOrOwner != null && typeof pathOrOwner === "object";
    const opts = ownerIsFirst ? { owner: pathOrOwner, ...options } : options;
    const path = ownerIsFirst ? (opts.path ?? "") : pathOrOwner;

    this.path = path == null ? "" : String(path);
    this.leafType = opts.leafType ?? "value";
    /** @type {T | null | undefined} */
    this.value = opts.value === undefined ? null : opts.value;
    this.owner = opts.owner ?? null;
    if (this.owner && !["reader", "writer"].includes(this.owner.mode)) {
      throw makeTemplateError("slot owner must declare reader or writer mode");
    }
    this.sourceOffsetStart = opts.sourceOffsetStart ?? null;
    this.sourceOffsetEnd = opts.sourceOffsetEnd ?? null;
    this.node = opts.node ?? null;
    this.exists = false;

    /** @internal */
    this._matched = opts.matched ?? this.value != null;
    /** @internal */
    this._trim = false;
    /** @internal */
    this._notEmpty = false;
    /** @internal @type {Array<(value: unknown) => boolean | void>} */
    this._validators = [];
    /** @internal */
    this._hasDefault = false;
    /** @internal @type {T | undefined} */
    this._defaultValue = undefined;
    /** @internal */
    this._bound = false;
    /** @internal @type {BindingMode | null} */
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

  /** @param {(value: T | undefined) => boolean | void} fn */
  validate(fn) {
    if (typeof fn === "function") {
      this._validators.push((value) => fn(/** @type {T | undefined} */ (value)));
    }
    return this;
  }

  /** @param {T} value */
  default(value) {
    this._hasDefault = true;
    this._defaultValue = value;
    return this;
  }

  /** @param {string} key */
  as(key) {
    return this._bind(key, "as");
  }

  /** @param {string} key */
  asArray(key) {
    return this._bind(key, "asArray");
  }

  /** @internal @param {string} key @param {BindingMode} mode */
  _bind(key, mode) {
    try {
      return this._bindValue(key, mode);
    } catch (cause) {
      const error = isDiagnosticError(cause)
        ? cause
        : makeTemplateError(errorMessage(cause), { cause });
      throw addProcessingLocation(error, this.owner, this);
    }
  }

  /** @internal @param {string} key @param {BindingMode} mode */
  _bindValue(key, mode) {
    if (this._bound) {
      throwTemplateError("slot is already bound");
    }
    this._bound = true;
    this._bindMode = mode;
    this.path = String(key);

    const owner = this.owner;
    const kind = owner?.mode ?? "none";
    registerBinding(owner, this.path, mode);

    let sourceMissing;
    let source;
    if (owner && kind === "writer") {
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

    // The leaf's T is the template's value contract. Writer input is dynamic;
    // validators apply before that value can be emitted or stored in context.
    let value = /** @type {T | undefined} */ (sourceMissing ? undefined : source);
    if (sourceMissing && this._hasDefault) {
      value = this._defaultValue;
    }

    if (this._trim && typeof value === "string") {
      value = /** @type {T} */ (value.trim());
    }

    for (const fn of this._validators) {
      const validate = () => fn(value);
      const valid = owner?.withReadSession ? owner.withReadSession(validate) : validate();
      if (valid === false) {
        throw makeUserError("validation failed");
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

    if (owner && kind === "reader" && owner.context) {
      if (mode === "asArray") {
        const values = owner.context[this.path] ?? [];
        if (!Array.isArray(values)) {
          throwTemplateError(`key ${JSON.stringify(this.path)} is not an array`);
        }
        values.push(value);
        owner.context[this.path] = values;
      } else {
        owner.context[this.path] = value;
      }
      recordSlotMap(owner, this, mode);
    } else if (owner && kind === "writer") {
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
