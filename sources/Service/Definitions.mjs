import * as z from "zod/v4";
import { createRequire } from "node:module";

export const VERSION = createRequire(import.meta.url)("../../package.json").version;
export const API_VERSION = 1;
export const DEFAULT_MAX_INPUT_BYTES = 1_048_576;
export const DEFAULT_TIMEOUT_MS = 30_000;
export const TOOL_NAMES = Object.freeze(["validate", "export", "create", "set", "render", "match", "query", "reference", "skill"]);
const path = z.string().min(1);
const object = z.record(z.string(), z.json());
const options = object.optional();
export const TOOL_DEFINITIONS = Object.freeze({
  validate: { description: "Validate a Markdown file against a template", inputSchema: z.strictObject({ file: path, template: path, options }) },
  export: { description: "Parse a Markdown file and return its context inline", inputSchema: z.strictObject({ file: path, template: path, savePath: path.optional(), options }) },
  create: { description: "Render a template with JSON data, optionally writing a file", inputSchema: z.strictObject({ template: path, data: object, file: path.optional(), force: z.boolean().default(false), options }) },
  set: { description: "Mutate a Markdown file and return the rewritten text", inputSchema: z.strictObject({ file: path, template: path, key: path.optional(), value: z.json().optional(), patch: object.optional(), out: path.optional(), dryRun: z.boolean().default(false), options }) },
  render: { description: "Parse with one template and render with another", inputSchema: z.strictObject({ file: path, parseTemplate: path, renderTemplate: path, outFile: path, dryRun: z.boolean().default(false), options }) },
  match: { description: "Find templates that fully match a Markdown file", inputSchema: z.strictObject({ file: path, templates: path, all: z.boolean().default(false), options }) },
  query: { description: "Find content occurrences using a query template", inputSchema: z.strictObject({ file: path, template: path, all: z.boolean().default(false), options }) },
  reference: { description: "Return the complete template-language reference or one function entry", inputSchema: z.strictObject({ topic: path.optional(), format: z.enum(["json", "markdown", "text"]).default("json") }) },
  skill: { description: "Read the bundled Agent Skill for authoring and editing do-md documents", inputSchema: z.strictObject({}) },
});

export function exitCode(errors = []) {
  const code = errors[0]?.code;
  if (code === "DO_MD_PARSE_ERROR") return 2;
  if (code === "DO_MD_TEMPLATE_ERROR") return 3;
  if (code === "DO_MD_IO_ERROR" || code === "DO_MD_CONFLICT") return 4;
  return 1;
}

export function failure(code, message) {
  return { ok: false, errors: [{ code, message: String(message), file: null, line: 1, column: 1, snippet: null }] };
}

export function positiveInteger(value, name) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) throw new Error(`${name} must be a positive integer`);
  return number;
}

export function portNumber(value, allowZero = false) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < (allowZero ? 0 : 1) || number > 65535) throw new Error("port must be between 1 and 65535");
  return number;
}
