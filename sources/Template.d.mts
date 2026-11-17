import type { TemplateFunction, IOAdapter } from "./types.d.mts";
import type { CompiledTemplate } from "./CompiledTemplate.mjs";
export function compileTemplate(source: unknown, options?: { file?: string }): CompiledTemplate;
export function runTemplate<TContext extends Record<string, unknown>>(
  fn: TemplateFunction<TContext>,
  doc: unknown,
  ctx: TContext,
  data: TContext | null,
  options?: Record<string, unknown>,
  io?: IOAdapter,
  templatePath?: string,
): unknown;
export const TEMPLATE_SOURCE_URL: "//# sourceURL=";
export function renderBlocks(source: unknown): string;
export class Template {
  constructor(source?: unknown, options?: { file?: string });
  source: string;
  file: string;
  static readonly sourceDirective: typeof TEMPLATE_SOURCE_URL;
  static renderBlocks(source: unknown): string;
  static compile(source: unknown, options?: { file?: string }): CompiledTemplate;
  static compilation(fn: Function): CompiledTemplate | null;
  static wrap<TContext extends Record<string, unknown> = Record<string, unknown>>(
    source: unknown,
    path?: string,
  ): TemplateFunction<TContext>;
  renderBlocks(): string;
  compile(): CompiledTemplate;
  wrap<
    TContext extends Record<string, unknown> = Record<string, unknown>,
  >(): TemplateFunction<TContext>;
}
