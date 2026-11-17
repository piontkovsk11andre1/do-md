import type {
  AtomicWriteOptions,
  FileStat,
  IOAdapter,
  ReadSnapshot,
  WriteSnapshot,
} from "../types.d.mts";
export class Fetch implements IOAdapter {
  readFileAsync(path: string, options?: unknown): Promise<string>;
  writeFileAsync(path: string, content: string | Uint8Array, options?: unknown): Promise<never>;
  readFileSnapshotAsync(path: string, options?: unknown): Promise<ReadSnapshot<string>>;
  writeFileAtomicAsync(
    path: string,
    content: string | Uint8Array,
    options?: AtomicWriteOptions,
  ): Promise<never>;
  statAsync(path: string): Promise<never>;
  resolvePath(cwd: string, path: string): string;
}
