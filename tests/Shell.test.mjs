import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync, readFileSync, rmSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import { coerceValue, exitFromResult, formatUsage, toExitCode, USAGE } from "../sources/Shell.mjs";
import { ERROR_CODES } from "../sources/SyntaxError.mjs";

const EXIT_BY_CODE = {
  [ERROR_CODES.DO_MD_USER_ERROR]: 1,
  [ERROR_CODES.DO_MD_PARSE_ERROR]: 2,
  [ERROR_CODES.DO_MD_TEMPLATE_ERROR]: 3,
  [ERROR_CODES.DO_MD_IO_ERROR]: 4,
  [ERROR_CODES.DO_MD_CONFLICT]: 4,
};

const V1_USAGE = "Usage: do-md <validate|create|export|set|render|match|query> ...\n";
const POST_V1_COMMANDS = [
  "diff",
  "schema",
  "mock",
  "format",
  "lint",
  "coverage",
  "infer",
  "migrate",
  "index",
  "bundle",
  "split",
  "sync",
  "cross-reference",
  "archive",
  "graph",
  "report",
];

const root = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(root, "..");
const binPath = path.join(projectRoot, "bin/do-md.mjs");
const fixtureDir = path.join(root, "conformance/release-notes");

function runCli(args, options = {}) {
  return spawnSync(process.execPath, [binPath, ...args], {
    encoding: "utf8",
    cwd: options.cwd ?? projectRoot,
  });
}

function withTempDir(fn) {
  const dir = mkdtempSync(path.join(tmpdir(), "do-md-cli-"));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function writeSimpleProject(dir, extras = {}) {
  writeFileSync(path.join(dir, "doc.md"), extras.doc ?? "# Hello\n");
  writeFileSync(path.join(dir, "tpl.md"), extras.tpl ?? '# {% doc.line().as("title") %}\n');
  if (extras.data != null) {
    writeFileSync(path.join(dir, "data.json"), extras.data);
  }
}

function fileEndsWith(file, suffix) {
  return String(file ?? "").replaceAll("\\", "/").endsWith(suffix);
}

function assertDiagnostic(error, expected = {}) {
  assert.equal(typeof error, "object");
  assert.equal(error.code, expected.code);
  assert.ok(Number.isInteger(error.line) && error.line >= 1);
  assert.ok(Number.isInteger(error.column) && error.column >= 1);
  assert.equal(typeof error.message, "string");
  assert.match(error.message, /^[^\r\n]*$/);
  assert.ok(error.snippet === null || typeof error.snippet === "string");
  if (expected.fileSuffix) {
    assert.ok(fileEndsWith(error.file, expected.fileSuffix));
  }
  if (Object.hasOwn(expected, "file")) {
    assert.equal(error.file, expected.file);
  }
  if (expected.line !== undefined) {
    assert.equal(error.line, expected.line);
  }
  if (expected.column !== undefined) {
    assert.equal(error.column, expected.column);
  }
  if (Object.hasOwn(expected, "snippet")) {
    assert.equal(error.snippet, expected.snippet);
  }
}

function assertErrorJson(result, { exitCode, code, ...diagnostic }) {
  assert.equal(result.status, exitCode);
  assert.equal(result.stdout, "");
  const payload = JSON.parse(result.stderr);
  assert.equal(payload.ok, false);
  assert.equal(payload.exitCode, exitCode);
  assert.equal(payload.output, null);
  assert.equal(payload.context, null);
  assert.ok(Array.isArray(payload.errors) && payload.errors.length > 0);
  assertDiagnostic(payload.errors[0], { code, ...diagnostic });
  return payload;
}

test("missing command prints usage and exits with code 1", () => {
  const result = spawnSync(process.execPath, [binPath], { encoding: "utf8" });
  const output = `${result.stdout}${result.stderr}`;

  assert.equal(result.status, 1);
  assert.match(output, /Usage: do-md/);
});

test("CLI help lists the supported commands", () => {
  assert.equal(USAGE, "Usage: do-md <validate|create|export|set|render|match|query> ...");
  assert.equal(formatUsage(), V1_USAGE);
  for (const args of [[], ["--help"], ["-h"], ["not-a-command"]]) {
    const result = runCli(args);
    assert.equal(result.status, 1, args.join(" ") || "(empty)");
    assert.equal(result.stdout, V1_USAGE, args.join(" ") || "(empty)");
    const output = `${result.stdout}${result.stderr}`;
    assert.doesNotMatch(output, /\bmcp\b/);
    for (const name of POST_V1_COMMANDS) {
      assert.doesNotMatch(output, new RegExp(`\\b${name}\\b`), name);
    }
  }
});

test("post-v1 extension commands are not accepted", () => {
  for (const name of POST_V1_COMMANDS) {
    const result = runCli([name]);
    assert.equal(result.status, 1, name);
    assert.equal(result.stdout, V1_USAGE, name);
    assert.doesNotMatch(`${result.stdout}${result.stderr}`, new RegExp(`\\b${name}\\b`), name);
  }
});

test("mcp delegates to the bundled server and does not print usage", () => {
  const result = runCli(["mcp"]);
  assert.equal(result.status, 1);
  assert.doesNotMatch(`${result.stdout}${result.stderr}`, /Usage: do-md/);
  assert.match(result.stderr, /--root/);
});

test("invalid command prints usage and exits with code 1", () => {
  const result = spawnSync(process.execPath, [binPath, "does-not-exist"], {
    encoding: "utf8",
  });
  const output = `${result.stdout}${result.stderr}`;

  assert.equal(result.status, 1);
  assert.match(output, /Usage: do-md/);
});

test("coerceValue parses JSON and falls back to the raw string", () => {
  assert.equal(coerceValue("2.0.0"), "2.0.0");
  assert.equal(coerceValue("42"), 42);
  assert.equal(coerceValue('"42"'), "42");
  assert.equal(coerceValue("true"), true);
  assert.deepEqual(coerceValue("[1,2,3]"), [1, 2, 3]);
  assert.equal(coerceValue("hello world"), "hello world");
});

test("toExitCode maps all library error codes to documented process exits", () => {
  assert.equal(toExitCode(ERROR_CODES.DO_MD_USER_ERROR), 1);
  assert.equal(toExitCode(ERROR_CODES.DO_MD_PARSE_ERROR), 2);
  assert.equal(toExitCode(ERROR_CODES.DO_MD_TEMPLATE_ERROR), 3);
  assert.equal(toExitCode(ERROR_CODES.DO_MD_IO_ERROR), 4);
  assert.equal(toExitCode(ERROR_CODES.DO_MD_CONFLICT), 4);
});

test("exitFromResult maps the first resolved Result error code", () => {
  assert.equal(exitFromResult({ ok: true, exitCode: 0, errors: [] }), 0);
  for (const [code, exitCode] of Object.entries(EXIT_BY_CODE)) {
    assert.equal(
      exitFromResult({ ok: false, exitCode: 99, errors: [{ code }] }),
      exitCode,
    );
  }
  assert.equal(
    exitFromResult({
      ok: false,
      exitCode: 1,
      errors: [
        { code: ERROR_CODES.DO_MD_PARSE_ERROR },
        { code: ERROR_CODES.DO_MD_USER_ERROR },
      ],
    }),
    2,
  );
});

test("validate positional form exits 0", () => {
  const result = runCli([
    "validate",
    path.join(fixtureDir, "input.md"),
    path.join(fixtureDir, "template.tpl.md"),
  ]);
  assert.equal(result.status, 0);
  assert.equal(result.stderr, "");
});

test("match prints the first template or all matches", () => {
  withTempDir((dir) => {
    writeSimpleProject(dir);
    const templates = path.join(dir, "templates");
    mkdirSync(templates);
    writeFileSync(path.join(templates, "a.tpl.md"), '# {% doc.line().as("title") %}\n');
    writeFileSync(path.join(templates, "b.tpl.md"), '# {% doc.line().as("heading") %}\n');
    writeFileSync(path.join(templates, "broken.tpl.md"), "{% invalid javascript %}");

    const first = runCli(["match", "doc.md", "templates"], { cwd: dir });
    assert.equal(first.status, 0);
    assert.equal(first.stderr, "");
    assert.ok(fileEndsWith(first.stdout.trim(), "templates/a.tpl.md"));

    const all = runCli(["match", "doc.md", "templates/**/*.tpl.md", "--all"], { cwd: dir });
    assert.equal(all.status, 0);
    assert.deepEqual(all.stdout.trim().split(/\r?\n/).map((file) => path.basename(file)), ["a.tpl.md", "b.tpl.md"]);

    const none = runCli(["match", "doc.md", "templates/broken.tpl.md"], { cwd: dir });
    assert.equal(none.status, 2);
    assert.match(none.stderr, /no matching template/);
  });
});

test("query prints first or all occurrence contexts and shifted offsets", () => {
  withTempDir((dir) => {
    writeSimpleProject(dir, { doc: "target:one\nother\ntarget:two\n" });
    writeFileSync(
      path.join(dir, "query.tpl.md"),
      '{% doc.rawUntil("target:"); doc.query((match) => { match.literal("target:"); match.line().as("value") }); doc.rawRest() %}',
    );

    const first = runCli(["query", "doc.md", "query.tpl.md"], { cwd: dir });
    assert.equal(first.status, 0, first.stderr);
    assert.deepEqual(JSON.parse(first.stdout), { start: 0, end: 10, context: { value: "one" } });

    const all = runCli(["query", "doc.md", "query.tpl.md", "--all"], { cwd: dir });
    assert.equal(all.status, 0, all.stderr);
    assert.deepEqual(JSON.parse(all.stdout), [
      { start: 0, end: 10, context: { value: "one" } },
      { start: 17, end: 27, context: { value: "two" } },
    ]);
  });
});

test("validate reports parse diagnostics and exits 2", () => {
  withTempDir((dir) => {
    writeSimpleProject(dir, { doc: "not a heading\n" });
    const result = runCli(["validate", "doc.md", "tpl.md"], { cwd: dir });
    assert.equal(result.status, 2);
    assert.match(result.stderr, /doc\.md:\d+:\d+: /);
  });
});

test("validate missing required positionals exits 1", () => {
  const result = runCli(["validate"]);
  assert.equal(result.status, 1);
  assert.match(`${result.stdout}${result.stderr}`, /Not enough non-option arguments/);
});

test("missing file is an I/O error and exits 4", () => {
  withTempDir((dir) => {
    writeSimpleProject(dir);
    const result = runCli(["validate", "missing.md", "tpl.md"], { cwd: dir });
    assert.equal(result.status, 4);
  });
});

test("template wrap error exits 3", () => {
  withTempDir((dir) => {
    writeSimpleProject(dir, { tpl: "{% function( %}\n" });
    const result = runCli(["validate", "doc.md", "tpl.md"], { cwd: dir });
    assert.equal(result.status, 3);
  });
});

test("create requires --data and refuses to overwrite without --force", () => {
  withTempDir((dir) => {
    writeSimpleProject(dir, { data: JSON.stringify({ title: "Hello" }) });
    const missing = runCli(["create", "out.md", "tpl.md"], { cwd: dir });
    assert.equal(missing.status, 1);

    const created = runCli(["create", "out.md", "tpl.md", "--data", "data.json"], { cwd: dir });
    assert.equal(created.status, 0);
    assert.match(readFileSync(path.join(dir, "out.md"), "utf8"), /Hello/);

    const refused = runCli(["create", "out.md", "tpl.md", "--data", "data.json"], { cwd: dir });
    assert.equal(refused.status, 1);
    assert.match(readFileSync(path.join(dir, "out.md"), "utf8"), /Hello/);

    writeFileSync(path.join(dir, "data.json"), JSON.stringify({ title: "Forced" }));
    const forced = runCli(["create", "out.md", "tpl.md", "--data", "data.json", "--force"], {
      cwd: dir,
    });
    assert.equal(forced.status, 0);
    assert.match(readFileSync(path.join(dir, "out.md"), "utf8"), /Forced/);
  });
});

test("export writes pretty JSON to --save and overwrites", () => {
  withTempDir((dir) => {
    writeSimpleProject(dir);
    writeFileSync(path.join(dir, "out.json"), '{"stale":true}');
    const result = runCli(["export", "doc.md", "tpl.md", "--save", "out.json"], { cwd: dir });
    assert.equal(result.status, 0);
    assert.deepEqual(JSON.parse(readFileSync(path.join(dir, "out.json"), "utf8")), {
      title: "Hello",
    });
  });
});

test("set requires a mutation and coerces --value", () => {
  withTempDir((dir) => {
    writeSimpleProject(dir);
    const missing = runCli(["set", "doc.md", "tpl.md"], { cwd: dir });
    assert.equal(missing.status, 1);
    assert.equal(readFileSync(path.join(dir, "doc.md"), "utf8"), "# Hello\n");

    const version = runCli(["set", "doc.md", "tpl.md", "--key", "title", "--value", "2.0.0"], {
      cwd: dir,
    });
    assert.equal(version.status, 0);
    assert.match(readFileSync(path.join(dir, "doc.md"), "utf8"), /2\.0\.0/);

    writeSimpleProject(dir);
    const number = runCli(
      ["set", "doc.md", "tpl.md", "--key", "title", "--value", "42", "--json"],
      { cwd: dir },
    );
    assertErrorJson(number, { exitCode: 1, code: ERROR_CODES.DO_MD_USER_ERROR, file: null });
    assert.equal(readFileSync(path.join(dir, "doc.md"), "utf8"), "# Hello\n");

    writeSimpleProject(dir);
    const flag = runCli(
      ["set", "doc.md", "tpl.md", "--key", "title", "--value", "true", "--json"],
      { cwd: dir },
    );
    assertErrorJson(flag, { exitCode: 1, code: ERROR_CODES.DO_MD_USER_ERROR, file: null });
    assert.equal(readFileSync(path.join(dir, "doc.md"), "utf8"), "# Hello\n");

    writeSimpleProject(dir);
    const quoted = runCli(
      ["set", "doc.md", "tpl.md", "--key", "title", "--value", '"42"', "--json"],
      { cwd: dir },
    );
    assert.equal(quoted.status, 0);
    assert.equal(JSON.parse(quoted.stdout).context.title, "42");

    writeSimpleProject(dir);
    const list = runCli(
      ["set", "doc.md", "tpl.md", "--key", "title", "--value", "[1,2,3]", "--json"],
      { cwd: dir },
    );
    assertErrorJson(list, { exitCode: 1, code: ERROR_CODES.DO_MD_USER_ERROR, file: null });
    assert.equal(readFileSync(path.join(dir, "doc.md"), "utf8"), "# Hello\n");
  });
});

test("render takes two templates and writes only the output file", () => {
  withTempDir((dir) => {
    writeFileSync(path.join(dir, "doc.md"), "# Hello\n");
    writeFileSync(path.join(dir, "parse.tpl.md"), '# {% doc.line().as("title") %}\n');
    writeFileSync(path.join(dir, "render.tpl.md"), "Title: {% doc.line().as(\"title\") %}\n");
    const result = runCli(["render", "doc.md", "parse.tpl.md", "render.tpl.md", "out.txt"], {
      cwd: dir,
    });
    assert.equal(result.status, 0);
    assert.equal(readFileSync(path.join(dir, "doc.md"), "utf8"), "# Hello\n");
    assert.match(readFileSync(path.join(dir, "out.txt"), "utf8"), /Title: Hello/);
  });
});

test("global --cwd resolves positional paths against --cwd, not process.cwd()", () => {
  withTempDir((dir) => {
    const work = path.join(dir, "docs");
    const decoy = path.join(dir, "decoy");
    mkdirSync(work);
    mkdirSync(decoy);
    writeSimpleProject(work, { data: JSON.stringify({ title: "FromCwd" }) });
    writeSimpleProject(decoy, {
      doc: "# Decoy\n",
      tpl: '# {% doc.line().as("title") %}\n',
      data: JSON.stringify({ title: "Decoy" }),
    });
    writeFileSync(path.join(work, "parse.tpl.md"), '# {% doc.line().as("title") %}\n');
    writeFileSync(path.join(work, "render.tpl.md"), 'Title: {% doc.line().as("title") %}\n');
    writeFileSync(path.join(work, "patch.json"), JSON.stringify({ title: "Patched" }));

    const spawn = { cwd: decoy };

    assert.equal(runCli(["validate", "doc.md", "tpl.md", "--cwd", work], spawn).status, 0);

    const exported = runCli(
      ["export", "doc.md", "tpl.md", "--save", "out.json", "--json", "--cwd", work],
      spawn,
    );
    assert.equal(exported.status, 0);
    assert.equal(JSON.parse(exported.stdout).context.title, "Hello");
    assert.deepEqual(JSON.parse(readFileSync(path.join(work, "out.json"), "utf8")), { title: "Hello" });
    assert.equal(existsSync(path.join(decoy, "out.json")), false);

    const created = runCli(["create", "out.md", "tpl.md", "--data", "data.json", "--cwd", work], spawn);
    assert.equal(created.status, 0);
    assert.match(readFileSync(path.join(work, "out.md"), "utf8"), /FromCwd/);
    assert.equal(existsSync(path.join(decoy, "out.md")), false);

    const mutated = runCli(
      ["set", "doc.md", "tpl.md", "--patch", "patch.json", "--out", "set-out.md", "--cwd", work],
      spawn,
    );
    assert.equal(mutated.status, 0);
    assert.match(readFileSync(path.join(work, "set-out.md"), "utf8"), /Patched/);
    assert.equal(readFileSync(path.join(work, "doc.md"), "utf8"), "# Hello\n");
    assert.equal(existsSync(path.join(decoy, "set-out.md")), false);

    const rendered = runCli(
      ["render", "doc.md", "parse.tpl.md", "render.tpl.md", "out.txt", "--cwd", work],
      spawn,
    );
    assert.equal(rendered.status, 0);
    assert.match(readFileSync(path.join(work, "out.txt"), "utf8"), /Title: Hello/);
    assert.equal(existsSync(path.join(decoy, "out.txt")), false);
  });
});

test("global --cwd does not keep resolved paths under cwd", () => {
  withTempDir((dir) => {
    const docs = path.join(dir, "docs");
    const config = path.join(dir, "config");
    const outside = path.join(dir, "outside");
    mkdirSync(docs);
    mkdirSync(config);
    mkdirSync(outside);
    writeFileSync(path.join(docs, "doc.md"), "# Hello\n");
    writeFileSync(path.join(config, "tpl.md"), '# {% doc.line().as("title") %}\n');
    writeFileSync(path.join(config, "data.json"), JSON.stringify({ title: "Config" }));
    writeFileSync(path.join(outside, "doc.md"), "# Outside\n");
    writeFileSync(path.join(outside, "tpl.md"), '# {% doc.line().as("title") %}\n');

    const viaParent = runCli(
      ["validate", "doc.md", path.join("..", "config", "tpl.md"), "--cwd", docs],
      { cwd: dir },
    );
    assert.equal(viaParent.status, 0);

    const viaAbs = runCli(["validate", "doc.md", path.join(config, "tpl.md"), "--cwd", docs], {
      cwd: dir,
    });
    assert.equal(viaAbs.status, 0);

    const escaped = runCli(
      [
        "validate",
        path.join("..", "outside", "doc.md"),
        path.join("..", "outside", "tpl.md"),
        "--cwd",
        docs,
      ],
      { cwd: dir },
    );
    assert.equal(escaped.status, 0);

    const created = runCli(
      [
        "create",
        path.join("..", "outside", "created.md"),
        path.join("..", "config", "tpl.md"),
        "--data",
        path.join("..", "config", "data.json"),
        "--cwd",
        docs,
      ],
      { cwd: dir },
    );
    assert.equal(created.status, 0);
    assert.match(readFileSync(path.join(outside, "created.md"), "utf8"), /Config/);
    assert.equal(existsSync(path.join(docs, "created.md")), false);
  });
});

test("global --json prints a Result object", () => {
  const result = runCli([
    "validate",
    path.join(fixtureDir, "input.md"),
    path.join(fixtureDir, "template.tpl.md"),
    "--json",
  ]);
  assert.equal(result.status, 0);
  assert.deepEqual(JSON.parse(result.stdout), {
    ok: true,
    exitCode: 0,
    output: null,
    context: null,
    errors: [],
  });
});

test("global --quiet suppresses informational JSON but not errors", () => {
  const ok = runCli([
    "validate",
    path.join(fixtureDir, "input.md"),
    path.join(fixtureDir, "template.tpl.md"),
    "--json",
    "--quiet",
  ]);
  assert.equal(ok.status, 0);
  assert.equal(ok.stdout, "");

  withTempDir((dir) => {
    writeSimpleProject(dir, { doc: "not a heading\n" });
    const failed = runCli(["validate", "doc.md", "tpl.md", "--json", "--quiet"], { cwd: dir });
    assert.equal(failed.status, 2);
    const payload = JSON.parse(failed.stderr);
    assert.equal(payload.ok, false);
    assert.equal(payload.exitCode, 2);
    assert.ok(payload.errors.length > 0);

    const text = runCli(["validate", "doc.md", "tpl.md", "--quiet"], { cwd: dir });
    assert.equal(text.status, 2);
    assert.match(text.stderr, /doc\.md:\d+:\d+: /);
  });
});

test("global --json parse errors include diagnostic fields", () => {
  withTempDir((dir) => {
    writeSimpleProject(dir, { doc: "not a heading\n" });
    const result = runCli(["validate", "doc.md", "tpl.md", "--json"], { cwd: dir });
    const payload = assertErrorJson(result, {
      exitCode: 2,
      code: ERROR_CODES.DO_MD_PARSE_ERROR,
      fileSuffix: "doc.md",
      line: 1,
      column: 1,
      snippet: "not a heading",
    });
    for (const error of payload.errors) {
      assertDiagnostic(error, {
        code: ERROR_CODES.DO_MD_PARSE_ERROR,
        fileSuffix: "doc.md",
      });
    }
  });
});

test("global --json --quiet still prints parse diagnostic fields", () => {
  withTempDir((dir) => {
    writeSimpleProject(dir, { doc: "not a heading\n" });
    const result = runCli(["validate", "doc.md", "tpl.md", "--json", "--quiet"], { cwd: dir });
    assertErrorJson(result, {
      exitCode: 2,
      code: ERROR_CODES.DO_MD_PARSE_ERROR,
      fileSuffix: "doc.md",
      line: 1,
      column: 1,
      snippet: "not a heading",
    });
  });
});

test("global --json rejected errors are Result-shaped diagnostics", () => {
  withTempDir((dir) => {
    writeSimpleProject(dir, { tpl: "{% function( %}\n" });
    assertErrorJson(runCli(["validate", "doc.md", "tpl.md", "--json"], { cwd: dir }), {
      exitCode: 3,
      code: ERROR_CODES.DO_MD_TEMPLATE_ERROR,
      fileSuffix: "tpl.md",
    });

    writeSimpleProject(dir);
    assertErrorJson(runCli(["validate", "missing.md", "tpl.md", "--json"], { cwd: dir }), {
      exitCode: 4,
      code: ERROR_CODES.DO_MD_IO_ERROR,
      fileSuffix: "missing.md",
    });

    assertErrorJson(runCli(["validate", "--json"], { cwd: dir }), {
      exitCode: 1,
      code: ERROR_CODES.DO_MD_USER_ERROR,
      file: null,
    });
  });
});

test("global --json --quiet still prints rejected-error JSON", () => {
  withTempDir((dir) => {
    writeSimpleProject(dir, { tpl: "{% function( %}\n" });
    assertErrorJson(runCli(["validate", "doc.md", "tpl.md", "--json", "--quiet"], { cwd: dir }), {
      exitCode: 3,
      code: ERROR_CODES.DO_MD_TEMPLATE_ERROR,
      fileSuffix: "tpl.md",
    });

    writeSimpleProject(dir);
    assertErrorJson(runCli(["validate", "missing.md", "tpl.md", "--json", "--quiet"], { cwd: dir }), {
      exitCode: 4,
      code: ERROR_CODES.DO_MD_IO_ERROR,
      fileSuffix: "missing.md",
    });
  });
});

test("global --quiet does not suppress rejected-error text", () => {
  withTempDir((dir) => {
    writeSimpleProject(dir, { tpl: "{% function( %}\n" });
    const template = runCli(["validate", "doc.md", "tpl.md", "--quiet"], { cwd: dir });
    assert.equal(template.status, 3);
    assert.notEqual(template.stderr.trim(), "");
    assert.match(template.stderr, /tpl\.md:\d+:\d+: /);

    const io = runCli(["validate", "missing.md", "tpl.md", "--quiet"], { cwd: dir });
    assert.equal(io.status, 4);
    assert.notEqual(io.stderr.trim(), "");
    assert.match(io.stderr, /missing\.md:\d+:\d+: /);
  });
});

test("CLI resolved Result.errors produce documented process exits", () => {
  withTempDir((dir) => {
    writeSimpleProject(dir, {
      doc: "not a heading\n",
      data: JSON.stringify({ title: "Hello" }),
    });
    writeFileSync(path.join(dir, "out.md"), "# keep\n");
    writeFileSync(path.join(dir, "parse.tpl.md"), '# {% doc.line().as("title") %}\n');
    writeFileSync(path.join(dir, "render.tpl.md"), 'Title: {% doc.line().as("title") %}\n');

    const cases = [
      {
        args: ["create", "out.md", "tpl.md", "--data", "data.json"],
        code: ERROR_CODES.DO_MD_USER_ERROR,
      },
      {
        args: ["set", "doc.md", "tpl.md"],
        code: ERROR_CODES.DO_MD_USER_ERROR,
      },
      {
        args: ["validate", "doc.md", "tpl.md"],
        code: ERROR_CODES.DO_MD_PARSE_ERROR,
      },
      {
        args: ["export", "doc.md", "tpl.md", "--save", "out.json"],
        code: ERROR_CODES.DO_MD_PARSE_ERROR,
      },
      {
        args: ["set", "doc.md", "tpl.md", "--key", "title", "--value", "X"],
        code: ERROR_CODES.DO_MD_PARSE_ERROR,
      },
      {
        args: ["render", "doc.md", "parse.tpl.md", "render.tpl.md", "out.txt"],
        code: ERROR_CODES.DO_MD_PARSE_ERROR,
      },
    ];

    for (const { args, code } of cases) {
      const exitCode = EXIT_BY_CODE[code];
      assertErrorJson(runCli([...args, "--json"], { cwd: dir }), { exitCode, code });
      assert.equal(runCli(args, { cwd: dir }).status, exitCode);
    }
  });
});

test("CLI rejected Errors produce documented process exits", () => {
  withTempDir((dir) => {
    writeSimpleProject(dir, { data: JSON.stringify({ title: "Hello" }) });
    writeFileSync(path.join(dir, "bad.json"), "{not json");
    writeFileSync(path.join(dir, "wrap.tpl.md"), "{% function( %}\n");
    writeFileSync(path.join(dir, "runtime.tpl.md"), "{% doc.fizzbuzz() %}\n");

    const cases = [
      { args: ["validate"], code: ERROR_CODES.DO_MD_USER_ERROR },
      {
        args: ["create", "out.md", "tpl.md", "--data", "bad.json"],
        code: ERROR_CODES.DO_MD_USER_ERROR,
      },
      {
        args: ["set", "doc.md", "tpl.md", "--key", "missing", "--value", "x"],
        code: ERROR_CODES.DO_MD_USER_ERROR,
      },
      {
        args: ["validate", "doc.md", "wrap.tpl.md"],
        code: ERROR_CODES.DO_MD_TEMPLATE_ERROR,
      },
      {
        args: ["create", "fresh.md", "runtime.tpl.md", "--data", "data.json"],
        code: ERROR_CODES.DO_MD_TEMPLATE_ERROR,
      },
      {
        args: ["validate", "missing.md", "tpl.md"],
        code: ERROR_CODES.DO_MD_IO_ERROR,
      },
      {
        args: ["create", "out.md", "missing.tpl.md", "--data", "data.json"],
        code: ERROR_CODES.DO_MD_IO_ERROR,
      },
      {
        args: ["export", "missing.md", "tpl.md", "--save", "out.json"],
        code: ERROR_CODES.DO_MD_IO_ERROR,
      },
      {
        args: ["set", "missing.md", "tpl.md", "--key", "title", "--value", "x"],
        code: ERROR_CODES.DO_MD_IO_ERROR,
      },
      {
        args: ["render", "missing.md", "tpl.md", "tpl.md", "out.txt"],
        code: ERROR_CODES.DO_MD_IO_ERROR,
      },
    ];

    for (const { args, code } of cases) {
      const exitCode = EXIT_BY_CODE[code];
      assertErrorJson(runCli([...args, "--json"], { cwd: dir }), { exitCode, code });
      assert.equal(runCli(args, { cwd: dir }).status, exitCode);
    }
  });
});

test("does not accept -m / -t aliases", () => {
  const result = runCli(["validate", "doc.md", "-t", "tpl.md"]);
  assert.equal(result.status, 1);
});

test("quickstart CLI flow on release-notes", () => {
  withTempDir((dir) => {
    cpSync(path.join(fixtureDir, "input.md"), path.join(dir, "release.md"));
    cpSync(path.join(fixtureDir, "template.tpl.md"), path.join(dir, "release.tpl.md"));

    const validated = runCli(["validate", "release.md", "release.tpl.md"], { cwd: dir });
    assert.equal(validated.status, 0);

    const exported = runCli(
      ["export", "release.md", "release.tpl.md", "--save", "release.json"],
      { cwd: dir },
    );
    assert.equal(exported.status, 0);
    assert.deepEqual(JSON.parse(readFileSync(path.join(dir, "release.json"), "utf8")), {
      version: "1.2.0",
      date: "2026-08-22",
      changes: ["Added Writer round-trip", "Added conformance fixtures"],
    });

    const created = runCli(
      ["create", "release-2.md", "release.tpl.md", "--data", "release.json"],
      { cwd: dir },
    );
    assert.equal(created.status, 0);
    assert.equal(
      readFileSync(path.join(dir, "release-2.md"), "utf8").replace(/\r\n/g, "\n"),
      readFileSync(path.join(dir, "release.md"), "utf8").replace(/\r\n/g, "\n"),
    );

    const mutated = runCli(
      ["set", "release.md", "release.tpl.md", "--key", "version", "--value", "2.0.0"],
      { cwd: dir },
    );
    assert.equal(mutated.status, 0);
    const updated = readFileSync(path.join(dir, "release.md"), "utf8");
    assert.match(updated, /^# 2\.0\.0/m);
    assert.match(updated, /2026-08-22/);
    assert.match(updated, /Added Writer round-trip/);
  });
});
