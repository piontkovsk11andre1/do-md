import type { AtomicWriteOptions, FileStat, IOAdapter, ReadSnapshot, WriteSnapshot } from "../types.d.mts";
export class Virtual implements IOAdapter {
  constructor(entries?: Record<string, unknown>);
  entries: Map<string, string>;
  readFileAsync(path: string): Promise<string>;
  writeFileAsync(path: string, content: string | Uint8Array): Promise<void>;
  readFileSnapshotAsync(path: string): Promise<ReadSnapshot<string>>;
  writeFileAtomicAsync(path: string, content: string | Uint8Array, options?: AtomicWriteOptions): Promise<WriteSnapshot>;
  statAsync(path: string): Promise<FileStat>;
  resolvePath(cwd: string, path: string): string;
}
