import test from "node:test";
import assert from "node:assert/strict";

import { set } from "../../sources/commands/set.mjs";
import { Virtual } from "../../sources/IO/Virtual.mjs";
import { ERROR_CODES } from "../../sources/SyntaxError.mjs";

const TEMPLATE = '# {% doc.line().as("title") %}\n';
const INPUT = "# Hello\n";

function trackReads(io) {
  const reads = [];
  const original = io.readFileAsync.bind(io);
  io.readFileAsync = async (path, options) => {
    reads.push(path);
    return original(path, options);
  };
  return reads;
}

test("set command module exists", () => {
  assert.equal(typeof set, "function");
});

test("set with neither key nor patch resolves user error before parsing", async () => {
  const io = new Virtual({ "/doc.md": "not a heading\n", "/tpl.md": TEMPLATE });
  const reads = trackReads(io);
  const before = Object.fromEntries(io.entries);
  const result = await set({ io, file: "/doc.md", template: "/tpl.md" });

  assert.equal(result.ok, false);
  assert.equal(result.exitCode, 1);
  assert.equal(result.output, null);
  assert.equal(result.context, null);
  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0].code, ERROR_CODES.DO_MD_USER_ERROR);
  assert.deepEqual(reads, []);
  assert.deepEqual(Object.fromEntries(io.entries), before);
});

test("set with empty key and no patch does not parse", async () => {
  const io = new Virtual({ "/doc.md": INPUT, "/tpl.md": TEMPLATE });
  const reads = trackReads(io);
  const result = await set({ io, file: "/doc.md", template: "/tpl.md", key: "" });

  assert.equal(result.ok, false);
  assert.equal(result.exitCode, 1);
  assert.equal(result.errors[0].code, ERROR_CODES.DO_MD_USER_ERROR);
  assert.deepEqual(reads, []);
});

test("set with a top-level key re-renders the document", async () => {
  const io = new Virtual({ "/doc.md": INPUT, "/tpl.md": TEMPLATE });
  const result = await set({
    io,
    file: "/doc.md",
    template: "/tpl.md",
    key: "title",
    value: "World",
  });

  assert.equal(result.ok, true);
  assert.equal(result.exitCode, 0);
  assert.match(result.output, /World/);
  assert.equal(result.context.title, "World");
  assert.deepEqual(result.errors, []);
  assert.match(await io.readFileAsync("/doc.md"), /World/);
  assert.deepEqual(Object.keys(result).sort(), ["context", "errors", "exitCode", "ok", "output"]);
});

test("set parse failure resolves exit 2 and does not write", async () => {
  const io = new Virtual({ "/doc.md": "not a heading\n", "/tpl.md": TEMPLATE });
  const result = await set({
    io,
    file: "/doc.md",
    template: "/tpl.md",
    key: "title",
    value: "World",
  });

  assert.equal(result.ok, false);
  assert.equal(result.exitCode, 2);
  assert.equal(result.output, null);
  assert.equal(result.context, null);
  assert.equal(result.errors[0].code, ERROR_CODES.DO_MD_PARSE_ERROR);
  assert.equal(await io.readFileAsync("/doc.md"), "not a heading\n");
});

test("set writes --out and leaves the input file unchanged", async () => {
  const io = new Virtual({ "/doc.md": INPUT, "/tpl.md": TEMPLATE });
  const result = await set({
    io,
    file: "/doc.md",
    template: "/tpl.md",
    key: "title",
    value: "World",
    out: "/other.md",
  });

  assert.equal(result.ok, true);
  assert.equal(await io.readFileAsync("/doc.md"), INPUT);
  assert.match(await io.readFileAsync("/other.md"), /World/);
});

test("set applies patch then key", async () => {
  const io = new Virtual({ "/doc.md": INPUT, "/tpl.md": TEMPLATE });
  const result = await set({
    io,
    file: "/doc.md",
    template: "/tpl.md",
    patch: { title: "Patched" },
    key: "title",
    value: "Keyed",
  });

  assert.equal(result.ok, true);
  assert.equal(result.context.title, "Keyed");
  assert.match(await io.readFileAsync("/doc.md"), /Keyed/);
});

test("set rejects a wrap-time template error", async () => {
  const io = new Virtual({ "/doc.md": INPUT, "/tpl.md": "{% function( %}\n" });
  await assert.rejects(
    () => set({ io, file: "/doc.md", template: "/tpl.md", key: "title", value: "World" }),
    (err) => err.code === ERROR_CODES.DO_MD_TEMPLATE_ERROR,
  );
});

const RELEASE_TPL = `# {% doc.line().as("version") %}

Released on {% doc.until(".").as("date") %}.

## Changes

{% doc.list().as("changes") %}
`;

const RELEASE_DOC = `# 1.2.0

Released on 2026-08-22.

## Changes

- Added Writer round-trip
- Added conformance fixtures
`;

const LINK_TPL = '{% doc.link().as("homepage") %}\n';
const LINK_DOC = '[docs](https://example.com "Guide")\n';

const CHECKBOX_TPL = '- {% doc.checkbox().as("done") %} {% doc.line().as("text") %}\n';
const CHECKBOX_DOC = "- [x] ship it\n";

test("set with only patch deep-merges and writes", async () => {
  const io = new Virtual({ "/doc.md": LINK_DOC, "/tpl.md": LINK_TPL });
  const result = await set({
    io,
    file: "/doc.md",
    template: "/tpl.md",
    patch: { homepage: { url: "https://new.example" } },
  });

  assert.equal(result.ok, true);
  assert.equal(result.exitCode, 0);
  assert.deepEqual(result.context.homepage, {
    url: "https://new.example",
    text: "docs",
    title: "Guide",
  });
  assert.match(result.output, /https:\/\/new\.example/);
  assert.match(result.output, /docs/);
  assert.match(await io.readFileAsync("/doc.md"), /https:\/\/new\.example/);
});

test("set --patch deep-merges nested objects instead of replacing them", async () => {
  const io = new Virtual({ "/doc.md": LINK_DOC, "/tpl.md": LINK_TPL });
  const result = await set({
    io,
    file: "/doc.md",
    template: "/tpl.md",
    patch: { homepage: { title: "Handbook" }, extra: { nested: { keep: true } } },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.context.homepage, {
    url: "https://example.com",
    text: "docs",
    title: "Handbook",
  });
  assert.deepEqual(result.context.extra, { nested: { keep: true } });
  assert.match(result.output, /Handbook/);
  assert.match(result.output, /https:\/\/example\.com/);
});

test("set applies patch deep merge before key and key wins on overlap", async () => {
  const io = new Virtual({ "/doc.md": RELEASE_DOC, "/tpl.md": RELEASE_TPL });
  const result = await set({
    io,
    file: "/doc.md",
    template: "/tpl.md",
    patch: { version: "9.0.0", extra: { from: "patch", nested: { n: 1 } } },
    key: "version",
    value: "2.0.0",
  });

  assert.equal(result.ok, true);
  assert.equal(result.context.version, "2.0.0");
  assert.equal(result.context.date, "2026-08-22");
  assert.deepEqual(result.context.extra, { from: "patch", nested: { n: 1 } });
  assert.deepEqual(result.context.changes, ["Added Writer round-trip", "Added conformance fixtures"]);
  assert.match(result.output, /2\.0\.0/);
  assert.doesNotMatch(result.output, /9\.0\.0/);
});

test("set applies nested patch first then replaces the overlapping key", async () => {
  const io = new Virtual({ "/doc.md": LINK_DOC, "/tpl.md": LINK_TPL });
  const result = await set({
    io,
    file: "/doc.md",
    template: "/tpl.md",
    patch: { homepage: { url: "https://patched.example" }, extra: { from: "patch" } },
    key: "homepage",
    value: { url: "https://keyed.example", text: "keyed", title: "Keyed" },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.context.homepage, {
    url: "https://keyed.example",
    text: "keyed",
    title: "Keyed",
  });
  assert.deepEqual(result.context.extra, { from: "patch" });
  assert.match(result.output, /https:\/\/keyed\.example/);
  assert.doesNotMatch(result.output, /patched\.example/);
});

test("set library values stay already-coerced and are not JSON-parsed", async () => {
  const stringIo = new Virtual({ "/doc.md": INPUT, "/tpl.md": TEMPLATE });
  const kept = await set({
    io: stringIo,
    file: "/doc.md",
    template: "/tpl.md",
    key: "title",
    value: "42",
  });
  assert.equal(kept.ok, true);
  assert.equal(kept.context.title, "42");
  assert.equal(typeof kept.context.title, "string");

  const numberIo = new Virtual({ "/doc.md": INPUT, "/tpl.md": TEMPLATE });
  await assert.rejects(
    () =>
      set({
        io: numberIo,
        file: "/doc.md",
        template: "/tpl.md",
        key: "title",
        value: 42,
      }),
    (err) => err.code === ERROR_CODES.DO_MD_USER_ERROR && /type mismatch/.test(err.message),
  );
  assert.equal(await numberIo.readFileAsync("/doc.md"), INPUT);

  const listIo = new Virtual({ "/doc.md": RELEASE_DOC, "/tpl.md": RELEASE_TPL });
  const list = await set({
    io: listIo,
    file: "/doc.md",
    template: "/tpl.md",
    key: "changes",
    value: ["one", "two"],
  });
  assert.equal(list.ok, true);
  assert.deepEqual(list.context.changes, ["one", "two"]);

  const listStringIo = new Virtual({ "/doc.md": RELEASE_DOC, "/tpl.md": RELEASE_TPL });
  await assert.rejects(
    () =>
      set({
        io: listStringIo,
        file: "/doc.md",
        template: "/tpl.md",
        key: "changes",
        value: '["one","two"]',
      }),
    (err) => err.code === ERROR_CODES.DO_MD_USER_ERROR && /type mismatch/.test(err.message),
  );

  const checkboxIo = new Virtual({ "/doc.md": CHECKBOX_DOC, "/tpl.md": CHECKBOX_TPL });
  const checkbox = await set({
    io: checkboxIo,
    file: "/doc.md",
    template: "/tpl.md",
    key: "done",
    value: false,
  });
  assert.equal(checkbox.ok, true);
  assert.equal(checkbox.context.done, false);
  assert.equal(typeof checkbox.context.done, "boolean");
  assert.equal(checkbox.context.text, "ship it");

  const checkboxStringIo = new Virtual({ "/doc.md": CHECKBOX_DOC, "/tpl.md": CHECKBOX_TPL });
  await assert.rejects(
    () =>
      set({
        io: checkboxStringIo,
        file: "/doc.md",
        template: "/tpl.md",
        key: "done",
        value: "false",
      }),
    (err) => err.code === ERROR_CODES.DO_MD_USER_ERROR && /type mismatch/.test(err.message),
  );
});

const LIST_TPL = `{% doc.heading(1).as("title") %}

{% doc.list().as("items") %}
`;

const LIST_DOC = `# Hello

- a
- b
`;

test("set honors Writer serializer settings on a structural list mutation", async () => {
  const io = new Virtual({ "/doc.md": LIST_DOC, "/tpl.md": LIST_TPL });
  const result = await set({
    io,
    file: "/doc.md",
    template: "/tpl.md",
    patch: { items: ["x", "y"] },
    options: {
      bullet: "*",
      orderedDelim: ")",
      fence: "~",
      headingStyle: "setext",
      tightLists: false,
      tablePadding: false,
    },
  });

  assert.equal(result.ok, true);
  assert.match(result.output, /^# Hello/);
  assert.match(result.output, /\* x\n\n\* y/);
});
