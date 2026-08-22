/**
 * @typedef {Object} Diagnostic
 * @property {string} code
 * @property {string} message
 * @property {string|null} file
 * @property {number} line
 * @property {number} column
 * @property {string|null} snippet
 */

export const ERROR_CODES = Object.freeze({
  DO_MD_USER_ERROR: "DO_MD_USER_ERROR",
  DO_MD_PARSE_ERROR: "DO_MD_PARSE_ERROR",
  DO_MD_TEMPLATE_ERROR: "DO_MD_TEMPLATE_ERROR",
  DO_MD_IO_ERROR: "DO_MD_IO_ERROR",
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

function pickLocation(payload = {}) {
  return {
    file: payload.file ?? payload.path ?? null,
    line: payload.line,
    column: payload.column ?? payload.char,
    snippet: payload.snippet,
  };
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
  const match = String(line).match(
    /(?:^|\s)(?:at(?:\s+async)?\s+(?:.+\s+\()?)?(?:file:\/\/\/?)?(.+?):(\d+):(\d+)\)?\s*$/,
  );
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
    const location = pickLocation(payload);
    super(normalizeMessage(payload.message));

    this.name = "SyntaxError";
    this.code = normalizeCode(payload.code);
    this.file = normalizeFile(location.file);
    this.line = normalizeIndex(location.line);
    this.column = normalizeIndex(location.column);
    this.snippet = location.snippet == null ? null : String(location.snippet);

    if (typeof Error.captureStackTrace === "function") {
      Error.captureStackTrace(this, SyntaxError);
    }
  }

  /** @returns {Diagnostic} */
  toDiagnostic() {
    return {
      code: this.code,
      message: this.message,
      file: this.file,
      line: this.line,
      column: this.column,
      snippet: this.snippet,
    };
  }
}

export function makeDiagnostic(message, code = ERROR_CODES.DO_MD_USER_ERROR, location = {}) {
  return new SyntaxError({
    code,
    message,
    ...pickLocation(location),
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
  });
}
