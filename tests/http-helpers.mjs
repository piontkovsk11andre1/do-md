import { spawn } from "node:child_process";
import { once } from "node:events";
import { resolve } from "node:path";

export async function startServe(root, bin = resolve("bin/do-md.mjs"), extra = []) {
  const child = spawn(process.execPath, [bin, "serve", "--root", root, "--port", "0", ...extra], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  const exited = once(child, "exit");
  let stderr = "";
  const ready = new Promise((done, reject) => {
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
      const match = /listening on 127\.0\.0\.1:(\d+)/.exec(stderr);
      if (match) {
        done(Number(match[1]));
      }
    });
    child.once("error", reject);
    child.once("exit", () => reject(new Error(`serve exited before ready: ${stderr}`)));
  });
  let timer;
  try {
    const port = await Promise.race([
      ready,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`serve startup timed out: ${stderr}`)), 10_000);
      }),
    ]);
    return {
      child,
      port,
      url: `http://127.0.0.1:${port}`,
      async close() {
        if (child.exitCode !== null || child.signalCode !== null) {
          return;
        }
        child.kill("SIGTERM");
        const kill = setTimeout(() => child.kill("SIGKILL"), 5000);
        try {
          await exited;
        } finally {
          clearTimeout(kill);
        }
      },
    };
  } catch (error) {
    child.kill("SIGKILL");
    await exited.catch(() => {});
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
