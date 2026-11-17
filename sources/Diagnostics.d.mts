import type { Diagnostic, DiagnosticLocation } from "./types.d.mts";
import type { SourceText } from "./SourceText.mjs";
export function diagnosticDocument(
  value: unknown,
): import("./RuntimeContracts.d.mts").ExecutableDocument | undefined;
export function primaryLocation(
  diagnostic: Pick<Diagnostic, "locations">,
): DiagnosticLocation | null;
export function attachSource<T extends { locations?: DiagnosticLocation[] }>(
  error: T,
  source: string,
): T;
export function sameLocation(left: DiagnosticLocation, right: DiagnosticLocation): boolean;
export function addProcessingLocation<T extends { locations: DiagnosticLocation[] }>(
  error: T,
  owner:
    | {
        mode?: string;
        sourceText?: SourceText;
        diagnosticSource?: SourceText;
        diagnosticOffsetBase?: number;
        offset?: number;
      }
    | null
    | undefined,
  slot?: { sourceOffsetStart?: number | null; sourceOffsetEnd?: number | null } | null,
): T;
