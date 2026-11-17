import test from "node:test";
import assert from "node:assert/strict";

import { create } from "../../sources/commands/create.mjs";
import { exportDoc } from "../../sources/commands/exportDoc.mjs";
import { render } from "../../sources/commands/render.mjs";
import { set } from "../../sources/commands/set.mjs";
import { validate } from "../../sources/commands/validate.mjs";
import { Virtual } from "../../sources/IO/Virtual.mjs";
import { ERROR_CODES } from "../../sources/DoMdError.mjs";

const TEMPLATE = '# {% doc.line().as("title") %}\n';
const RENDER_TEMPLATE = 'Title: {% doc.line().as("title") %}\n';
const INPUT = "# Hello\n";
const BAD_INPUT = "not a heading\n";
const BAD_WRAP = "{% function( %}\n";
const BAD_RUNTIME = "{% doc.fizzbuzz() %}\n";

const RESULT_KEYS = ["context", "errors", "exitCode", "ok", "output"];

function assertResolvedFailure(result, { exitCode, code, file }) {
  assert.equal(result.ok, false);
  assert.equal(result.exitCode, exitCode);
  assert.equal(result.output, null);
  assert.equal(result.context, null);
  assert.deepEqual(Object.keys(result).sort(), RESULT_KEYS);
  assert.ok(Array.isArray(result.errors));
  assert.ok(result.errors.length > 0);
  const err = result.errors[0];
  assert.equal(err.code, code);
  assert.equal(typeof err.message, "string");
  assert.match(err.message, /^[^\r\n]*$/);
  assert.ok(Array.isArray(err.locations));
  for (const location of err.locations) {
    assert.ok(Number.isInteger(location.range.start.line) && location.range.start.line >= 1);
    assert.ok(Number.isInteger(location.range.start.column) && location.range.start.column >= 1);
    assert.ok("snippet" in location);
  }
  if (file !== undefined) {
    assert.ok(err.locations.some((l) => l.source === file));
  }
}

function assertRejectedError(err, code, file) {
  assert.ok(err instanceof Error);
  assert.equal(err.ok, undefined);
  assert.equal(err.code, code);
  assert.equal(typeof err.message, "string");
  assert.match(err.message, /^[^\r\n]*$/);
  if (file !== undefined) {
    assert.ok(err.locations.some((l) => l.source === file));
  }
}

test("parse and documented user failures resolve Result.errors", async () => {
  const parseIo = new Virtual({
    "/doc.md": BAD_INPUT,
    "/tpl.md": TEMPLATE,
    "/parse.tpl.md": TEMPLATE,
    "/render.tpl.md": RENDER_TEMPLATE,
    "/out.md": "# keep\n",
  });

  const validated = await validate({ io: parseIo, file: "/doc.md", template: "/tpl.md" });
  assertResolvedFailure(validated, {
    exitCode: 2,
    code: ERROR_CODES.DO_MD_PARSE_ERROR,
    file: "/doc.md",
  });
  assert.equal(parseIo.entries.get("/out.md"), "# keep\n");

  const created = await create({
    io: parseIo,
    file: "/out.md",
    template: "/tpl.md",
    data: { title: "Hello" },
  });
  assertResolvedFailure(created, {
    exitCode: 1,
    code: ERROR_CODES.DO_MD_USER_ERROR,
    file: "/out.md",
  });
  assert.equal(parseIo.entries.get("/out.md"), "# keep\n");

  parseIo.entries.set("/out.json", '{"keep":true}');
  const exported = await exportDoc({
    io: parseIo,
    file: "/doc.md",
    template: "/tpl.md",
    savePath: "/out.json",
  });
  assertResolvedFailure(exported, {
    exitCode: 2,
    code: ERROR_CODES.DO_MD_PARSE_ERROR,
    file: "/doc.md",
  });
  assert.equal(parseIo.entries.get("/out.json"), '{"keep":true}');

  const mutated = await set({
    io: parseIo,
    file: "/doc.md",
    template: "/tpl.md",
    key: "title",
    value: "World",
  });
  assertResolvedFailure(mutated, {
    exitCode: 2,
    code: ERROR_CODES.DO_MD_PARSE_ERROR,
    file: "/doc.md",
  });
  assert.equal(parseIo.entries.get("/doc.md"), BAD_INPUT);

  const rendered = await render({
    io: parseIo,
    file: "/doc.md",
    parseTemplate: "/parse.tpl.md",
    renderTemplate: "/render.tpl.md",
    outFile: "/out.txt",
  });
  assertResolvedFailure(rendered, {
    exitCode: 2,
    code: ERROR_CODES.DO_MD_PARSE_ERROR,
    file: "/doc.md",
  });
  assert.equal(parseIo.entries.has("/out.txt"), false);

  const neither = await set({ io: parseIo, file: "/doc.md", template: "/tpl.md" });
  assertResolvedFailure(neither, {
    exitCode: 1,
    code: ERROR_CODES.DO_MD_USER_ERROR,
  });
  assert.equal(parseIo.entries.get("/doc.md"), BAD_INPUT);
});

test("Reader notEmpty failures resolve as parse Results", async () => {
  const io = new Virtual({
    "/doc.md": "\n",
    "/tpl.md": '{% doc.line().notEmpty().as("title") %}\n',
  });

  for (const command of [
    () => validate({ io, file: "/doc.md", template: "/tpl.md" }),
    () => exportDoc({ io, file: "/doc.md", template: "/tpl.md", savePath: "/out.json" }),
    () => set({ io, file: "/doc.md", template: "/tpl.md", key: "title", value: "Hello" }),
  ]) {
    const result = await command();
    assertResolvedFailure(result, {
      exitCode: 2,
      code: ERROR_CODES.DO_MD_PARSE_ERROR,
      file: "/doc.md",
    });
  }
  assert.equal(io.entries.has("/out.json"), false);
  assert.equal(io.entries.get("/doc.md"), "\n");
});

test("template wrap and runtime failures reject DO_MD_TEMPLATE_ERROR", async () => {
  const wrapIo = new Virtual({
    "/doc.md": INPUT,
    "/tpl.md": BAD_WRAP,
    "/parse.tpl.md": TEMPLATE,
    "/render.tpl.md": BAD_WRAP,
  });

  await assert.rejects(
    () => validate({ io: wrapIo, file: "/doc.md", template: "/tpl.md" }),
    (err) => {
      assertRejectedError(err, ERROR_CODES.DO_MD_TEMPLATE_ERROR, "/tpl.md");
      return true;
    },
  );
  await assert.rejects(
    () => create({ io: wrapIo, file: "/out.md", template: "/tpl.md", data: { title: "Hello" } }),
    (err) => {
      assertRejectedError(err, ERROR_CODES.DO_MD_TEMPLATE_ERROR, "/tpl.md");
      return true;
    },
  );
  assert.equal(wrapIo.entries.has("/out.md"), false);
  await assert.rejects(
    () => exportDoc({ io: wrapIo, file: "/doc.md", template: "/tpl.md", savePath: "/out.json" }),
    (err) => {
      assertRejectedError(err, ERROR_CODES.DO_MD_TEMPLATE_ERROR, "/tpl.md");
      return true;
    },
  );
  assert.equal(wrapIo.entries.has("/out.json"), false);
  await assert.rejects(
    () => set({ io: wrapIo, file: "/doc.md", template: "/tpl.md", key: "title", value: "World" }),
    (err) => {
      assertRejectedError(err, ERROR_CODES.DO_MD_TEMPLATE_ERROR, "/tpl.md");
      return true;
    },
  );
  await assert.rejects(
    () =>
      render({
        io: wrapIo,
        file: "/doc.md",
        parseTemplate: "/parse.tpl.md",
        renderTemplate: "/render.tpl.md",
        outFile: "/out.txt",
      }),
    (err) => {
      assertRejectedError(err, ERROR_CODES.DO_MD_TEMPLATE_ERROR, "/render.tpl.md");
      return true;
    },
  );
  assert.equal(wrapIo.entries.has("/out.txt"), false);
  assert.equal(wrapIo.entries.get("/doc.md"), INPUT);

  const runtimeIo = new Virtual({
    "/doc.md": INPUT,
    "/tpl.md": BAD_RUNTIME,
    "/parse.tpl.md": TEMPLATE,
    "/render.tpl.md": BAD_RUNTIME,
  });

  await assert.rejects(
    () => validate({ io: runtimeIo, file: "/doc.md", template: "/tpl.md" }),
    (err) => {
      assertRejectedError(err, ERROR_CODES.DO_MD_TEMPLATE_ERROR, "/tpl.md");
      return true;
    },
  );
  await assert.rejects(
    () =>
      create({ io: runtimeIo, file: "/fresh.md", template: "/tpl.md", data: { title: "Hello" } }),
    (err) => {
      assertRejectedError(err, ERROR_CODES.DO_MD_TEMPLATE_ERROR, "/tpl.md");
      return true;
    },
  );
  assert.equal(runtimeIo.entries.has("/fresh.md"), false);
  await assert.rejects(
    () => exportDoc({ io: runtimeIo, file: "/doc.md", template: "/tpl.md", savePath: "/out.json" }),
    (err) => {
      assertRejectedError(err, ERROR_CODES.DO_MD_TEMPLATE_ERROR, "/tpl.md");
      return true;
    },
  );
  await assert.rejects(
    () =>
      set({ io: runtimeIo, file: "/doc.md", template: "/tpl.md", key: "title", value: "World" }),
    (err) => {
      assertRejectedError(err, ERROR_CODES.DO_MD_TEMPLATE_ERROR, "/tpl.md");
      return true;
    },
  );
  await assert.rejects(
    () =>
      render({
        io: runtimeIo,
        file: "/doc.md",
        parseTemplate: "/parse.tpl.md",
        renderTemplate: "/render.tpl.md",
        outFile: "/out.txt",
      }),
    (err) => {
      assertRejectedError(err, ERROR_CODES.DO_MD_TEMPLATE_ERROR, "/render.tpl.md");
      return true;
    },
  );
  assert.equal(runtimeIo.entries.has("/out.txt"), false);
});

test("I/O failures reject DO_MD_IO_ERROR", async () => {
  const io = new Virtual({
    "/tpl.md": TEMPLATE,
    "/parse.tpl.md": TEMPLATE,
    "/render.tpl.md": RENDER_TEMPLATE,
  });

  await assert.rejects(
    () => validate({ io, file: "/missing.md", template: "/tpl.md" }),
    (err) => {
      assertRejectedError(err, ERROR_CODES.DO_MD_IO_ERROR, "/missing.md");
      return true;
    },
  );
  await assert.rejects(
    () => create({ io, file: "/out.md", template: "/missing.tpl.md", data: { title: "Hello" } }),
    (err) => {
      assertRejectedError(err, ERROR_CODES.DO_MD_IO_ERROR, "/missing.tpl.md");
      return true;
    },
  );
  await assert.rejects(
    () => exportDoc({ io, file: "/missing.md", template: "/tpl.md", savePath: "/out.json" }),
    (err) => {
      assertRejectedError(err, ERROR_CODES.DO_MD_IO_ERROR, "/missing.md");
      return true;
    },
  );
  await assert.rejects(
    () => set({ io, file: "/missing.md", template: "/tpl.md", key: "title", value: "World" }),
    (err) => {
      assertRejectedError(err, ERROR_CODES.DO_MD_IO_ERROR, "/missing.md");
      return true;
    },
  );
  await assert.rejects(
    () =>
      render({
        io,
        file: "/missing.md",
        parseTemplate: "/parse.tpl.md",
        renderTemplate: "/render.tpl.md",
        outFile: "/out.txt",
      }),
    (err) => {
      assertRejectedError(err, ERROR_CODES.DO_MD_IO_ERROR, "/missing.md");
      return true;
    },
  );
});

test("bad library-call arguments reject DO_MD_USER_ERROR", async () => {
  const io = new Virtual({ "/doc.md": INPUT, "/tpl.md": TEMPLATE, "/parse.tpl.md": TEMPLATE });

  await assert.rejects(
    () => validate({}),
    (err) => {
      assertRejectedError(err, ERROR_CODES.DO_MD_USER_ERROR);
      return true;
    },
  );
  await assert.rejects(
    () => validate({ io, file: "/doc.md" }),
    (err) => {
      assertRejectedError(err, ERROR_CODES.DO_MD_USER_ERROR);
      return true;
    },
  );
  await assert.rejects(
    () => create({}),
    (err) => {
      assertRejectedError(err, ERROR_CODES.DO_MD_USER_ERROR);
      return true;
    },
  );
  await assert.rejects(
    () => create({ io, file: "/out.md" }),
    (err) => {
      assertRejectedError(err, ERROR_CODES.DO_MD_USER_ERROR);
      return true;
    },
  );
  await assert.rejects(
    () => create({ io, file: "/fresh.md", template: "/tpl.md", data: 42 }),
    (err) => {
      assertRejectedError(err, ERROR_CODES.DO_MD_USER_ERROR);
      return true;
    },
  );
  await assert.rejects(
    () => exportDoc({}),
    (err) => {
      assertRejectedError(err, ERROR_CODES.DO_MD_USER_ERROR);
      return true;
    },
  );
  await assert.rejects(
    () => exportDoc({ io, file: "/doc.md", template: "/tpl.md" }),
    (err) => {
      assertRejectedError(err, ERROR_CODES.DO_MD_USER_ERROR);
      return true;
    },
  );
  await assert.rejects(
    () => set({ key: "title", value: "World" }),
    (err) => {
      assertRejectedError(err, ERROR_CODES.DO_MD_USER_ERROR);
      return true;
    },
  );
  await assert.rejects(
    () => set({ io, key: "title", value: "World" }),
    (err) => {
      assertRejectedError(err, ERROR_CODES.DO_MD_USER_ERROR);
      return true;
    },
  );
  await assert.rejects(
    () => set({ io, file: "/doc.md", key: "title", value: "World" }),
    (err) => {
      assertRejectedError(err, ERROR_CODES.DO_MD_USER_ERROR);
      return true;
    },
  );
  await assert.rejects(
    () => set({ io, file: "/doc.md", template: "/tpl.md", key: "missing", value: "x" }),
    (err) => {
      assertRejectedError(err, ERROR_CODES.DO_MD_USER_ERROR);
      return true;
    },
  );
  await assert.rejects(
    () => render({}),
    (err) => {
      assertRejectedError(err, ERROR_CODES.DO_MD_USER_ERROR);
      return true;
    },
  );
  await assert.rejects(
    () =>
      render({ io, file: "/doc.md", parseTemplate: "/parse.tpl.md", renderTemplate: "/tpl.md" }),
    (err) => {
      assertRejectedError(err, ERROR_CODES.DO_MD_USER_ERROR);
      return true;
    },
  );
});
