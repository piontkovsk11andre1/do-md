import type { CommandOptions, IOAdapter } from "../../types.d.mts";
export const INLINE_OUTPUT: "__do_md_mcp_inline__";
export interface McpToolContext {
  root?: string | null;
  maxInputBytes?: number;
  io?: IOAdapter;
  [key: string]: unknown;
}
export function ioOf(context?: McpToolContext): IOAdapter;
export function cwdOf(context?: McpToolContext): string | null | undefined;
export function commandOptions(
  params?: { options?: CommandOptions },
  context?: McpToolContext,
): CommandOptions;
export function commandIo(
  io: IOAdapter,
  options?: { suppressWrites?: boolean; hidePaths?: string[] },
): IOAdapter;
export function missingArg(name: string): never;
export function resolveToolPath(
  context: McpToolContext,
  value: unknown,
  name: string,
): Promise<string>;
export function resolveToolPattern(
  context: McpToolContext,
  value: unknown,
  name: string,
): Promise<string>;
export function hasOwnPath(value: unknown): boolean;
