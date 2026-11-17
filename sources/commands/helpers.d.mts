// Generated from checked JSDoc by npm run types. Do not edit.
import { Reader } from "../Reader.mjs";
export { runTemplate } from "../Template.mjs";
import { Writer } from "../Writer.mjs";
export type IOAdapter = import("../types.d.mts").IOAdapter;
export type CommandOptions = import("../types.d.mts").CommandOptions;
export type Diagnostic = import("../types.d.mts").Diagnostic;
export type DoMdError = import("../DoMdError.mjs").DoMdError;
export type AtomicWriteOptions = import("../types.d.mts").AtomicWriteOptions;
/** @typedef {import('../types.d.mts').IOAdapter} IOAdapter */
/** @typedef {import('../types.d.mts').CommandOptions} CommandOptions */
/** @typedef {import('../types.d.mts').Diagnostic} Diagnostic */
/** @typedef {import('../DoMdError.mjs').DoMdError} DoMdError */
/** @typedef {import('../types.d.mts').AtomicWriteOptions} AtomicWriteOptions */
/** @param {IOAdapter | undefined} io @returns {asserts io is IOAdapter} */
export declare function requireIo(io: IOAdapter | undefined): asserts io is IOAdapter;
/** @param {unknown} value @param {string} name @returns {asserts value is string} */
export declare function requireArg(value: unknown, name: string): asserts value is string;
/** @param {IOAdapter} io @param {string | null | undefined} cwd @param {string} path */
export declare function resolvePath(
  io: IOAdapter,
  cwd: string | null | undefined,
  path: string,
): string;
/** @param {Diagnostic | DoMdError | readonly (Diagnostic | DoMdError)[] | null | undefined} errors @returns {Diagnostic[]} */
export declare function diagnosticsFrom(
  errors: Diagnostic | DoMdError | readonly (Diagnostic | DoMdError)[] | null | undefined,
): Diagnostic[];
/** @template T @param {{output?: string | null, context?: T | null}} [data] @returns {import('../types.d.mts').CommandSuccess<T>} */
export declare function success<T>({
  output,
  context,
}?: {
  output?: string | null;
  context?: T | null;
}): import("../types.d.mts").CommandSuccess<T>;
/** @template T @param {number} exitCode @param {Diagnostic | DoMdError | readonly (Diagnostic | DoMdError)[]} errors
 * @param {{output?: string | null, context?: T | null}} [extra] @returns {import('../types.d.mts').CommandFailure<T>} */
export declare function failure<T>(
  exitCode: number,
  errors: Diagnostic | DoMdError | readonly (Diagnostic | DoMdError)[],
  extra?: {
    output?: string | null;
    context?: T | null;
  },
): import("../types.d.mts").CommandFailure<T>;
/** @param {unknown} text */
export declare function ensureTrailingNewline(text: unknown): string;
/** @param {unknown} text */
export declare function normalizeDocument(text: unknown): string;
/** @template {Record<string, unknown>} [T=Record<string, unknown>]
 * @param {unknown} source @param {string} path @returns {import('../types.d.mts').TemplateFunction<T>} */
export declare function wrapTemplate<T extends Record<string, unknown> = Record<string, unknown>>(
  source: unknown,
  path: string,
): import("../types.d.mts").TemplateFunction<T>;
/** @param {unknown} text */
export declare function utf8ByteLength(text: unknown): number;
/** @param {IOAdapter} io @param {string} path @param {CommandOptions} [options] */
export declare function readText(
  io: IOAdapter,
  path: string,
  options?: CommandOptions,
): Promise<string>;
/** @param {IOAdapter} io @param {string} path @param {CommandOptions} [options] */
export declare function readTextSnapshot(
  io: IOAdapter,
  path: string,
  options?: CommandOptions,
): Promise<
  | {
      content: string;
      revision: null;
    }
  | {
      content: string;
      revision: string;
    }
>;
/** @param {IOAdapter} io @param {string} path @param {string} content @param {AtomicWriteOptions} [options] */
export declare function writeText(
  io: IOAdapter,
  path: string,
  content: string,
  options?: AtomicWriteOptions,
): Promise<
  | import("../types.d.mts").WriteSnapshot
  | {
      revision: null;
    }
>;
/** @param {IOAdapter} io @param {string} path */
export declare function fileExists(io: IOAdapter, path: string): Promise<boolean>;
/** @template {Record<string, unknown>} [T=Record<string, unknown>]
 * @param {unknown} source @param {import('../types.d.mts').TemplateFunction<T>} fn
 * @param {{ file: string, templatePath: string, options?: CommandOptions, io: IOAdapter, diagnosticSource?: unknown, diagnosticOffset?: number }} settings
 * @returns {Reader<T>} */
export declare function parseSource<T extends Record<string, unknown> = Record<string, unknown>>(
  source: unknown,
  fn: import("../types.d.mts").TemplateFunction<T>,
  {
    file,
    templatePath,
    options,
    io,
    diagnosticSource,
    diagnosticOffset,
  }: {
    file: string;
    templatePath: string;
    options?: CommandOptions;
    io: IOAdapter;
    diagnosticSource?: unknown;
    diagnosticOffset?: number;
  },
): Reader<T>;
/** @template {Record<string, unknown>} T
 * @param {T} data @param {import('../types.d.mts').TemplateFunction<T>} fn
 * @param {{templatePath: string, options?: CommandOptions, io: IOAdapter}} settings */
export declare function renderSource<T extends Record<string, unknown>>(
  data: T,
  fn: import("../types.d.mts").TemplateFunction<T>,
  {
    templatePath,
    options,
    io,
  }: {
    templatePath: string;
    options?: CommandOptions;
    io: IOAdapter;
  },
): Writer<T>;
