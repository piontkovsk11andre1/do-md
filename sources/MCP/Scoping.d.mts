import type { ErrorCode } from "../types.d.mts";
export interface ScopeError extends Error {
  code: ErrorCode;
  file: string | null;
  line: 1;
  column: 1;
  snippet: null;
}
export function isWithinRoot(rootPath: unknown, candidatePath: unknown): boolean;
export function ensureWithinRoot(rootPath: unknown, targetPath: unknown): boolean;
export function scopeError(path: unknown, message?: unknown): ScopeError;
export function resolveScopedPath(rootPath: unknown, targetPath: string): Promise<string>;
