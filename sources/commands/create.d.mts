import type { CommandResult, CreateOptions } from "../types.d.mts";
export function create<TData extends Record<string, unknown> = Record<string, unknown>>(
  options: CreateOptions<TData>,
): Promise<CommandResult<never>>;
