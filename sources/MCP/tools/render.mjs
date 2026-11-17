import { render } from "../../commands/render.mjs";
import { commandIo, commandOptions, cwdOf, ioOf, resolveToolPath } from "./helpers.mjs";

export async function handleRender(params = {}, context = {}) {
  const io = ioOf(context);
  const file = await resolveToolPath(context, params.file, "file");
  const parseTemplate = await resolveToolPath(context, params.parseTemplate, "parseTemplate");
  const renderTemplate = await resolveToolPath(context, params.renderTemplate, "renderTemplate");
  const outFile = await resolveToolPath(context, params.outFile, "outFile");
  const dryRun = params.dryRun === true;
  const result = await render({
    io: dryRun ? commandIo(io, { suppressWrites: true }) : io,
    file,
    parseTemplate,
    renderTemplate,
    outFile,
    cwd: cwdOf(context),
    options: commandOptions(params, context),
  });
  return {
    ok: result.ok === true,
    output: result.output ?? null,
    wrote: result.ok === true && !dryRun ? params.outFile : null,
    errors: result.errors ?? [],
  };
}
