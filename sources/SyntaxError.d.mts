import type { Diagnostic, ErrorCode } from "./types.d.mts";
export type { Diagnostic, ErrorCode } from "./types.d.mts";

export const ERROR_CODES: Readonly<Record<ErrorCode, ErrorCode>>;
export interface DiagnosticLocation {
  file?: string | null;
  path?: string | null;
  line?: number;
  column?: number;
  char?: number;
  snippet?: string | null;
}
export class SyntaxError extends Error implements Diagnostic {
  constructor(diagnostic: Partial<Diagnostic> | string, fallback?: Partial<Diagnostic>);
  code: ErrorCode;
  file: string | null;
  line: number;
  column: number;
  snippet: string | null;
  errors?: SyntaxError[];
  toDiagnostic(): Diagnostic;
}
export function locationFromStack(stack?: string | null, preferredFile?: string | null): Required<Pick<Diagnostic, "file" | "line" | "column">>;
export function makeDiagnostic(message: unknown, code?: ErrorCode, location?: DiagnosticLocation): SyntaxError;
export function makeParseError(message: unknown, location?: DiagnosticLocation): SyntaxError;
export function makeTemplateError(message: unknown, location?: DiagnosticLocation): SyntaxError;
export function makeUserError(message: unknown, location?: DiagnosticLocation): SyntaxError;
export function makeNotImplementedError(feature?: string): SyntaxError;
export function createIoError(message?: unknown, code?: ErrorCode | DiagnosticLocation, location?: DiagnosticLocation): SyntaxError;
export function createConflictError(message?: unknown, location?: DiagnosticLocation): SyntaxError;
export function fromNativeError(error: unknown, options?: DiagnosticLocation & { code?: ErrorCode }): SyntaxError;
