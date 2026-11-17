import { Reader } from "../Reader.mjs";
import { Template } from "../Template.mjs";
export { runTemplate } from "../Template.mjs";
import { runTemplate } from "../Template.mjs";
import { Writer } from "../Writer.mjs";
import { ERROR_CODES, makeUserError } from "../SyntaxError.mjs";

export function requireIo(io) {
  if (io == null || typeof io.readFileAsync !== "function" || typeof io.resolvePath !== "function") {
    throw makeUserError("missing io");
  }
  return io;
}

export function requireArg(value, name) {
  if (value == null || value === "") {
    throw makeUserError(`missing ${name}`);
  }
  return value;
}

export function resolvePath(io, cwd, path) {
  return io.resolvePath(cwd == null ? process.cwd() : cwd, path);
}

export function diagnosticsFrom(errors) {
  const list = Array.isArray(errors) ? errors : errors == null ? [] : [errors];
  return list.map((err) => (typeof err?.toDiagnostic === "function" ? err.toDiagnostic() : err));
}

export function success({ output = null, context = null } = {}) {
  return { ok: true, exitCode: 0, output, context, errors: [] };
}

export function failure(exitCode, errors, extra = {}) {
  return {
    ok: false,
    exitCode,
    output: extra.output ?? null,
    context: extra.context ?? null,
    errors: diagnosticsFrom(errors),
  };
}

export function ensureTrailingNewline(text) {
  const value = String(text ?? "");
  return value.endsWith("\n") ? value : `${value}\n`;
}

export function normalizeDocument(text) {
  return String(text ?? "");
}

export function wrapTemplate(source, path) {
  return Template.wrap(String(source ?? ""), path);
}

function maxInputBytesLimit(options) {
  const limit = options?.maxInputBytes;
  if (limit == null || limit === false) {
    return null;
  }
  const max = Number(limit);
  return Number.isFinite(max) && max >= 0 ? max : null;
}

export function utf8ByteLength(text) {
  return new TextEncoder().encode(String(text ?? "")).length;
}

export async function readText(io, path, options) {
  const raw = await io.readFileAsync(path);
  return checkedText(raw, path, options);
}

export async function readTextSnapshot(io, path, options) {
  if (typeof io.readFileSnapshotAsync !== "function") {
    return { content: await readText(io, path, options), revision: null };
  }
  const snapshot = await io.readFileSnapshotAsync(path, "utf8");
  return {
    content: checkedText(snapshot.content, path, options),
    revision: snapshot.revision ?? null,
  };
}

function checkedText(raw, path, options) {
  const text = String(raw ?? "");
  const max = maxInputBytesLimit(options);
  const size = utf8ByteLength(text);
  if (max != null && size > max) {
    throw makeUserError(`input exceeds maxInputBytes (${size} > ${max})`, { file: path });
  }
  return normalizeDocument(text);
}

export async function writeText(io, path, content, options = {}) {
  if (typeof io?.writeFileAtomicAsync === "function") {
    return io.writeFileAtomicAsync(path, content, options);
  }
  if (typeof io?.writeFileAsync !== "function") {
    throw makeUserError("missing io");
  }
  if (options.expectedRevision !== undefined || options.ifAbsent) {
    throw makeUserError("io does not support atomic writes");
  }
  await io.writeFileAsync(path, content);
  return { revision: null };
}

export async function fileExists(io, path) {
  try {
    await io.statAsync(path);
    return true;
  } catch (error) {
    if (error?.code === ERROR_CODES.DO_MD_IO_ERROR) {
      return false;
    }
    throw error;
  }
}

export function parseSource(source, fn, { file, templatePath, options, io, diagnosticSource = source, diagnosticOffset = 0 }) {
  const text = String(source ?? "");
  const bomOffset = text.startsWith("\uFEFF") ? 1 : 0;
  const reader = new Reader(bomOffset ? text.slice(bomOffset) : text, { ...(options ?? {}), file });
  reader.diagnosticSourceText = String(diagnosticSource ?? "");
  reader.diagnosticOffsetBase = diagnosticOffset + bomOffset;
  const literal = reader.literal;
  reader.literal = function parseLiteral(value) {
    const expected = String(value ?? "");
    const finalNewline = expected.endsWith("\r\n") ? 2 : /[\r\n]$/.test(expected) ? 1 : 0;
    if (finalNewline && !/[\r\n]$/.test(this.remaining())) {
      const withoutFinalNewline = expected.slice(0, -finalNewline);
      if (withoutFinalNewline === "" && this.remaining() === "") {
        return this;
      }
      if (withoutFinalNewline !== "") {
        const probe = new Reader(this.remaining());
        literal.call(probe, withoutFinalNewline);
        if (probe.errors.length === 0 && probe.remaining() === "") {
          return literal.call(this, withoutFinalNewline);
        }
      }
    }
    return literal.call(this, value);
  };
  try {
    runTemplate(fn, reader, reader.context, null, options, io, templatePath);
  } catch (error) {
    if (error?.code !== ERROR_CODES.DO_MD_PARSE_ERROR) {
      throw error;
    }
    if (!reader.errors.includes(error)) {
      reader.errors.push(error);
    }
  }
  if (reader.errors.length === 0) {
    reader.assertConsumed();
  }
  if (bomOffset) {
    for (const slot of reader.slotMap) {
      slot.sourceOffsetStart += bomOffset;
      slot.sourceOffsetEnd += bomOffset;
    }
    for (const region of reader.regionMap) {
      region.sourceOffsetStart += bomOffset;
      region.sourceOffsetEnd += bomOffset;
      for (const element of region.elements) {
        element.sourceOffsetStart += bomOffset;
        element.sourceOffsetEnd += bomOffset;
      }
    }
    for (const region of reader.queryMap) {
      region.sourceOffsetStart += bomOffset;
      region.sourceOffsetEnd += bomOffset;
    }
  }
  return reader;
}

export function renderSource(data, fn, { templatePath, options, io }) {
  const writer = new Writer(data, { ...(options ?? {}), file: templatePath });
  runTemplate(fn, writer, data, data, options, io, templatePath);
  return writer;
}
