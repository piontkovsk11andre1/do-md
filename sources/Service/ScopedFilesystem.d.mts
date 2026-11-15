import { NodeFilesystem } from "../IO/NodeFilesystem.mjs";
export class ScopedFilesystem extends NodeFilesystem {
  constructor(root: string, maxInputBytes: number);
  root: string;
  maxInputBytes: number;
  readable(path: string): Promise<string>;
}
