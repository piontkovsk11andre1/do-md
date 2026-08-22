import { createIoError, ERROR_CODES } from "../SyntaxError.mjs";
import { normalizeIoPath, resolveIoPath } from "../IO.mjs";

function byteLength(content) {
  return new TextEncoder().encode(String(content ?? "")).length;
}

function missingFile(path) {
  return createIoError(`ENOENT: virtual file not found ${path}`, ERROR_CODES.DO_MD_IO_ERROR, {
    file: path,
  });
}

export class Virtual {
  constructor(entries = {}) {
    this.entries = new Map();
    for (const [path, content] of Object.entries(entries)) {
      this.entries.set(normalizeIoPath(path), String(content));
    }
  }

  async readFileAsync(path) {
    const key = normalizeIoPath(path);
    if (!this.entries.has(key)) {
      throw missingFile(key);
    }
    return this.entries.get(key);
  }

  async writeFileAsync(path, content) {
    this.entries.set(normalizeIoPath(path), String(content ?? ""));
  }

  async statAsync(path) {
    const key = normalizeIoPath(path);
    if (!this.entries.has(key)) {
      throw missingFile(key);
    }
    return {
      isFile: true,
      isDirectory: false,
      size: byteLength(this.entries.get(key)),
    };
  }

  resolvePath(cwd, path) {
    return resolveIoPath(cwd, path);
  }
}
