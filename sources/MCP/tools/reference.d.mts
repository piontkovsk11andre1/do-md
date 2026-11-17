export interface ReferenceToolResult {
  ok: boolean;
  reference: unknown;
  errors: unknown[];
}
export function handleReference(
  params?: { topic?: string; format?: "json" | "markdown" | "text" },
  context?: unknown,
): Promise<ReferenceToolResult>;
