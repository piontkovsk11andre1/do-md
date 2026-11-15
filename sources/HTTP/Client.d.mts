import type { McpResult } from "../MCP/Server.d.mts";
export interface ClientOptions {
  url?: string;
  host?: string;
  port?: number;
  root: string;
  timeoutMs?: number;
  maxInputBytes?: number;
  maxResponseBytes?: number;
  noSnippets?: boolean;
}
export function remoteUrl(options?: Partial<ClientOptions>): string | null;
export class Client {
  constructor(options: ClientOptions);
  url: string;
  root: string;
  timeoutMs: number;
  maxResponseBytes: number;
  maxInputBytes: number;
  noSnippets: boolean;
  capabilities: Record<string, unknown> | null;
  request(path: string, options?: { body?: unknown; signal?: AbortSignal }): Promise<{ status: number; result: any }>;
  connect(): Promise<Record<string, any>>;
  call(name: string, params: Record<string, unknown>, signal?: AbortSignal): Promise<McpResult>;
}
