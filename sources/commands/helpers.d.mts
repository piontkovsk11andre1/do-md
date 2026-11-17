import { Reader } from "../Reader.mjs";
import { DoMdError } from "../DoMdError.mjs";
import { Writer } from "../Writer.mjs";
import type {
  AtomicWriteOptions,
  CommandFailure,
  CommandOptions,
  CommandSuccess,
  Diagnostic,
  IOAdapter,
  ReadSnapshot,
  TemplateFunction,
  WriteSnapshot,
} from "../types.d.mts";
export function requireIo<T extends IOAdapter>(io: T | null | undefined): T;
export function requireArg<T>(value: T | null | undefined, name: string): T;
export function resolvePath(io: IOAdapter, cwd: string | null | undefined, path: string): string;
export function diagnosticsFrom(
  errors: DoMdError | Diagnostic | readonly (DoMdError | Diagnostic)[] | null,
): Diagnostic[];
export function success<TContext = unknown>(options?: {
  output?: string | null;
  context?: TContext | null;
}): CommandSuccess<TContext>;
export function failure<TContext = unknown>(
  exitCode: number,
  errors: unknown,
  extra?: { output?: string | null; context?: TContext | null },
): CommandFailure<TContext>;
export function ensureTrailingNewline(text: unknown): string;
export function normalizeDocument(text: unknown): string;
export function runTemplate<TContext extends Record<string, unknown>>(
  fn: TemplateFunction<TContext>,
  doc: unknown,
  context: TContext,
  data: TContext | null,
  options: Record<string, unknown> | undefined,
  io: IOAdapter,
  templatePath: string,
): void;
export function wrapTemplate<TContext extends Record<string, unknown> = Record<string, unknown>>(
  source: unknown,
  path: string,
): TemplateFunction<TContext>;
export function utf8ByteLength(text: unknown): number;
export function readText(io: IOAdapter, path: string, options?: CommandOptions): Promise<string>;
export function readTextSnapshot(
  io: IOAdapter,
  path: string,
  options?: CommandOptions,
): Promise<{ content: string; revision: string | null }>;
export function writeText(
  io: IOAdapter,
  path: string,
  content: string,
  options?: AtomicWriteOptions,
): Promise<WriteSnapshot | { revision: null }>;
export function fileExists(io: IOAdapter, path: string): Promise<boolean>;
export function parseSource<TContext extends Record<string, unknown> = Record<string, unknown>>(
  source: unknown,
  fn: TemplateFunction<TContext>,
  options: {
    file: string;
    templatePath: string;
    options?: CommandOptions;
    io: IOAdapter;
    diagnosticSource?: unknown;
    diagnosticOffset?: number;
  },
): Reader<TContext>;
export function renderSource<TContext extends Record<string, unknown> = Record<string, unknown>>(
  data: TContext,
  fn: TemplateFunction<TContext>,
  options: { templatePath: string; options?: CommandOptions; io: IOAdapter },
): Writer<TContext>;
