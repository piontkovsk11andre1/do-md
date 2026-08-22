import yargs from "yargs";
import chalk from "chalk";

import {
  validate,
  create,
  exportDoc,
  set,
  render,
  match,
  query,
} from "./commands/index.mjs";
import { NodeFilesystem } from "./IO/NodeFilesystem.mjs";
import { run as runMcpServer } from "./McpServer.mjs";
import { ERROR_CODES, makeUserError } from "./SyntaxError.mjs";

export const USAGE = "Usage: do-md <validate|create|export|set|render|match|query> ...";

const COMMANDS = new Set(["validate", "create", "export", "set", "render", "match", "query"]);

export function formatUsage() {
  return `${USAGE}\n`;
}

export function coerceValue(value) {
  if (value == null || typeof value !== "string") {
    return value;
  }
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

export function toExitCode(errorCode) {
  switch (errorCode) {
    case ERROR_CODES.DO_MD_PARSE_ERROR:
      return 2;
    case ERROR_CODES.DO_MD_TEMPLATE_ERROR:
      return 3;
    case ERROR_CODES.DO_MD_IO_ERROR:
    case ERROR_CODES.DO_MD_CONFLICT:
      return 4;
    case ERROR_CODES.DO_MD_USER_ERROR:
    default:
      return 1;
  }
}

function hasFlag(argv, name) {
  const prefix = `--${name}`;
  return argv.some((arg) => arg === prefix || arg.startsWith(`${prefix}=`));
}

function firstCommandToken(argv) {
  return argv.find((arg) => arg !== "--" && !String(arg).startsWith("-"));
}

function diagnosticFrom(error) {
  if (error && typeof error.toDiagnostic === "function") {
    return error.toDiagnostic();
  }
  return {
    code: error?.code && Object.values(ERROR_CODES).includes(error.code) ? error.code : ERROR_CODES.DO_MD_USER_ERROR,
    message: error?.message ?? String(error),
    file: error?.file ?? null,
    line: error?.line ?? 1,
    column: error?.column ?? 1,
    snippet: error?.snippet ?? null,
  };
}

function formatDiagnostic(diagnostic) {
  const message = diagnostic?.message ?? "";
  if (!diagnostic?.file) {
    return message;
  }
  const loc = `${diagnostic.file}:${diagnostic.line ?? 1}:${diagnostic.column ?? 1}`;
  const prefix = process.stderr.isTTY ? chalk.cyan(loc) : loc;
  return `${prefix}: ${message}`;
}

function writeLine(stream, text) {
  const value = String(text ?? "");
  stream.write(value.endsWith("\n") ? value : `${value}\n`);
}

function resultPayload(result) {
  return {
    ok: result.ok,
    exitCode: result.exitCode,
    output: result.output ?? null,
    context: result.context ?? null,
    errors: Array.isArray(result.errors) ? result.errors : [],
  };
}

function reportResult(result, { json, quiet, showOutput = false }) {
  if (json) {
    if (result.ok && quiet) {
      return;
    }
    const stream = result.ok ? process.stdout : process.stderr;
    writeLine(stream, JSON.stringify(resultPayload(result)));
    return;
  }

  if (result.ok && showOutput && !quiet && result.output) {
    writeLine(process.stdout, result.output);
  } else if (!result.ok) {
    for (const error of result.errors ?? []) {
      writeLine(process.stderr, formatDiagnostic(error));
    }
  }
}

function reportRejected(error, { json }) {
  const diagnostic = diagnosticFrom(error);
  const exitCode = toExitCode(diagnostic.code);
  if (json) {
    writeLine(
      process.stderr,
      JSON.stringify({
        ok: false,
        exitCode,
        output: null,
        context: null,
        errors: [diagnostic],
      }),
    );
  } else {
    writeLine(process.stderr, formatDiagnostic(diagnostic));
  }
  return exitCode;
}

export function exitFromResult(result) {
  if (result?.ok) {
    return typeof result.exitCode === "number" ? result.exitCode : 0;
  }
  if (result?.errors?.[0]?.code) {
    return toExitCode(result.errors[0].code);
  }
  return typeof result?.exitCode === "number" ? result.exitCode : 1;
}

async function readJsonFile(io, cwd, path, name) {
  const resolved = io.resolvePath(cwd ?? process.cwd(), path);
  const text = await io.readFileAsync(resolved);
  try {
    return JSON.parse(text);
  } catch (error) {
    throw makeUserError(`invalid JSON in ${name}: ${error.message}`, { file: resolved });
  }
}

function parseArgv(argv) {
  return yargs(argv)
    .scriptName("do-md")
    .locale("en")
    .exitProcess(false)
    .strict()
    .strictCommands()
    .parserConfiguration({
      "camel-case-expansion": true,
      "duplicate-arguments-array": false,
    })
    .option("cwd", {
      type: "string",
      describe: "Resolve relative paths against this directory",
      global: true,
    })
    .option("quiet", {
      type: "boolean",
      default: false,
      describe: "Suppress informational messages",
      global: true,
    })
    .option("json", {
      type: "boolean",
      default: false,
      describe: "Print structured logs as JSON",
      global: true,
    })
    .command("validate <file> <template>", "Validate a file against a template")
    .command("create <file> <template>", "Create a file from a template and JSON data", (cmd) => {
      cmd.option("data", {
        type: "string",
        demandOption: true,
        describe: "Path to JSON input data",
      });
      cmd.option("force", {
        type: "boolean",
        default: false,
        describe: "Overwrite the target file if it exists",
      });
    })
    .command("export <file> <template>", "Export captured context as JSON", (cmd) => {
      cmd.option("save", {
        type: "string",
        demandOption: true,
        describe: "Path to write captured JSON",
      });
    })
    .command("set <file> <template>", "Mutate a document and re-render it", (cmd) => {
      cmd.option("key", { type: "string", describe: "Dotted path of a single context value" });
      cmd.option("value", { type: "string", describe: "Replacement value for --key" });
      cmd.option("patch", { type: "string", describe: "Path to a JSON patch object" });
      cmd.option("out", { type: "string", describe: "Write to a different file" });
    })
    .command("render <file> <parseTemplate> <renderTemplate> <outFile>", "Parse with one template and render with another")
    .command("match <file> <templates>", "Find templates that match a Markdown file", (cmd) => {
      cmd.option("all", {
        type: "boolean",
        default: false,
        describe: "Return every matching template",
      });
    })
    .command("query <file> <template>", "Find content matching a query template", (cmd) => {
      cmd.option("all", {
        type: "boolean",
        default: false,
        describe: "Return every non-overlapping match",
      });
    })
    .fail((msg, err) => {
      const error = err instanceof Error ? err : new Error(msg);
      if (!error.code) {
        error.code = ERROR_CODES.DO_MD_USER_ERROR;
      }
      throw error;
    })
    .help(false)
    .version(false)
    .wrap(null)
    .parse();
}

export async function execute(argv = process.argv.slice(2)) {
  const flags = {
    json: hasFlag(argv, "json"),
    quiet: hasFlag(argv, "quiet"),
  };

  if (!argv.length || argv[0] === "--help" || argv[0] === "-h") {
    process.stdout.write(formatUsage());
    return 1;
  }

  const token = firstCommandToken(argv);
  if (token === "mcp") {
    const index = argv.findIndex((arg) => arg !== "--" && !String(arg).startsWith("-"));
    return runMcpServer([...argv.slice(0, index), ...argv.slice(index + 1)]);
  }

  if (!COMMANDS.has(token)) {
    process.stdout.write(formatUsage());
    return 1;
  }

  let parsed;
  try {
    parsed = parseArgv(argv);
  } catch (error) {
    return reportRejected(makeUserError(error?.message ?? String(error)), flags);
  }

  flags.json = Boolean(parsed.json);
  flags.quiet = Boolean(parsed.quiet);

  const io = new NodeFilesystem();
  const cwd = parsed.cwd;

  try {
    let result;
    switch (token) {
      case "validate":
        result = await validate({
          io,
          file: parsed.file,
          template: parsed.template,
          cwd,
        });
        break;
      case "create":
        result = await create({
          io,
          file: parsed.file,
          template: parsed.template,
          data: await readJsonFile(io, cwd, parsed.data, "--data"),
          force: parsed.force === true,
          cwd,
        });
        break;
      case "export":
        result = await exportDoc({
          io,
          file: parsed.file,
          template: parsed.template,
          savePath: parsed.save,
          cwd,
        });
        break;
      case "set":
        result = await set({
          io,
          file: parsed.file,
          template: parsed.template,
          key: parsed.key,
          value: parsed.value === undefined ? undefined : coerceValue(parsed.value),
          patch: parsed.patch == null ? undefined : await readJsonFile(io, cwd, parsed.patch, "--patch"),
          out: parsed.out,
          cwd,
        });
        break;
      case "render":
        result = await render({
          io,
          file: parsed.file,
          parseTemplate: parsed.parseTemplate,
          renderTemplate: parsed.renderTemplate,
          outFile: parsed.outFile,
          cwd,
        });
        break;
      case "match":
        result = await match({
          io,
          file: parsed.file,
          templates: parsed.templates,
          all: parsed.all === true,
          cwd,
        });
        break;
      case "query":
        result = await query({
          io,
          file: parsed.file,
          template: parsed.template,
          all: parsed.all === true,
          cwd,
        });
        break;
      default:
        process.stdout.write(formatUsage());
        return 1;
    }

    reportResult(result, { ...flags, showOutput: token === "match" || token === "query" });
    return exitFromResult(result);
  } catch (error) {
    return reportRejected(error, flags);
  }
}
