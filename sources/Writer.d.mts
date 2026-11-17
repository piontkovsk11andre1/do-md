// Generated from checked JSDoc by npm run types. Do not edit.
import { Slot } from "./Slot.mjs";
export type MarkdownNode = import("./types.d.mts").MarkdownNode;
export type InlineNode = import("./types.d.mts").MarkdownInlineNode;
export type BlockNode = import("./types.d.mts").MarkdownBlockNode;
export type WriterOptions = import("./types.d.mts").WriterOptions;
export type SlotDescription = import("./RuntimeContracts.d.mts").SlotDescription;
export type OptionalFrame = {
  missed: boolean;
  bound: number;
};
/**
 * Render data through the same slot protocol as Reader. Bound values emit text;
 * optional/repeat frames stage buffers and regions before committing output.
 * Raw slots bypass EOL normalization to preserve retained source bytes.
 * @template {Record<string, unknown>} [TData=Record<string, unknown>]
 */
export declare class Writer<TData extends Record<string, unknown> = Record<string, unknown>> {
  data: TData;
  options: {
    [x: string]: unknown;
    sourceText?: import("./SourceText.mjs").SourceText;
    file?: string;
    path?: string;
    bullet?: string;
    orderedDelim?: string;
    fence?: string;
    headingStyle?: "atx" | "setext";
    tightLists?: boolean;
    tablePadding?: boolean;
    eol?: "\n" | "\r\n" | "\r";
  };
  context: TData;
  /** @type {string[]} */
  buffer: string[];
  /** @type {BlockNode[]} */
  nodes: BlockNode[];
  /** @type {import('./types.d.mts').ParagraphNode | null} */
  current: import("./types.d.mts").ParagraphNode | null;
  /** @type {Map<string, import('./RuntimeContracts.d.mts').BindingMode>} */
  bindings: Map<string, import("./RuntimeContracts.d.mts").BindingMode>;
  /** @type {import('./types.d.mts').OutputRegionMetadata[]} */
  regionMap: import("./types.d.mts").OutputRegionMetadata[];
  regionPathPrefix: string;
  optionalMode: boolean;
  /** @type {number | undefined} */
  repeatIndex: number | undefined;
  file: string | null;
  /** @internal @type {Writer | null} */
  _parent: Writer | null;
  /** @internal @type {OptionalFrame | null} */
  _optionalFrame: OptionalFrame | null;
  /** @internal */
  _repeatMissed: boolean;
  /** @returns {'writer'} */
  get mode(): "writer";
  /** @param {TData} [data] @param {WriterOptions} [options] */
  constructor(data?: TData, options?: WriterOptions);
  /** @param {unknown} [text] */
  write(text?: unknown): this;
  /** @param {unknown} [text] */
  writeRaw(text?: unknown): this;
  /** @param {unknown} text */
  literal(text: unknown): this;
  /** @returns {Slot<string>} */
  line(): Slot<string>;
  /** @param {unknown} [_limiter] @returns {Slot<string>} */
  text(_limiter?: unknown): Slot<string>;
  /** @param {unknown} [_limiter] @returns {Slot<string>} */
  until(_limiter?: unknown): Slot<string>;
  /** @param {RegExp | string} [_re] @returns {Slot<string>} */
  regexp(_re?: RegExp | string): Slot<string>;
  /** @param {number} [level] @returns {Slot<string>} */
  heading(level?: number): Slot<string>;
  /** @returns {Slot<string>} */
  paragraph(): Slot<string>;
  /** @returns {Slot<string[]>} */
  list(): Slot<string[]>;
  /** @returns {Slot<import('./types.d.mts').ListTreeValue>} */
  listTree(): Slot<import("./types.d.mts").ListTreeValue>;
  /** @template {Record<string, unknown>} [T=Record<string, unknown>]
   * @param {import('./types.d.mts').SafeParseSchema<T> | {schema?: import('./types.d.mts').SafeParseSchema<T>}} [options]
   * @returns {Slot<import('./types.d.mts').FrontmatterValue<T> | T>} */
  frontmatter<T extends Record<string, unknown> = Record<string, unknown>>(
    options?:
      | import("./types.d.mts").SafeParseSchema<T>
      | {
          schema?: import("./types.d.mts").SafeParseSchema<T>;
        },
  ): Slot<import("./types.d.mts").FrontmatterValue<T> | T>;
  /** @param {unknown} [_limiter] @returns {Slot<string>} */
  rawUntil(_limiter?: unknown): Slot<string>;
  /** @param {unknown} type @returns {Slot<string>} */
  rawUntilElement(type: unknown): Slot<string>;
  /** @returns {Slot<string>} */
  rawBlock(): Slot<string>;
  /** @returns {Slot<string>} */
  rawRest(): Slot<string>;
  /** @returns {Slot<import('./types.d.mts').TableValue>} */
  table(): Slot<import("./types.d.mts").TableValue>;
  /** @returns {Slot<import('./types.d.mts').CodeBlockValue>} */
  codeBlock(): Slot<import("./types.d.mts").CodeBlockValue>;
  /** @returns {Slot<string>} */
  blockQuote(): Slot<string>;
  /** @returns {Slot<true>} */
  thematicBreak(): Slot<true>;
  /** @returns {Slot<string>} */
  htmlBlock(): Slot<string>;
  /** @returns {Slot<import('./types.d.mts').LinkValue>} */
  link(): Slot<import("./types.d.mts").LinkValue>;
  /** @returns {Slot<import('./types.d.mts').ImageValue>} */
  image(): Slot<import("./types.d.mts").ImageValue>;
  /** @returns {Slot<string>} */
  autolink(): Slot<string>;
  /** @returns {Slot<string>} */
  codeSpan(): Slot<string>;
  /** @returns {Slot<boolean>} */
  checkbox(): Slot<boolean>;
  /** @param {(writer: this) => void} fn */
  query(fn: (writer: this) => void): this;
  /** @param {unknown} [_predicate] @returns {false} */
  skipUntilHeading(_predicate?: unknown): false;
  /** @param {import('./RuntimeContracts.d.mts').BindingMode} mode */
  noteWriterMiss(mode: import("./RuntimeContracts.d.mts").BindingMode): void;
  noteWriterBind(): void;
  /** Stage optional output; commit only a successful branch with bound data. */
  /** @overload @returns {this} */
  /** @overload @param {(writer: this) => void} fn @returns {boolean} */
  /** @param {((writer: this) => void)} [fn] @returns {this | boolean} */
  optional(): this;
  /** Stage optional output; commit only a successful branch with bound data. */
  /** @overload @returns {this} */
  /** @overload @param {(writer: this) => void} fn @returns {boolean} */
  /** @param {((writer: this) => void)} [fn] @returns {this | boolean} */
  optional(fn: (writer: this) => void): boolean;
  /** Child scopes share committed output but own independent binding registries. */
  /** @param {keyof TData & string} key @param {(writer: Writer, index: number) => void} fn */
  scope(key: keyof TData & string, fn: (writer: Writer, index: number) => void): void;
  /** Each array iteration stages output; a missing binding discards only that attempt. */
  /** @param {(writer: this, index: number) => unknown} fn */
  repeat(fn: (writer: this, index: number) => unknown): void;
  /** @param {SlotDescription} slot @param {unknown} value */
  emitBoundValue(slot: SlotDescription, value: unknown): void;
  /** @param {SlotDescription} slot @param {unknown} value @returns {string} */
  serializeSlotValue(slot: SlotDescription, value: unknown): string;
  /** @param {unknown} value */
  serializeTableValue(value: unknown): string;
  /** @param {unknown} value */
  serializeCodeBlockValue(value: unknown): string;
  /** @param {unknown} value */
  serializeLinkValue(value: unknown): string;
  /** @param {unknown} value */
  serializeImageValue(value: unknown): string;
  /** Record only after serializeSlotValue has validated the dynamic binding.
   * @private @param {SlotDescription} slot @param {unknown} value */
  private recordSlotNode;
  /** @param {number} level @param {unknown} text */
  writeHeading(level: number, text: unknown): this;
  /** @param {unknown} text */
  writeParagraph(text: unknown): this;
  /** @param {unknown} text */
  writeText(text: unknown): this;
  /** @param {unknown} text */
  writeLine(text: unknown): this;
  writeNewline(count?: number): this;
  /** @param {unknown[]} items */
  writeList(items: unknown[]): this;
  /** @param {import('./types.d.mts').TableValue} table */
  writeTable(table: import("./types.d.mts").TableValue): this;
  /** @param {unknown} value @param {unknown} [language] */
  writeCodeBlock(value: unknown, language?: unknown): this;
  /** @param {unknown} value */
  writeBlockQuote(value: unknown): this;
  writeThematicBreak(): this;
  /** @param {unknown} value */
  writeHtmlBlock(value: unknown): this;
  /** @param {unknown} href @param {unknown} text @param {unknown} [title] */
  writeLink(href: unknown, text: unknown, title?: unknown): this;
  /** @param {unknown} src @param {unknown} alt @param {unknown} [title] */
  writeImage(src: unknown, alt: unknown, title?: unknown): this;
  /** @param {unknown} url */
  writeAutolink(url: unknown): this;
  /** @param {unknown} value */
  writeCodeSpan(value: unknown): this;
  /** @param {unknown} text */
  writeEmphasis(text: unknown): this;
  /** @param {unknown} text */
  writeStrong(text: unknown): this;
  /** @param {unknown} checked */
  writeCheckbox(checked: unknown): this;
  /** @param {MarkdownNode | null} node */
  append(node: MarkdownNode | null): this;
  toMarkdown(): string;
  toString(): string;
  /** @returns {import('./types.d.mts').DocumentNode} */
  toAst(): import("./types.d.mts").DocumentNode;
  ensureParagraph(): import("./types.d.mts").ParagraphNode;
  /** @param {InlineNode} node */
  pushInline(node: InlineNode): void;
  closeCurrent(): void;
  ensureBlockStart(): void;
  ensureBlankLine(): void;
}
