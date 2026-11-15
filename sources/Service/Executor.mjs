import { Worker } from "node:worker_threads";
import { DEFAULT_MAX_INPUT_BYTES, DEFAULT_TIMEOUT_MS, failure } from "./Definitions.mjs";

// Each call owns its worker. Aborting can stop execution, but cannot undo a
// filesystem write that has already committed, so callers must not retry writes.
export async function execute(name, params, context, { signal } = {}) {
  if (signal?.aborted) return failure("DO_MD_TIMEOUT", "command cancelled");
  const worker = new Worker(new URL("../MCP/Worker.mjs", import.meta.url), {
    workerData: { name, params, context: { maxInputBytes: DEFAULT_MAX_INPUT_BYTES, timeoutMs: DEFAULT_TIMEOUT_MS, ...context, scoped: true } },
    stdout: true,
    stderr: true,
    // Runtime/CLI flags such as --input-type and process-wide V8 flags are
    // not valid worker flags and must not leak from an embedding process.
    execArgv: [],
  });
  worker.stdout.on("data", (chunk) => process.stderr.write(chunk));
  worker.stderr.on("data", (chunk) => process.stderr.write(chunk));
  return new Promise((resolve) => {
    let settled = false;
    const finish = async (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      await worker.terminate().catch(() => {});
      if (context.noSnippets && Array.isArray(result?.errors)) {
        result.errors = result.errors.map((error) => ({ ...error, snippet: null }));
      }
      resolve(result);
    };
    const abort = () => void finish(failure("DO_MD_TIMEOUT", "command cancelled"));
    const timer = setTimeout(() => void finish(failure("DO_MD_TIMEOUT", "command timed out")), context.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    signal?.addEventListener("abort", abort, { once: true });
    worker.once("message", (result) => void finish(result));
    worker.once("error", (error) => void finish(failure("DO_MD_INTERNAL_ERROR", error.message)));
    worker.once("exit", (code) => {
      if (!settled) void finish(failure("DO_MD_INTERNAL_ERROR", `tool worker exited with code ${code}`));
    });
    if (signal?.aborted) abort();
  });
}
