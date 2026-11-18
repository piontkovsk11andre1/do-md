/** HTTP boundary failures carry a status without changing library diagnostics. */
export function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

/** Bounded, cancellable JSON reading shared by REST and Streamable HTTP MCP. */
export function readJson(request, maxBytes, timeoutMs, signal) {
  return new Promise((resolveBody, reject) => {
    let bytes = 0;
    const chunks = [];
    let settled = false;
    const finish = (error, value) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      if (error) {
        chunks.length = 0;
        request.resume();
        reject(error);
      } else {
        resolveBody(value);
      }
    };
    const abort = () => finish(httpError(408, "request body cancelled"));
    const timer = setTimeout(() => finish(httpError(408, "request body timed out")), timeoutMs);
    signal.addEventListener("abort", abort, { once: true });
    request.on("data", (chunk) => {
      if (settled) {
        return;
      }
      bytes += chunk.length;
      if (bytes > maxBytes) {
        finish(httpError(413, "request body exceeds maxBodyBytes"));
      } else {
        chunks.push(chunk);
      }
    });
    request.once("end", () => {
      if (settled) {
        return;
      }
      try {
        finish(null, JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch (cause) {
        finish(Object.assign(httpError(400, "invalid JSON request body"), { cause }));
      }
    });
    request.once("error", (error) => finish(error));
    request.once("aborted", () => finish(httpError(400, "request aborted")));
    if (signal.aborted) {
      abort();
    }
  });
}
