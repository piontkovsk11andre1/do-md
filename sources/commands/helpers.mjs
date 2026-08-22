import { Reader } from "../Reader.mjs";
import { Template } from "../Template.mjs";
import { Writer } from "../Writer.mjs";
import { ERROR_CODES, fromNativeError, makeUserError } from "../SyntaxError.mjs";

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
  let value = String(text ?? "");
  if (value.startsWith("\uFEFF")) {
    value = value.slice(1);
  }
  value = value.replace(/\r\n|\r/g, "\n");
  if (!value.endsWith("\n")) {
    value += "\n";
  }
  return value;
}

export function runTemplate(fn, doc, ctx, data, options, io, templatePath) {
  try {
    fn(doc, ctx, data, options ?? {}, io);
  } catch (error) {
    if (error?.code && Object.values(ERROR_CODES).includes(error.code)) {
      throw error;
    }
    throw fromNativeError(error, { file: templatePath });
  }
}

export function wrapTemplate(source, path) {
  return Template.wrap(source, path);
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
  const max = maxInputBytesLimit(options);
  const size = utf8ByteLength(raw);
  if (max != null && size > max) {
    throw makeUserError(`input exceeds maxInputBytes (${size} > ${max})`, { file: path });
  }
  return normalizeDocument(raw);
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

export function parseSource(source, fn, { file, templatePath, options, io }) {
  const reader = new Reader(source, { ...(options ?? {}), file });
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
  return reader;
}

export function renderSource(data, fn, { templatePath, options, io }) {
  const writer = new Writer(data, { ...(options ?? {}), file: templatePath });
  runTemplate(fn, writer, data, data, options, io, templatePath);
  return writer;
}
