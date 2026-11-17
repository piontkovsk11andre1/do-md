import ErrorStackParser from "error-stack-parser";

const INTERNAL_FRAME = /(?:^|[\\/])sources[\\/]|^node:|^native$|^<anonymous>$/i;
let functionWrapperLines;

/** Isolate V8, SpiderMonkey and JavaScriptCore stack syntax behind the parser. */
function frames(stack) {
  if (!stack) {
    return [];
  }
  try {
    return ErrorStackParser.parse({ stack });
  } catch {
    return [];
  }
}

/** V8 permits deeper capture; other engines keep their native stack behavior. */
export function captureDiagnosticStack(error, constructor) {
  if (typeof Error.captureStackTrace !== "function") {
    return;
  }
  const limit = Error.stackTraceLimit;
  try {
    Error.stackTraceLimit = Math.max(limit ?? 10, 100);
    Error.captureStackTrace(error, constructor);
    void error.stack;
  } finally {
    Error.stackTraceLimit = limit;
  }
}

/** Calibrate Function wrapper lines once per engine, without user-agent sniffing.
 * A failed probe (including CSP) leaves the position unknown instead of guessing.
 */
function wrapperLines() {
  if (functionWrapperLines !== undefined) {
    return functionWrapperLines;
  }
  functionWrapperLines = null;
  const source = "generated:do-md/stack-probe";
  try {
    new Function(
      "doc",
      "ctx",
      "data",
      "options",
      "io",
      `throw new Error('do-md stack probe');\n//# sourceURL=${source}`,
    )();
  } catch (error) {
    const frame = frames(error.stack).find((entry) => entry.fileName === source);
    if (frame?.lineNumber >= 1) {
      functionWrapperLines = frame.lineNumber - 1;
    }
  }
  return functionWrapperLines;
}

/** Resolve the exact generated identity, never a similarly named user file. */
export function generatedOffset(stack, source) {
  const frame = frames(stack).find((entry) => entry.fileName === source.source);
  if (!frame) {
    return null;
  }
  const prefix = wrapperLines();
  return prefix == null ? null : source.offsetAt(frame.lineNumber - prefix, frame.columnNumber);
}

/** Best-effort context for native errors outside a compiled template. */
export function locationFromStack(stack, preferredFile = null) {
  const entries = frames(stack);
  const normalize = (file) => String(file).replace(/\\/g, "/");
  const preferred = entries.find(
    (frame) =>
      preferredFile &&
      (normalize(frame.fileName) === normalize(preferredFile) ||
        normalize(frame.fileName).endsWith(`/${normalize(preferredFile)}`)),
  );
  const frame =
    preferred ?? entries.find((entry) => entry.fileName && !INTERNAL_FRAME.test(entry.fileName));
  return {
    file: preferred ? preferredFile : (frame?.fileName ?? preferredFile),
    line: frame?.lineNumber ?? 1,
    column: frame?.columnNumber ?? 1,
  };
}
