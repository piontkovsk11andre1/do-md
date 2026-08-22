import type { TemplateFunction } from "./types.d.mts";
export const TEMPLATE_SOURCE_URL: "//# sourceURL=";
export function renderBlocks(source: unknown): string;
export class Template {
  constructor(source?: unknown, options?: { file?: string });
  source: string;
  file: string;
  static readonly sourceDirective: typeof TEMPLATE_SOURCE_URL;
  static renderBlocks(source: unknown): string;
  static wrap<TContext extends Record<string, unknown> = Record<string, unknown>>(source: unknown, path?: string): TemplateFunction<TContext>;
  renderBlocks(): string;
  wrap<TContext extends Record<string, unknown> = Record<string, unknown>>(): TemplateFunction<TContext>;
}
