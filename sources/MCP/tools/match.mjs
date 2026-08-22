import { match } from "../../commands/match.mjs";
import { resolveScopedPath } from "../Scoping.mjs";
import { commandOptions, cwdOf, ioOf, resolveToolPath, resolveToolPattern } from "./helpers.mjs";

export async function handleMatch(params = {}, context = {}) {
  const file = await resolveToolPath(context, params.file, "file");
  const templates = await resolveToolPattern(context, params.templates, "templates");
  const io = ioOf(context);
  let scopedIo = io;
  if (!context.io) {
    scopedIo = Object.create(io);
    scopedIo.globAsync = async (pattern, options) => {
      const candidates = await io.globAsync(pattern, options);
      const scoped = [];
      for (const candidate of candidates) {
        try {
          scoped.push(await resolveScopedPath(context.root, candidate));
        } catch {
          // Symlinks and other matches outside --root are not candidates.
        }
      }
      return scoped;
    };
  }
  const result = await match({
    io: scopedIo,
    file,
    templates,
    all: params.all === true,
    cwd: cwdOf(context),
    options: commandOptions(params, context),
  });
  return {
    ok: result.ok === true,
    matches: result.context?.matches ?? [],
    errors: result.errors ?? [],
  };
}
