import { query } from "../../commands/query.mjs";
import { commandOptions, cwdOf, ioOf, resolveToolPath } from "./helpers.mjs";

export async function handleQuery(params = {}, context = {}) {
  const file = await resolveToolPath(context, params.file, "file");
  const template = await resolveToolPath(context, params.template, "template");
  const result = await query({
    io: ioOf(context),
    file,
    template,
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
