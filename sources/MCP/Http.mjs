import { randomUUID } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { Server as McpBackend } from "./Server.mjs";
import { httpError, readJson } from "../Service/Http.mjs";

/** One listener's MCP sessions. Execution remains owned by the HTTP service. */
export class Endpoint {
  constructor(owner) {
    this.owner = owner;
    this.backend = new McpBackend({
      root: owner.root,
      noSnippets: owner.noSnippets,
      maxInputBytes: owner.maxInputBytes,
      timeoutMs: owner.timeoutMs,
    });
    this.sessions = new Map();
    this.records = new Set();
    this.readers = new Set();
    this.closed = false;
  }

  sendError(response, status, message, id = null, code = -32000) {
    if (response.destroyed || response.writableEnded) {
      return;
    }
    response.writeHead(status, {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...([408, 413, 503].includes(status) ? { connection: "close" } : {}),
    });
    response.end(
      JSON.stringify({
        jsonrpc: "2.0",
        id,
        error: { code, message },
      }),
    );
  }

  async handle(request, response) {
    let input;
    try {
      if (this.closed || this.owner.stopping) {
        throw httpError(503, "server is stopping");
      }
      if (
        request.headers.origin &&
        !this.owner.mcpAllowedOrigins.includes(request.headers.origin)
      ) {
        throw httpError(403, "MCP Origin is not allowed");
      }
      if (!["POST", "DELETE"].includes(request.method)) {
        request.resume();
        response.writeHead(405, { allow: "POST, DELETE" });
        response.end();
        return;
      }
      const id = request.headers["mcp-session-id"];
      if (id !== undefined && (typeof id !== "string" || !id)) {
        throw httpError(400, "invalid MCP session header");
      }
      let record = id ? this.sessions.get(id) : null;
      if (id && !record) {
        throw httpError(404, "unknown MCP session");
      }
      if (request.method === "POST") {
        if (!/^application\/json(?:;|$)/i.test(request.headers["content-type"] ?? "")) {
          throw httpError(415, "Content-Type must be application/json");
        }
        if (Number(request.headers["content-length"]) > this.owner.maxBodyBytes) {
          throw httpError(413, "request body exceeds maxBodyBytes");
        }
        // Reserve bounded control-plane capacity even when every worker is busy:
        // cancellation/initialization must never wait for an execution slot.
        if (this.readers.size >= this.owner.maxConcurrency + 1) {
          throw httpError(503, "MCP body readers are busy");
        }
        const controller = new AbortController();
        const abort = () => {
          if (!response.writableFinished) {
            controller.abort();
          }
        };
        response.once("close", abort);
        this.readers.add(controller);
        try {
          input = await readJson(
            request,
            this.owner.maxBodyBytes,
            this.owner.timeoutMs,
            controller.signal,
          );
        } finally {
          this.readers.delete(controller);
          response.removeListener("close", abort);
        }
      }
      if (this.closed || this.owner.stopping) {
        throw httpError(503, "server is stopping");
      }
      if (!record) {
        if (request.method !== "POST" || input?.method !== "initialize") {
          throw httpError(400, "initialize an MCP session first");
        }
        for (const existing of this.records) {
          if (
            !existing.active.size &&
            !existing.running &&
            Date.now() - existing.lastSeen > 300000
          ) {
            await existing.protocol.close();
          }
        }
        if (this.records.size >= 256) {
          throw httpError(503, "MCP session limit reached");
        }
        record = await this.createSession();
      }
      const current = record;
      current.lastSeen = Date.now();
      current.active.add(response);
      let finished = false;
      const finish = () => {
        if (finished) {
          return;
        }
        finished = true;
        current.active.delete(response);
        if (!current.transport.sessionId) {
          void current.protocol.close().catch(() => {});
        }
      };
      response.once("finish", finish);
      response.once("close", finish);
      // A dropped HTTP response is not an implicit MCP cancellation. The SDK
      // retains request state so later cancellation notifications reach the call.
      await current.transport.handleRequest(request, response, input);
    } catch (error) {
      const id = typeof input?.id === "string" || typeof input?.id === "number" ? input.id : null;
      this.sendError(
        response,
        error.status ?? 500,
        error.message ?? String(error),
        id,
        error.cause instanceof SyntaxError ? -32700 : error.status === 400 ? -32600 : -32000,
      );
    }
  }

  async createSession() {
    const record = {
      protocol: null,
      transport: null,
      active: new Set(),
      running: 0,
      lastSeen: Date.now(),
    };
    const protocol = this.backend.createProtocol({
      dispatch: async (name, params, signal) => {
        record.running++;
        try {
          return await this.owner.dispatchMcp(name, params, signal);
        } finally {
          record.running--;
        }
      },
    });
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      enableJsonResponse: true,
      onsessioninitialized: (id) => {
        if (!this.closed) {
          this.sessions.set(id, record);
        }
      },
      onsessionclosed: (id) => {
        this.sessions.delete(id);
      },
    });
    record.protocol = protocol;
    record.transport = transport;
    this.records.add(record);
    protocol.server.onclose = () => {
      this.records.delete(record);
      if (transport.sessionId) {
        this.sessions.delete(transport.sessionId);
      }
    };
    const send = transport.send.bind(transport);
    transport.send = async (message, options) => {
      if (Buffer.byteLength(JSON.stringify(message)) > this.owner.maxResponseBytes) {
        // Like the REST endpoint, a small fixed error replaces an oversized
        // payload. It can exceed an unrealistically small configured limit.
        if ("id" in message) {
          return send(
            {
              jsonrpc: "2.0",
              id: message.id ?? null,
              error: { code: -32603, message: "response exceeds maxResponseBytes" },
            },
            options,
          );
        }
        return;
      }
      return send(message, options);
    };
    try {
      await protocol.connect(transport);
      if (this.closed) {
        throw httpError(503, "server is stopping");
      }
    } catch (error) {
      await protocol.close();
      throw error;
    }
    return record;
  }

  close() {
    return (this.closing ??= (async () => {
      this.closed = true;
      for (const controller of this.readers) {
        controller.abort();
      }
      await Promise.allSettled([...this.records].map((record) => record.protocol.close()));
      await this.backend.close();
      this.sessions.clear();
      this.records.clear();
    })());
  }
}
