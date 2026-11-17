import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { RunWorkspace } from "./RunWorkspace.mjs";
import { runNpm, runTool } from "./Process.mjs";
import { buildBrowser } from "./browser/Build.mjs";
import { serveBrowser } from "./browser/Server.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const command = process.argv[2];
if (!["build", "pack", "serve", "test"].includes(command)) {
  throw new Error("Use browser.mjs build, pack, serve or test");
}
const workspace = await RunWorkspace.create(root, command);
const abort = new AbortController();
const stop = () => abort.abort(new Error("Browser operation interrupted"));
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
let server;
let retain = false;
try {
  let packageRoot = root;
  const packed = command === "pack" || command === "test";
  if (packed) {
    await mkdir(workspace.installation);
    const [archive] = JSON.parse(
      await runNpm(["pack", "--json", "--pack-destination", workspace.installation], {
        cwd: root,
        signal: abort.signal,
      }),
    );
    await writeFile(
      join(workspace.installation, "package.json"),
      JSON.stringify({ private: true, type: "module" }),
    );
    await runNpm(
      [
        "install",
        "--prefix",
        workspace.installation,
        "--ignore-scripts",
        "--no-package-lock",
        "--omit=dev",
        join(workspace.installation, archive.filename),
      ],
      { cwd: root, signal: abort.signal },
    );
    packageRoot = dirname(
      createRequire(pathToFileURL(join(workspace.installation, "package.json"))).resolve(
        "@p10i/do-md/package.json",
      ),
    );
  }
  await buildBrowser({ packageRoot, output: workspace.output, packed });
  abort.signal.throwIfAborted();
  if (command === "build" || command === "pack") {
    retain = true;
    process.stdout.write(
      `${packed ? "Packed browser" : "Browser"} artifact: ${workspace.output}\nNo browser engines were run.\n`,
    );
  } else {
    server = await serveBrowser(workspace.output);
    if (command === "serve") {
      process.stdout.write(
        `do-md browser playground: ${server.url}\nArtifact: ${workspace.output}\n`,
      );
      await new Promise((done) => {
        if (abort.signal.aborted) {
          done();
        } else {
          abort.signal.addEventListener("abort", done, { once: true });
        }
      });
    } else {
      const cli = fileURLToPath(
        new URL("../node_modules/@playwright/test/cli.js", import.meta.url),
      );
      await runTool(
        process.execPath,
        [cli, "test", `--output=${workspace.results}`, ...process.argv.slice(3)],
        {
          cwd: root,
          capture: false,
          timeoutMs: 600000,
          signal: abort.signal,
          env: { ...process.env, DO_MD_BROWSER_URL: server.url },
        },
      );
    }
  }
} catch (error) {
  // Keep failed-run diagnostics, but never retain a transient installed package.
  retain = command === "test";
  if (retain) {
    process.stderr.write(`Browser diagnostics: ${workspace.results}\n`);
  }
  throw error;
} finally {
  process.removeListener("SIGINT", stop);
  process.removeListener("SIGTERM", stop);
  await server?.close();
  await workspace.removeInstallation();
  if (!retain) {
    await workspace.dispose();
  }
}
