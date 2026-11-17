import {
  failure,
  parseSource,
  readText,
  requireArg,
  requireIo,
  resolvePath,
  success,
  writeText,
  wrapTemplate,
} from "./helpers.mjs";

/** @template {Record<string, unknown>} [T=Record<string, unknown>] @overload @param {import('../types.d.mts').ExportOptions} input @returns {Promise<import('../types.d.mts').CommandResult<T>>} */
/** @template {Record<string, unknown>} T @param {Partial<import('../types.d.mts').ExportOptions>} [input] */
export async function exportDoc({ io, file, template, savePath, cwd, options } = {}) {
  requireIo(io);
  requireArg(file, "file");
  requireArg(template, "template");
  if (savePath != null) {
    requireArg(savePath, "savePath");
  }

  const filePath = resolvePath(io, cwd, file);
  const templatePath = resolvePath(io, cwd, template);
  const dest = savePath == null ? null : resolvePath(io, cwd, savePath);
  const source = await readText(io, filePath, options);
  const templateSource = await readText(io, templatePath, options);
  const fn = wrapTemplate(templateSource, templatePath);
  const reader = parseSource(source, fn, { file: filePath, templatePath, options, io });

  if (reader.errors.length > 0) {
    return failure(2, reader.errors);
  }

  // Omitted savePath is a read-only extraction, including for Fetch adapters.
  if (dest != null) {
    await writeText(io, dest, `${JSON.stringify(reader.context, null, 2)}\n`, { force: true });
  }
  return success({ context: /** @type {T} */ (reader.context) });
}
