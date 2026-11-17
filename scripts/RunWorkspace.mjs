import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";

/** Own one invocation's artifacts. Cleanup never targets a shared output directory. */
export class RunWorkspace {
  static async create(root, label) {
    const base = join(root, ".browser");
    await mkdir(base, { recursive: true });
    return new RunWorkspace(await mkdtemp(join(base, `${label}-`)));
  }
  constructor(path) {
    this.path = path;
    this.output = join(path, "dist");
    this.installation = join(path, "installation");
    this.results = join(path, "results");
  }
  async dispose() {
    await rm(this.path, { recursive: true, force: true });
  }
  async removeInstallation() {
    await rm(this.installation, { recursive: true, force: true });
  }
}
