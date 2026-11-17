import type { Diagnostic, DiagnosticLocation, SourcePoint } from "./types.d.mts";
export interface SourceMap {
  generated: { source: string; text: string };
  original: { source: string; text: string };
  segments: SourceMapSegment[];
}
export interface SourceMapSegment {
  generatedStart: number;
  generatedEnd: number;
  originalStart: number;
  originalEnd: number;
  kind: "exact" | "range";
}
export function createSourceMap(map: SourceMap): SourceMap;
export function sourcePoint(text: string, offset: number): SourcePoint;
export function sourceOffset(text: string, point: { line: number; column: number }): number | null;
export function sourceLocation(source: string | null, text: string, start: number, end?: number | null, options?: Partial<Pick<DiagnosticLocation, "role" | "relation" | "precision">>): DiagnosticLocation;
export function mapPosition(map: SourceMap, offset: number): DiagnosticLocation | null;
export function mapRange(map: SourceMap, range: { start: number; end?: number | null }): DiagnosticLocation | null;
export function composeSourceMaps(inner: SourceMap, outer: SourceMap): SourceMap;
export function mapDiagnostic(diagnostic: Diagnostic | { toDiagnostic(): Diagnostic }, map: SourceMap, options?: { role?: DiagnosticLocation["role"] }): Diagnostic;
