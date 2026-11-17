import type { Diagnostic } from "../../types.d.mts";
import type { McpToolContext } from "./helpers.mjs";
export function handleRender(
  params?: {
    file?: string;
    parseTemplate?: string;
    renderTemplate?: string;
    outFile?: string;
    dryRun?: boolean;
    options?: Record<string, unknown>;
  },
  context?: McpToolContext,
): Promise<{ ok: boolean; output: string | null; wrote: string | null; errors: Diagnostic[] }>;
