import { create } from "../../commands/create.mjs";
import {
  INLINE_OUTPUT,
  commandIo,
  commandOptions,
  cwdOf,
  hasOwnPath,
  ioOf,
  missingArg,
  resolveToolPath,
} from "./helpers.mjs";

export async function handleCreate(params = {}, context = {}) {
  const io = ioOf(context);
  const template = await resolveToolPath(context, params.template, "template");
  if (params.data == null) {
    missingArg("data");
  }
  const writeFile = hasOwnPath(params.file);
  const file = writeFile
    ? await resolveToolPath(context, params.file, "file")
    : io.resolvePath(cwdOf(context), INLINE_OUTPUT);
  const result = await create({
    io: writeFile ? io : commandIo(io, { suppressWrites: true, hidePaths: [file] }),
    file,
    template,
    data: params.data,
    force: params.force === true,
    cwd: cwdOf(context),
    options: commandOptions(params, context),
  });
  return {
    ok: result.ok === true,
    output: result.output ?? null,
    wrote: result.ok === true && writeFile ? params.file : null,
    errors: result.errors ?? [],
  };
}
