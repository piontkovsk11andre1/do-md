import { createHash } from "node:crypto";

import { makeNotImplementedError } from "./DoMdError.mjs";

export { createConflictError, createIoError } from "./DoMdError.mjs";

/**
 * @typedef {Object} IO
 * @property {(path: string, options?: any) => Promise<string>} readFileAsync
 * @property {(path: string, content: string, options?: any) => Promise<void>} writeFileAsync
 * @property {(path: string, options?: any) => Promise<{ content: string, revision: string }>} readFileSnapshotAsync
 * @property {(path: string, content: string, options?: any) => Promise<{ revision: string }>} writeFileAtomicAsync
 * @property {(path: string) => Promise<{ isFile: boolean, isDirectory: boolean, size: number }>} statAsync
 * @property {(pattern: string, options?: { cwd?: string }) => Promise<string[]>} globAsync
 * @property {(cwd: string, path: string) => string} resolvePath
 */

export function createContentRevision(content) {
  return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}

export function normalizeIoPath(path) {
  const raw = String(path ?? "").replace(/\\/g, "/");
  if (raw === "") {
    return "";
  }

  const absolute = raw.startsWith("/");
  const segments = [];
  for (const part of raw.split("/")) {
    if (part === "" || part === ".") {
      continue;
    }
    if (part === "..") {
      if (segments.length > 0 && segments[segments.length - 1] !== "..") {
        segments.pop();
      } else if (!absolute) {
        segments.push("..");
      }
      continue;
    }
    segments.push(part);
  }

  const joined = segments.join("/");
  if (absolute) {
    return joined ? `/${joined}` : "/";
  }
  return joined;
}

export function resolveIoPath(cwd, path) {
  const target = String(path ?? "").replace(/\\/g, "/");
  if (target.startsWith("/")) {
    return normalizeIoPath(target);
  }
  const base = cwd == null || cwd === "" ? "" : String(cwd);
  return normalizeIoPath(base === "" ? target : `${base}/${target}`);
}

export class IO {
  async globAsync() {
    throw makeNotImplementedError("IO.globAsync");
  }

  async readFileAsync() {
    throw makeNotImplementedError("IO.readFileAsync");
  }

  async writeFileAsync() {
    throw makeNotImplementedError("IO.writeFileAsync");
  }

  async readFileSnapshotAsync(path, options) {
    const content = await this.readFileAsync(path, options);
    return { content, revision: createContentRevision(content) };
  }

  async writeFileAtomicAsync() {
    throw makeNotImplementedError("IO.writeFileAtomicAsync");
  }

  async statAsync() {
    throw makeNotImplementedError("IO.statAsync");
  }

  resolvePath(cwd, path) {
    return resolveIoPath(cwd, path);
  }
}
