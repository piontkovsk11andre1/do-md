import type { Diagnostic, DiagnosticLocation as Location, ErrorCode } from "./types.d.mts";
export type { Diagnostic, DiagnosticLocation, ErrorCode } from "./types.d.mts";

export const ERROR_CODES: Readonly<Record<ErrorCode, ErrorCode>>;
export interface DiagnosticFormatOptions {
  colors?: boolean;
  includeGenerated?: boolean;
}
export function formatDiagnostic(diagnostic: Pick<Diagnostic, "message" | "locations">, options?: DiagnosticFormatOptions): string;
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
export class SyntaxError extends Error implements Diagnostic {
  constructor(diagnostic: (Partial<Diagnostic> & DiagnosticOptions) | string, fallback?: Partial<Diagnostic> & DiagnosticOptions);
  code: ErrorCode;
  locations: Location[];
  errors?: SyntaxError[];
  toDiagnostic(): Diagnostic;
  toString(): string;
}
export function locationFromStack(stack?: string | null, preferredFile?: string | null): { file: string | null; line: number; column: number };
export function primaryLocation(diagnostic: { locations?: Location[] }): Location | null;
export function attachSource<T extends { locations?: Location[] }>(error: T, source: string): T;
export function addProcessingLocation<T extends { locations: Location[] }>(error: T, owner: { inputSourceText?: string; diagnosticSourceText?: string; diagnosticOffsetBase?: number; offset?: number; file?: string | null }, slot?: { sourceOffsetStart?: number | null; sourceOffsetEnd?: number | null } | null): T;
export function makeDiagnostic(message: unknown, code?: ErrorCode, location?: DiagnosticOptions): SyntaxError;
export function makeParseError(message: unknown, location?: DiagnosticOptions): SyntaxError;
export function makeTemplateError(message: unknown, location?: DiagnosticOptions): SyntaxError;
export function makeUserError(message: unknown, location?: DiagnosticOptions): SyntaxError;
export function makeNotImplementedError(feature?: string): SyntaxError;
export function createIoError(message?: unknown, code?: ErrorCode | DiagnosticOptions, location?: DiagnosticOptions): SyntaxError;
export function createConflictError(message?: unknown, location?: DiagnosticOptions): SyntaxError;
export function fromNativeError(error: unknown, options?: DiagnosticOptions & { code?: ErrorCode }): SyntaxError;
