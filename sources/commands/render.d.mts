import type { CommandResult, RenderOptions } from "../types.d.mts";
export function render<TContext extends Record<string, unknown> = Record<string, unknown>>(
  options: RenderOptions,
): Promise<CommandResult<TContext>>;
