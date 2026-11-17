import { sourceLocation } from "./SourceMap.mjs";
import { Chalk } from "chalk";
import stringWidth from "string-width";

export const ERROR_CODES = Object.freeze({
  DO_MD_USER_ERROR: "DO_MD_USER_ERROR",
  DO_MD_PARSE_ERROR: "DO_MD_PARSE_ERROR",
  DO_MD_TEMPLATE_ERROR: "DO_MD_TEMPLATE_ERROR",
  DO_MD_IO_ERROR: "DO_MD_IO_ERROR",
  DO_MD_CONFLICT: "DO_MD_CONFLICT",
});

const INTERNAL_FRAME = /(?:^|[\\/])sources[\\/]|node:|^native$|^<anonymous>$/i;

function normalizeMessage(message) {
  const text = message == null ? "Unknown do-md error" : String(message);
  return text.replace(/[\r\n]+/g, " ").trim() || "Unknown do-md error";
}

function normalizeCode(code) {
  return Object.values(ERROR_CODES).includes(code) ? code : ERROR_CODES.DO_MD_USER_ERROR;
}

function normalizeFile(value) {
  if (value == null || value === "") {
    return null;
  }
  return String(value);
}

function normalizeIndex(value) {
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 ? n : 1;
}

export function primaryLocation(diagnostic) {
  const locations = diagnostic?.locations ?? [];
  return [...locations].reverse().find((l) => l.relation === "processing")
    ?? [...locations].reverse().find((l) => l.role !== "generated") ?? null;
}

const graphemes = new Intl.Segmenter("en", { granularity: "grapheme" });

// Expand tabs before measuring columns; escape terminal controls so displaying
// a source line cannot change the frame's layout or introduce ANSI sequences.
function displayText(value) {
  let text = "";
  let width = 0;
  for (const { segment } of graphemes.segment(String(value))) {
    const rendered = segment === "\t" ? " ".repeat(4 - width % 4)
      : segment.replace(/[\x00-\x1f\x7f-\x9f]/g, (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`);
    text += rendered;
    width += stringWidth(rendered);
  }
  return text;
}

function codeFrame(location, color) {
  if (location.snippet == null) return "";
  const { start, end } = location.range;
  const snippet = String(location.snippet);
  const offset = Math.min(Math.max(start.column - 1, 0), snippet.length);
  const line = displayText(snippet);
  const column = stringWidth(displayText(snippet.slice(0, offset)));
  const continues = end != null && end.line > start.line;
  const endColumn = end == null ? column + 1 : continues ? stringWidth(line)
    : stringWidth(displayText(snippet.slice(0, Math.max(offset, end.column - 1))));

  // Keep long lines readable while retaining context around the marked range.
  const width = stringWidth(line);
  const left = Math.max(0, Math.min(column - 40, width - 100));
  let position = 0;
  let visibleStart = null;
  let visible = "";
  for (const { segment } of graphemes.segment(line)) {
    const size = stringWidth(segment);
    if (position + size > left && position < left + 100) {
      visibleStart ??= position;
      visible += segment;
    }
    position += size;
  }
  visibleStart ??= 0;
  const before = visibleStart > 0 ? "…" : "";
  const after = visibleStart + stringWidth(visible) < width ? "…" : "";
  const caret = before.length + column - visibleStart;
  const markerWidth = Math.max(1, Math.min(endColumn - column, stringWidth(visible) - column + visibleStart));
  const context = location.precision === "context";
  const marker = context ? "~" : `^${"~".repeat(markerWidth - 1)}`;
  const note = context ? " processing context" : continues ? ` range ends at ${end.line}:${end.column}` : "";
  const gutter = String(start.line);
  return `${color.dim(`${gutter} |`)} ${before}${visible}${after}\n`
    + `${color.dim(`${" ".repeat(gutter.length)} |`)} ${" ".repeat(Math.max(0, caret))}${color.red(marker)}${color.dim(note)}`;
}

/** Render the existing diagnostic chain without reading files or modifying it. */
export function formatDiagnostic(diagnostic, { colors = false, includeGenerated = false } = {}) {
  const color = new Chalk({ level: colors ? 1 : 0 });
  const primary = primaryLocation(diagnostic)
    ?? (includeGenerated ? diagnostic.locations?.at(-1) : null);
  const message = displayText(diagnostic.message ?? "");
  if (!primary) return message;
  const locations = [primary, ...[...(diagnostic.locations ?? [])].reverse().filter((l) => l !== primary)];
  const seen = new Set();
  const blocks = [];
  for (const location of locations) {
    if (!includeGenerated && location.role === "generated") continue;
    const key = JSON.stringify(location);
    if (seen.has(key)) continue;
    seen.add(key);
    const path = displayText(location.source ?? "<unknown>");
    const point = `${path}:${location.range.start.line}:${location.range.start.column}`;
    const heading = blocks.length === 0 ? `${color.cyan(point)}: ${color.red(message)}`
      : `${color.dim(`${location.role}${location.relation === "processing" ? " (processing)" : ""}:`)} ${color.cyan(point)}`;
    const frame = codeFrame(location, color);
    blocks.push(`${heading}${frame ? `\n\n${frame}` : ""}`);
  }
  return blocks.join("\n\n");
}

// Factories accept cursor coordinates; serialized diagnostics always use locations.
function cursorLocation(payload, code) {
  if (!payload.file && !payload.path && payload.line == null && payload.column == null && payload.char == null) return [];
  const role = code === ERROR_CODES.DO_MD_TEMPLATE_ERROR ? "template" : "document";
  return [{ role, relation: role === "document" && code !== ERROR_CODES.DO_MD_IO_ERROR ? "processing" : "origin",
    source: normalizeFile(payload.file ?? payload.path),
    range: { start: { offset: payload.offset ?? null, line: normalizeIndex(payload.line), column: normalizeIndex(payload.column ?? payload.char) }, end: null },
    precision: payload.precision ?? "context", snippet: payload.snippet == null ? null : String(payload.snippet) }];
}

export function attachSource(error, source) {
  for (const location of error?.locations ?? []) {
    if (location.source == null) location.source = source;
  }
  return error;
}

export function addProcessingLocation(error, owner, slot = null) {
  const text = owner?.diagnosticSourceText ?? owner?.inputSourceText;
  if (typeof text !== "string") return error;
  const base = owner.diagnosticOffsetBase ?? 0;
  const start = base + (slot?.sourceOffsetStart ?? owner.offset ?? 0);
  const end = slot?.sourceOffsetEnd == null ? null : base + slot.sourceOffsetEnd;
  const location = sourceLocation(owner.file ?? null, text, start, end, {
    role: "document", relation: "processing", precision: slot ? "range" : "context",
  });
  const existing = error.locations.findIndex((l) => l.relation === "processing" && l.source === location.source);
  if (existing < 0) error.locations.push(location);
  else if (slot) error.locations[existing] = location;
  return error;
}

function normalizeSlashes(value) {
  return String(value).replace(/\\/g, "/");
}

function filesMatch(left, right) {
  if (!left || !right) {
    return false;
  }
  const a = normalizeSlashes(left);
  const b = normalizeSlashes(right);
  return a === b || a.endsWith(`/${b}`) || b.endsWith(`/${a}`) || a.endsWith(b) || b.endsWith(a);
}

function parseStackFrame(line) {
  const text = String(line).trim().replace(/^at\s+(?:async\s+)?/, "");
  const open = text.indexOf(" (");
  const location = text.endsWith(")") && open >= 0 ? text.slice(open + 2, -1) : text;
  const match = location.match(/^(?:file:\/\/\/?)?(.+?):(\d+):(\d+)$/);
  if (!match) {
    return null;
  }
  return {
    file: match[1],
    line: Number(match[2]),
    column: Number(match[3]),
  };
}

export function locationFromStack(stack, preferredFile = null) {
  const preferred = normalizeFile(preferredFile);
  if (!stack) {
    return { file: preferred, line: 1, column: 1 };
  }

  let fallback = null;
  for (const line of String(stack).split(/\r?\n/)) {
    const frame = parseStackFrame(line);
    if (!frame) {
      continue;
    }
    if (preferred && filesMatch(frame.file, preferred)) {
      return { file: preferred, line: frame.line, column: frame.column };
    }
    if (INTERNAL_FRAME.test(frame.file)) {
      continue;
    }
    if (!fallback) {
      fallback = {
        file: normalizeFile(frame.file),
        line: normalizeIndex(frame.line),
        column: normalizeIndex(frame.column),
      };
    }
  }

  return fallback ?? { file: preferred, line: 1, column: 1 };
}

export class SyntaxError extends Error {
  /** @param {Partial<Diagnostic> | string} diagnostic */
  constructor(diagnostic, fallback = {}) {
    const payload =
      typeof diagnostic === "string"
        ? { code: ERROR_CODES.DO_MD_USER_ERROR, message: diagnostic, ...fallback }
        : { ...fallback, ...diagnostic };
    super(normalizeMessage(payload.message), { cause: payload.cause });

    this.name = "SyntaxError";
    this.code = normalizeCode(payload.code);
    this.locations = structuredClone(payload.locations ?? cursorLocation(payload, this.code));

    if (typeof Error.captureStackTrace === "function") {
      // Deep parser/binding calls must retain the template frame. Restore the
      // process setting synchronously after materializing this error's stack.
      const limit = Error.stackTraceLimit;
      try {
        Error.stackTraceLimit = Math.max(limit ?? 10, 100);
        Error.captureStackTrace(this, SyntaxError);
        void this.stack;
      } finally { Error.stackTraceLimit = limit; }
    }
  }

  /** @returns {Diagnostic} */
  toDiagnostic() {
    return {
      code: this.code,
      message: this.message,
      locations: structuredClone(this.locations),
    };
  }

  toString() {
    return formatDiagnostic(this);
  }

  [Symbol.for("nodejs.util.inspect.custom")](_depth, options) {
    return formatDiagnostic(this, { colors: options?.colors === true });
  }
}

export function makeDiagnostic(message, code = ERROR_CODES.DO_MD_USER_ERROR, location = {}) {
  return new SyntaxError({
    code,
    message,
    ...location,
  });
}

export function makeParseError(message, location = {}) {
  return makeDiagnostic(message, ERROR_CODES.DO_MD_PARSE_ERROR, location);
}

export function makeTemplateError(message, location = {}) {
  return makeDiagnostic(message, ERROR_CODES.DO_MD_TEMPLATE_ERROR, location);
}

export function makeUserError(message, location = {}) {
  return makeDiagnostic(message, ERROR_CODES.DO_MD_USER_ERROR, location);
}

export function makeNotImplementedError(feature = "operation") {
  return makeDiagnostic(`${feature} is not implemented`, ERROR_CODES.DO_MD_USER_ERROR);
}

export function createIoError(message = "I/O error", code = ERROR_CODES.DO_MD_IO_ERROR, location = {}) {
  const loc = code && typeof code === "object" ? code : location;
  return makeDiagnostic(message, ERROR_CODES.DO_MD_IO_ERROR, loc);
}

export function createConflictError(message = "File revision conflict", location = {}) {
  return makeDiagnostic(message, ERROR_CODES.DO_MD_CONFLICT, location);
}

export function fromNativeError(error, options = {}) {
  const preferredFile = options.file ?? options.path ?? null;
  const location = locationFromStack(error?.stack, preferredFile);
  return new SyntaxError({
    code: options.code ?? ERROR_CODES.DO_MD_TEMPLATE_ERROR,
    message: error?.message ?? String(error),
    file: location.file ?? preferredFile,
    line: location.line,
    column: location.column,
    snippet: options.snippet ?? null,
    cause: error,
  });
}
