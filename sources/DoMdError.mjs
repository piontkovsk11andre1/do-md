import { formatDiagnostic } from "./DiagnosticFormat.mjs";
import { locationFromStack } from "./StackTrace.mjs";
export { formatDiagnostic } from "./DiagnosticFormat.mjs";
export { primaryLocation, attachSource, addProcessingLocation } from "./Diagnostics.mjs";
export { locationFromStack } from "./StackTrace.mjs";

export const ERROR_CODES = Object.freeze({
  DO_MD_USER_ERROR: "DO_MD_USER_ERROR",
  DO_MD_PARSE_ERROR: "DO_MD_PARSE_ERROR",
  DO_MD_TEMPLATE_ERROR: "DO_MD_TEMPLATE_ERROR",
  DO_MD_IO_ERROR: "DO_MD_IO_ERROR",
  DO_MD_CONFLICT: "DO_MD_CONFLICT",
});

/** Factories accept cursor context; the wire contract contains only locations. */
function cursorLocation(payload, code) {
  if (
    !payload.file &&
    !payload.path &&
    payload.line == null &&
    payload.column == null &&
    payload.char == null
  ) {
    return [];
  }
  const role = code === ERROR_CODES.DO_MD_TEMPLATE_ERROR ? "template" : "document";
  const index = (value) => (Number.isInteger(value) && value >= 1 ? value : 1);
  return [
    {
      role,
      relation:
        role === "document" && code !== ERROR_CODES.DO_MD_IO_ERROR ? "processing" : "origin",
      source: payload.file ?? payload.path ?? null,
      range: {
        start: {
          offset: payload.offset ?? null,
          line: index(payload.line),
          column: index(payload.column ?? payload.char),
        },
        end: null,
      },
      precision: payload.precision ?? "context",
      snippet: payload.snippet == null ? null : String(payload.snippet),
    },
  ];
}

/**
 * A do-md domain failure with a transport-safe diagnostic and an ordinary cause.
 * Location ownership is detached on construction/serialization. V8 stack capture
 * remains available for mapping/debugging; rendering is delegated to a presenter.
 */
export class DoMdError extends Error {
  constructor(diagnostic, fallback = {}) {
    const payload =
      typeof diagnostic === "string"
        ? { code: ERROR_CODES.DO_MD_USER_ERROR, message: diagnostic, ...fallback }
        : { ...fallback, ...diagnostic };
    super(
      String(payload.message ?? "Unknown do-md error")
        .replace(/[\r\n]+/g, " ")
        .trim() || "Unknown do-md error",
      { cause: payload.cause },
    );
    this.name = "DoMdError";
    this.code = Object.values(ERROR_CODES).includes(payload.code)
      ? payload.code
      : ERROR_CODES.DO_MD_USER_ERROR;
    this.locations = structuredClone(payload.locations ?? cursorLocation(payload, this.code));
    // Parser stacks can be deep. Change the limit only during synchronous capture
    // and materialization, so callers keep their own process-wide stack policy.
    const limit = Error.stackTraceLimit;
    try {
      Error.stackTraceLimit = Math.max(limit ?? 10, 100);
      Error.captureStackTrace(this, DoMdError);
      void this.stack;
    } finally {
      Error.stackTraceLimit = limit;
    }
  }

  /** Return detached plain data, deliberately excluding JS stacks and causes. */
  toDiagnostic() {
    return { code: this.code, message: this.message, locations: structuredClone(this.locations) };
  }
  toString() {
    return formatDiagnostic(this);
  }
  [Symbol.for("nodejs.util.inspect.custom")](_depth, options) {
    return formatDiagnostic(this, { colors: options?.colors === true });
  }
}

/** Create one normalized library error; transports add their own service-only codes. */
export function makeDiagnostic(message, code = ERROR_CODES.DO_MD_USER_ERROR, location = {}) {
  return new DoMdError({ code, message, ...location });
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
  return makeUserError(`${feature} is not implemented`);
}
export function createIoError(
  message = "I/O error",
  code = ERROR_CODES.DO_MD_IO_ERROR,
  location = {},
) {
  return makeDiagnostic(
    message,
    ERROR_CODES.DO_MD_IO_ERROR,
    code && typeof code === "object" ? code : location,
  );
}
export function createConflictError(message = "File revision conflict", location = {}) {
  return makeDiagnostic(message, ERROR_CODES.DO_MD_CONFLICT, location);
}
/** Native exceptions retain their cause; uncompiled frames are context, not exact source mappings. */
export function fromNativeError(error, options = {}) {
  const location = locationFromStack(error?.stack, options.file ?? options.path ?? null);
  return new DoMdError({
    code: options.code ?? ERROR_CODES.DO_MD_TEMPLATE_ERROR,
    message: error?.message ?? String(error),
    ...location,
    snippet: options.snippet ?? null,
    cause: error,
  });
}
