import { createContentRevision, resolveIoPath } from "../IO.mjs";
import { createIoError, ERROR_CODES } from "../SyntaxError.mjs";

function isAbsoluteUrl(value) {
  return /^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//.test(value);
}

function wrapIoError(error, fallback, path) {
  if (error?.code === ERROR_CODES.DO_MD_IO_ERROR) {
    return error;
  }
  return createIoError(error?.message ?? fallback, ERROR_CODES.DO_MD_IO_ERROR, { file: path });
}

export class Fetch {
  async readFileAsync(path, options = {}) {
    try {
      const response = await fetch(path, options);
      if (!response.ok) {
        throw createIoError(`HTTP ${response.status}`, ERROR_CODES.DO_MD_IO_ERROR, { file: path });
      }

      return response.text();
    } catch (error) {
      throw wrapIoError(error, "fetch failed", path);
    }
  }

  async writeFileAsync(path) {
    throw createIoError("Fetch IO is read-only", ERROR_CODES.DO_MD_IO_ERROR, { file: path });
  }

  async readFileSnapshotAsync(path, options = {}) {
    const content = await this.readFileAsync(path, options);
    return { content, revision: createContentRevision(content) };
  }

  async writeFileAtomicAsync(path) {
    throw createIoError("Fetch IO is read-only", ERROR_CODES.DO_MD_IO_ERROR, { file: path });
  }

  async statAsync(path) {
    throw createIoError("Fetch IO is read-only", ERROR_CODES.DO_MD_IO_ERROR, { file: path });
  }

  resolvePath(cwd, path) {
    const target = String(path ?? "");
    if (isAbsoluteUrl(target)) {
      return target;
    }

    const base = cwd == null || cwd === "" ? "" : String(cwd);
    if (base === "") {
      return resolveIoPath("", target);
    }

    try {
      const baseUrl = new URL(base);
      const prefix = baseUrl.href.endsWith("/") ? baseUrl.href : `${baseUrl.href}/`;
      return new URL(target, prefix).href;
    } catch {
      return resolveIoPath(base, target);
    }
  }
}
