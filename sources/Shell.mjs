import yargs from "yargs";

import { validate, create, exportDoc, set, render, match, query } from "./commands/index.mjs";
import { NodeFilesystem } from "./IO/NodeFilesystem.mjs";
import { ERROR_CODES, makeUserError, formatDiagnostic } from "./DoMdError.mjs";
import { renderTemplateReference } from "./TemplateLanguage.mjs";
import { readSkill } from "./Skill.mjs";

export const USAGE =
  "Usage: do-md <validate|create|export|set|render|match|query|reference|skill> ...";

const COMMANDS = new Set(["validate", "create", "export", "set", "render", "match", "query"]);
const COMMAND_HELP = Object.freeze({
  validate: "do-md validate <file> <template>\nValidate a complete document against one template.",
  create:
    "do-md create <file> <template> --data <json> [--force]\nCreate a document from template data.",
  export: "do-md export <file> <template> --save <json>\nExport a parsed template context.",
  set: "do-md set <file> <template> [--key k --value v] [--patch json] [--out file]\nEdit a parsed document.",
  render:
    "do-md render <file> <parse-template> <render-template> <out-file>\nParse with one template and render with another.",
  match: "do-md match <file> <templates> [--all]\nFind templates that fully match a document.",
  query:
    "do-md query <file> <template> [--all]\nFind non-overlapping content regions marked by doc.query().",
  reference:
    "do-md reference [topic] [--format json|markdown|text]\nRead the template-language reference. JSON is the default, matching MCP reference.",
  skill: "do-md skill\nPrint the bundled Agent Skill as Markdown. This does not install it.",
  serve:
    "do-md serve --root <dir> [--host 127.0.0.1] [--port 8080]\nOptions: --max-input-bytes --timeout-ms --max-body-bytes --max-response-bytes --max-concurrency --no-snippets",
  mcp: "do-md mcp --root <dir> [--host <host> --port 8080 | --url <http(s)://host/prefix>]\nOptions: --max-input-bytes --timeout-ms --max-response-bytes --no-snippets\nWithout host/port/URL, commands execute locally. In remote mode --root is a server-side directory.",
});

export function formatUsage() {
  return `${USAGE}\n`;
}

function formatHelp() {
  return `${formatUsage()}\nCommands:\n  validate  Validate a document\n  create    Create a document\n  export    Export parsed context\n  set       Edit a document\n  render    Parse and render\n  match     Find matching templates\n  query     Find content regions\n  reference Read the template-language reference\n  skill     Read the Agent Skill\n  mcp       Start the local or remote-dispatch MCP server\n  serve     Start the HTTP execution server\n\nHelp:\n  do-md help [command]\n  do-md <command> --help\n`;
}

function formatCommandHelp(command) {
  if (!COMMANDS.has(command)) {
    return `${COMMAND_HELP[command]}\n`;
  }
  return `${COMMAND_HELP[command]}\n\nGlobal options:\n  --cwd <dir>  Resolve relative paths against a directory\n  --json       Print structured command results\n  --quiet      Suppress successful informational output\n`;
}

function commandHelp(argv) {
  if (argv.length === 1 || (argv.length === 2 && ["--help", "-h"].includes(argv[1]))) {
    return formatHelp();
  }
  if (argv.length !== 2 || !Object.hasOwn(COMMAND_HELP, argv[1])) {
    throw makeUserError("help expects a command name; use reference for the template language");
  }
  return formatCommandHelp(argv[1]);
}

function referenceOutput(argv) {
  const parsed = yargs(argv)
    .exitProcess(false)
    .help(false)
    .version(false)
    .strictOptions()
    .option("format", { choices: ["json", "markdown", "text"], default: "json" })
    .fail((message) => {
      throw makeUserError(message);
    })
    .parseSync();
  if (parsed._.length > 1) {
    throw makeUserError("reference accepts at most one topic");
  }
  const topic = parsed._[0] == null ? null : String(parsed._[0]);
  const output = renderTemplateReference({ topic, format: parsed.format });
  if (output == null) {
    throw makeUserError(`unknown template function: ${topic}`);
  }
  return output;
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
    code:
      error?.code && Object.values(ERROR_CODES).includes(error.code)
        ? error.code
        : ERROR_CODES.DO_MD_USER_ERROR,
    message: error?.message ?? String(error),
    locations: error?.locations ?? [],
  };
}

function formatTextDiagnostic(diagnostic) {
  return formatDiagnostic(diagnostic, {
    colors:
      Boolean(process.stderr.isTTY) &&
      !Object.hasOwn(process.env, "NO_COLOR") &&
      process.env.TERM !== "dumb",
  });
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
      writeLine(process.stderr, formatTextDiagnostic(error));
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
    writeLine(process.stderr, formatTextDiagnostic(diagnostic));
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
    .command(
      "render <file> <parseTemplate> <renderTemplate> <outFile>",
      "Parse with one template and render with another",
    )
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

  if (!argv.length) {
    process.stdout.write(formatUsage());
    return 1;
  }

  const token = firstCommandToken(argv);
  if (token === "reference" || token === "skill") {
    try {
      if (argv.includes("--help") || argv.includes("-h")) {
        process.stdout.write(`${COMMAND_HELP[token]}\n`);
      } else if (token === "reference") {
        process.stdout.write(`${referenceOutput(argv.slice(argv.indexOf(token) + 1))}\n`);
      } else {
        if (argv.length !== 1) {
          throw makeUserError("skill accepts no arguments");
        }
        process.stdout.write(await readSkill());
      }
      return 0;
    } catch (error) {
      return reportRejected(error, flags);
    }
  }
  if (["serve", "mcp"].includes(token) && (argv.includes("--help") || argv.includes("-h"))) {
    process.stdout.write(`${COMMAND_HELP[token]}\n`);
    return 0;
  }
  if (token === "help") {
    try {
      process.stdout.write(commandHelp(argv));
      return 0;
    } catch (error) {
      return reportRejected(error, flags);
    }
  }
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(COMMANDS.has(token) ? formatCommandHelp(token) : formatHelp());
    return 0;
  }
  if (token === "mcp") {
    const index = argv.findIndex((arg) => arg !== "--" && !String(arg).startsWith("-"));
    return (await import("./McpServer.mjs")).run([
      ...argv.slice(0, index),
      ...argv.slice(index + 1),
    ]);
  }
  if (token === "serve") {
    const index = argv.indexOf("serve");
    return (await import("./HttpServer.mjs")).run([
      ...argv.slice(0, index),
      ...argv.slice(index + 1),
    ]);
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
          patch:
            parsed.patch == null ? undefined : await readJsonFile(io, cwd, parsed.patch, "--patch"),
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
