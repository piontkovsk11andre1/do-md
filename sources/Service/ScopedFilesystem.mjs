import { dirname, resolve } from "node:path";
import { NodeFilesystem } from "../IO/NodeFilesystem.mjs";
import { isWithinRoot, resolveScopedPath, scopeError } from "../MCP/Scoping.mjs";

// Every service-managed access is checked, including I/O invoked by templates.
// Trusted template code can still use Node's own filesystem APIs directly.
export class ScopedFilesystem extends NodeFilesystem {
  constructor(root, maxInputBytes) {
    super();
    this.root = root;
    this.maxInputBytes = maxInputBytes;
  }

  resolvePath(cwd, path) {
    const target = resolve(cwd ?? this.root, path);
    if (!isWithinRoot(this.root, target)) {
      throw scopeError(path);
    }
    return target;
  }

  async readable(path) {
    const target = await resolveScopedPath(this.root, path);
    const info = await super.statAsync(target);
    if (info.size > this.maxInputBytes) {
      throw scopeError(path, "input exceeds maxInputBytes");
    }
    return target;
  }

  async readFileAsync(path, options) {
    return super.readFileAsync(await this.readable(path), options);
  }
  async readFileSnapshotAsync(path, options) {
    return super.readFileSnapshotAsync(await this.readable(path), options);
  }
  async statAsync(path) {
    return super.statAsync(await resolveScopedPath(this.root, path));
  }
  async writeFileAsync(path, content, options) {
    return super.writeFileAsync(await resolveScopedPath(this.root, path), content, options);
  }
  async writeFileAtomicAsync(path, content, options) {
    return super.writeFileAtomicAsync(await resolveScopedPath(this.root, path), content, options);
  }

  async globAsync(pattern, { cwd = this.root } = {}) {
    const input = this.resolvePath(cwd, String(pattern)).replace(/\\/g, "/");
    const magic = input.search(/[?*[\]{}()!]/);
    const prefix = magic < 0 ? input : input.slice(0, magic);
    const base = magic < 0 ? input : prefix.endsWith("/") ? prefix.slice(0, -1) : dirname(prefix);
    await resolveScopedPath(this.root, base || this.root);
    const matches = await super.globAsync(input, { cwd: this.root });
    const scoped = [];
    for (const candidate of matches) {
      try {
        scoped.push(await resolveScopedPath(this.root, candidate));
      } catch {
        /* Outside-root candidates are not templates. */
      }
    }
    return scoped;
  }
}
