import type { CommandResult, ErrorCode } from "./types.d.mts";
export const USAGE: string;
export function formatUsage(): string;
export function coerceValue(value: unknown): unknown;
export function toExitCode(errorCode: ErrorCode | string): 1 | 2 | 3 | 4;
export function exitFromResult(result: Partial<CommandResult>): number;
export function execute(argv?: string[]): Promise<number>;
