import { Editor } from "../Editor.mjs";
import { ERROR_CODES, makeUserError } from "../DoMdError.mjs";
import { failure, requireArg, requireIo, resolvePath, success } from "./helpers.mjs";

function hasKey(key) {
  return key != null && key !== "";
}

export async function set({ io, file, template, key, value, patch, out, cwd, options } = {}) {
  if (!hasKey(key) && patch == null) {
    return failure(1, makeUserError("set requires a key or patch"));
  }

  requireIo(io);
  if (typeof io.writeFileAsync !== "function") {
    throw makeUserError("missing io");
  }
  requireArg(file, "file");
  requireArg(template, "template");

  const filePath = resolvePath(io, cwd, file);
  const templatePath = resolvePath(io, cwd, template);
  const outPath = out == null || out === "" ? filePath : resolvePath(io, cwd, out);

  let editor;
  try {
    editor = await Editor.open({ io, file: filePath, template: templatePath, options });
  } catch (error) {
    if (error?.code === ERROR_CODES.DO_MD_PARSE_ERROR) {
      return failure(2, error.errors ?? error);
    }
    throw error;
  }

  if (patch != null) {
    editor.merge(patch);
  }
  if (hasKey(key)) {
    editor.set(key, value);
  }

  const output = editor.render();
  await editor.save({ to: outPath });
  return success({ output, context: editor.context });
}
