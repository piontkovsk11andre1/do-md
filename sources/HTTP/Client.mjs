import { API_VERSION, failure, portNumber, positiveInteger } from "../Service/Definitions.mjs";

export function remoteUrl({ url, host, port } = {}) {
  if (url != null && (host != null || port != null)) throw new Error("--url cannot be combined with --host or --port");
  if (url == null && host == null && port == null) return null;
  const hostname = host ?? "127.0.0.1";
  if (typeof hostname !== "string" || !hostname || /[\s/@?#]/.test(hostname)) throw new Error("invalid remote host");
  const address = hostname.includes(":") && !hostname.startsWith("[") ? `[${hostname}]` : hostname;
  const parsed = new URL(url ?? `http://${address}:${portNumber(port ?? 8080)}`);
  if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error("remote URL must be HTTP(S) without credentials, query, or fragment");
  }
  parsed.pathname = parsed.pathname.replace(/\/*$/, "/");
  return parsed.href;
}

export class Client {
  constructor(options = {}) {
    this.url = remoteUrl(options);
    if (!this.url) throw new Error("remote host or URL is required");
    if (!options.root) throw new Error("--root is required");
    this.root = options.root;
    this.timeoutMs = positiveInteger(options.timeoutMs ?? 30_000, "timeoutMs");
    this.maxResponseBytes = positiveInteger(options.maxResponseBytes ?? 8_388_608, "maxResponseBytes");
    this.maxInputBytes = positiveInteger(options.maxInputBytes ?? 1_048_576, "maxInputBytes");
    this.noSnippets = options.noSnippets === true;
    this.capabilities = null;
  }

  async request(path, { body, signal } = {}) {
    const controller = new AbortController();
    const abort = () => controller.abort(signal.reason);
    const timer = setTimeout(() => controller.abort(new DOMException("remote request timed out", "TimeoutError")), this.timeoutMs + 5000);
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    try {
      const response = await fetch(new URL(path, this.url), {
        method: body === undefined ? "GET" : "POST",
        headers: { accept: "application/json", ...(body === undefined ? {} : { "content-type": "application/json" }) },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
        redirect: "error",
      });
      if (!/^application\/json(?:;|$)/i.test(response.headers.get("content-type") ?? "")) {
        await response.body?.cancel();
        throw new Error("remote service returned a non-JSON response");
      }
      const reader = response.body.getReader();
      const chunks = [];
      let size = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > this.maxResponseBytes) throw new Error("remote response exceeds maxResponseBytes");
          chunks.push(Buffer.from(value));
        }
      } finally {
        await reader.cancel().catch(() => {});
        reader.releaseLock();
      }
      const result = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if (result?.apiVersion !== API_VERSION) throw new Error("incompatible remote API version");
      if (!response.ok && (!Array.isArray(result.errors) || typeof result.ok !== "boolean")) {
        throw new Error(`remote HTTP ${response.status}`);
      }
      return { status: response.status, result };
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
    }
  }

  async connect() {
    const { status, result } = await this.request(`v1/capabilities?directory=${encodeURIComponent(this.root)}`);
    if (status !== 200 || result.ok !== true) throw new Error(result.errors?.[0]?.message ?? "remote service is unavailable");
    const names = result.commands?.map((command) => command.name);
    if (!Array.isArray(names) || !["validate", "export", "create", "set", "render", "match", "query", "reference"].every((name) => names.includes(name))) {
      throw new Error("remote service is missing required commands");
    }
    this.capabilities = result;
    if (Number.isSafeInteger(result.limits?.timeoutMs) && result.limits.timeoutMs > 0) {
      this.timeoutMs = Math.min(this.timeoutMs, result.limits.timeoutMs);
    }
    return result;
  }

  async call(name, params, signal) {
    try {
      const { status, result } = await this.request(`v1/commands/${encodeURIComponent(name)}`, {
        signal,
        body: { directory: this.root, params, limits: { timeoutMs: this.timeoutMs, maxInputBytes: this.maxInputBytes, noSnippets: this.noSnippets } },
      });
      if (typeof result.ok !== "boolean" || !Number.isInteger(result.exitCode) || result.exitCode < 0 || result.exitCode > 4 || !Array.isArray(result.errors)
        || result.errors.some((error) => typeof error?.code !== "string" || typeof error.message !== "string")
        || (result.ok && (status !== 200 || result.exitCode !== 0 || result.errors.length > 0))
        || (!result.ok && (result.exitCode === 0 || result.errors.length === 0))) throw new Error("invalid remote command result");
      if (result.ok) {
        if (name === "reference" && !Object.hasOwn(result, "reference")) throw new Error("missing remote reference");
        if (["match", "query"].includes(name) && !Array.isArray(result.matches)) throw new Error("invalid remote matches");
        if (["create", "set", "render"].includes(name) && typeof result.output !== "string") throw new Error("invalid remote output");
      }
      return result;
    } catch (error) {
      return failure(signal?.aborted || error?.name === "TimeoutError" || error?.name === "AbortError" ? "DO_MD_TIMEOUT" : "DO_MD_INTERNAL_ERROR", `remote execution failed: ${error?.message ?? String(error)}; mutations are not retried`);
    }
  }
}
