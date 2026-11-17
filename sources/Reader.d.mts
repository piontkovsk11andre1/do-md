// Generated from checked JSDoc by npm run types. Do not edit.
import { CursorParser } from "./CursorParser.mjs";
import { Slot } from "./Slot.mjs";
export type MarkdownBlockNode = import("./types.d.mts").MarkdownBlockNode;
export type SlotMetadata = import("./types.d.mts").SlotMetadata;
export type SlotDescription = import("./RuntimeContracts.d.mts").SlotDescription;
/**
 * Stateful template reader. Slots and regions refer to the untouched input;
 * forks share source ownership but commit their cursor and metadata explicitly.
 * Optional/repeated attempts are transactions over the state snapshotted below.
 * @template {Record<string, unknown>} [TContext=Record<string, unknown>]
 * @extends {CursorParser<TContext>}
 */
export declare class Reader<
  TContext extends Record<string, unknown> = Record<string, unknown>,
> extends CursorParser<TContext> {
  /** @type {SlotMetadata[]} */
  slotMap: SlotMetadata[];
  /** @type {import('./types.d.mts').RegionMetadata[]} */
  regionMap: import("./types.d.mts").RegionMetadata[];
  /** @type {import('./types.d.mts').QueryRegionMetadata[]} */
  queryMap: import("./types.d.mts").QueryRegionMetadata[];
  data: null;
  slotPathPrefix: string;
  /** @param {unknown} [source] @param {import('./types.d.mts').ReaderOptions} [options] */
  constructor(source?: unknown, options?: import("./types.d.mts").ReaderOptions);
  reset(): this;
  /** @param {unknown} [source] @param {import('./types.d.mts').ReaderOptions} [options] */
  static fromMarkdown(
    source?: unknown,
    options?: import("./types.d.mts").ReaderOptions,
  ): import("./types.d.mts").DocumentNode;
  parseDocument(): import("./types.d.mts").DocumentNode;
  /** @param {unknown} text */
  literal(text: unknown): this;
  /** @returns {Slot<string>} */
  line(): Slot<string>;
  /** @param {unknown} limiter */
  until(limiter: unknown): Slot<string>;
  /** @param {unknown} limiter */
  rawUntil(limiter: unknown): Slot<string>;
  /** @param {unknown} type @returns {Slot<string>} */
  rawUntilElement(type: unknown): Slot<string>;
  /** @returns {Slot<string>} */
  rawBlock(): Slot<string>;
  rawRest(): Slot<string>;
  /** @param {RegExp | string} re */
  regexp(re: RegExp | string): Slot<string>;
  /** @param {unknown} [limiter] @returns {Slot<string>} */
  text(limiter?: unknown): Slot<string>;
  /** @param {1 | 2 | 3 | 4 | 5 | 6} [level] */
  heading(level?: 1 | 2 | 3 | 4 | 5 | 6): Slot<string>;
  paragraph(): Slot<string>;
  list(): Slot<string[]>;
  listTree(): Slot<import("./types.d.mts").ListTreeValue>;
  /** @template {Record<string, unknown>} [T=Record<string, unknown>]
   * @param {import('./types.d.mts').SafeParseSchema<T> | {schema?: import('./types.d.mts').SafeParseSchema<T>}} [options]
   * @returns {Slot<import('./types.d.mts').FrontmatterValue<T>>} */
  frontmatter<T extends Record<string, unknown> = Record<string, unknown>>(
    options?:
      | import("./types.d.mts").SafeParseSchema<T>
      | {
          schema?: import("./types.d.mts").SafeParseSchema<T>;
        },
  ): Slot<import("./types.d.mts").FrontmatterValue<T>>;
  /** @returns {Slot<import('./types.d.mts').TableValue>} */
  table(): Slot<import("./types.d.mts").TableValue>;
  codeBlock(): Slot<{
    language: string | null;
    meta: string;
    value: string;
  }>;
  /** @returns {Slot<string>} */
  blockQuote(): Slot<string>;
  /** @returns {Slot<true>} */
  thematicBreak(): Slot<true>;
  htmlBlock(): Slot<string>;
  link(): Slot<{
    url: string;
    text: string;
    title: string | null;
  }>;
  image(): Slot<{
    url: string;
    alt: string;
    title: string | null;
  }>;
  autolink(): Slot<string>;
  codeSpan(): Slot<string>;
  /** @returns {Slot<boolean>} */
  checkbox(): Slot<boolean>;
  /** @param {(reader: this) => void} fn */
  query(fn: (reader: this) => void): this;
  /** Commit a callback only if it binds data without a first miss or required error. */
  /** @overload @returns {this} */
  /** @overload @param {(reader: this) => void} fn @returns {boolean} */
  /** @param {((reader: this) => void)} [fn] @returns {this | boolean} */
  optional(): this;
  /** Commit a callback only if it binds data without a first miss or required error. */
  /** @overload @returns {this} */
  /** @overload @param {(reader: this) => void} fn @returns {boolean} */
  /** @param {((reader: this) => void)} [fn] @returns {this | boolean} */
  optional(fn: (reader: this) => void): boolean;
  /** Parse independent child contexts, adopting metadata only for a complete child. */
  /** @param {string} key @param {(reader: Reader, index: number) => void} fn */
  scope(key: string, fn: (reader: Reader, index: number) => void): void;
  /** Roll back a rejected attempt; always restore the enclosing iteration policy. */
  /** @param {(reader: this, index: number) => unknown} fn @returns {TContext[]} */
  repeat(fn: (reader: this, index: number) => unknown): TContext[];
  /** @param {string | ((heading: {level: number, text: string, node: import('./types.d.mts').HeadingNode}) => boolean)} [predicate] */
  skipUntilHeading(
    predicate?:
      | string
      | ((heading: {
          level: number;
          text: string;
          node: import("./types.d.mts").HeadingNode;
        }) => boolean),
  ): boolean;
  assertConsumed({ trailingWhitespace }?: { trailingWhitespace?: boolean | undefined }): boolean;
  /** @param {SlotDescription} slot @param {import('./RuntimeContracts.d.mts').BindingMode} mode */
  recordSlotBinding(
    slot: SlotDescription,
    mode: import("./RuntimeContracts.d.mts").BindingMode,
  ): void;
  /** @returns {Reader} */
  fork(): Reader;
}
