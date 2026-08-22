import { readFile as readFileRaw, stat as statRaw, writeFile as writeFileRaw } from "node:fs/promises";
import { resolve as resolvePath } from "node:path";

import { createIoError, ERROR_CODES } from "../SyntaxError.mjs";

function wrapIoError(error, fallback, path) {
  if (error?.code === ERROR_CODES.DO_MD_IO_ERROR) {
    return error;
  }
  return createIoError(error?.message ?? fallback, ERROR_CODES.DO_MD_IO_ERROR, { file: path });
}

export class NodeFilesystem {
  async readFileAsync(path, options = "utf8") {
    try {
      return await readFileRaw(path, options);
    } catch (error) {
      throw wrapIoError(error, "read failed", path);
    }
  }

  async writeFileAsync(path, content, options = "utf8") {
    try {
      await writeFileRaw(path, content, options);
    } catch (error) {
      throw wrapIoError(error, "write failed", path);
    }
  }

  async statAsync(path) {
    try {
      const stats = await statRaw(path);
      return {
        isFile: stats.isFile(),
        isDirectory: stats.isDirectory(),
        size: stats.size,
      };
    } catch (error) {
      throw wrapIoError(error, "stat failed", path);
    }
  }

  resolvePath(cwd, path) {
    return resolvePath(cwd ?? process.cwd(), path);
  }
}
