import type { Diagnostic } from "../../types.d.mts";
import type { McpToolContext } from "./helpers.mjs";
export function handleSet(
  params?: {
    file?: string;
    template?: string;
    key?: string;
    value?: unknown;
    patch?: Record<string, unknown>;
    out?: string;
    dryRun?: boolean;
    options?: Record<string, unknown>;
  },
  context?: McpToolContext,
): Promise<{
  ok: boolean;
  output: string | null;
  wrote: string | null;
  context: unknown;
  errors: Diagnostic[];
}>;
