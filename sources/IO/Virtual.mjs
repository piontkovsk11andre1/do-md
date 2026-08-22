import { createConflictError, createIoError, ERROR_CODES } from "../SyntaxError.mjs";
import { createContentRevision, normalizeIoPath, resolveIoPath } from "../IO.mjs";

function byteLength(content) {
  return new TextEncoder().encode(String(content ?? "")).length;
}

function missingFile(path) {
  return createIoError(`ENOENT: virtual file not found ${path}`, ERROR_CODES.DO_MD_IO_ERROR, {
    file: path,
  });
}

function globRegExp(pattern) {
  let source = "^";
  for (let index = 0; index < pattern.length; index++) {
    const char = pattern[index];
    if (char === "*" && pattern[index + 1] === "*") {
      index += 1;
      if (pattern[index + 1] === "/") {
        index += 1;
        source += "(?:.*/)?";
      } else {
        source += ".*";
      }
    } else if (char === "*") {
      source += "[^/]*";
    } else if (char === "?") {
      source += "[^/]";
    } else {
      source += char.replace(/[\\^$.[\]{}()+|]/g, "\\$&");
    }
  }
  return new RegExp(`${source}$`);
}

export class Virtual {
  constructor(entries = {}) {
    this.entries = new Map();
    for (const [path, content] of Object.entries(entries)) {
      this.entries.set(normalizeIoPath(path), String(content));
    }
  }

  async globAsync(pattern, { cwd = "" } = {}) {
    const target = resolveIoPath(cwd, pattern);
    if (this.entries.has(target)) {
      return [target];
    }
    const directoryPrefix = target === "/" ? "/" : `${target.replace(/\/$/, "")}/`;
    const directoryMatches = [...this.entries.keys()].filter(
      (path) => path.startsWith(directoryPrefix) && path.endsWith(".tpl.md"),
    );
    if (directoryMatches.length > 0 && !/[?*]/.test(target)) {
      return directoryMatches.sort();
    }
    const matcher = globRegExp(target);
    return [...this.entries.keys()].filter((path) => matcher.test(path)).sort();
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

  async readFileSnapshotAsync(path) {
    const key = normalizeIoPath(path);
    if (!this.entries.has(key)) {
      throw missingFile(key);
    }
    const content = this.entries.get(key);
    return { content, revision: createContentRevision(content) };
  }

  async writeFileAtomicAsync(path, content, options = {}) {
    const key = normalizeIoPath(path);
    const { expectedRevision, ifAbsent = false, force = false } = options ?? {};
    const exists = this.entries.has(key);
    const currentRevision = exists ? createContentRevision(this.entries.get(key)) : null;

    if (!force && (ifAbsent ? exists : expectedRevision !== undefined && expectedRevision !== currentRevision)) {
      throw createConflictError(`File changed before it could be written: ${key}`, { file: key });
    }

    const nextContent = String(content ?? "");
    const revision = createContentRevision(nextContent);
    // There are no awaits before this update, so revision validation and mutation are one synchronous CAS step.
    this.entries.set(key, nextContent);
    return { revision };
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
