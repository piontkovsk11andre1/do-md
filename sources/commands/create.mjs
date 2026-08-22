import { makeUserError } from "../SyntaxError.mjs";
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
  wrapTemplate,
} from "./helpers.mjs";

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
  const writer = renderSource(data, fn, { templatePath, options, io });
  const output = writer.toMarkdown();
  await io.writeFileAsync(filePath, ensureTrailingNewline(output));
  return success({ output });
}
