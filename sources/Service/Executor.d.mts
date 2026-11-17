import type { McpResult, ToolContext } from "../MCP/Server.d.mts";
export function execute(
  name: string,
  params: Record<string, unknown>,
  context: ToolContext,
  options?: { signal?: AbortSignal },
): Promise<McpResult>;
