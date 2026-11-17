import { makeParseError, makeUserError } from "../SyntaxError.mjs";
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

export async function query({ io, file, template, all = false, cwd, options } = {}) {
  requireIo(io);
  requireArg(file, "file");
  requireArg(template, "template");

  const filePath = resolvePath(io, cwd, file);
  const templatePath = resolvePath(io, cwd, template);
  const source = await readText(io, filePath, options);
  const templateSource = await readText(io, templatePath, options);
  const fn = wrapTemplate(templateSource, templatePath);
  const matches = [];
  let shift = 0;

  while (shift <= source.length) {
    const reader = parseSource(source.slice(shift), fn, { file: filePath, templatePath, options, io,
      diagnosticSource: source, diagnosticOffset: shift });
    if (reader.errors.length > 0) {
      break;
    }
    if (reader.queryMap.length !== 1) {
      throw makeUserError("query template must define exactly one doc.query region", { file: templatePath });
    }
    const region = reader.queryMap[0];
    const start = shift + region.sourceOffsetStart;
    const end = shift + region.sourceOffsetEnd;
    if (end <= start) {
      throw makeUserError("query region must consume content", { file: templatePath });
    }
    matches.push({ start, end, context: reader.context });
    if (!all) {
      break;
    }
    shift = end;
  }

  const context = { matches };
  if (matches.length === 0) {
    return failure(2, makeParseError("no query match", { file: filePath }), { context });
  }
  const outputValue = all ? matches : matches[0];
  return success({ output: JSON.stringify(outputValue, null, 2), context });
}
