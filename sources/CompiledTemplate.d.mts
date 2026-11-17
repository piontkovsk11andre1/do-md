import type { TemplateFunction, IOAdapter } from "./types.d.mts";
import type { SourceMap } from "./SourceMap.mjs";
export const TEMPLATE_SOURCE_URL: "//# sourceURL=";
export class CompiledTemplate<TContext extends Record<string, unknown> = Record<string, unknown>> {
  constructor(source: unknown, options?: { file?: string });
  readonly code: string;
  readonly sourceMap: SourceMap;
  execute(
    doc: Parameters<TemplateFunction<TContext>>[0],
    context: TContext,
    data: TContext | null,
    options?: Record<string, unknown>,
    io?: IOAdapter,
  ): unknown;
  toFunction(): TemplateFunction<TContext>;
  static forFunction(fn: Function): CompiledTemplate | null;
}
