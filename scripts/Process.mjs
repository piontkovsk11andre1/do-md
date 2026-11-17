import { spawn } from "node:child_process";

/** Run an owned child with bounded capture, cancellation and a deadline.
 * POSIX children get their own group so termination also reaches grandchildren.
 * Settle on close, after stdout is drained, rather than the earlier exit event.
 */
export function runTool(
  command,
  args,
  {
    cwd,
    signal,
    timeoutMs = 180000,
    capture = true,
    env = process.env,
    maxOutputBytes = 8388608,
  } = {},
) {
  if (signal?.aborted) {
    return Promise.reject(signal.reason ?? new Error("Operation aborted"));
  }
  return new Promise((resolve, reject) => {
    const grouped = process.platform !== "win32";
    const child = spawn(command, args, {
      cwd,
      env,
      detached: grouped,
      stdio: ["ignore", capture ? "pipe" : "inherit", "inherit"],
    });
    const chunks = [];
    let size = 0;
    let failure;
    let escalation;
    function kill(signalName) {
      try {
        if (grouped && child.pid) {
          process.kill(-child.pid, signalName);
        } else {
          child.kill(signalName);
        }
      } catch (error) {
        if (error.code !== "ESRCH") {
          failure ??= error;
        }
      }
    }
    function stop(error) {
      if (failure) {
        return;
      }
      failure = error;
      kill("SIGTERM");
      escalation = setTimeout(() => kill("SIGKILL"), 2000);
      escalation.unref();
    }
    const abort = () => stop(signal.reason ?? new Error("Operation aborted"));
    const timer = setTimeout(
      () => stop(new Error(`${command} exceeded ${timeoutMs}ms`)),
      timeoutMs,
    );
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) {
      abort();
    }
    child.stdout?.on("data", (chunk) => {
      size += chunk.length;
      if (size > maxOutputBytes) {
        stop(new Error(`${command} output exceeded ${maxOutputBytes} bytes`));
      } else {
        chunks.push(chunk);
      }
    });
    child.once("error", (error) => {
      failure ??= error;
    });
    child.once("close", (code, signalName) => {
      clearTimeout(timer);
      clearTimeout(escalation);
      signal?.removeEventListener("abort", abort);
      if (failure) {
        reject(failure);
      } else if (code !== 0) {
        reject(new Error(`${command} failed (${signalName ?? code})`));
      } else {
        resolve(Buffer.concat(chunks).toString("utf8"));
      }
    });
  });
}

/** npm scripts supply the CLI path, avoiding shell quoting and platform-specific shims. */
export function runNpm(args, options) {
  if (process.env.npm_execpath) {
    return runTool(process.execPath, [process.env.npm_execpath, ...args], options);
  }
  if (process.platform === "win32") {
    throw new Error("Run this command through npm run so npm_execpath is available");
  }
  return runTool("npm", args, options);
}
