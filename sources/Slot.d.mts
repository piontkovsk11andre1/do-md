import type { LeafType, MarkdownNode } from "./types.d.mts";
export interface SlotOwner {
  readonly mode: "reader" | "writer";
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
export function registerBinding(
  owner: SlotOwner | null | undefined,
  key: string,
  mode: "as" | "asArray",
): void;
export class Slot<T = unknown> {
  constructor(pathOrOwner?: string | SlotOwner, options?: SlotOptions<T>);
  path: string;
  leafType: LeafType;
  value: T | null | undefined;
  owner: SlotOwner | null;
  sourceOffsetStart: number | null;
  sourceOffsetEnd: number | null;
  node: MarkdownNode | null;
  exists: boolean;
  headingLevel?: number;
  frontmatterOptions?: unknown;
  trim(): this;
  notEmpty(): this;
  validate(fn: (value: T | undefined) => boolean | void): this;
  default(value: T): this;
  as(key: string): this;
  asArray(key: string): this;
}
