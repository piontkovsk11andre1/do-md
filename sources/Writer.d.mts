import { Slot } from "./Slot.mjs";
import type {
  CodeBlockValue,
  DocumentNode,
  FrontmatterValue,
  ImageValue,
  LinkValue,
  ListTreeValue,
  MarkdownNode,
  OutputRegionMetadata,
  SafeParseSchema,
  TableValue,
  WriterOptions,
} from "./types.d.mts";
export class Writer<TData extends Record<string, unknown> = Record<string, unknown>> {
  readonly mode: "writer";
  constructor(data?: TData, options?: WriterOptions);
  data: TData;
  context: TData;
  options: WriterOptions;
  buffer: string[];
  nodes: MarkdownNode[];
  regionMap: OutputRegionMetadata[];
  optionalMode: boolean;
  write(text?: unknown): this;
  literal(text: unknown): this;
  line(): Slot<string>;
  text(limiter?: unknown): Slot<string>;
  until(limiter?: unknown): Slot<string>;
  regexp(re?: RegExp | string): Slot<string>;
  heading(level?: number): Slot<string>;
  paragraph(): Slot<string>;
  list(): Slot<string[]>;
  listTree(): Slot<ListTreeValue>;
  frontmatter<T extends Record<string, unknown> = Record<string, unknown>>(
    options?: SafeParseSchema<T> | { schema?: SafeParseSchema<T> },
  ): Slot<FrontmatterValue<T> | T>;
  rawUntil(limiter?: unknown): Slot<string>;
  rawUntilElement(type: unknown): Slot<string>;
  rawBlock(): Slot<string>;
  rawRest(): Slot<string>;
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
  query(fn: (writer: this) => void): this;
  skipUntilHeading(predicate?: unknown): false;
  optional(): this;
  optional(fn: (writer: this) => void): boolean;
  scope<K extends keyof TData & string>(
    key: K,
    fn: (writer: Writer<Record<string, unknown>>, index: number) => void,
  ): void;
  repeat(fn: (writer: this, index: number) => unknown): void;
  serializeSlotValue(slot: Slot<unknown>, value: unknown): string;
  serializeTableValue(value: TableValue): string;
  serializeCodeBlockValue(value: CodeBlockValue): string;
  serializeLinkValue(value: LinkValue): string;
  serializeImageValue(value: ImageValue): string;
  writeHeading(level: number, text: unknown): this;
  writeParagraph(text: unknown): this;
  writeText(text: unknown): this;
  writeLine(text: unknown): this;
  writeNewline(count?: number): this;
  writeList(items: unknown[]): this;
  writeTable(table: TableValue): this;
  writeCodeBlock(value: unknown, language?: unknown): this;
  writeBlockQuote(value: unknown): this;
  writeThematicBreak(): this;
  writeHtmlBlock(value: unknown): this;
  writeLink(href: unknown, text: unknown, title?: unknown): this;
  writeImage(src: unknown, alt: unknown, title?: unknown): this;
  writeAutolink(url: unknown): this;
  writeCodeSpan(value: unknown): this;
  writeEmphasis(text: unknown): this;
  writeStrong(text: unknown): this;
  writeCheckbox(checked: unknown): this;
  append(node: MarkdownNode | null): this;
  toMarkdown(): string;
  toString(): string;
  toAst(): DocumentNode;
}
