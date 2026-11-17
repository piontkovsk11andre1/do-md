import stringWidth from "string-width";
import { primaryLocation, sameLocation } from "./Diagnostics.mjs";

const graphemes = new Intl.Segmenter("en", { granularity: "grapheme" });
const FRAME_WIDTH = 100;
const CONTEXT_BEFORE = 40;
const plainStyle = { dim: (text) => text, cyan: (text) => text, red: (text) => text };

/** Expand terminal tabs and neutralize controls before measuring display cells. */
function displayText(value) {
  let text = "";
  let width = 0;
  for (const { segment } of graphemes.segment(String(value))) {
    const rendered =
      segment === "\t"
        ? " ".repeat(4 - (width % 4))
        : segment.replace(
            /[\x00-\x1f\x7f-\x9f]/g,
            (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`,
          );
    text += rendered;
    width += stringWidth(rendered);
  }
  return text;
}

/** Crop in display cells, retaining whole graphemes and the focus column. */
function cropLine(line, column) {
  const width = stringWidth(line);
  const left = Math.max(0, Math.min(column - CONTEXT_BEFORE, width - FRAME_WIDTH));
  let position = 0;
  let start = null;
  let text = "";
  for (const { segment } of graphemes.segment(line)) {
    const size = stringWidth(segment);
    if (position + size > left && position < left + FRAME_WIDTH) {
      start ??= position;
      text += segment;
    }
    position += size;
  }
  start ??= 0;
  const before = start > 0 ? "…" : "";
  const after = start + stringWidth(text) < width ? "…" : "";
  return {
    text: `${before}${text}${after}`,
    start,
    width: stringWidth(text),
    caret: before.length + column - start,
  };
}

/** A snippet contains one original line; multiline spans retain their endpoint as a label. */
function codeFrame(location, color) {
  if (location.snippet == null) {
    return "";
  }
  const { start, end } = location.range;
  const snippet = String(location.snippet);
  const offset = Math.min(Math.max(start.column - 1, 0), snippet.length);
  const line = displayText(snippet);
  const column = stringWidth(displayText(snippet.slice(0, offset)));
  const continues = end != null && end.line > start.line;
  const endColumn =
    end == null
      ? column + 1
      : continues
        ? stringWidth(line)
        : stringWidth(displayText(snippet.slice(0, Math.max(offset, end.column - 1))));
  const visible = cropLine(line, column);
  const markerWidth = Math.max(
    1,
    Math.min(endColumn - column, visible.width - column + visible.start),
  );
  const context = location.precision === "context";
  const marker = context ? "~" : `^${"~".repeat(markerWidth - 1)}`;
  const note = context
    ? " processing context"
    : continues
      ? ` range ends at ${end.line}:${end.column}`
      : "";
  const gutter = String(start.line);
  return (
    `${color.dim(`${gutter} |`)} ${visible.text}\n` +
    `${color.dim(`${" ".repeat(gutter.length)} |`)} ${" ".repeat(Math.max(0, visible.caret))}${color.red(marker)}${color.dim(note)}`
  );
}

/** Render an existing diagnostic without reading files, changing state or traversing causes. */
export function formatDiagnostic(diagnostic, options = {}) {
  return renderDiagnostic(diagnostic, plainStyle, options);
}

/** Internal presentation seam: Node supplies ANSI styles, the browser uses plain text. */
export function renderDiagnostic(diagnostic, color, { includeGenerated = false } = {}) {
  const primary =
    primaryLocation(diagnostic) ?? (includeGenerated ? diagnostic.locations?.at(-1) : null);
  const message = displayText(diagnostic.message ?? "");
  if (!primary) {
    return message;
  }
  const locations = [
    primary,
    ...[...(diagnostic.locations ?? [])].reverse().filter((location) => location !== primary),
  ];
  const seen = [];
  const blocks = [];
  for (const location of locations) {
    if (
      (!includeGenerated && location.role === "generated") ||
      seen.some((entry) => sameLocation(entry, location))
    ) {
      continue;
    }
    seen.push(location);
    const path = displayText(location.source ?? "<unknown>");
    const point = `${path}:${location.range.start.line}:${location.range.start.column}`;
    const heading =
      blocks.length === 0
        ? `${color.cyan(point)}: ${color.red(message)}`
        : `${color.dim(`${location.role}${location.relation === "processing" ? " (processing)" : ""}:`)} ${color.cyan(point)}`;
    const frame = codeFrame(location, color);
    blocks.push(`${heading}${frame ? `\n\n${frame}` : ""}`);
  }
  return blocks.join("\n\n");
}
