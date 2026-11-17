import type { CommandResult, SetOptions } from "../types.d.mts";
export function set<TContext extends Record<string, unknown> = Record<string, unknown>>(
  options: SetOptions,
): Promise<CommandResult<TContext>>;
