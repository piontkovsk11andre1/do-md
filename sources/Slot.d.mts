// Generated from checked JSDoc by npm run types. Do not edit.
export type SlotOwner = import("./RuntimeContracts.d.mts").SlotOwner;
export type BindingMode = import("./RuntimeContracts.d.mts").BindingMode;
export type SlotMetadata = import("./types.d.mts").SlotMetadata;
export type SlotDescription = import("./RuntimeContracts.d.mts").SlotDescription;
/** @param {SlotOwner | null | undefined} owner @param {string} key @param {BindingMode} mode */
export declare function registerBinding(
  owner: SlotOwner | null | undefined,
  key: string,
  mode: BindingMode,
): void;
/**
 * An eager binding operation owned by a Reader or Writer. Configuration is applied
 * in the fixed order default → trim → validators → notEmpty at as()/asArray().
 * A slot can bind once; duplicate scalar keys are rejected within its owner scope.
 * @template [T=unknown]
 */
export declare class Slot<T = unknown> {
  path: string;
  leafType: import("./types.d.mts").LeafType;
  /** @type {T | null | undefined} */
  value: T | null | undefined;
  owner: import("./RuntimeContracts.d.mts").SlotOwner | null;
  sourceOffsetStart: number | null;
  sourceOffsetEnd: number | null;
  node: import("./types.d.mts").MarkdownNode | null;
  exists: boolean;
  /** @internal */
  _matched: boolean;
  /** @internal */
  _trim: boolean;
  /** @internal */
  _notEmpty: boolean;
  /** @internal @type {Array<(value: unknown) => boolean | void>} */
  _validators: Array<(value: unknown) => boolean | void>;
  /** @internal */
  _hasDefault: boolean;
  /** @internal @type {T | undefined} */
  _defaultValue: T | undefined;
  /** @internal */
  _bound: boolean;
  /** @internal @type {BindingMode | null} */
  _bindMode: BindingMode | null;
  /** @type {number | undefined} */
  headingLevel: number | undefined;
  /** @type {unknown} */
  frontmatterOptions: unknown;
  /** @param {string | SlotOwner} [pathOrOwner] @param {import('./RuntimeContracts.d.mts').SlotOptions<T>} [options] */
  constructor(
    pathOrOwner?: string | SlotOwner,
    options?: import("./RuntimeContracts.d.mts").SlotOptions<T>,
  );
  trim(): this;
  notEmpty(): this;
  /** @param {(value: T | undefined) => boolean | void} fn */
  validate(fn: (value: T | undefined) => boolean | void): this;
  /** @param {T} value */
  default(value: T): this;
  /** @param {string} key */
  as(key: string): this;
  /** @param {string} key */
  asArray(key: string): this;
}
