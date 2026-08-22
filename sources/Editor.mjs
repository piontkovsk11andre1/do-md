import { Template } from "./Template.mjs";
import { Writer } from "./Writer.mjs";
import { ERROR_CODES, fromNativeError, makeUserError } from "./SyntaxError.mjs";
import { parseSource, readText, readTextSnapshot, wrapTemplate, writeText } from "./commands/helpers.mjs";

const SAFE_KEY = /^[A-Za-z_][A-Za-z0-9_-]*$/;

function runTemplate(fn, doc, ctx, data, options, io, templatePath) {
  try {
    fn(doc, ctx, data, options ?? {}, io);
  } catch (error) {
    if (error?.code && Object.values(ERROR_CODES).includes(error.code)) {
      throw error;
    }
    throw fromNativeError(error, { file: templatePath });
  }
}

function isUnsafeKey(key) {
  return key === "__proto__" || key === "constructor" || key === "prototype";
}

function tokenizePath(path) {
  const text = String(path ?? "");
  const parts = [];
  let i = 0;
  while (i < text.length) {
    if (parts.length > 0) {
      if (text[i] === ".") {
        i += 1;
        if (i >= text.length || text[i] === "." || text[i] === "[") {
          throw makeUserError(`invalid path: ${text}`);
        }
      } else if (text[i] !== "[") {
        throw makeUserError(`invalid path: ${text}`);
      }
    } else if (text[i] === "." || text[i] === "[") {
      throw makeUserError(`invalid path: ${text}`);
    }

    if (text[i] === "[") {
      const close = text.indexOf("]", i);
      const digits = close < 0 ? "" : text.slice(i + 1, close);
      if (close < 0 || !/^\d+$/.test(digits)) {
        throw makeUserError(`invalid path: ${text}`);
      }
      parts.push(Number(digits));
      i = close + 1;
      continue;
    }

    let j = i;
    while (j < text.length && text[j] !== "." && text[j] !== "[" && text[j] !== "]") {
      j += 1;
    }
    const key = text.slice(i, j);
    if (!key || !SAFE_KEY.test(key) || isUnsafeKey(key)) {
      throw makeUserError(`invalid path: ${text}`);
    }
    parts.push(key);
    i = j;
  }
  if (parts.length === 0) {
    throw makeUserError(`invalid path: ${text}`);
  }
  return parts;
}

function formatPath(parts) {
  let out = "";
  for (const part of parts) {
    if (typeof part === "number") {
      out += `[${part}]`;
    } else if (out) {
      out += `.${part}`;
    } else {
      out = part;
    }
  }
  return out;
}

function isPathPrefix(parent, child) {
  if (!child.startsWith(parent) || child === parent) {
    return false;
  }
  const next = child[parent.length];
  return next === "." || next === "[";
}

export function lookupSlot(slotMap, path) {
  const normalized = formatPath(tokenizePath(path));
  const slots = Array.isArray(slotMap) ? slotMap : [];
  for (const slot of slots) {
    if (slot.key === normalized) {
      return { kind: "exact", slot };
    }
  }
  for (const slot of slots) {
    if (isPathPrefix(slot.key, normalized)) {
      return { kind: "descendant", slot };
    }
  }
  for (const slot of slots) {
    if (isPathPrefix(normalized, slot.key)) {
      return { kind: "descendant", slot };
    }
  }
  return { kind: "unknown", slot: null };
}

function cloneValue(value) {
  if (Array.isArray(value)) {
    return value.map(cloneValue);
  }
  if (value && typeof value === "object") {
    const out = {};
    for (const [key, item] of Object.entries(value)) {
      out[key] = cloneValue(item);
    }
    return out;
  }
  return value;
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    if (Array.isArray(value)) {
      for (const item of value) {
        deepFreeze(item);
      }
    } else {
      for (const key of Object.keys(value)) {
        deepFreeze(value[key]);
      }
    }
  }
  return value;
}

function protect(value) {
  return deepFreeze(cloneValue(value));
}

function getAtPath(target, path) {
  const parts = tokenizePath(path);
  let current = target;
  for (const key of parts) {
    if (current == null || typeof current !== "object") {
      return undefined;
    }
    if (typeof key === "number") {
      if (!Array.isArray(current) || key < 0 || key >= current.length) {
        return undefined;
      }
      current = current[key];
      continue;
    }
    if (!Object.hasOwn(current, key)) {
      return undefined;
    }
    current = current[key];
  }
  return current;
}

function setAtPath(target, path, value) {
  const parts = tokenizePath(path);
  let current = target;
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i];
    const next = parts[i + 1];
    const existing = current[key];
    if (existing == null || typeof existing !== "object") {
      current[key] = typeof next === "number" ? [] : {};
    }
    current = current[key];
  }
  current[parts[parts.length - 1]] = value;
}

function deleteAtPath(target, path) {
  const parts = tokenizePath(path);
  let current = target;
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i];
    if (current == null || typeof current !== "object") {
      throw makeUserError(`unknown slot: ${path}`);
    }
    if (typeof key === "number") {
      if (!Array.isArray(current) || key < 0 || key >= current.length) {
        throw makeUserError(`unknown slot: ${path}`);
      }
    } else if (!Object.hasOwn(current, key)) {
      throw makeUserError(`unknown slot: ${path}`);
    }
    current = current[key];
  }
  const last = parts[parts.length - 1];
  if (typeof last === "number") {
    if (!Array.isArray(current) || last < 0 || last >= current.length) {
      throw makeUserError(`unknown slot: ${path}`);
    }
    current.splice(last, 1);
    return;
  }
  if (current == null || typeof current !== "object" || !Object.hasOwn(current, last)) {
    throw makeUserError(`unknown slot: ${path}`);
  }
  delete current[last];
}

function isPlainObject(value) {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function isStringArray(value) {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

const STRING_LEAF_TYPES = new Set([
  "line",
  "text",
  "heading",
  "paragraph",
  "blockQuote",
  "htmlBlock",
  "codeSpan",
  "autolink",
  "rawUntil",
  "rawBlock",
  "rawRest",
]);

const AGGREGATE_LEAF_TYPES = new Set([
  "list",
  "listTree",
  "table",
  "frontmatter",
  "rawUntil",
  "rawBlock",
  "rawRest",
]);

function matchesTableShape(value) {
  if (!isPlainObject(value) || !isStringArray(value.headers) || value.headers.length === 0) {
    return false;
  }
  if (!Array.isArray(value.align) || value.align.length !== value.headers.length) {
    return false;
  }
  if (!value.align.every((item) => item === null || item === "left" || item === "right" || item === "center")) {
    return false;
  }
  if (!Array.isArray(value.rows)) {
    return false;
  }
  for (const row of value.rows) {
    if (!Array.isArray(row) || row.length > value.headers.length) {
      return false;
    }
    if (!row.every((cell) => typeof cell === "string")) {
      return false;
    }
  }
  return true;
}

function matchesListTreeShape(value) {
  if (!isPlainObject(value) || !Array.isArray(value.items)) {
    return false;
  }
  if (value.ordered === true && value.start != null && (!Number.isInteger(value.start) || value.start < 0)) {
    return false;
  }
  return value.items.every((item) =>
    isPlainObject(item) &&
    Array.isArray(item.children) &&
    (item.checked == null || typeof item.checked === "boolean"));
}

function matchesFrontmatterShape(value) {
  if (!isPlainObject(value)) {
    return false;
  }
  const structured =
    value.format === "yaml" &&
    Object.hasOwn(value, "data") &&
    Object.hasOwn(value, "raw") &&
    Object.hasOwn(value, "content");
  return !structured || isPlainObject(value.data);
}

function overlayParsedContext(current, parsed) {
  if (Array.isArray(parsed)) {
    return parsed.map((value, index) => overlayParsedContext(current?.[index], value));
  }
  if (isPlainObject(parsed)) {
    const out = isPlainObject(current) ? cloneValue(current) : {};
    for (const [key, value] of Object.entries(parsed)) {
      out[key] = overlayParsedContext(current?.[key], value);
    }
    return out;
  }
  return cloneValue(parsed);
}

function matchesLeafShape(leafType, value) {
  if (STRING_LEAF_TYPES.has(leafType)) {
    return typeof value === "string";
  }
  switch (leafType) {
    case "list":
      return isStringArray(value);
    case "listTree":
      return matchesListTreeShape(value);
    case "frontmatter":
      return matchesFrontmatterShape(value);
    case "checkbox":
      return typeof value === "boolean";
    case "thematicBreak":
      return value === true;
    case "table":
      return matchesTableShape(value);
    case "codeBlock":
      return isPlainObject(value) && (value.language == null || typeof value.language === "string") && typeof value.value === "string";
    case "link":
      return isPlainObject(value) && typeof value.url === "string" && typeof value.text === "string" && (value.title == null || typeof value.title === "string");
    case "image":
      return isPlainObject(value) && typeof value.url === "string" && typeof value.alt === "string" && (value.title == null || typeof value.title === "string");
    default:
      return true;
  }
}

function requireKnownPath(slotMap, path, regionMap = []) {
  const lookup = lookupSlot(slotMap, path);
  if (lookup.kind === "unknown") {
    const normalized = formatPath(tokenizePath(path));
    const region = regionMap.find((item) => item.path === normalized);
    if (region) {
      return { kind: "region", slot: null, region };
    }
    throw makeUserError(`unknown slot: ${path}`);
  }
  return lookup;
}

function requireArrayAtPath(slotMap, regionMap, ctx, path) {
  const lookup = requireKnownPath(slotMap, path, regionMap);
  if (lookup.kind === "exact" && lookup.slot.leafType !== "list") {
    throw makeUserError(`type mismatch: ${path}`);
  }
  const value = getAtPath(ctx, path);
  if (!Array.isArray(value)) {
    throw makeUserError(`type mismatch: ${path}`);
  }
  return value;
}

function requireIndex(index, path) {
  if (!Number.isInteger(index) || index < 0) {
    throw makeUserError(`type mismatch: ${path}`);
  }
  return index;
}

function isStructuralSet(lookup, path, value, ctx) {
  if (lookup.kind === "region") {
    return true;
  }
  if (lookup.kind === "descendant") {
    return true;
  }
  if (!matchesLeafShape(lookup.slot.leafType, value)) {
    return true;
  }
  if (lookup.slot.leafType === "list") {
    const current = getAtPath(ctx, path);
    return !Array.isArray(current) || current.length !== value.length;
  }
  return false;
}

function assertSafeMergeKeys(value, parts = []) {
  if (value == null || typeof value !== "object") {
    return;
  }
  for (const key of Object.keys(value)) {
    const next = Array.isArray(value) && /^\d+$/.test(key) ? [...parts, Number(key)] : [...parts, key];
    if (isUnsafeKey(key)) {
      throw makeUserError(`unsafe patch key: ${formatPath(next)}`);
    }
    assertSafeMergeKeys(value[key], next);
  }
}

function deepMerge(target, source, prefix = "") {
  if (source == null || typeof source !== "object" || Array.isArray(source)) {
    return source;
  }
  const base = isPlainObject(target) ? target : Object.create(null);
  for (const [key, value] of Object.entries(source)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (isUnsafeKey(key)) {
      throw makeUserError(`unsafe patch key: ${path}`);
    }
    if (isPlainObject(value)) {
      base[key] = deepMerge(base[key], value, path);
    } else {
      base[key] = value;
    }
  }
  return base;
}

function headingLevelForSlot(slot, source) {
  if (Number.isInteger(slot.headingLevel) && slot.headingLevel >= 1) {
    return Math.min(6, slot.headingLevel);
  }
  const original = String(source ?? "").slice(slot.sourceOffsetStart, slot.sourceOffsetEnd);
  const atx = original.match(/^ {0,3}(#{1,6})(?:[ \t]|$)/m);
  if (atx) {
    return atx[1].length;
  }
  if (/^=+[ \t]*$/m.test(original)) {
    return 1;
  }
  if (/^-+[ \t]*$/m.test(original)) {
    return 2;
  }
  return 1;
}

function applySplices(source, splices) {
  let out = String(source ?? "");
  for (const { start, end, replacement } of splices) {
    out = `${out.slice(0, start)}${replacement}${out.slice(end)}`;
  }
  return out;
}

export class Editor {
  constructor({ io, file = "", template = "", context = {}, options = {} } = {}) {
    this.io = io;
    this.file = file;
    this.template = template;
    this.templateSource = template;
    this._context = cloneValue(context);
    this._original = cloneValue(context);
    this.options = options ?? {};
    this.writer = new Writer(context, this.options);
    this.slotMap = [];
    this.regionMap = [];
    this.originalSource = "";
    this.revision = null;
    this._journal = [];
    this._structuralDirty = false;
  }

  get context() {
    return protect(this._context);
  }

  get original() {
    return protect(this._original);
  }

  get isDirty() {
    return this._journal.length > 0;
  }

  get dirtyKeys() {
    const seen = new Set();
    const keys = [];
    for (const entry of this._journal) {
      if (seen.has(entry.path)) {
        continue;
      }
      seen.add(entry.path);
      keys.push(entry.path);
    }
    return keys;
  }

  get changes() {
    return protect(this._journal.map((entry) => ({
      path: entry.path,
      before: entry.before,
      after: entry.after,
    })));
  }

  _recordChange(path, before, after, { structural = false, deleted = false } = {}) {
    this._journal.push({
      path: formatPath(tokenizePath(path)),
      before: cloneValue(before),
      after: cloneValue(after),
      structural: Boolean(structural),
      deleted: Boolean(deleted),
    });
    if (structural) {
      this._structuralDirty = true;
    }
  }

  _rebuildFromJournal() {
    this._context = cloneValue(this._original);
    this._structuralDirty = false;
    for (const entry of this._journal) {
      if (entry.deleted) {
        deleteAtPath(this._context, entry.path);
      } else {
        setAtPath(this._context, entry.path, cloneValue(entry.after));
      }
      if (entry.structural) {
        this._structuralDirty = true;
      }
    }
  }

  static async open({ io, file, template, options } = {}) {
    if (io == null || typeof io.readFileAsync !== "function") {
      throw makeUserError("missing io");
    }
    if (file == null || file === "") {
      throw makeUserError("missing file");
    }
    if (template == null || template === "") {
      throw makeUserError("missing template");
    }

    const snapshot = await readTextSnapshot(io, file, options);
    const source = snapshot.content;
    const templateSource = await readText(io, template, options);
    const fn = wrapTemplate(templateSource, template);
    const reader = parseSource(source, fn, { file, templatePath: template, options, io });

    if (reader.errors.length > 0) {
      const first = reader.errors[0];
      first.errors = reader.errors;
      throw first;
    }

    const editor = new Editor({ io, file, template, context: reader.context, options });
    editor.templateSource = templateSource;
    editor.slotMap = reader.slotMap.map((slot) => ({ ...slot }));
    editor.regionMap = reader.regionMap.map((region) => ({
      ...region,
      elements: region.elements.map((element) => ({ ...element })),
    }));
    editor.originalSource = source;
    editor.revision = snapshot.revision;
    return editor;
  }

  get(path) {
    return getAtPath(this._context, path);
  }

  has(path) {
    if (getAtPath(this._context, path) !== undefined) {
      return true;
    }
    const normalized = formatPath(tokenizePath(path));
    return lookupSlot(this.slotMap, normalized).kind !== "unknown" ||
      this.regionMap.some((region) => region.path === normalized);
  }

  keys() {
    const seen = new Set();
    const out = [];
    for (const slot of this.slotMap) {
      let top;
      try {
        top = tokenizePath(slot.key)[0];
      } catch {
        continue;
      }
      if (typeof top !== "string" || seen.has(top)) {
        continue;
      }
      seen.add(top);
      out.push(top);
    }
    for (const region of this.regionMap) {
      const top = tokenizePath(region.path)[0];
      if (typeof top === "string" && !seen.has(top)) {
        seen.add(top);
        out.push(top);
      }
    }
    return out;
  }

  set(path, value) {
    const lookup = requireKnownPath(this.slotMap, path, this.regionMap);
    if (lookup.kind === "region" && !Array.isArray(value)) {
      throw makeUserError(`type mismatch: ${path}`);
    }
    if (lookup.kind === "exact" && !matchesLeafShape(lookup.slot.leafType, value)) {
      throw makeUserError(`type mismatch: ${path}`);
    }
    const structural = isStructuralSet(lookup, path, value, this._context);
    const before = getAtPath(this._context, path);
    if (structural) {
      this._structuralDirty = true;
    }
    setAtPath(this._context, path, cloneValue(value));
    this._recordChange(path, before, value, { structural });
    return this;
  }

  patch(obj) {
    if (!isPlainObject(obj)) {
      throw makeUserError("patch requires an object");
    }
    assertSafeMergeKeys(obj);
    this._structuralDirty = true;
    for (const [key, value] of Object.entries(obj)) {
      const before = this._context[key];
      this._context[key] = cloneValue(value);
      this._recordChange(key, before, value, { structural: true });
    }
    return this;
  }

  merge(obj) {
    if (!isPlainObject(obj)) {
      throw makeUserError("merge requires an object");
    }
    assertSafeMergeKeys(obj);
    const befores = {};
    for (const key of Object.keys(obj)) {
      befores[key] = cloneValue(this._context[key]);
    }
    this._structuralDirty = true;
    this._context = deepMerge(this._context, obj);
    for (const key of Object.keys(obj)) {
      this._recordChange(key, befores[key], this._context[key], { structural: true });
    }
    return this;
  }

  delete(path) {
    requireKnownPath(this.slotMap, path, this.regionMap);
    const before = getAtPath(this._context, path);
    this._structuralDirty = true;
    deleteAtPath(this._context, path);
    this._recordChange(path, before, undefined, { structural: true, deleted: true });
    return this;
  }

  append(path, value) {
    const target = requireArrayAtPath(this.slotMap, this.regionMap, this._context, path);
    const before = cloneValue(target);
    this._structuralDirty = true;
    target.push(cloneValue(value));
    this._recordChange(path, before, target, { structural: true });
    return this;
  }

  prepend(path, value) {
    const target = requireArrayAtPath(this.slotMap, this.regionMap, this._context, path);
    const before = cloneValue(target);
    this._structuralDirty = true;
    target.unshift(cloneValue(value));
    this._recordChange(path, before, target, { structural: true });
    return this;
  }

  insert(path, index, value) {
    const target = requireArrayAtPath(this.slotMap, this.regionMap, this._context, path);
    const at = requireIndex(index, path);
    const before = cloneValue(target);
    this._structuralDirty = true;
    target.splice(at, 0, cloneValue(value));
    this._recordChange(path, before, target, { structural: true });
    return this;
  }

  move(path, fromIndex, toIndex) {
    const target = requireArrayAtPath(this.slotMap, this.regionMap, this._context, path);
    const from = requireIndex(fromIndex, path);
    const to = requireIndex(toIndex, path);
    if (from >= target.length) {
      throw makeUserError(`type mismatch: ${path}`);
    }
    const before = cloneValue(target);
    this._structuralDirty = true;
    const [item] = target.splice(from, 1);
    target.splice(Math.min(to, target.length), 0, item);
    this._recordChange(path, before, target, { structural: true });
    return this;
  }

  revert(path) {
    const normalized = formatPath(tokenizePath(path));
    for (let i = this._journal.length - 1; i >= 0; i--) {
      if (this._journal[i].path === normalized) {
        this._journal.splice(i, 1);
        this._rebuildFromJournal();
        return this;
      }
    }
    throw makeUserError(`unknown slot: ${path}`);
  }

  revertAll() {
    this._journal = [];
    this._context = cloneValue(this._original);
    this._structuralDirty = false;
    return this;
  }

  render() {
    return this._compose();
  }

  async save({ to = null, force = false } = {}) {
    if (!this.io?.writeFileAsync && !this.io?.writeFileAtomicAsync) {
      throw makeUserError("Editor.save requires io");
    }

    const outputPath = to ?? this.file;
    const text = this.render();
    const samePath = outputPath === this.file;
    const writeOptions = samePath
      ? force === true ? { force: true } : { expectedRevision: this.revision }
      : { force: true };
    const committed = await writeText(this.io, outputPath, text, writeOptions);
    this._rebase(outputPath, text, committed?.revision ?? null);
  }

  _compose() {
    const splices = this._splices();
    if (splices == null) {
      return this._renderFull();
    }
    return applySplices(this.originalSource, splices);
  }

  _splices() {
    const latest = new Map();
    const regions = new Map();
    for (const entry of this._journal) {
      const lookup = lookupSlot(this.slotMap, entry.path);
      if (lookup.kind === "unknown") {
        const region = this._enclosingRegion(entry.path);
        if (!region) {
          return null;
        }
        regions.set(region.path, region);
        continue;
      }
      if (!entry.structural && !entry.deleted && lookup.kind === "exact") {
        latest.set(entry.path, { path: entry.path, slot: lookup.slot });
        continue;
      }
      if (lookup.slot && AGGREGATE_LEAF_TYPES.has(lookup.slot.leafType)) {
        latest.set(lookup.slot.key, { path: lookup.slot.key, slot: lookup.slot });
        continue;
      }
      const region = this._enclosingRegion(entry.path);
      if (!region) {
        return null;
      }
      regions.set(region.path, region);
    }

    const selectedRegions = [...regions.values()].filter((region, _index, all) =>
      !all.some((parent) => parent !== region && isPathPrefix(parent.path, region.path)));
    for (const { path } of latest.values()) {
      if (selectedRegions.some((region) => region.path === path || isPathPrefix(region.path, path))) {
        latest.delete(path);
      }
    }

    const splices = [];
    for (const { path, slot } of latest.values()) {
      const start = Number(slot.sourceOffsetStart);
      const end = Number(slot.sourceOffsetEnd);
      if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
        return null;
      }
      const value = getAtPath(this._context, path);
      if (!matchesLeafShape(slot.leafType, value)) {
        return null;
      }
      splices.push({
        start,
        end,
        replacement: this._renderSlot(slot, value),
      });
    }

    if (selectedRegions.length > 0) {
      const rendered = this._renderFull();
      for (const region of selectedRegions) {
        const outputRegion = this.writer.regionMap.find((candidate) => candidate.path === region.path);
        if (!outputRegion) {
          return null;
        }
        const start = Number(region.sourceOffsetStart);
        const end = Number(region.sourceOffsetEnd);
        const outputStart = Number(outputRegion.outputOffsetStart);
        const outputEnd = Number(outputRegion.outputOffsetEnd);
        if (![start, end, outputStart, outputEnd].every(Number.isFinite) || end < start || outputEnd < outputStart) {
          return null;
        }
        splices.push({ start, end, replacement: rendered.slice(outputStart, outputEnd) });
      }
    }

    splices.sort((a, b) => b.start - a.start || b.end - a.end);
    for (let i = 1; i < splices.length; i++) {
      if (splices[i].end > splices[i - 1].start ||
          (splices[i].start === splices[i].end && splices[i].start === splices[i - 1].start)) {
        return null;
      }
    }
    return splices;
  }

  _enclosingRegion(path) {
    let match = null;
    for (const region of this.regionMap) {
      if (region.path !== path && !isPathPrefix(region.path, path)) {
        continue;
      }
      if (!match || region.path.length > match.path.length) {
        match = region;
      }
    }
    return match;
  }

  _renderSlot(slot, value) {
    const writer = new Writer(this._context, { ...(this.options ?? {}), file: this.template });
    const prepared = slot.leafType === "heading"
      ? { ...slot, headingLevel: headingLevelForSlot(slot, this.originalSource) }
      : slot;
    return writer.serializeSlotValue(prepared, value);
  }

  _renderFull() {
    const fn = wrapTemplate(this.templateSource, this.template);
    const writer = new Writer(this._context, { ...(this.options ?? {}), file: this.template });
    runTemplate(fn, writer, this._context, this._context, this.options, this.io, this.template);
    this.writer = writer;
    return writer.toMarkdown();
  }

  _rebase(file, source, revision) {
    const fn = wrapTemplate(this.templateSource, this.template);
    const reader = parseSource(source, fn, {
      file,
      templatePath: this.template,
      options: this.options,
      io: this.io,
    });
    if (reader.errors.length > 0) {
      const first = reader.errors[0];
      first.errors = reader.errors;
      throw first;
    }
    this.file = file;
    this.revision = revision;
    this.originalSource = source;
    this.slotMap = reader.slotMap.map((slot) => ({ ...slot }));
    this.regionMap = reader.regionMap.map((region) => ({
      ...region,
      elements: region.elements.map((element) => ({ ...element })),
    }));
    this._context = overlayParsedContext(this._context, reader.context);
    this._original = cloneValue(this._context);
    this._journal = [];
    this._structuralDirty = false;
    this.writer = new Writer(reader.context, this.options);
  }
}

export const TEMPLATE_ENTRYPOINT = Template.sourceDirective;
