import { parse as parseYaml } from "yaml";

import { makeParseError } from "../DoMdError.mjs";

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

function isWhitespace(ch) {
  return ch === " " || ch === "\t" || ch === "\n" || ch === "\r";
}

function isWordChar(ch) {
  return ch != null && ch !== "" && /[A-Za-z0-9]/.test(ch);
}

function endPosition(source) {
  let line = 1;
  let column = 1;
  for (let i = 0; i < source.length;) {
    const nl = newlineLength(source, i);
    if (nl) {
      i += nl;
      line += 1;
      column = 1;
    } else {
      i += 1;
      column += 1;
    }
  }
  return { offset: source.length, line, column };
}

function splitLines(source) {
  const lines = [];
  let offset = 0;
  let line = 1;
  while (offset < source.length) {
    const startOffset = offset;
    while (offset < source.length && !newlineLength(source, offset)) {
      offset += 1;
    }
    const text = source.slice(startOffset, offset);
    const end = { offset, line, column: 1 + text.length };
    const nl = newlineLength(source, offset);
    const lineEnd = nl
      ? { offset: offset + nl, line: line + 1, column: 1 }
      : { offset, line, column: 1 + text.length };
    lines.push({
      text,
      start: { offset: startOffset, line, column: 1 },
      end,
      lineEnd,
      newline: nl,
    });
    offset += nl;
    if (nl) {
      line += 1;
    }
  }
  return lines;
}

function isBlank(line) {
  return !line || /^[ \t]*$/.test(line.text);
}

function lineIndent(text) {
  let i = 0;
  while (i < text.length && text[i] === " ") {
    i += 1;
  }
  if (i < text.length && text[i] === "\t") {
    return i + 4;
  }
  return i;
}

function makePos(start, end) {
  return {
    start: { offset: start.offset, line: start.line, column: start.column },
    end: { offset: end.offset, line: end.line, column: end.column },
  };
}

function makeNode(type, fields, start, end) {
  return {
    type,
    ...fields,
    position: makePos(start, end),
  };
}

function yamlData(raw, start) {
  let data;
  try {
    data = parseYaml(raw);
  } catch (error) {
    const point = error?.linePos?.[0];
    throw makeParseError(`invalid YAML frontmatter: ${error.message}`, {
      line: point ? start.line + point.line : start.line + 1,
      column: point?.col ?? 1,
    });
  }
  if (data == null && raw.trim() === "") {
    return {};
  }
  if (data == null || typeof data !== "object" || Array.isArray(data)) {
    throw makeParseError("YAML frontmatter must contain an object", {
      line: start.line + 1,
      column: 1,
    });
  }
  return data;
}

export function parseFrontmatter(source = "") {
  const text = String(source);
  const lines = splitLines(text);
  if (!lines.length || !/^\uFEFF?---[ \t]*$/.test(lines[0].text)) {
    return null;
  }
  for (let index = 1; index < lines.length; index++) {
    if (!/^(?:---|\.\.\.)[ \t]*$/.test(lines[index].text)) {
      continue;
    }
    const raw = text.slice(lines[0].lineEnd.offset, lines[index].start.offset);
    const node = makeNode(
      "frontmatter",
      { format: "yaml", raw, content: raw, data: yamlData(raw, lines[0].start) },
      lines[0].start,
      lines[index].end,
    );
    Object.defineProperty(node, "source", {
      value: text.slice(lines[0].start.offset, lines[index].end.offset),
      enumerable: false,
    });
    return node;
  }
  return null;
}

function virtualLine(line, text, prefixLen) {
  return {
    text,
    start: {
      offset: line.start.offset + prefixLen,
      line: line.start.line,
      column: line.start.column + prefixLen,
    },
    end: {
      offset: line.start.offset + prefixLen + text.length,
      line: line.start.line,
      column: line.start.column + prefixLen + text.length,
    },
    lineEnd: line.lineEnd,
    newline: line.newline,
  };
}

function stripIndentLine(line, indent) {
  let i = 0;
  let stripped = 0;
  while (i < line.text.length && stripped < indent) {
    if (line.text[i] === " ") {
      i += 1;
      stripped += 1;
    } else if (line.text[i] === "\t") {
      i += 1;
      stripped += 4;
    } else {
      break;
    }
  }
  return virtualLine(line, line.text.slice(i), i);
}

export function flattenInlines(nodes) {
  if (!nodes) {
    return "";
  }
  let out = "";
  for (const node of nodes) {
    switch (node.type) {
      case "text":
      case "code_span":
      case "html_inline":
        out += node.value ?? "";
        break;
      case "soft_break":
      case "hard_break":
        out += "\n";
        break;
      case "image":
        out += node.alt ?? "";
        break;
      default:
        if (node.children) {
          out += flattenInlines(node.children);
        }
        break;
    }
  }
  return out;
}

export function flattenNode(node) {
  if (!node) {
    return "";
  }
  switch (node.type) {
    case "heading":
    case "paragraph":
      return flattenInlines(node.children);
    case "text":
    case "code_span":
    case "html_inline":
    case "html_block":
    case "code_block":
      return node.value ?? "";
    case "thematic_break":
      return "";
    case "frontmatter":
      return node.raw ?? "";
    case "image":
      return node.alt ?? "";
    case "list":
    case "list_item":
    case "block_quote":
    case "document":
      return (node.children ?? [])
        .map(flattenNode)
        .filter((part, i, arr) => part || i < arr.length - 1)
        .join("\n");
    case "table": {
      const headers = (node.headers ?? []).map((cell) => flattenInlines(cell.children));
      const rows = (node.rows ?? []).map((row) =>
        row.map((cell) => flattenInlines(cell.children)).join(" | "),
      );
      return [...headers, ...rows].join("\n");
    }
    default:
      if (node.children) {
        return flattenInlines(node.children);
      }
      return node.value ?? "";
  }
}

function isAtxHeading(text) {
  return /^( {0,3})(#{1,6})(?:$|[ \t])/.test(text);
}

function isThematicBreak(text) {
  return /^( {0,3})(?:(?:-[ \t]*){3,}|(?:\*[ \t]*){3,}|(?:_[ \t]*){3,})$/.test(text);
}

function isFence(text) {
  return /^( {0,3})(?:`{3,}|~{3,})/.test(text);
}

function isBlockQuote(text) {
  return /^( {0,3})>/.test(text);
}

function isHtmlBlockStart(text) {
  return /^( {0,3})<(?:!--|\?|!\[CDATA\[|![A-Za-z]|\/[A-Za-z][A-Za-z0-9-]*|[A-Za-z][A-Za-z0-9-]*(?:[\s>/]|$))/.test(
    text,
  );
}

function isSetextUnderline(text) {
  return /^( {0,3})(?:=+|-+)[ \t]*$/.test(text);
}

function setextLevel(text) {
  return /^\s*=/.test(text) ? 1 : 2;
}

function isIndentedCodeLine(text) {
  return text.startsWith("    ") || text.startsWith("\t");
}

function matchListMarker(text) {
  const match = text.match(/^( {0,3})([-*+]|\d{1,9}[.)])(?:([ \t]+)|$)/);
  if (!match) {
    return null;
  }
  if (isThematicBreak(text)) {
    return null;
  }
  const indent = match[1].length;
  const marker = match[2];
  const ordered = /\d/.test(marker);
  const contentIndex = match[0].length;
  return {
    indent,
    marker,
    ordered,
    start: ordered ? Number.parseInt(marker, 10) : null,
    contentIndex,
  };
}

function interruptsParagraph(text) {
  if (
    isAtxHeading(text) ||
    isThematicBreak(text) ||
    isFence(text) ||
    isBlockQuote(text) ||
    isHtmlBlockStart(text)
  ) {
    return true;
  }
  if (matchListMarker(text)) {
    return true;
  }
  return false;
}

function markScan(s) {
  return { offset: s.offset, line: s.line, column: s.column };
}

function advanceScan(s) {
  const nl = newlineLength(s.source, s.offset);
  if (nl && s.offset + nl <= s.end) {
    s.offset += nl;
    s.line += 1;
    s.column = 1;
    return;
  }
  s.offset += 1;
  s.column += 1;
}

function advanceScanN(s, n) {
  for (let i = 0; i < n && s.offset < s.end; i++) {
    advanceScan(s);
  }
}

function restoreScan(s, cursor) {
  s.offset = cursor.offset;
  s.line = cursor.line;
  s.column = cursor.column;
}

function peekScan(s, n = 0) {
  const index = s.offset + n;
  if (index >= s.end) {
    return "";
  }
  return s.source[index];
}

function makeInlineNode(type, fields, start, end) {
  return makeNode(type, fields, start, end);
}

function mergeAdjacentText(nodes) {
  const out = [];
  for (const node of nodes) {
    const prev = out[out.length - 1];
    if (node.type === "text" && prev && prev.type === "text") {
      prev.value += node.value;
      prev.position.end = node.position.end;
    } else {
      out.push(node);
    }
  }
  return out;
}

function matchHtmlInline(text) {
  const comment = text.match(/^<!--[\s\S]*?-->/);
  if (comment) {
    return comment[0];
  }
  const pi = text.match(/^<\?[\s\S]*?\?>/);
  if (pi) {
    return pi[0];
  }
  const cdata = text.match(/^<!\[CDATA\[[\s\S]*?\]\]>/);
  if (cdata) {
    return cdata[0];
  }
  const decl = text.match(/^<![A-Za-z][^>]*>/);
  if (decl) {
    return decl[0];
  }
  const tag = text.match(/^<\/?[A-Za-z][A-Za-z0-9-]*(?:\s[^<>]*?)?\/?>/);
  if (tag) {
    return tag[0];
  }
  return null;
}

function tryCodeSpan(s) {
  if (peekScan(s) !== "`") {
    return null;
  }
  const start = markScan(s);
  let opener = 0;
  while (s.offset < s.end && peekScan(s) === "`") {
    advanceScan(s);
    opener += 1;
  }
  let i = s.offset;
  while (i < s.end) {
    if (s.source[i] === "`") {
      let closer = 0;
      while (i + closer < s.end && s.source[i + closer] === "`") {
        closer += 1;
      }
      if (closer === opener) {
        let value = s.source.slice(s.offset, i).replace(/\r\n|\r|\n/g, " ");
        if (
          value.length >= 2 &&
          value.startsWith(" ") &&
          value.endsWith(" ") &&
          value.trim() !== ""
        ) {
          value = value.slice(1, -1);
        }
        while (s.offset < i + closer) {
          advanceScan(s);
        }
        return makeInlineNode("code_span", { value }, start, markScan(s));
      }
      i += closer;
    } else {
      i += 1;
    }
  }
  restoreScan(s, start);
  return null;
}

function tryAutolinkOrHtml(s) {
  if (peekScan(s) !== "<") {
    return null;
  }
  const start = markScan(s);
  const rest = s.source.slice(s.offset, s.end);

  const email = rest.match(
    /^<([a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*)>/,
  );
  if (email) {
    advanceScanN(s, email[0].length);
    const addr = email[1];
    const innerStart = { offset: start.offset + 1, line: start.line, column: start.column + 1 };
    const innerEnd = {
      offset: start.offset + 1 + addr.length,
      line: start.line,
      column: start.column + 1 + addr.length,
    };
    return makeInlineNode(
      "autolink",
      {
        url: `mailto:${addr}`,
        kind: "email",
        children: [makeInlineNode("text", { value: addr }, innerStart, innerEnd)],
      },
      start,
      markScan(s),
    );
  }

  const url = rest.match(/^<([a-zA-Z][a-zA-Z0-9+.-]{1,31}:[^<>\s]*)>/);
  if (url) {
    advanceScanN(s, url[0].length);
    const href = url[1];
    const innerStart = { offset: start.offset + 1, line: start.line, column: start.column + 1 };
    const innerEnd = {
      offset: start.offset + 1 + href.length,
      line: start.line,
      column: start.column + 1 + href.length,
    };
    return makeInlineNode(
      "autolink",
      {
        url: href,
        kind: "url",
        children: [makeInlineNode("text", { value: href }, innerStart, innerEnd)],
      },
      start,
      markScan(s),
    );
  }

  const html = matchHtmlInline(rest);
  if (html) {
    advanceScanN(s, html.length);
    return makeInlineNode("html_inline", { value: html }, start, markScan(s));
  }

  return null;
}

function parseDestination(s) {
  if (peekScan(s) === "<") {
    advanceScan(s);
    let url = "";
    while (
      s.offset < s.end &&
      peekScan(s) !== ">" &&
      peekScan(s) !== "\n" &&
      peekScan(s) !== "\r"
    ) {
      if (peekScan(s) === "\\") {
        advanceScan(s);
      }
      url += peekScan(s);
      advanceScan(s);
    }
    if (peekScan(s) !== ">") {
      return null;
    }
    advanceScan(s);
    return url;
  }
  let url = "";
  let depth = 0;
  while (s.offset < s.end) {
    const ch = peekScan(s);
    if (isWhitespace(ch) || ch === "") {
      break;
    }
    if (ch === "(") {
      depth += 1;
    } else if (ch === ")") {
      if (depth === 0) {
        break;
      }
      depth -= 1;
    } else if (ch === "\\") {
      advanceScan(s);
      if (s.offset < s.end) {
        url += peekScan(s);
        advanceScan(s);
      }
      continue;
    }
    url += ch;
    advanceScan(s);
  }
  return url;
}

function parseTitle(s) {
  const opener = peekScan(s);
  if (opener !== '"' && opener !== "'" && opener !== "(") {
    return null;
  }
  const closer = opener === "(" ? ")" : opener;
  advanceScan(s);
  let title = "";
  while (s.offset < s.end && peekScan(s) !== closer) {
    if (peekScan(s) === "\\") {
      advanceScan(s);
    }
    title += peekScan(s);
    advanceScan(s);
  }
  if (peekScan(s) !== closer) {
    return null;
  }
  advanceScan(s);
  return title;
}

function skipInlineSpaces(s) {
  while (s.offset < s.end && isSpace(peekScan(s))) {
    advanceScan(s);
  }
}

function tryLinkLike(s, image) {
  const start = markScan(s);
  if (image) {
    if (peekScan(s) !== "!" || peekScan(s, 1) !== "[") {
      return null;
    }
    advanceScan(s);
  } else if (peekScan(s) !== "[") {
    return null;
  }
  if (peekScan(s) !== "[") {
    restoreScan(s, start);
    return null;
  }
  advanceScan(s);
  const innerStart = markScan(s);
  let depth = 1;
  while (s.offset < s.end && depth > 0) {
    const ch = peekScan(s);
    if (ch === "\\") {
      advanceScan(s);
      if (s.offset < s.end) {
        advanceScan(s);
      }
      continue;
    }
    if (ch === "[") {
      depth += 1;
    } else if (ch === "]") {
      depth -= 1;
      if (depth === 0) {
        break;
      }
    }
    advanceScan(s);
  }
  if (depth !== 0 || peekScan(s) !== "]") {
    restoreScan(s, start);
    return null;
  }
  const innerEnd = markScan(s);
  advanceScan(s);
  if (peekScan(s) !== "(") {
    restoreScan(s, start);
    return null;
  }
  advanceScan(s);
  skipInlineSpaces(s);
  const url = parseDestination(s);
  if (url == null) {
    restoreScan(s, start);
    return null;
  }
  skipInlineSpaces(s);
  let title = null;
  if (peekScan(s) === '"' || peekScan(s) === "'" || peekScan(s) === "(") {
    title = parseTitle(s);
    if (title == null) {
      restoreScan(s, start);
      return null;
    }
    skipInlineSpaces(s);
  }
  if (peekScan(s) !== ")") {
    restoreScan(s, start);
    return null;
  }
  advanceScan(s);
  const children = parseInlinesAt(
    s.source,
    innerStart.offset,
    innerEnd.offset,
    innerStart.line,
    innerStart.column,
  );
  if (image) {
    return makeInlineNode(
      "image",
      { url, title, alt: flattenInlines(children) },
      start,
      markScan(s),
    );
  }
  return makeInlineNode("link", { url, title, children }, start, markScan(s));
}

function takeDelimiter(s) {
  const ch = peekScan(s);
  if (ch !== "*" && ch !== "_") {
    return null;
  }
  const start = markScan(s);
  let count = 0;
  while (peekScan(s) === ch) {
    advanceScan(s);
    count += 1;
  }
  const prev = start.offset > 0 ? s.source[start.offset - 1] : "";
  const next = peekScan(s);
  let canOpen = next !== "" && !isWhitespace(next);
  let canClose = prev !== "" && !isWhitespace(prev);
  if (ch === "_") {
    if (isWordChar(prev)) {
      canOpen = false;
    }
    if (isWordChar(next)) {
      canClose = false;
    }
  }
  return {
    type: "delim",
    ch,
    count,
    canOpen,
    canClose,
    position: makePos(start, markScan(s)),
  };
}

function shiftPos(pos, delta) {
  return { offset: pos.offset + delta, line: pos.line, column: pos.column + delta };
}

function delimToText(node) {
  return makeInlineNode(
    "text",
    { value: node.ch.repeat(node.count) },
    node.position.start,
    node.position.end,
  );
}

function processEmphasis(nodes) {
  let i = 0;
  while (i < nodes.length) {
    const closer = nodes[i];
    if (closer.type !== "delim" || !closer.canClose) {
      i += 1;
      continue;
    }
    let openerIndex = -1;
    for (let j = i - 1; j >= 0; j--) {
      const opener = nodes[j];
      if (opener.type === "delim" && opener.ch === closer.ch && opener.canOpen) {
        openerIndex = j;
        break;
      }
    }
    if (openerIndex < 0) {
      i += 1;
      continue;
    }
    const opener = nodes[openerIndex];
    const used = opener.count >= 2 && closer.count >= 2 ? 2 : 1;
    const inner = nodes
      .slice(openerIndex + 1, i)
      .map((node) => (node.type === "delim" ? delimToText(node) : node));
    const wrapStart = shiftPos(opener.position.end, -used);
    const wrapEnd = shiftPos(closer.position.start, used);
    const wrapped = makeInlineNode(
      used === 2 ? "strong" : "emphasis",
      { children: mergeAdjacentText(inner) },
      wrapStart,
      wrapEnd,
    );
    opener.count -= used;
    closer.count -= used;
    const replacement = [];
    if (opener.count > 0) {
      opener.position.end = shiftPos(opener.position.end, -used);
      replacement.push(opener);
    }
    replacement.push(wrapped);
    if (closer.count > 0) {
      closer.position.start = shiftPos(closer.position.start, used);
      replacement.push(closer);
    }
    nodes.splice(openerIndex, i - openerIndex + 1, ...replacement);
    i = openerIndex;
  }
  return mergeAdjacentText(nodes.map((node) => (node.type === "delim" ? delimToText(node) : node)));
}

function isSpecialStart(s) {
  const ch = peekScan(s);
  if (
    ch === "`" ||
    ch === "[" ||
    ch === "<" ||
    ch === "*" ||
    ch === "_" ||
    ch === "\n" ||
    ch === "\r"
  ) {
    return true;
  }
  if (ch === "!" && peekScan(s, 1) === "[") {
    return true;
  }
  if (ch === "\\" && (peekScan(s, 1) === "\n" || peekScan(s, 1) === "\r")) {
    return true;
  }
  if (ch === " ") {
    let k = s.offset;
    while (k < s.end && s.source[k] === " ") {
      k += 1;
    }
    if (k - s.offset >= 2 && (s.source[k] === "\n" || s.source[k] === "\r")) {
      return true;
    }
  }
  return false;
}

function tryBreak(s) {
  if (peekScan(s) === "\\" && (peekScan(s, 1) === "\n" || peekScan(s, 1) === "\r")) {
    const start = markScan(s);
    advanceScan(s);
    advanceScan(s);
    return makeInlineNode("hard_break", {}, start, markScan(s));
  }
  if (peekScan(s) === " ") {
    let k = s.offset;
    while (k < s.end && s.source[k] === " ") {
      k += 1;
    }
    if (k - s.offset >= 2 && (s.source[k] === "\n" || s.source[k] === "\r")) {
      const start = markScan(s);
      while (s.offset < k) {
        advanceScan(s);
      }
      advanceScan(s);
      return makeInlineNode("hard_break", {}, start, markScan(s));
    }
  }
  if (peekScan(s) === "\n" || peekScan(s) === "\r") {
    const start = markScan(s);
    advanceScan(s);
    return makeInlineNode("soft_break", {}, start, markScan(s));
  }
  return null;
}

function consumeText(s) {
  const start = markScan(s);
  let value = "";
  while (s.offset < s.end && !isSpecialStart(s)) {
    value += peekScan(s);
    advanceScan(s);
  }
  if (!value) {
    return null;
  }
  return makeInlineNode("text", { value }, start, markScan(s));
}

function parseInlinesAt(source, start, end, line, column) {
  const s = { source, offset: start, end, line, column };
  const nodes = [];
  while (s.offset < s.end) {
    const node =
      tryCodeSpan(s) ||
      tryAutolinkOrHtml(s) ||
      tryLinkLike(s, true) ||
      tryLinkLike(s, false) ||
      takeDelimiter(s) ||
      tryBreak(s) ||
      consumeText(s);
    if (node) {
      nodes.push(node);
      continue;
    }
    const fallbackStart = markScan(s);
    const ch = peekScan(s);
    if (!ch) {
      break;
    }
    advanceScan(s);
    nodes.push(makeInlineNode("text", { value: ch }, fallbackStart, markScan(s)));
  }
  return processEmphasis(nodes);
}

function parseLineInlines(source, line) {
  return parseInlinesAt(
    source,
    line.start.offset,
    line.end.offset,
    line.start.line,
    line.start.column,
  );
}

function parseParagraphInlines(source, lines) {
  const nodes = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let text = line.text;
    let breakType = i < lines.length - 1 ? "soft_break" : null;
    let contentEnd = line.end;
    if (i < lines.length - 1) {
      if (text.endsWith("\\")) {
        text = text.slice(0, -1);
        breakType = "hard_break";
        contentEnd = {
          offset: line.end.offset - 1,
          line: line.end.line,
          column: line.end.column - 1,
        };
      } else {
        const spaces = text.match(/ {2,}$/);
        if (spaces) {
          text = text.slice(0, -spaces[0].length);
          breakType = "hard_break";
          contentEnd = {
            offset: line.end.offset - spaces[0].length,
            line: line.end.line,
            column: line.end.column - spaces[0].length,
          };
        }
      }
    }
    const parsed = parseInlinesAt(
      source,
      line.start.offset,
      line.start.offset + text.length,
      line.start.line,
      line.start.column,
    );
    nodes.push(...parsed);
    if (breakType) {
      const breakStart = contentEnd;
      const breakEnd = line.lineEnd;
      nodes.push(makeInlineNode(breakType, {}, breakStart, breakEnd));
    }
  }
  return mergeAdjacentText(nodes);
}

function makeParagraph(source, lines) {
  return makeNode(
    "paragraph",
    { children: parseParagraphInlines(source, lines) },
    lines[0].start,
    lines[lines.length - 1].end,
  );
}

function makeHeading(source, line, level, start, end) {
  return makeNode("heading", { level, children: parseLineInlines(source, line) }, start, end);
}

function parseAtxHeading(source, line) {
  const match = line.text.match(/^( {0,3})(#{1,6})(?:[ \t]+(.*))?$/);
  if (!match) {
    return null;
  }
  if (
    match[3] == null &&
    !/^( {0,3})(#{1,6})[ \t]*$/.test(line.text) &&
    !/^( {0,3})(#{1,6})[ \t]/.test(line.text)
  ) {
    return null;
  }
  const content = (match[3] ?? "").replace(/[ \t]+#*[ \t]*$/, "");
  const prefix = match[1].length + match[2].length;
  const afterHashes = line.text.slice(prefix);
  const spaceMatch = afterHashes.match(/^[ \t]*/);
  const contentOffset = prefix + (spaceMatch ? spaceMatch[0].length : 0);
  const contentLine = virtualLine(line, content, contentOffset);
  return makeHeading(source, contentLine, match[2].length, line.start, line.end);
}

function parseFencedCode(lines, start, end) {
  const match = lines[start].text.match(/^( {0,3})(`{3,}|~{3,})(.*)$/);
  if (!match) {
    return null;
  }
  const indent = match[1].length;
  const fence = match[2];
  const fenceChar = fence[0];
  const info = match[3].trim();
  if (fenceChar === "`" && info.includes("`")) {
    return null;
  }
  const splitAt = info.search(/\s/);
  const language = splitAt === -1 ? info || null : info.slice(0, splitAt);
  const meta = splitAt === -1 ? "" : info.slice(splitAt).replace(/^\s+/, "");
  const valueLines = [];
  let i = start + 1;
  for (; i < end; i++) {
    const close = lines[i].text.match(/^( {0,3})(`{3,}|~{3,})[ \t]*$/);
    if (close && close[2][0] === fenceChar && close[2].length >= fence.length) {
      i += 1;
      break;
    }
    const text = lines[i].text;
    let stripped = 0;
    while (stripped < indent && text[stripped] === " ") {
      stripped += 1;
    }
    valueLines.push(text.slice(stripped));
  }
  return {
    node: makeNode(
      "code_block",
      { language, meta, value: valueLines.join("\n"), fenced: true },
      lines[start].start,
      lines[Math.max(start, i - 1)].end,
    ),
    nextIndex: i,
  };
}

function parseIndentedCode(lines, start, end) {
  if (!isIndentedCodeLine(lines[start].text)) {
    return null;
  }
  const valueLines = [];
  let i = start;
  let lastNonBlank = start;
  while (i < end) {
    if (isIndentedCodeLine(lines[i].text)) {
      valueLines.push(stripIndentLine(lines[i], 4).text);
      lastNonBlank = i;
      i += 1;
    } else if (isBlank(lines[i])) {
      valueLines.push("");
      i += 1;
    } else {
      break;
    }
  }
  while (valueLines.length && valueLines[valueLines.length - 1] === "") {
    valueLines.pop();
  }
  return {
    node: makeNode(
      "code_block",
      { language: null, meta: "", value: valueLines.join("\n"), fenced: false },
      lines[start].start,
      lines[lastNonBlank].end,
    ),
    nextIndex: lastNonBlank + 1,
  };
}

function parseHtmlBlock(lines, start, end) {
  if (!isHtmlBlockStart(lines[start].text)) {
    return null;
  }
  const valueLines = [lines[start].text];
  let i = start + 1;
  while (i < end && !isBlank(lines[i])) {
    valueLines.push(lines[i].text);
    i += 1;
  }
  return {
    node: makeNode(
      "html_block",
      { value: valueLines.join("\n") },
      lines[start].start,
      lines[i - 1].end,
    ),
    nextIndex: i,
  };
}

function splitTableRow(text) {
  let value = text.trim();
  if (!value.includes("|")) {
    return null;
  }
  if (value.startsWith("|")) {
    value = value.slice(1);
  }
  if (value.endsWith("|") && !/(^|[^\\])\\\|$/.test(value)) {
    value = value.slice(0, -1);
  }
  const cells = [];
  let current = "";
  for (let i = 0; i < value.length; i++) {
    if (value[i] === "\\" && value[i + 1] === "|") {
      current += "|";
      i += 1;
    } else if (value[i] === "|") {
      cells.push(current.trim());
      current = "";
    } else {
      current += value[i];
    }
  }
  cells.push(current.trim());
  return cells;
}

function parseDelimiterRow(text) {
  const cells = splitTableRow(text);
  if (!cells || !cells.length) {
    return null;
  }
  const align = [];
  for (const cell of cells) {
    if (!/^:?-+:?$/.test(cell)) {
      return null;
    }
    const left = cell.startsWith(":");
    const right = cell.endsWith(":");
    if (left && right) {
      align.push("center");
    } else if (right) {
      align.push("right");
    } else if (left) {
      align.push("left");
    } else {
      align.push(null);
    }
  }
  return align;
}

function makeTableCell(source, line, text) {
  const index = line.text.indexOf(text);
  const prefix = index >= 0 ? index : Math.max(0, line.text.length - text.length);
  const cellLine = virtualLine(line, text, prefix);
  return { children: parseLineInlines(source, cellLine) };
}

function parseTable(source, lines, start, end) {
  if (start + 1 >= end) {
    return null;
  }
  const headerCells = splitTableRow(lines[start].text);
  if (!headerCells) {
    return null;
  }
  const align = parseDelimiterRow(lines[start + 1].text);
  if (!align) {
    return null;
  }
  let extraCells = headerCells.length > align.length || align.length > headerCells.length;
  while (align.length < headerCells.length) {
    align.push(null);
  }
  if (align.length > headerCells.length) {
    extraCells = true;
    align.length = headerCells.length;
  }
  if (headerCells.length === 0) {
    return null;
  }
  const headers = headerCells.map((text) => makeTableCell(source, lines[start], text));
  const rows = [];
  let i = start + 2;
  while (i < end && !isBlank(lines[i]) && splitTableRow(lines[i].text)) {
    if (interruptsParagraph(lines[i].text) && !lines[i].text.includes("|")) {
      break;
    }
    const cells = splitTableRow(lines[i].text);
    if (!cells) {
      break;
    }
    if (cells.length > headers.length) {
      extraCells = true;
    }
    while (cells.length < headers.length) {
      cells.push("");
    }
    cells.length = headers.length;
    rows.push(cells.map((text) => makeTableCell(source, lines[i], text)));
    i += 1;
  }
  const node = makeNode("table", { align, headers, rows }, lines[start].start, lines[i - 1].end);
  Object.defineProperty(node, "extraCells", { value: extraCells, enumerable: false });
  return { node, nextIndex: i };
}

function parseBlockQuote(source, lines, start, end) {
  if (!isBlockQuote(lines[start].text)) {
    return null;
  }
  const quoteLines = [];
  let i = start;
  while (i < end) {
    if (isBlank(lines[i])) {
      let j = i + 1;
      while (j < end && isBlank(lines[j])) {
        j += 1;
      }
      if (j < end && isBlockQuote(lines[j].text)) {
        quoteLines.push(virtualLine(lines[i], "", 0));
        i += 1;
        continue;
      }
      break;
    }
    if (isBlockQuote(lines[i].text)) {
      const match = lines[i].text.match(/^( {0,3}>) ?/);
      const prefix = match ? match[0].length : 0;
      quoteLines.push(virtualLine(lines[i], lines[i].text.slice(prefix), prefix));
      i += 1;
      continue;
    }
    if (quoteLines.length && !interruptsParagraph(lines[i].text)) {
      quoteLines.push(virtualLine(lines[i], lines[i].text, 0));
      i += 1;
      continue;
    }
    break;
  }
  const children = parseBlockSequence(source, quoteLines, 0, quoteLines.length);
  return {
    node: makeNode("block_quote", { children }, lines[start].start, lines[i - 1].end),
    nextIndex: i,
  };
}

function parseList(source, lines, start, end) {
  const first = matchListMarker(lines[start].text);
  if (!first) {
    return null;
  }
  const items = [];
  let i = start;
  let tight = true;
  while (i < end) {
    const marker = matchListMarker(lines[i].text);
    if (!marker || marker.ordered !== first.ordered) {
      break;
    }
    const itemStart = lines[i].start;
    const contentIndent = marker.contentIndex;
    let firstText = lines[i].text.slice(contentIndent);
    let checked = null;
    let checkboxLen = 0;
    let checkboxPosition;
    const checkbox = firstText.match(/^\[([ xX])\](?:[ \t]+|(?=$))/);
    if (checkbox) {
      checked = checkbox[1] !== " ";
      checkboxLen = checkbox[0].length;
      const checkboxStart = {
        offset: lines[i].start.offset + contentIndent,
        line: lines[i].start.line,
        column: lines[i].start.column + contentIndent,
      };
      checkboxPosition = makePos(checkboxStart, {
        offset: checkboxStart.offset + 3,
        line: checkboxStart.line,
        column: checkboxStart.column + 3,
      });
      firstText = firstText.slice(checkboxLen);
    }
    const itemLines = [virtualLine(lines[i], firstText, contentIndent + checkboxLen)];
    i += 1;
    while (i < end) {
      if (isBlank(lines[i])) {
        let j = i + 1;
        while (j < end && isBlank(lines[j])) {
          j += 1;
        }
        if (j >= end) {
          break;
        }
        const nextMarker = matchListMarker(lines[j].text);
        const nextIndent = lineIndent(lines[j].text);
        if (
          (nextMarker && nextMarker.ordered === first.ordered && nextIndent < contentIndent) ||
          nextIndent < contentIndent
        ) {
          if (!nextMarker || nextMarker.ordered !== first.ordered || nextIndent < marker.indent) {
            if (!(nextIndent >= contentIndent || (nextMarker && nextIndent >= contentIndent))) {
              break;
            }
          }
        }
        if (
          nextMarker &&
          nextMarker.ordered === first.ordered &&
          lineIndent(lines[j].text) <= marker.indent
        ) {
          tight = false;
          break;
        }
        if (
          nextIndent >= contentIndent ||
          (nextMarker && lineIndent(lines[j].text) > marker.indent)
        ) {
          tight = false;
          itemLines.push(virtualLine(lines[i], "", 0));
          i += 1;
          continue;
        }
        break;
      }
      const nextMarker = matchListMarker(lines[i].text);
      if (
        nextMarker &&
        nextMarker.ordered === first.ordered &&
        lineIndent(lines[i].text) <= marker.indent
      ) {
        break;
      }
      if (lineIndent(lines[i].text) >= contentIndent) {
        itemLines.push(stripIndentLine(lines[i], contentIndent));
        i += 1;
        continue;
      }
      if (!interruptsParagraph(lines[i].text)) {
        itemLines.push(virtualLine(lines[i], lines[i].text, 0));
        i += 1;
        continue;
      }
      break;
    }
    const children = parseBlockSequence(source, itemLines, 0, itemLines.length);
    const item = makeNode("list_item", { checked, children }, itemStart, lines[i - 1].end);
    if (checkboxPosition) {
      item.checkboxPosition = checkboxPosition;
    }
    items.push(item);
    if (i < end && isBlank(lines[i])) {
      let j = i;
      while (j < end && isBlank(lines[j])) {
        j += 1;
      }
      if (j < end) {
        const nextMarker = matchListMarker(lines[j].text);
        if (
          nextMarker &&
          nextMarker.ordered === first.ordered &&
          lineIndent(lines[j].text) <= marker.indent
        ) {
          tight = false;
          i = j;
        }
      }
    }
  }
  return {
    node: makeNode(
      "list",
      {
        ordered: first.ordered,
        start: first.ordered ? first.start : null,
        tight,
        children: items,
      },
      lines[start].start,
      lines[i - 1].end,
    ),
    nextIndex: i,
  };
}

function parseParagraphOrSetext(source, lines, start, end) {
  const paraLines = [lines[start]];
  let i = start + 1;
  while (i < end) {
    if (isBlank(lines[i])) {
      break;
    }
    if (isSetextUnderline(lines[i].text)) {
      if (paraLines.length === 1) {
        return {
          nodes: [
            makeHeading(
              source,
              paraLines[0],
              setextLevel(lines[i].text),
              paraLines[0].start,
              lines[i].end,
            ),
          ],
          nextIndex: i + 1,
        };
      }
      paraLines.pop();
      return {
        nodes: [makeParagraph(source, paraLines)],
        nextIndex: i - 1,
      };
    }
    if (interruptsParagraph(lines[i].text)) {
      break;
    }
    paraLines.push(lines[i]);
    i += 1;
  }
  return { nodes: [makeParagraph(source, paraLines)], nextIndex: i };
}

function parseBlockSequence(source, lines, from, to) {
  const nodes = [];
  let i = from;
  while (i < to) {
    if (isBlank(lines[i])) {
      i += 1;
      continue;
    }
    if (isAtxHeading(lines[i].text)) {
      const heading = parseAtxHeading(source, lines[i]);
      if (heading) {
        nodes.push(heading);
        i += 1;
        continue;
      }
    }
    const fenced = isFence(lines[i].text) ? parseFencedCode(lines, i, to) : null;
    if (fenced) {
      nodes.push(fenced.node);
      i = fenced.nextIndex;
      continue;
    }
    const html = isHtmlBlockStart(lines[i].text) ? parseHtmlBlock(lines, i, to) : null;
    if (html) {
      nodes.push(html.node);
      i = html.nextIndex;
      continue;
    }
    if (isThematicBreak(lines[i].text)) {
      nodes.push(makeNode("thematic_break", {}, lines[i].start, lines[i].end));
      i += 1;
      continue;
    }
    const quote = isBlockQuote(lines[i].text) ? parseBlockQuote(source, lines, i, to) : null;
    if (quote) {
      nodes.push(quote.node);
      i = quote.nextIndex;
      continue;
    }
    const list = matchListMarker(lines[i].text) ? parseList(source, lines, i, to) : null;
    if (list) {
      nodes.push(list.node);
      i = list.nextIndex;
      continue;
    }
    const table = parseTable(source, lines, i, to);
    if (table) {
      nodes.push(table.node);
      i = table.nextIndex;
      continue;
    }
    const indented = isIndentedCodeLine(lines[i].text) ? parseIndentedCode(lines, i, to) : null;
    if (indented) {
      nodes.push(indented.node);
      i = indented.nextIndex;
      continue;
    }
    const para = parseParagraphOrSetext(source, lines, i, to);
    nodes.push(...para.nodes);
    i = para.nextIndex;
  }
  return nodes;
}

export function parseMarkdown(source = "") {
  const text = String(source);
  const lines = splitLines(text);
  const frontmatter = parseFrontmatter(text);
  let from = 0;
  if (frontmatter) {
    while (from < lines.length && lines[from].start.offset <= frontmatter.position.end.offset) {
      from += 1;
    }
  }
  const children = parseBlockSequence(text, lines, from, lines.length);
  if (frontmatter) {
    children.unshift(frontmatter);
  }
  return makeNode("document", { children }, { offset: 0, line: 1, column: 1 }, endPosition(text));
}

function lineIndexAt(lines, offset) {
  let i = 0;
  while (i < lines.length && lines[i].lineEnd.offset <= offset) {
    i += 1;
  }
  return i;
}

function skipBlankLines(lines, index) {
  let i = index;
  while (i < lines.length && isBlank(lines[i])) {
    i += 1;
  }
  return i;
}

function firstListAt(nodes, minOffset = 0) {
  for (const node of nodes) {
    if (node.type === "list" && (node.position?.start?.offset ?? 0) >= minOffset) {
      return node;
    }
  }
  return null;
}

export function parseNextBlock(source, offset = 0) {
  const text = String(source);
  if (offset === 0) {
    const frontmatter = parseFrontmatter(text);
    if (frontmatter) {
      return frontmatter;
    }
  }
  const lines = splitLines(text);
  let i = lineIndexAt(lines, offset);
  if (i < lines.length && lines[i].start.offset < offset) {
    return null;
  }
  i = skipBlankLines(lines, i);
  if (i >= lines.length) {
    return null;
  }
  const nodes = parseBlockSequence(text, lines, i, lines.length);
  return nodes[0] ?? null;
}

export function findNextListBlock(source, offset = 0) {
  // Retain enclosing-block context even when the cursor is at a line boundary
  // inside a fence, frontmatter, or list. Parsing only the suffix loses it.
  return firstListAt(parseMarkdown(source).children, offset);
}

export function collectHeadings(node, out = []) {
  if (!node) {
    return out;
  }
  if (node.type === "heading") {
    out.push(node);
  }
  if (Array.isArray(node.children)) {
    for (const child of node.children) {
      collectHeadings(child, out);
    }
  }
  return out;
}

export function parseInlineLeaf(source, offset, line, column, kind) {
  const text = String(source);
  const s = { source: text, offset, end: text.length, line, column };
  if (kind === "codeSpan") {
    return tryCodeSpan(s);
  }
  if (kind === "autolink") {
    const node = tryAutolinkOrHtml(s);
    return node && node.type === "autolink" ? node : null;
  }
  if (kind === "image") {
    return tryLinkLike(s, true);
  }
  if (kind === "link") {
    return tryLinkLike(s, false);
  }
  return null;
}

export function parseCheckboxAt(source, offset) {
  const rest = String(source).slice(offset);
  const match = rest.match(/^\[([ xX])\]/);
  if (!match) {
    return null;
  }
  return { value: match[1] !== " ", length: 3 };
}
