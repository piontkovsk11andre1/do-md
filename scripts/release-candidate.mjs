import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runNpm, runTool } from "./Process.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const packageJson = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
if (!/^2\.0\.0-rc\.\d+$/.test(packageJson.version)) {
  throw new Error("Expected a versioned 2.0.0-rc.N candidate");
}
const git = async (...args) => (await runTool("git", args, { cwd: root, timeoutMs: 10000 })).trim();
if (resolve(await git("rev-parse", "--show-toplevel")) !== resolve(root)) {
  throw new Error("Candidate must belong to this Git root");
}
const assertClean = async () => {
  if (await git("status", "--porcelain")) {
    throw new Error("Commit the reviewed changes before freezing a release candidate");
  }
};
await assertClean();
const commit = await git("rev-parse", "HEAD");
if (!/^[a-f0-9]{40,64}$/.test(commit)) {
  throw new Error("Invalid Git identity");
}
const abort = new AbortController();
const stop = () => abort.abort(new Error("Candidate verification interrupted"));
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
let staging;
try {
  await runNpm(["run", "check"], {
    cwd: root,
    capture: false,
    timeoutMs: 600000,
    signal: abort.signal,
  });
  await runNpm(["run", "test:runtime"], { cwd: root, capture: false, signal: abort.signal });
  await assertClean();
  if ((await git("rev-parse", "HEAD")) !== commit) {
    throw new Error("HEAD changed during verification");
  }
  const base = join(root, ".release");
  await mkdir(base, { recursive: true });
  staging = await mkdtemp(join(base, ".candidate-"));
  const [archive] = JSON.parse(
    await runNpm(["pack", "--json", "--pack-destination", staging], {
      cwd: root,
      signal: abort.signal,
    }),
  );
  if (archive.version !== packageJson.version) {
    throw new Error("Packed version differs from candidate version");
  }
  const sha256 = createHash("sha256")
    .update(await readFile(join(staging, archive.filename)))
    .digest("hex");
  const manifest = {
    package: packageJson.name,
    version: packageJson.version,
    commit,
    archive: archive.filename,
    sha256,
    npmIntegrity: archive.integrity,
    runtime: process.version,
    platform: process.platform,
    npm: (await runNpm(["--version"], { cwd: root, signal: abort.signal })).trim(),
    checks: [
      "format",
      "lint",
      "checked-JSDoc declarations",
      "consumer types",
      "reference",
      "Node behavior and packed installs",
      "CLI/Skill/MCP/HTTP runtime smoke",
    ],
    deferredVerification: ["Windows", "Chromium", "Firefox", "WebKit"],
    imageVerification: "separate CI job required",
  };
  await writeFile(join(staging, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  await assertClean();
  if ((await git("rev-parse", "HEAD")) !== commit) {
    throw new Error("HEAD changed while packing");
  }
  // A completed candidate is a non-empty directory; rename refuses to overwrite it.
  const destination = join(base, `${packageJson.version}-${commit.slice(0, 12)}`);
  await rename(staging, destination);
  staging = undefined;
  process.stdout.write(
    `Frozen candidate: ${destination}\nSHA-256: ${sha256}\nNo publication or Git mutation was performed.\n`,
  );
} finally {
  process.removeListener("SIGINT", stop);
  process.removeListener("SIGTERM", stop);
  if (staging) {
    await rm(staging, { recursive: true, force: true });
  }
}
