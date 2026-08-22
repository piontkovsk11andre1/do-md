import { lstat, readlink, realpath } from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";

import { ERROR_CODES } from "../SyntaxError.mjs";

const ESCAPE_MESSAGE = "path escapes --root";

export function isWithinRoot(rootPath, candidatePath) {
  const root = resolve(String(rootPath ?? ""));
  const candidate = resolve(String(candidatePath ?? ""));
  const rel = relative(root, candidate);
  if (rel === "") {
    return true;
  }
  if (isAbsolute(rel)) {
    return false;
  }
  return rel.split(/[\\/]/)[0] !== "..";
}

export function ensureWithinRoot(rootPath, targetPath) {
  const root = resolve(String(rootPath ?? ""));
  const target = resolve(root, String(targetPath ?? ""));
  return isWithinRoot(root, target);
}

export function scopeError(path, message = ESCAPE_MESSAGE) {
  const error = new Error(String(message));
  error.code = ERROR_CODES.DO_MD_USER_ERROR;
  error.file = path == null || path === "" ? null : String(path);
  error.line = 1;
  error.column = 1;
  error.snippet = null;
  return error;
}

export async function resolveScopedPath(rootPath, targetPath) {
  if (typeof targetPath !== "string") {
    throw scopeError(targetPath, "path is required");
  }
  const root = await realpath(resolve(String(rootPath ?? "")));
  const resolved = resolve(root, targetPath);
  if (!isWithinRoot(root, resolved)) {
    throw scopeError(targetPath, ESCAPE_MESSAGE);
  }
  const canonical = await canonicalize(resolved);
  if (!isWithinRoot(root, canonical)) {
    throw scopeError(targetPath, ESCAPE_MESSAGE);
  }
  return canonical;
}

async function canonicalize(input, seen = new Set()) {
  const absolute = resolve(String(input));
  if (seen.has(absolute)) {
    throw scopeError(input, ESCAPE_MESSAGE);
  }
  seen.add(absolute);
  try {
    return await realpath(absolute);
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }
  try {
    const info = await lstat(absolute);
    if (info.isSymbolicLink()) {
      const target = await readlink(absolute);
      return canonicalize(resolve(dirname(absolute), target), seen);
    }
    return absolute;
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }
  const parent = dirname(absolute);
  if (parent === absolute) {
    return absolute;
  }
  return resolve(await canonicalize(parent, seen), basename(absolute));
}
