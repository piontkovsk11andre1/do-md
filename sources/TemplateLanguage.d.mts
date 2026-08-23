export interface TemplateFunctionReference { readonly name: string; readonly category: string; readonly signature: string; readonly summary: string; readonly value: string; readonly example: string; }
export interface TemplateModifierReference { readonly name: string; readonly signature: string; readonly summary: string; readonly example: string; }
export interface TemplateLanguageReference {
  readonly version: string;
  readonly syntax: Readonly<Record<string, string>>;
  readonly globals: readonly Readonly<{ name: string; summary: string }>[];
  readonly functions: readonly TemplateFunctionReference[];
  readonly modifiers: readonly TemplateModifierReference[];
  readonly valueShapes: Readonly<Record<string, string>>;
  readonly advanced: Readonly<{ reader: readonly string[]; writer: readonly string[] }>;
  readonly examples: readonly Readonly<{ name: string; summary: string; template: string }>[];
  readonly caveats: readonly string[];
}
export const templateLanguage: TemplateLanguageReference;
export function listTemplateFunctions(): string[];
export function describeTemplateFunction(name: unknown): TemplateFunctionReference | TemplateModifierReference | null;
export function renderTemplateReference(options?: { topic?: string | null; format?: "text" | "markdown" | "json" }): string | null;
