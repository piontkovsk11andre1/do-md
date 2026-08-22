import {
  link as linkRaw,
  open as openRaw,
  readFile as readFileRaw,
  rename as renameRaw,
  stat as statRaw,
  unlink as unlinkRaw,
  writeFile as writeFileRaw,
} from "node:fs/promises";
import { dirname, resolve as resolvePath } from "node:path";
import { randomUUID } from "node:crypto";
import fastGlob from "fast-glob";

import { createConflictError, createIoError, ERROR_CODES } from "../SyntaxError.mjs";
import { createContentRevision } from "../IO.mjs";

function wrapIoError(error, fallback, path) {
  if (error?.code === ERROR_CODES.DO_MD_IO_ERROR || error?.code === ERROR_CODES.DO_MD_CONFLICT) {
    return error;
  }
  return createIoError(error?.message ?? fallback, ERROR_CODES.DO_MD_IO_ERROR, { file: path });
}

function conflict(path) {
  return createConflictError(`File changed before it could be written: ${path}`, { file: path });
}

async function currentRevision(path) {
  try {
    return createContentRevision(await readFileRaw(path));
  } catch (error) {
    if (error?.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function readSnapshot(path, options) {
  const readOptions =
    options && typeof options === "object" ? { ...options, encoding: null } : null;
  const raw = await readFileRaw(path, readOptions);
  const encoding = typeof options === "string" ? options : options?.encoding;
  return {
    content: encoding ? raw.toString(encoding) : raw,
    revision: createContentRevision(raw),
  };
}

async function syncDirectory(path) {
  let handle;
  try {
    handle = await openRaw(dirname(path), "r");
    await handle.sync();
  } catch {
    // Directory fsync is unavailable on some platforms, notably Windows.
  } finally {
    await handle?.close().catch(() => {});
  }
}

export class NodeFilesystem {
  async globAsync(pattern, { cwd = process.cwd() } = {}) {
    const input = String(pattern ?? "");
    const resolved = resolvePath(cwd, input);
    try {
      const info = await statRaw(resolved);
      if (info.isFile()) {
        return [resolved];
      }
      if (info.isDirectory()) {
        return (await fastGlob("**/*.tpl.md", {
          absolute: true,
          cwd: resolved,
          followSymbolicLinks: false,
          onlyFiles: true,
          unique: true,
        })).map((path) => resolvePath(path)).sort();
      }
    } catch (error) {
      if (error?.code !== "ENOENT") {
        throw wrapIoError(error, "candidate discovery failed", resolved);
      }
    }
    try {
      return (await fastGlob(input.replace(/\\/g, "/"), {
        absolute: true,
        cwd: resolvePath(cwd),
        followSymbolicLinks: false,
        onlyFiles: true,
        unique: true,
      })).map((path) => resolvePath(path)).sort();
    } catch (error) {
      throw wrapIoError(error, "candidate discovery failed", input);
    }
  }

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

  async readFileSnapshotAsync(path, options = "utf8") {
    try {
      return await readSnapshot(path, options);
    } catch (error) {
      throw wrapIoError(error, "read failed", path);
    }
  }

  async writeFileAtomicAsync(path, content, options = {}) {
    const config = options && typeof options === "object" ? options : {};
    const { expectedRevision, ifAbsent = false, force = false, mode, ...writeOptions } = config;
    const temporaryPath = `${path}.do-md-${process.pid}-${randomUUID()}.tmp`;
    const lockPath = `${path}.do-md.lock`;
    let handle;
    let lockHandle;
    let ownsLock = false;

    try {
      handle = await openRaw(temporaryPath, "wx", mode);
      await handle.writeFile(content, writeOptions);
      await handle.sync();
      await handle.close();
      handle = null;

      const revision = createContentRevision(await readFileRaw(temporaryPath));
      if (!force && ifAbsent) {
        try {
          await linkRaw(temporaryPath, path);
        } catch (error) {
          if (error?.code === "EEXIST") {
            throw conflict(path);
          }
          throw error;
        }
        await unlinkRaw(temporaryPath);
      } else {
        if (!force && expectedRevision !== undefined) {
          try {
            lockHandle = await openRaw(lockPath, "wx");
            ownsLock = true;
          } catch (error) {
            if (error?.code === "EEXIST") {
              throw conflict(path);
            }
            throw error;
          }
        }
        if (!force && expectedRevision !== undefined && expectedRevision !== (await currentRevision(path))) {
          throw conflict(path);
        }
        await renameRaw(temporaryPath, path);
      }

      await lockHandle?.close();
      lockHandle = null;
      if (ownsLock) {
        await unlinkRaw(lockPath).catch(() => {});
      }
      await syncDirectory(path);
      return { revision };
    } catch (error) {
      await handle?.close().catch(() => {});
      await lockHandle?.close().catch(() => {});
      await unlinkRaw(temporaryPath).catch(() => {});
      if (ownsLock) {
        await unlinkRaw(lockPath).catch(() => {});
      }
      throw wrapIoError(error, "atomic write failed", path);
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
