import type { SourceMap } from "./SourceMap.mjs";
export function compileTemplateSource(
  source: unknown,
  file: string,
): { code: string; sourceMap: SourceMap };
