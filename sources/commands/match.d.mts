import type { CommandResult, MatchContext, MatchOptions } from "../types.d.mts";
export function match(options: MatchOptions): Promise<CommandResult<MatchContext>>;
