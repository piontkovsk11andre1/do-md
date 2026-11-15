import { exportDoc } from "../../commands/exportDoc.mjs";
import {
  INLINE_EXPORT,
  commandIo,
  commandOptions,
  cwdOf,
  ioOf,
  resolveToolPath,
} from "./helpers.mjs";

export async function handleExport(params = {}, context = {}) {
  const io = ioOf(context);
  const file = await resolveToolPath(context, params.file, "file");
  const template = await resolveToolPath(context, params.template, "template");
  const savePath = params.savePath
    ? await resolveToolPath(context, params.savePath, "savePath")
    : io.resolvePath(cwdOf(context), INLINE_EXPORT);
  const result = await exportDoc({
    io: params.savePath ? io : commandIo(io, { suppressWrites: true }),
    file,
    template,
    savePath,
    cwd: cwdOf(context),
    options: commandOptions(params, context),
  });
  return {
    ok: result.ok === true,
    context: result.ok === true ? result.context ?? null : null,
    ...(params.savePath ? { wrote: result.ok === true ? params.savePath : null } : {}),
    errors: result.errors ?? [],
  };
}
