import type { Diagnostic } from "./types.d.mts";
export interface DiagnosticFormatOptions {
  includeGenerated?: boolean;
}
export function renderDiagnostic(
  diagnostic: Pick<Diagnostic, "message" | "locations">,
  style: { dim(text: string): string; cyan(text: string): string; red(text: string): string },
  options?: DiagnosticFormatOptions,
): string;
export function formatDiagnostic(
  diagnostic: Pick<Diagnostic, "message" | "locations">,
  options?: DiagnosticFormatOptions,
): string;
