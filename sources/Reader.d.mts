import { Slot } from "./Slot.mjs";
import { DoMdError } from "./DoMdError.mjs";
import type {
  CodeBlockValue,
  CursorSnapshot,
  DocumentNode,
  FrontmatterValue,
  HeadingNode,
  ImageValue,
  LinkValue,
  ListTreeValue,
  QueryRegionMetadata,
  ReaderOptions,
  RegionMetadata,
  SafeParseSchema,
  SlotMetadata,
  TableValue,
} from "./types.d.mts";
export class Reader<TContext extends Record<string, unknown> = Record<string, unknown>> {
  readonly mode: "reader";
  constructor(source?: unknown, options?: ReaderOptions);
  inputSourceText: string;
  source: string;
  options: ReaderOptions;
  file: string | null;
  offset: number;
  position: number;
  char: number;
  optionalMode: boolean;
  context: TContext;
  errors: DoMdError[];
  data: null;
  slotMap: SlotMetadata[];
  regionMap: RegionMetadata[];
  queryMap: QueryRegionMetadata[];
  bindings: Map<string, "as" | "asArray">;
  static fromMarkdown(source?: unknown, options?: ReaderOptions): DocumentNode;
  reset(): void;
  remaining(): string;
  snapshotCursor(): CursorSnapshot;
  restoreCursor(cursor: CursorSnapshot): this;
  advanceTo(end: number): this;
  required(): this;
  error(message: unknown): DoMdError;
  parse(literal: unknown): this;
  parseRegExp(re: RegExp | string): Slot<string>;
  parseUntil(limiter: unknown): Slot<string>;
  allowWhitespaces(): this;
  allowNewlines(): this;
  allowNewlinesAndWhitespaces(): this;
  parseOneOf(...fns: Array<(reader: this) => unknown>): Slot<string>;
  parseDocument(): DocumentNode;
  literal(text: unknown): this;
  line(): Slot<string>;
  until(limiter: unknown): Slot<string>;
  rawUntil(limiter: unknown): Slot<string>;
  rawUntilElement(type: unknown): Slot<string>;
  rawBlock(): Slot<string>;
  rawRest(): Slot<string>;
  regexp(re: RegExp | string): Slot<string>;
  text(limiter?: unknown): Slot<string>;
  heading(level?: 1 | 2 | 3 | 4 | 5 | 6): Slot<string>;
  paragraph(): Slot<string>;
  list(): Slot<string[]>;
  listTree(): Slot<ListTreeValue>;
  frontmatter<T extends Record<string, unknown> = Record<string, unknown>>(
    options?: SafeParseSchema<T> | { schema?: SafeParseSchema<T> },
  ): Slot<FrontmatterValue<T>>;
  table(): Slot<TableValue>;
  codeBlock(): Slot<CodeBlockValue>;
  blockQuote(): Slot<string>;
  thematicBreak(): Slot<true>;
  htmlBlock(): Slot<string>;
  link(): Slot<LinkValue>;
  image(): Slot<ImageValue>;
  autolink(): Slot<string>;
  codeSpan(): Slot<string>;
  checkbox(): Slot<boolean>;
  query(fn: (reader: this) => void): this;
  optional(): this;
  optional(fn: (reader: this) => void): boolean;
  scope(key: string, fn: (reader: Reader<Record<string, unknown>>, index: number) => void): void;
  repeat(fn: (reader: this, index: number) => unknown): TContext[];
  skipUntilHeading(
    predicate?: string | ((heading: { level: number; text: string; node: HeadingNode }) => boolean),
  ): boolean;
  assertConsumed(options?: { trailingWhitespace?: boolean }): boolean;
  fork(): Reader<Record<string, unknown>>;
}
