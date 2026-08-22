import { stat, realpath } from "node:fs/promises";
import { resolve } from "node:path";
import { Worker } from "node:worker_threads";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as z from "zod/v4";

import { ERROR_CODES } from "../SyntaxError.mjs";
import { handleValidate } from "./tools/validate.mjs";
import { handleExport } from "./tools/export.mjs";
import { handleCreate } from "./tools/create.mjs";
import { handleSet } from "./tools/set.mjs";
import { handleRender } from "./tools/render.mjs";
import { handleMatch } from "./tools/match.mjs";
import { handleQuery } from "./tools/query.mjs";

export const DEFAULT_MAX_INPUT_BYTES = 1_048_576;
export const DEFAULT_TIMEOUT_MS = 30_000;
export const TOOL_NAMES = Object.freeze(["validate", "export", "create", "set", "render", "match", "query"]);
export const MCP_CODES = Object.freeze({
  DO_MD_USER_ERROR: "DO_MD_USER_ERROR",
  DO_MD_TIMEOUT: "DO_MD_TIMEOUT",
  DO_MD_INTERNAL_ERROR: "DO_MD_INTERNAL_ERROR",
});

const LIBRARY_CODES = new Set(Object.values(ERROR_CODES));
const HANDLERS = Object.freeze({
  validate: handleValidate,
  export: handleExport,
  create: handleCreate,
  set: handleSet,
  render: handleRender,
  match: handleMatch,
  query: handleQuery,
});
const jsonObject = z.record(z.string(), z.json());

const TOOL_DEFINITIONS = Object.freeze({
  validate: {
    description: "Validate a Markdown file against a template",
    inputSchema: z.strictObject({
      file: z.string().min(1),
      template: z.string().min(1),
      options: jsonObject.optional(),
    }),
  },
  export: {
    description: "Parse a Markdown file and return its context inline",
    inputSchema: z.strictObject({
      file: z.string().min(1),
      template: z.string().min(1),
      options: jsonObject.optional(),
    }),
  },
  create: {
    description: "Render a template with JSON data, optionally writing a file",
    inputSchema: z.strictObject({
      template: z.string().min(1),
      data: jsonObject,
      file: z.string().min(1).optional(),
      force: z.boolean().default(false),
    }),
  },
  set: {
    description: "Mutate a Markdown file and return the rewritten text",
    inputSchema: z.strictObject({
      file: z.string().min(1),
      template: z.string().min(1),
      key: z.string().min(1).optional(),
      value: z.json().optional(),
      patch: jsonObject.optional(),
      out: z.string().min(1).optional(),
      dryRun: z.boolean().default(false),
    }),
  },
  render: {
    description: "Parse with one template and render with another",
    inputSchema: z.strictObject({
      file: z.string().min(1),
      parseTemplate: z.string().min(1),
      renderTemplate: z.string().min(1),
      outFile: z.string().min(1),
      dryRun: z.boolean().default(false),
    }),
  },
  match: {
    description: "Find templates that fully match a Markdown file",
    inputSchema: z.strictObject({
      file: z.string().min(1),
      templates: z.string().min(1),
      all: z.boolean().default(false),
      options: jsonObject.optional(),
    }),
  },
  query: {
    description: "Find content occurrences using a query template",
    inputSchema: z.strictObject({
      file: z.string().min(1),
      template: z.string().min(1),
      all: z.boolean().default(false),
      options: jsonObject.optional(),
    }),
  },
});

function flagValue(argv, index, name) {
  const arg = String(argv[index]);
  const prefix = `${name}=`;
  if (arg.startsWith(prefix)) {
    const value = arg.slice(prefix.length);
    if (value === "") throw new Error(`${name} requires a value`);
    return { value, consumed: 0 };
  }
  const value = argv[index + 1];
  if (value == null || String(value).startsWith("--")) throw new Error(`${name} requires a value`);
  return { value, consumed: 1 };
}

function nonNegativeInteger(value, name) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
  return number;
}

export function parseArgv(argv = []) {
  const options = {
    root: null,
    maxInputBytes: DEFAULT_MAX_INPUT_BYTES,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    noSnippets: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = String(argv[i]);
    if (arg === "--root" || arg.startsWith("--root=")) {
      const parsed = flagValue(argv, i, "--root");
      options.root = parsed.value;
      i += parsed.consumed;
    } else if (arg === "--max-input-bytes" || arg.startsWith("--max-input-bytes=")) {
      const parsed = flagValue(argv, i, "--max-input-bytes");
      options.maxInputBytes = nonNegativeInteger(parsed.value, "--max-input-bytes");
      i += parsed.consumed;
    } else if (arg === "--timeout-ms" || arg.startsWith("--timeout-ms=")) {
      const parsed = flagValue(argv, i, "--timeout-ms");
      options.timeoutMs = nonNegativeInteger(parsed.value, "--timeout-ms");
      i += parsed.consumed;
    } else if (arg === "--no-snippets") {
      options.noSnippets = true;
    } else {
      throw new Error(`unknown option: ${arg}`);
    }
  }
  return options;
}

function singleLine(message) {
  const text = message == null ? "" : String(message);
  return text.replace(/[\r\n]+/g, " ").trim() || "Unknown do-md error";
}

export function mcpDiagnostic(code, message, extra = {}) {
  return {
    code,
    message: singleLine(message),
    file: extra.file ?? extra.path ?? null,
    line: Number.isInteger(extra.line) && extra.line >= 1 ? extra.line : 1,
    column: Number.isInteger(extra.column) && extra.column >= 1 ? extra.column : 1,
    snippet: extra.snippet == null ? null : String(extra.snippet),
  };
}

export function stripDiagnosticSnippets(errors) {
  const list = Array.isArray(errors) ? errors : errors == null ? [] : [errors];
  return list.map((error) => (error && typeof error === "object" ? { ...error, snippet: null } : error));
}

function isKnownDiagnosticCode(code) {
  return code === MCP_CODES.DO_MD_TIMEOUT || code === MCP_CODES.DO_MD_INTERNAL_ERROR || LIBRARY_CODES.has(code);
}

export function toMcpDiagnostic(error, { fallbackInternal = true } = {}) {
  if (error && typeof error.toDiagnostic === "function") {
    return toMcpDiagnostic(error.toDiagnostic(), { fallbackInternal: false });
  }
  if (error && typeof error === "object" && isKnownDiagnosticCode(error.code)) {
    return mcpDiagnostic(error.code, error.message, error);
  }
  const extra = error && typeof error === "object" ? error : {};
  const code = fallbackInternal ? MCP_CODES.DO_MD_INTERNAL_ERROR : MCP_CODES.DO_MD_USER_ERROR;
  return mcpDiagnostic(code, error?.message ?? error, extra);
}

export async function resolveRoot(root) {
  if (root == null || String(root).trim() === "") throw new Error("--root is required");
  const absolute = resolve(String(root));
  let info;
  try {
    info = await stat(absolute);
  } catch {
    throw new Error(`--root does not exist: ${root}`);
  }
  if (!info.isDirectory()) throw new Error(`--root is not a directory: ${root}`);
  return realpath(absolute);
}

function emptyResult(name) {
  switch (name) {
    case "export": return { ok: false, context: null, errors: [] };
    case "create": return { ok: false, output: null, wrote: null, errors: [] };
    case "set": return { ok: false, output: null, wrote: null, context: null, errors: [] };
    case "render": return { ok: false, output: null, wrote: null, errors: [] };
    case "match":
    case "query": return { ok: false, matches: [], errors: [] };
    default: return { ok: false, errors: [] };
  }
}

function raceTimeout(promise, timeoutMs) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error("tool call timed out");
      error.code = MCP_CODES.DO_MD_TIMEOUT;
      reject(error);
    }, timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export class Server {
  constructor(options = {}) {
    this.root = options.root ?? null;
    this.maxInputBytes = options.maxInputBytes ?? DEFAULT_MAX_INPUT_BYTES;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.noSnippets = options.noSnippets === true;
    this.handlers = { ...HANDLERS, ...(options.handlers ?? {}) };
    this._customHandlers = options.handlers != null;
    this._protocol = null;
  }

  toolNames() { return [...TOOL_NAMES]; }

  toolDefinitions() {
    return TOOL_NAMES.map((name) => ({ name, ...TOOL_DEFINITIONS[name] }));
  }

  toolContext(extra = {}) {
    return {
      root: this.root,
      maxInputBytes: this.maxInputBytes,
      timeoutMs: this.timeoutMs,
      noSnippets: this.noSnippets,
      ...extra,
    };
  }

  async callTool(name, params = {}) {
    const handler = this.handlers[name];
    if (typeof handler !== "function") {
      return this._failure(name, mcpDiagnostic(MCP_CODES.DO_MD_USER_ERROR, `unknown tool: ${name ?? ""}`));
    }
    try {
      const running = Promise.resolve().then(() => handler(params, this.toolContext()));
      return this._shapeResult(name, await raceTimeout(running, this.timeoutMs));
    } catch (error) {
      return this._failure(name, toMcpDiagnostic(error));
    }
  }

  async start() {
    this.root = await resolveRoot(this.root);
    this._protocol = new McpServer({ name: "do-md", version: "1.1.0" });
    for (const name of TOOL_NAMES) {
      const definition = TOOL_DEFINITIONS[name];
      this._protocol.registerTool(name, definition, async (params, extra) => {
        const result = this._customHandlers
          ? await this.callTool(name, params)
          : await this._callIsolated(name, params, extra.signal);
        return {
          content: [{ type: "text", text: JSON.stringify(result) }],
          isError: result.ok === false,
        };
      });
    }
    await this._protocol.connect(new StdioServerTransport());
    return new Promise((resolveDone) => {
      let done = false;
      const finish = async () => {
        if (done) return;
        done = true;
        await this.close();
        resolveDone();
      };
      if (process.stdin.readableEnded) void finish();
      else process.stdin.once("end", () => void finish());
    });
  }

  async close() {
    const protocol = this._protocol;
    this._protocol = null;
    if (protocol) await protocol.close();
  }

  async _callIsolated(name, params, signal) {
    const worker = new Worker(new URL("./Worker.mjs", import.meta.url), {
      workerData: { name, params, context: this.toolContext() },
      stdout: true,
      stderr: true,
    });
    worker.stdout?.on("data", (chunk) => process.stderr.write(chunk));
    worker.stderr?.on("data", (chunk) => process.stderr.write(chunk));

    return new Promise((resolveResult) => {
      let settled = false;
      const finish = async (result) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
        await worker.terminate().catch(() => {});
        resolveResult(result);
      };
      const timeout = () => finish(this._failure(name, mcpDiagnostic(MCP_CODES.DO_MD_TIMEOUT, "tool call timed out")));
      const abort = () => finish(this._failure(name, mcpDiagnostic(MCP_CODES.DO_MD_TIMEOUT, "tool call cancelled")));
      const timer = setTimeout(timeout, this.timeoutMs);
      signal?.addEventListener("abort", abort, { once: true });
      worker.once("message", (message) => finish(this._shapeResult(name, message)));
      worker.once("error", (error) => finish(this._failure(name, toMcpDiagnostic(error))));
      worker.once("exit", (code) => {
        if (!settled) finish(this._failure(name, mcpDiagnostic(MCP_CODES.DO_MD_INTERNAL_ERROR, `tool worker exited with code ${code}`)));
      });
    });
  }

  _shapeResult(name, result) {
    if (result == null || typeof result !== "object") {
      return this._failure(name, mcpDiagnostic(MCP_CODES.DO_MD_INTERNAL_ERROR, "invalid tool result"));
    }
    const shaped = emptyResult(name);
    shaped.ok = result.ok === true;
    shaped.errors = this._normalizeErrors(result.errors);
    for (const key of ["output", "context", "wrote", "matches"]) {
      if (Object.hasOwn(shaped, key)) shaped[key] = result[key] ?? null;
    }
    return this._finalizeResult(shaped);
  }

  _failure(name, diagnostic) {
    const shaped = emptyResult(name);
    shaped.errors = [toMcpDiagnostic(diagnostic, { fallbackInternal: false })];
    return this._finalizeResult(shaped);
  }

  _finalizeResult(result) {
    if (this.noSnippets) result.errors = stripDiagnosticSnippets(result.errors);
    return result;
  }

  _normalizeErrors(errors) {
    const list = Array.isArray(errors) ? errors : errors == null ? [] : [errors];
    return list.map((error) => toMcpDiagnostic(error, { fallbackInternal: false }));
  }
}
