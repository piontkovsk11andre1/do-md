import { makeTemplateError } from "./SyntaxError.mjs";

export const TEMPLATE_SOURCE_URL = "//# sourceURL=";

function stripBlockNewlines(content) {
  if (content.startsWith("\r\n")) {
    content = content.slice(2);
  } else if (content.startsWith("\n") || content.startsWith("\r")) {
    content = content.slice(1);
  }
  if (content.endsWith("\r\n")) {
    content = content.slice(0, -2);
  } else if (content.endsWith("\n") || content.endsWith("\r")) {
    content = content.slice(0, -1);
  }
  return content;
}

export function renderBlocks(source) {
  const text = String(source ?? "");
  let body = "";
  let literal = "";
  let index = 0;

  const flushLiteral = () => {
    if (literal.length > 0) {
      body += `doc.literal(${JSON.stringify(literal)});\n`;
    }
    literal = "";
  };

  while (index < text.length) {
    if (text.startsWith("\\{%", index)) {
      literal += "{%";
      index += 3;
      continue;
    }
    if (text.startsWith("\\%}", index)) {
      literal += "%}";
      index += 3;
      continue;
    }
    if (text.startsWith("{%", index)) {
      flushLiteral();
      index += 2;
      const close = text.indexOf("%}", index);
      const content = close < 0 ? text.slice(index) : text.slice(index, close);
      index = close < 0 ? text.length : close + 2;
      body += `${stripBlockNewlines(content)}\n`;
      continue;
    }
    literal += text[index];
    index += 1;
  }

  flushLiteral();
  return body;
}

export class Template {
  constructor(source = "", { file = "template.js" } = {}) {
    this.source = String(source);
    this.file = file;
  }

  static get sourceDirective() {
    return TEMPLATE_SOURCE_URL;
  }

  static renderBlocks(source) {
    return renderBlocks(source);
  }

  static wrap(source, path = "template.js") {
    const body = renderBlocks(source);
    try {
      return new Function("doc", "ctx", "data", "options", "io", `${body}\n${TEMPLATE_SOURCE_URL}${path}`);
    } catch (error) {
      throw makeTemplateError(error?.message ?? String(error), { file: path });
    }
  }

  renderBlocks() {
    return renderBlocks(this.source);
  }

  wrap() {
    return Template.wrap(this.source, this.file);
  }
}
