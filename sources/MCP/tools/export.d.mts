import type { Diagnostic } from "../../types.d.mts";
import type { McpToolContext } from "./helpers.mjs";
export function handleExport(params?: { file?: string; template?: string; options?: Record<string, unknown> }, context?: McpToolContext): Promise<{ ok: boolean; context: unknown; errors: Diagnostic[] }>;
