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

export async function match({ io, file, templates, all = false, cwd, options } = {}) {
  requireIo(io);
  requireArg(file, "file");
  requireArg(templates, "templates");
  if (typeof io.globAsync !== "function") {
    throw makeUserError("io does not support template discovery");
  }

  const base = cwd == null ? process.cwd() : cwd;
  const filePath = resolvePath(io, cwd, file);
  const source = await readText(io, filePath, options);
  const candidates = [...new Set(await io.globAsync(templates, { cwd: base }))].sort();
  const matches = [];

  for (const templatePath of candidates) {
    try {
      const templateSource = await readText(io, templatePath, options);
      const fn = wrapTemplate(templateSource, templatePath);
      const reader = parseSource(source, fn, { file: filePath, templatePath, options, io });
      if (reader.errors.length === 0) {
        matches.push(templatePath);
        if (!all) {
          break;
        }
      }
    } catch {
      // Discovery treats unreadable and malformed candidates as non-matches.
    }
  }

  const context = { matches };
  if (matches.length === 0) {
    return failure(2, makeParseError("no matching template", { file: filePath }), { context });
  }
  return success({ output: matches.join("\n"), context });
}
