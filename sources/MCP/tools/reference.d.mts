export interface ReferenceToolResult {
  ok: boolean;
  reference: unknown;
  errors: unknown[];
}
export function handleReference(params?: { topic?: string }, context?: unknown): Promise<ReferenceToolResult>;
