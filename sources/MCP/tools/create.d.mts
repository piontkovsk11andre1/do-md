import type { Diagnostic } from "../../types.d.mts";
import type { McpToolContext } from "./helpers.mjs";
export function handleCreate(params?: { template?: string; data?: Record<string, unknown>; file?: string; force?: boolean; options?: Record<string, unknown> }, context?: McpToolContext): Promise<{ ok: boolean; output: string | null; wrote: string | null; errors: Diagnostic[] }>;
