import { makeUserError } from "../DoMdError.mjs";
import {
  ensureTrailingNewline,
  failure,
  fileExists,
  readText,
  renderSource,
  requireArg,
  requireIo,
  resolvePath,
  success,
  writeText,
  wrapTemplate,
} from "./helpers.mjs";

/** @template {Record<string, unknown>} [T=Record<string, unknown>] @overload @param {import('../types.d.mts').CreateOptions<T>} input @returns {Promise<import('../types.d.mts').CommandResult>} */
/** @template {Record<string, unknown>} T @param {Partial<import('../types.d.mts').CreateOptions<T>>} [input] */
export async function create({ io, file, template, data, force, cwd, options } = {}) {
  requireIo(io);
  requireArg(file, "file");
  requireArg(template, "template");

  const filePath = resolvePath(io, cwd, file);
  const templatePath = resolvePath(io, cwd, template);

  if (force !== true && (await fileExists(io, filePath))) {
    return failure(1, makeUserError(`file already exists: ${file}`, { file: filePath }));
  }

  const templateSource = await readText(io, templatePath, options);
  const fn = wrapTemplate(templateSource, templatePath);
  const writer = renderSource(data === undefined ? {} : data, fn, { templatePath, options, io });
  const output = writer.toMarkdown();
  await writeText(
    io,
    filePath,
    ensureTrailingNewline(output),
    force === true ? { force: true } : { ifAbsent: true },
  );
  return success({ output });
}
