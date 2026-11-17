import test from "node:test";
import assert from "node:assert/strict";
import { getEventListeners } from "node:events";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runTool } from "../scripts/Process.mjs";
import { RunWorkspace } from "../scripts/RunWorkspace.mjs";
import { serveBrowser } from "../scripts/browser/Server.mjs";

test("owned subprocesses drain stdout and remove abort listeners", async () => {
  const controller = new AbortController();
  const text = "value".repeat(20000);
  const result = await runTool(
    process.execPath,
    ["-e", `process.stdout.write(${JSON.stringify(text)})`],
    { signal: controller.signal },
  );
  assert.equal(result, text);
  assert.deepEqual(getEventListeners(controller.signal, "abort"), []);
});

test("subprocess deadlines, cancellation and output budgets fail explicitly", async () => {
  await assert.rejects(
    runTool(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { timeoutMs: 100 }),
    /exceeded 100ms/,
  );
  await assert.rejects(
    runTool(process.execPath, ["-e", 'console.log("x".repeat(1000))'], { maxOutputBytes: 32 }),
    /output exceeded/,
  );
  const controller = new AbortController();
  controller.abort(new Error("cancelled by caller"));
  await assert.rejects(
    runTool(process.execPath, ["-e", "process.exit(0)"], { signal: controller.signal }),
    /cancelled by caller/,
  );
  const running = new AbortController();
  const pending = runTool(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
    signal: running.signal,
  });
  running.abort(new Error("cancel running child"));
  await assert.rejects(pending, /cancel running child/);
  assert.deepEqual(getEventListeners(running.signal, "abort"), []);
});

test("independent output workspaces cannot overwrite or delete a running server artifact", async () => {
  const root = await mkdtemp(join(tmpdir(), "do-md-tooling-"));
  let first;
  let second;
  try {
    first = await RunWorkspace.create(root, "serve");
    second = await RunWorkspace.create(root, "pack");
    assert.notEqual(first.output, second.output);
    await mkdir(first.output);
    await mkdir(second.output);
    await writeFile(join(first.output, "index.html"), "first");
    await writeFile(join(second.output, "index.html"), "second");
    const server = await serveBrowser(first.output);
    try {
      await second.dispose();
      assert.equal(await (await fetch(server.url)).text(), "first");
      assert.equal(await readFile(join(first.output, "index.html"), "utf8"), "first");
    } finally {
      await server.close();
    }
  } finally {
    await first?.dispose();
    await second?.dispose();
    await rm(root, { recursive: true, force: true });
  }
});
