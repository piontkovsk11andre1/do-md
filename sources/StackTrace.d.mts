import type { SourceText } from "./SourceText.mjs";
export function captureDiagnosticStack(error: Error, constructor: Function): void;
export function generatedOffset(
  stack: string | null | undefined,
  source: SourceText,
): number | null;
export function locationFromStack(
  stack?: string | null,
  preferredFile?: string | null,
): { file: string | null; line: number; column: number };
