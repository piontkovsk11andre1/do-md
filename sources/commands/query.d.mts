import type { CommandResult, QueryContext, QueryOptions } from "../types.d.mts";
export function query(options: QueryOptions): Promise<CommandResult<QueryContext>>;
