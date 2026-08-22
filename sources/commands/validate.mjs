import {
  failure,
  parseSource,
  readText,
  requireArg,
  requireIo,
  resolvePath,
  success,
  wrapTemplate,
} from "./helpers.mjs";

export async function validate({ io, file, template, cwd, options } = {}) {
  requireIo(io);
  requireArg(file, "file");
  requireArg(template, "template");

  const filePath = resolvePath(io, cwd, file);
  const templatePath = resolvePath(io, cwd, template);
  const source = await readText(io, filePath, options);
  const templateSource = await readText(io, templatePath, options);
  const fn = wrapTemplate(templateSource, templatePath);
  const reader = parseSource(source, fn, { file: filePath, templatePath, options, io });
  const errors = reader.errors;

  if (errors.length === 0) {
    return success();
  }
  return failure(2, errors);
}
