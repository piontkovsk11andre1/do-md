import { validate } from "../../commands/validate.mjs";
import { commandOptions, cwdOf, ioOf, resolveToolPath } from "./helpers.mjs";

export async function handleValidate(params = {}, context = {}) {
  const file = await resolveToolPath(context, params.file, "file");
  const template = await resolveToolPath(context, params.template, "template");
  const result = await validate({
    io: ioOf(context),
    file,
    template,
    cwd: cwdOf(context),
    options: commandOptions(params, context),
  });
  return {
    ok: result.ok === true,
    errors: result.errors ?? [],
  };
}
