import type { LeafType, MarkdownNode, SlotMetadata } from "./types.d.mts";
import type { SourceText } from "./SourceText.mjs";
import type { DoMdError } from "./DoMdError.mjs";

export type BindingMode = "as" | "asArray";
export interface SlotDescription {
  readonly path: string;
  readonly leafType: LeafType;
  readonly sourceOffsetStart: number | null;
  readonly sourceOffsetEnd: number | null;
  readonly node: MarkdownNode | null;
  readonly exists: boolean;
  readonly headingLevel?: number | undefined;
  readonly frontmatterOptions?: unknown;
}
/** Shared binding protocol. Runtime owners are explicit; capabilities are optional. */
export interface SlotOwner {
  readonly mode: "reader" | "writer";
  context?: Record<string, unknown>;
  data?: Record<string, unknown> | null;
  bindings?: Map<string, BindingMode>;
  optionalMode?: boolean;
  repeatIndex?: number | undefined;
  file?: string | null;
  lineNumber?: number;
  char?: number;
  offset?: number;
  sourceText?: SourceText;
  diagnosticSource?: SourceText;
  diagnosticOffsetBase?: number;
  slotMap?: SlotMetadata[];
  slotPathPrefix?: string;
  _matchedBinds?: number;
  _usedAsArray?: boolean;
  buffer?: string[];
  recordSlotBinding?(slot: SlotDescription, mode: BindingMode): void;
  emitBoundValue?(slot: SlotDescription, value: unknown): void;
  write?(text: string): unknown;
  noteWriterMiss?(mode: BindingMode): void;
  noteWriterBind?(): void;
  error?(message: string): DoMdError;
  withReadSession?<R>(fn: () => R): R;
}
export interface SlotOptions<T> {
  owner?: SlotOwner | null;
  path?: string;
  leafType?: LeafType;
  value?: T | null;
  matched?: boolean;
  sourceOffsetStart?: number | null;
  sourceOffsetEnd?: number | null;
  node?: MarkdownNode | null;
}
export interface ExecutableDocument {
  withReadSession?<R>(fn: () => R): R;
  mode?: "reader" | "writer";
  errors?: DoMdError[];
  offset?: number;
  sourceText?: SourceText;
  diagnosticSource?: SourceText;
  diagnosticOffsetBase?: number;
}
