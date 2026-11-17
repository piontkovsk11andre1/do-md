import type { CommandResult, ExportOptions } from "../types.d.mts";
export function exportDoc<TContext extends Record<string, unknown> = Record<string, unknown>>(
  options: ExportOptions,
): Promise<CommandResult<TContext>>;
