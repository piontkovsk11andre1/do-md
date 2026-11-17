// Generated from checked JSDoc by npm run types. Do not edit.
import { SourceMap } from "./SourceMap.mjs";
/**
 * Translate literal runs and JS blocks in one pass. Segment offsets are recorded
 * when emitting code, so trimming delimiters/newlines never loses provenance.
 * Exact segments describe copied JS; generated literal calls retain whole spans.
 * @param {unknown} source @param {string} file
 */
export declare function compileTemplateSource(
  source: unknown,
  file: string,
): {
  code: string;
  sourceMap: SourceMap;
};
