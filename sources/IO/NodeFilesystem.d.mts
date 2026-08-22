import type { AtomicWriteOptions, FileStat, IOAdapter, ReadSnapshot, WriteSnapshot } from "../types.d.mts";
export class NodeFilesystem implements IOAdapter {
  readFileAsync(path: string, options?: unknown): Promise<string>;
  writeFileAsync(path: string, content: string | Uint8Array, options?: unknown): Promise<void>;
  readFileSnapshotAsync(path: string, options?: unknown): Promise<ReadSnapshot<string>>;
  writeFileAtomicAsync(path: string, content: string | Uint8Array, options?: AtomicWriteOptions): Promise<WriteSnapshot>;
  statAsync(path: string): Promise<FileStat>;
  resolvePath(cwd: string, path: string): string;
}
