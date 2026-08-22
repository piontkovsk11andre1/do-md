import { set } from "../../commands/set.mjs";
import {
  commandIo,
  commandOptions,
  cwdOf,
  hasOwnPath,
  ioOf,
  resolveToolPath,
} from "./helpers.mjs";

export async function handleSet(params = {}, context = {}) {
  const io = ioOf(context);
  const file = await resolveToolPath(context, params.file, "file");
  const template = await resolveToolPath(context, params.template, "template");
  const writeOut = hasOwnPath(params.out);
  const out = writeOut ? await resolveToolPath(context, params.out, "out") : undefined;
  const dryRun = params.dryRun === true;
  const result = await set({
    io: dryRun ? commandIo(io, { suppressWrites: true }) : io,
    file,
    template,
    key: params.key,
    value: params.value,
    patch: params.patch,
    out,
    cwd: cwdOf(context),
    options: commandOptions(params, context),
  });
  return {
    ok: result.ok === true,
    output: result.output ?? null,
    wrote: result.ok === true && !dryRun ? (writeOut ? params.out : params.file) : null,
    context: result.ok === true ? result.context ?? null : null,
    errors: result.errors ?? [],
  };
}
