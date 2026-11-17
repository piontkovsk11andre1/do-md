import type { Diagnostic } from "./types.d.mts";
export interface DiagnosticFormatOptions {
  colors?: boolean;
  includeGenerated?: boolean;
}
export function formatDiagnostic(
  diagnostic: Pick<Diagnostic, "message" | "locations">,
  options?: DiagnosticFormatOptions,
): string;
