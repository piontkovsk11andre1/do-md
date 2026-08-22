import type { McpResult, ToolContext } from "../Server.mjs";
export interface MatchToolParams {
  file: string;
  templates: string;
  all?: boolean;
  options?: Record<string, unknown>;
}
export function handleMatch(params?: Partial<MatchToolParams>, context?: Partial<ToolContext>): Promise<McpResult & { matches: string[] }>;
