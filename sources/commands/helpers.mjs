import { Reader } from "../Reader.mjs";
import { SourceText } from "../SourceText.mjs";
import { Template } from "../Template.mjs";
export { runTemplate } from "../Template.mjs";
import { runTemplate } from "../Template.mjs";
import { Writer } from "../Writer.mjs";
import { ERROR_CODES, makeUserError, isDiagnosticError } from "../DoMdError.mjs";

/** @typedef {import('../types.d.mts').IOAdapter} IOAdapter */
/** @typedef {import('../types.d.mts').CommandOptions} CommandOptions */
/** @typedef {import('../types.d.mts').Diagnostic} Diagnostic */
/** @typedef {import('../DoMdError.mjs').DoMdError} DoMdError */
/** @typedef {import('../types.d.mts').AtomicWriteOptions} AtomicWriteOptions */

/** @param {IOAdapter | undefined} io @returns {asserts io is IOAdapter} */
export function requireIo(io) {
  if (
    io == null ||
    typeof io.readFileAsync !== "function" ||
    typeof io.resolvePath !== "function"
  ) {
    throw makeUserError("missing io");
  }
}

/** @param {unknown} value @param {string} name @returns {asserts value is string} */
export function requireArg(value, name) {
  if (typeof value !== "string" || value === "") {
    throw makeUserError(`missing ${name}`);
  }
}

/** @param {IOAdapter} io @param {string | null | undefined} cwd @param {string} path */
export function resolvePath(io, cwd, path) {
  // Defaults belong to the adapter: disk uses its working directory, Virtual
  // uses virtual paths and Fetch can leave relative URLs to the browser.
  return io.resolvePath(cwd, path);
}

/** @param {Diagnostic | DoMdError | readonly (Diagnostic | DoMdError)[] | null | undefined} errors @returns {Diagnostic[]} */
export function diagnosticsFrom(errors) {
  const list = Array.isArray(errors) ? errors : errors == null ? [] : [errors];
  return list.map((err) => (isDiagnosticError(err) ? err.toDiagnostic() : err));
}

/** @template T @param {{output?: string | null, context?: T | null}} [data] @returns {import('../types.d.mts').CommandSuccess<T>} */
export function success({ output = null, context = null } = {}) {
  return { ok: true, exitCode: 0, output, context, errors: [] };
}

/** @template T @param {number} exitCode @param {Diagnostic | DoMdError | readonly (Diagnostic | DoMdError)[]} errors
 * @param {{output?: string | null, context?: T | null}} [extra] @returns {import('../types.d.mts').CommandFailure<T>} */
export function failure(exitCode, errors, extra = {}) {
  return {
    ok: false,
    exitCode,
    output: extra.output ?? null,
    context: extra.context ?? null,
    errors: diagnosticsFrom(errors),
  };
}

/** @param {unknown} text */
export function ensureTrailingNewline(text) {
  const value = String(text ?? "");
  return value.endsWith("\n") ? value : `${value}\n`;
}

/** @param {unknown} text */
export function normalizeDocument(text) {
  return String(text ?? "");
}

/** @template {Record<string, unknown>} [T=Record<string, unknown>]
 * @param {unknown} source @param {string} path @returns {import('../types.d.mts').TemplateFunction<T>} */
export function wrapTemplate(source, path) {
  return Template.wrap(String(source ?? ""), path);
}

/** @param {CommandOptions | undefined} options */
function maxInputBytesLimit(options) {
  const limit = options?.maxInputBytes;
  if (limit == null || limit === false) {
    return null;
  }
  const max = Number(limit);
  return Number.isFinite(max) && max >= 0 ? max : null;
}

/** @param {unknown} text */
export function utf8ByteLength(text) {
  return new TextEncoder().encode(String(text ?? "")).length;
}

/** @param {IOAdapter} io @param {string} path @param {CommandOptions} [options] */
export async function readText(io, path, options) {
  const raw = await io.readFileAsync(path);
  return checkedText(raw, path, options);
}

/** @param {IOAdapter} io @param {string} path @param {CommandOptions} [options] */
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

/** @param {string | Uint8Array} raw @param {string} path @param {CommandOptions | undefined} options */
function checkedText(raw, path, options) {
  const bytes = ArrayBuffer.isView(raw)
    ? new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength)
    : null;
  // ignoreBOM preserves the leading U+FEFF instead of silently consuming it.
  const text = bytes
    ? new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes)
    : String(raw ?? "");
  const max = maxInputBytesLimit(options);
  const size = bytes ? bytes.byteLength : utf8ByteLength(text);
  if (max != null && size > max) {
    throw makeUserError(`input exceeds maxInputBytes (${size} > ${max})`, { file: path });
  }
  return normalizeDocument(text);
}

/** @param {IOAdapter} io @param {string} path @param {string} content @param {AtomicWriteOptions} [options] */
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

/** @param {IOAdapter} io @param {string} path */
export async function fileExists(io, path) {
  try {
    await io.statAsync(path);
    return true;
  } catch (error) {
    if (isDiagnosticError(error) && error.code === ERROR_CODES.DO_MD_IO_ERROR) {
      return false;
    }
    throw error;
  }
}

/** @template {Record<string, unknown>} [T=Record<string, unknown>]
 * @param {unknown} source @param {import('../types.d.mts').TemplateFunction<T>} fn
 * @param {{ file: string, templatePath: string, options?: CommandOptions, io: IOAdapter, diagnosticSource?: unknown, diagnosticOffset?: number }} settings
 * @returns {Reader<T>} */
export function parseSource(
  source,
  fn,
  { file, templatePath, options, io, diagnosticSource = source, diagnosticOffset = 0 },
) {
  const text = String(source ?? "");
  const bomOffset = text.startsWith("\uFEFF") ? 1 : 0;
  const reader = /** @type {Reader<T>} */ (
    new Reader(bomOffset ? text.slice(bomOffset) : text, { ...(options ?? {}), file })
  );
  reader.diagnosticSource =
    !bomOffset && diagnosticSource === text
      ? reader.sourceText
      : new SourceText(String(diagnosticSource ?? ""), file);
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
    if (!isDiagnosticError(error) || error.code !== ERROR_CODES.DO_MD_PARSE_ERROR) {
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

/** @template {Record<string, unknown>} T
 * @param {T} data @param {import('../types.d.mts').TemplateFunction<T>} fn
 * @param {{templatePath: string, options?: CommandOptions, io: IOAdapter}} settings */
export function renderSource(data, fn, { templatePath, options, io }) {
  const writer = new Writer(data, { ...(options ?? {}), file: templatePath });
  runTemplate(fn, writer, data, data, options, io, templatePath);
  return writer;
}
