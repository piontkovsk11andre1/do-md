import type { Diagnostic, IOAdapter } from "../types.d.mts";
export const DEFAULT_MAX_INPUT_BYTES: 1048576;
export const DEFAULT_TIMEOUT_MS: 30000;
export const TOOL_NAMES: readonly ["validate", "export", "create", "set", "render", "match", "query", "reference"];
export const MCP_CODES: Readonly<{
  DO_MD_USER_ERROR: "DO_MD_USER_ERROR";
  DO_MD_TIMEOUT: "DO_MD_TIMEOUT";
  DO_MD_INTERNAL_ERROR: "DO_MD_INTERNAL_ERROR";
}>;
export type ToolName = typeof TOOL_NAMES[number];
export type ToolHandler = (params: Record<string, unknown>, context: ToolContext) => unknown | Promise<unknown>;
export interface ToolContext {
  root: string | null;
  maxInputBytes: number;
  timeoutMs: number;
  noSnippets: boolean;
  io?: IOAdapter;
  [key: string]: unknown;
}
export interface ServerOptions {
  root?: string | null;
  maxInputBytes?: number;
  timeoutMs?: number;
  noSnippets?: boolean;
  handlers?: Partial<Record<ToolName, ToolHandler>>;
}
export interface McpResult {
  ok: boolean;
  output?: string | null;
  context?: unknown;
  matches?: unknown[];
  reference?: unknown;
  wrote?: string | null;
  errors: Diagnostic[];
}
export function parseArgv(argv?: string[]): Required<Pick<ServerOptions, "root" | "maxInputBytes" | "timeoutMs" | "noSnippets">>;
export function mcpDiagnostic(code: string, message: unknown, extra?: Partial<Diagnostic> & { path?: string }): Diagnostic;
export function stripDiagnosticSnippets(errors: Diagnostic | readonly Diagnostic[] | null): Diagnostic[];
export function toMcpDiagnostic(error: unknown, options?: { fallbackInternal?: boolean }): Diagnostic;
export function resolveRoot(root: unknown): Promise<string>;
export class Server {
  constructor(options?: ServerOptions);
  root: string | null;
  maxInputBytes: number;
  timeoutMs: number;
  noSnippets: boolean;
  handlers: Record<string, ToolHandler>;
  toolNames(): ToolName[];
  toolDefinitions(): Array<{ name: ToolName; description: string; inputSchema: unknown }>;
  toolContext(extra?: Record<string, unknown>): ToolContext;
  callTool(name: string, params?: Record<string, unknown>): Promise<McpResult>;
  start(): Promise<void>;
  close(): Promise<void>;
}
