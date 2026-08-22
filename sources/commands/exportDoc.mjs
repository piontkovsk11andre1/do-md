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

export async function exportDoc({ io, file, template, savePath, cwd, options } = {}) {
  requireIo(io);
  requireArg(file, "file");
  requireArg(template, "template");
  requireArg(savePath, "savePath");

  const filePath = resolvePath(io, cwd, file);
  const templatePath = resolvePath(io, cwd, template);
  const dest = resolvePath(io, cwd, savePath);
  const source = await readText(io, filePath, options);
  const templateSource = await readText(io, templatePath, options);
  const fn = wrapTemplate(templateSource, templatePath);
  const reader = parseSource(source, fn, { file: filePath, templatePath, options, io });

  if (reader.errors.length > 0) {
    return failure(2, reader.errors);
  }

  await io.writeFileAsync(dest, `${JSON.stringify(reader.context, null, 2)}\n`);
  return success({ context: reader.context });
}
