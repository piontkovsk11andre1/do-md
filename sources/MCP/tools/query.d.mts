import type { McpResult, ToolContext } from "../Server.mjs";
import type { QueryMatch } from "../../types.d.mts";
export interface QueryToolParams {
  file: string;
  template: string;
  all?: boolean;
  options?: Record<string, unknown>;
}
export function handleQuery(
  params?: Partial<QueryToolParams>,
  context?: Partial<ToolContext>,
): Promise<McpResult & { matches: QueryMatch[] }>;
