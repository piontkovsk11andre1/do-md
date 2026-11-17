import ErrorStackParser from "error-stack-parser";

const INTERNAL_FRAME = /(?:^|[\\/])sources[\\/]|^node:|^native$|^<anonymous>$/i;
const FUNCTION_WRAPPER_LINES = 2;

/** Isolate V8/Node stack conventions. Unsupported or disabled stacks have no frames. */
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

/** Resolve the exact generated identity, never a similarly named user file. */
export function generatedOffset(stack, source) {
  const frame = frames(stack).find((entry) => entry.fileName === source.source);
  if (!frame) {
    return null;
  }
  return source.offsetAt(frame.lineNumber - FUNCTION_WRAPPER_LINES, frame.columnNumber);
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
