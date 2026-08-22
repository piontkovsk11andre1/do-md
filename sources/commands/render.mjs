import {
  ensureTrailingNewline,
  failure,
  parseSource,
  readText,
  renderSource,
  requireArg,
  requireIo,
  resolvePath,
  success,
  wrapTemplate,
} from "./helpers.mjs";

export async function render({ io, file, parseTemplate, renderTemplate, outFile, cwd, options } = {}) {
  requireIo(io);
  requireArg(file, "file");
  requireArg(parseTemplate, "parseTemplate");
  requireArg(renderTemplate, "renderTemplate");
  requireArg(outFile, "outFile");

  const filePath = resolvePath(io, cwd, file);
  const parsePath = resolvePath(io, cwd, parseTemplate);
  const renderPath = resolvePath(io, cwd, renderTemplate);
  const dest = resolvePath(io, cwd, outFile);
  const source = await readText(io, filePath, options);
  const parseTemplateSource = await readText(io, parsePath, options);
  const renderTemplateSource = await readText(io, renderPath, options);
  const parseFn = wrapTemplate(parseTemplateSource, parsePath);
  const renderFn = wrapTemplate(renderTemplateSource, renderPath);
  const reader = parseSource(source, parseFn, { file: filePath, templatePath: parsePath, options, io });

  if (reader.errors.length > 0) {
    return failure(2, reader.errors);
  }

  const context = reader.context;
  const writer = renderSource(context, renderFn, { templatePath: renderPath, options, io });
  const output = writer.toString();
  await io.writeFileAsync(dest, ensureTrailingNewline(output));
  return success({ output, context });
}
