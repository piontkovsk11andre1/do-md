import { dirname, join } from "node:path";

import { NodeFilesystem } from "../../IO/NodeFilesystem.mjs";
import { Virtual } from "../../IO/Virtual.mjs";
import { resolveScopedPath, scopeError } from "../Scoping.mjs";

const DEFAULT_MAX_INPUT_BYTES = 1_048_576;
export const INLINE_OUTPUT = "__do_md_mcp_inline__";

export function ioOf(context = {}) {
  return context.io ?? new NodeFilesystem();
}

export function cwdOf(context = {}) {
  return context.root;
}

export function commandOptions(params = {}, context = {}) {
  return {
    ...(params.options ?? {}),
    maxInputBytes: context.maxInputBytes ?? DEFAULT_MAX_INPUT_BYTES,
  };
}

export function commandIo(io, { suppressWrites = false, hidePaths = [] } = {}) {
  const sink = new Virtual();
  const hidden = new Set(hidePaths);
  return {
    readFileAsync(path, options) {
      return io.readFileAsync(path, options);
    },
    readFileSnapshotAsync(path, options) {
      return typeof io.readFileSnapshotAsync === "function"
        ? io.readFileSnapshotAsync(path, options)
        : io.readFileAsync(path, options).then((content) => ({ content, revision: null }));
    },
    writeFileAsync(path, content, options) {
      if (suppressWrites) {
        return sink.writeFileAsync(path, content, options);
      }
      return io.writeFileAsync(path, content, options);
    },
    writeFileAtomicAsync(path, content, options) {
      if (suppressWrites) {
        return sink.writeFileAtomicAsync(path, content, { force: true });
      }
      if (typeof io.writeFileAtomicAsync === "function") {
        return io.writeFileAtomicAsync(path, content, options);
      }
      return io.writeFileAsync(path, content, options).then(() => ({ revision: null }));
    },
    statAsync(path) {
      if (hidden.has(path)) {
        return sink.statAsync(path);
      }
      return io.statAsync(path);
    },
    resolvePath(cwd, path) {
      return io.resolvePath(cwd, path);
    },
  };
}

export function missingArg(name) {
  throw scopeError(null, `missing ${name}`);
}

export async function resolveToolPath(context, value, name) {
  if (value == null || value === "") {
    missingArg(name);
  }
  if (context.io) {
    return context.io.resolvePath(context.root ?? "", value);
  }
  return resolveScopedPath(context.root, value);
}

export async function resolveToolPattern(context, value, name) {
  if (value == null || value === "") {
    missingArg(name);
  }
  if (context.io) {
    return context.io.resolvePath(context.root ?? "", value);
  }
  const input = String(value).replace(/\\/g, "/");
  const magic = input.search(/[?*[\]{}()!]/);
  if (magic < 0) {
    return resolveScopedPath(context.root, input);
  }
  const prefix = input.slice(0, magic);
  const base = prefix.endsWith("/") ? prefix.slice(0, -1) || "." : dirname(prefix || ".");
  const resolvedBase = await resolveScopedPath(context.root, base);
  const tail = input.slice(base === "." ? 0 : base.length).replace(/^\//, "");
  return join(resolvedBase, tail).replace(/\\/g, "/");
}

export function hasOwnPath(value) {
  return value != null && value !== "";
}
