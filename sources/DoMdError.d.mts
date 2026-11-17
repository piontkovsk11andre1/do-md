import type { Diagnostic, DiagnosticLocation as Location, ErrorCode } from "./types.d.mts";
export type { Diagnostic, DiagnosticLocation, ErrorCode } from "./types.d.mts";

export const ERROR_CODES: Readonly<Record<ErrorCode, ErrorCode>>;
export { formatDiagnostic } from "./DiagnosticFormat.mjs";
export { primaryLocation, attachSource, addProcessingLocation } from "./Diagnostics.mjs";
export { locationFromStack } from "./StackTrace.mjs";
export interface DiagnosticOptions {
  file?: string | null;
  path?: string | null;
  line?: number;
  column?: number;
  char?: number;
  snippet?: string | null;
  offset?: number | null;
  locations?: Location[];
  cause?: unknown;
  precision?: Location["precision"];
}
export class DoMdError extends Error implements Diagnostic {
  constructor(
    diagnostic: (Partial<Diagnostic> & DiagnosticOptions) | string,
    fallback?: Partial<Diagnostic> & DiagnosticOptions,
  );
  code: ErrorCode;
  locations: Location[];
  errors?: DoMdError[];
  toDiagnostic(): Diagnostic;
  toString(): string;
}
export function makeDiagnostic(
  message: unknown,
  code?: ErrorCode,
  location?: DiagnosticOptions,
): DoMdError;
export function makeParseError(message: unknown, location?: DiagnosticOptions): DoMdError;
export function makeTemplateError(message: unknown, location?: DiagnosticOptions): DoMdError;
export function makeUserError(message: unknown, location?: DiagnosticOptions): DoMdError;
export function makeNotImplementedError(feature?: string): DoMdError;
export function createIoError(
  message?: unknown,
  code?: ErrorCode | DiagnosticOptions,
  location?: DiagnosticOptions,
): DoMdError;
export function createConflictError(message?: unknown, location?: DiagnosticOptions): DoMdError;
export function fromNativeError(
  error: unknown,
  options?: DiagnosticOptions & { code?: ErrorCode },
): DoMdError;
