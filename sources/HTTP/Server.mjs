import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { realpath, stat } from "node:fs/promises";
import { resolve } from "node:path";
import * as z from "zod/v4";
import {
  API_VERSION,
  VERSION,
  TOOL_NAMES,
  TOOL_DEFINITIONS,
  DEFAULT_MAX_INPUT_BYTES,
  DEFAULT_TIMEOUT_MS,
  exitCode,
  failure,
  positiveInteger,
  portNumber,
} from "../Service/Definitions.mjs";
import { execute } from "../Service/Executor.mjs";
import { resolveScopedPath } from "../MCP/Scoping.mjs";
import { httpError, readJson } from "../Service/Http.mjs";

const requestSchema = z.strictObject({
  directory: z.string().min(1).optional(),
  params: z.record(z.string(), z.json()),
  limits: z
    .strictObject({
      timeoutMs: z.number().int().positive().optional(),
      maxInputBytes: z.number().int().positive().optional(),
      noSnippets: z.boolean().optional(),
    })
    .optional(),
});

export class Server {
  constructor(options = {}) {
    this.root = options.root;
    this.host = options.host ?? "127.0.0.1";
    this.port = portNumber(options.port ?? 8080, true);
    this.maxInputBytes = positiveInteger(
      options.maxInputBytes ?? DEFAULT_MAX_INPUT_BYTES,
      "maxInputBytes",
    );
    this.timeoutMs = positiveInteger(options.timeoutMs ?? DEFAULT_TIMEOUT_MS, "timeoutMs");
    this.maxBodyBytes = positiveInteger(options.maxBodyBytes ?? 1_048_576, "maxBodyBytes");
    this.maxResponseBytes = positiveInteger(
      options.maxResponseBytes ?? 8_388_608,
      "maxResponseBytes",
    );
    this.maxConcurrency = positiveInteger(options.maxConcurrency ?? 4, "maxConcurrency");
    this.noSnippets = options.noSnippets === true;
    this.mcp = options.mcp === true;
    this.mcpAllowedOrigins = options.mcpAllowedOrigins ?? [];
    if (
      !Array.isArray(this.mcpAllowedOrigins) ||
      this.mcpAllowedOrigins.some(
        (origin) =>
          typeof origin !== "string" ||
          !["http:", "https:"].includes(new URL(origin).protocol) ||
          new URL(origin).origin !== origin,
      )
    ) {
      throw new Error("mcpAllowedOrigins must contain exact HTTP(S) origins");
    }
    this.mcpEndpoint = null;
    this.server = null;
    this.calls = new Map();
    this.stopping = false;
  }

  async directory(value = this.root) {
    const path = await resolveScopedPath(this.root, value);
    if (!(await stat(path)).isDirectory()) {
      throw httpError(400, "directory is not a directory");
    }
    return path;
  }

  async start() {
    if (this.server) {
      throw new Error("HTTP server is already started");
    }
    if (typeof this.root !== "string" || !this.root.trim()) {
      throw new Error("--root is required");
    }
    this.root = await realpath(resolve(this.root));
    await this.directory();
    if (this.mcp) {
      const { Endpoint } = await import("../MCP/Http.mjs");
      this.mcpEndpoint = new Endpoint(this);
    }
    this.stopping = false;
    const server = createServer((request, response) => void this.handle(request, response));
    server.requestTimeout = this.timeoutMs;
    server.headersTimeout = Math.min(this.timeoutMs, 10_000);
    server.setTimeout(this.timeoutMs + 5000, (socket) => socket.destroy());
    this.server = server;
    try {
      await new Promise((ready, reject) => {
        server.once("error", reject);
        server.listen(this.port, this.host, () => {
          server.removeListener("error", reject);
          ready();
        });
      });
    } catch (error) {
      this.server = null;
      throw error;
    }
    this.port = server.address().port;
    return this;
  }

  address() {
    return this.server?.address() ?? null;
  }

  async close() {
    this.stopping = true;
    for (const { controller } of this.calls.values()) {
      controller.abort();
    }
    const server = this.server;
    this.server = null;
    const closed = server ? new Promise((done) => server.close(done)) : Promise.resolve();
    server?.closeAllConnections();
    await Promise.allSettled([...this.calls.values()].map(({ promise }) => promise));
    await this.mcpEndpoint?.close();
    await closed;
  }

  send(response, status, result, requestId) {
    if (response.destroyed || response.writableEnded) {
      return;
    }
    let body = JSON.stringify({ ...result, apiVersion: API_VERSION, requestId });
    if (Buffer.byteLength(body) > this.maxResponseBytes) {
      status = 500;
      body = JSON.stringify({
        ...failure("DO_MD_INTERNAL_ERROR", "response exceeds maxResponseBytes"),
        exitCode: 1,
        output: null,
        context: null,
        apiVersion: API_VERSION,
        requestId,
      });
    }
    response.writeHead(status, {
      "content-type": "application/json; charset=utf-8",
      "content-length": Buffer.byteLength(body),
      "cache-control": "no-store",
      "x-request-id": requestId,
      ...([408, 413, 503].includes(status) ? { connection: "close" } : {}),
    });
    response.end(body);
  }

  async handle(request, response) {
    const requestId = randomUUID();
    try {
      if (this.stopping) {
        throw httpError(503, "server is stopping");
      }
      const url = new URL(request.url, "http://do-md.local");
      if (url.pathname === "/mcp" && this.mcpEndpoint) {
        await this.mcpEndpoint.handle(request, response);
        return;
      }
      if (request.method === "GET" && url.pathname === "/healthz") {
        this.send(response, 200, { ok: true, version: VERSION }, requestId);
        return;
      }
      if (request.method === "GET" && url.pathname === "/v1/capabilities") {
        if (url.searchParams.has("directory")) {
          await this.directory(url.searchParams.get("directory"));
        }
        this.send(
          response,
          200,
          {
            ok: true,
            version: VERSION,
            commands: TOOL_NAMES.map((name) => ({
              name,
              description: TOOL_DEFINITIONS[name].description,
              inputSchema: z.toJSONSchema(TOOL_DEFINITIONS[name].inputSchema),
            })),
            limits: {
              timeoutMs: this.timeoutMs,
              maxInputBytes: this.maxInputBytes,
              maxBodyBytes: this.maxBodyBytes,
              maxResponseBytes: this.maxResponseBytes,
              maxConcurrency: this.maxConcurrency,
              noSnippets: this.noSnippets,
            },
          },
          requestId,
        );
        return;
      }
      const match = /^\/v1\/commands\/([a-z]+)$/.exec(url.pathname);
      if (!match || !TOOL_NAMES.includes(match[1])) {
        throw httpError(404, "unknown route or command");
      }
      if (request.method !== "POST") {
        throw httpError(405, "command requests require POST");
      }
      if (!/^application\/json(?:;|$)/i.test(request.headers["content-type"] ?? "")) {
        throw httpError(415, "Content-Type must be application/json");
      }
      if (Number(request.headers["content-length"]) > this.maxBodyBytes) {
        throw httpError(413, "request body exceeds maxBodyBytes");
      }
      // Admission covers body readers as well as workers, bounding slow clients.
      if (this.calls.size >= this.maxConcurrency) {
        throw httpError(503, "server is busy");
      }
      const controller = new AbortController();
      response.once("close", () => {
        if (!response.writableFinished) {
          controller.abort();
        }
      });
      const promise = this.run(request, response, match[1], requestId, controller.signal);
      this.calls.set(requestId, { controller, promise });
      try {
        await promise;
      } finally {
        this.calls.delete(requestId);
      }
    } catch (error) {
      const status =
        error.status ?? (error.code === "DO_MD_USER_ERROR" || error.code === "ENOENT" ? 400 : 500);
      this.send(
        response,
        status,
        {
          ...failure(status < 500 ? "DO_MD_USER_ERROR" : "DO_MD_INTERNAL_ERROR", error.message),
          exitCode: 1,
          output: null,
          context: null,
        },
        requestId,
      );
    }
  }

  async run(request, response, name, requestId, signal) {
    const envelope = requestSchema.safeParse(
      await readJson(request, this.maxBodyBytes, this.timeoutMs, signal),
    );
    if (!envelope.success) {
      throw httpError(400, `invalid command request: ${envelope.error.message}`);
    }
    const parsed = TOOL_DEFINITIONS[name].inputSchema.safeParse(envelope.data.params);
    if (!parsed.success) {
      throw httpError(400, `invalid command arguments: ${parsed.error.message}`);
    }
    const root = await this.directory(envelope.data.directory);
    const limits = envelope.data.limits ?? {};
    const result = await execute(
      name,
      parsed.data,
      {
        root,
        maxInputBytes: Math.min(this.maxInputBytes, limits.maxInputBytes ?? this.maxInputBytes),
        timeoutMs: Math.min(this.timeoutMs, limits.timeoutMs ?? this.timeoutMs),
        noSnippets: this.noSnippets || limits.noSnippets === true,
      },
      { signal },
    );
    const code = result.errors?.[0]?.code;
    const status = code === "DO_MD_TIMEOUT" ? 504 : code === "DO_MD_INTERNAL_ERROR" ? 500 : 200;
    let output = result.output ?? null;
    if (result.ok && name === "match") {
      output = result.matches.join("\n");
    }
    if (result.ok && name === "query") {
      output = JSON.stringify(parsed.data.all ? result.matches : result.matches[0], null, 2);
    }
    if (name === "reference" && result.ok) {
      output =
        typeof result.reference === "string" ? result.reference : JSON.stringify(result.reference);
    }
    if (name === "skill" && result.ok) {
      output = result.skill;
    }
    this.send(
      response,
      status,
      {
        ...result,
        exitCode: result.ok ? 0 : exitCode(result.errors),
        output,
        context: result.context ?? (result.matches ? { matches: result.matches } : null),
      },
      requestId,
    );
  }

  /** MCP tool/resource execution shares the REST worker budget and configured root. */
  async dispatchMcp(name, params, signal) {
    if (this.stopping) {
      throw httpError(503, "server is stopping");
    }
    if (this.calls.size >= this.maxConcurrency) {
      throw httpError(503, "server is busy");
    }
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) {
      abort();
    }
    const id = randomUUID();
    const promise = execute(
      name,
      params,
      {
        root: this.root,
        maxInputBytes: this.maxInputBytes,
        timeoutMs: this.timeoutMs,
        noSnippets: this.noSnippets,
      },
      { signal: controller.signal },
    );
    this.calls.set(id, { controller, promise });
    try {
      return await promise;
    } finally {
      signal?.removeEventListener("abort", abort);
      this.calls.delete(id);
    }
  }
}
