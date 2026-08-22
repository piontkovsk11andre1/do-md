import type { AtomicWriteOptions, FileStat, IOAdapter, ReadSnapshot, WriteSnapshot } from "./types.d.mts";
export type { AtomicWriteOptions, FileStat, IOAdapter, ReadSnapshot, WriteSnapshot } from "./types.d.mts";
export { createConflictError, createIoError } from "./SyntaxError.mjs";
export function createContentRevision(content: string | Uint8Array): string;
export function normalizeIoPath(path: unknown): string;
export function resolveIoPath(cwd: unknown, path: unknown): string;
export class IO implements IOAdapter {
  globAsync(pattern: string, options?: { cwd?: string }): Promise<string[]>;
  readFileAsync(path: string, options?: unknown): Promise<string>;
  writeFileAsync(path: string, content: string, options?: unknown): Promise<void>;
  readFileSnapshotAsync(path: string, options?: unknown): Promise<ReadSnapshot<string>>;
  writeFileAtomicAsync(path: string, content: string, options?: AtomicWriteOptions): Promise<WriteSnapshot>;
  statAsync(path: string): Promise<FileStat>;
  resolvePath(cwd: string, path: string): string;
}
