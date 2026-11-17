import { Chalk } from "chalk";
import { renderDiagnostic } from "./DiagnosticFormat.mjs";

/** Node presentation entry; the portable model never imports terminal libraries. */
export function formatDiagnostic(diagnostic, { colors = false, includeGenerated = false } = {}) {
  return renderDiagnostic(diagnostic, new Chalk({ level: colors ? 1 : 0 }), { includeGenerated });
}
