import test from "node:test";
import assert from "node:assert/strict";

import { Editor, lookupSlot } from "../sources/Editor.mjs";
import { Reader } from "../sources/Reader.mjs";
import { Virtual } from "../sources/IO/Virtual.mjs";
import { ERROR_CODES } from "../sources/SyntaxError.mjs";

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

const CHAPTERS_TPL = `# {% doc.line().as("title") %}

{%
doc.scope("chapters", (ch) => {
  ch.heading(2).as("name")
  ch.literal("\\n\\n")
  ch.paragraph().as("intro")
  ch.literal("\\n\\n")
})
doc.optional()
%}
`;

const CHAPTERS_DOC = `# Book

## One

Intro one

## Two

Intro two

`;

const NOTES_TPL = '{% doc.line().asArray("notes") %}\n{% doc.line().asArray("notes") %}\n';
const NOTES_DOC = "alpha\nbeta\n";

async function openDoc(files, file = "/doc.md", template = "/tpl.md") {
  const io = new Virtual(files);
  return Editor.open({ io, file, template });
}

test("Editor module exists", () => {
  assert.equal(typeof Editor, "function");
  const editor = new Editor({ file: "x.md", template: "" });
  assert.equal(editor.file, "x.md");
  assert.equal(editor.template, "");
});

test("Editor.open reads via io and stores source, slotMap, and snapshots", async () => {
  const editor = await openDoc({ "/doc.md": RELEASE_DOC, "/tpl.md": RELEASE_TPL });
  assert.equal(editor.file, "/doc.md");
  assert.equal(editor.template, "/tpl.md");
  assert.equal(editor.originalSource, RELEASE_DOC);
  assert.deepEqual(editor.get("version"), "1.2.0");
  assert.deepEqual(editor.original.version, "1.2.0");
  assert.ok(editor.slotMap.some((slot) => slot.key === "version" && slot.leafType === "line"));
  assert.ok(editor.slotMap.some((slot) => slot.key === "changes" && slot.leafType === "list"));
});

test("Editor.open prefers the revision snapshot API for the document", async () => {
  const io = new Virtual({ "/doc.md": RELEASE_DOC, "/tpl.md": RELEASE_TPL });
  const reads = [];
  const readSnapshot = io.readFileSnapshotAsync.bind(io);
  io.readFileSnapshotAsync = async (path, options) => {
    reads.push(path);
    return readSnapshot(path, options);
  };
  const editor = await Editor.open({ io, file: "/doc.md", template: "/tpl.md" });
  assert.deepEqual(reads, ["/doc.md"]);
  assert.match(editor.revision, /^sha256:/);
});

test("Editor.open parses while preserving BOM, line endings, and missing final newline", async () => {
  const crlf = `\uFEFF${RELEASE_DOC.replaceAll("\n", "\r\n").replace(/\r\n$/, "")}`;
  const crlfEditor = await openDoc({ "/doc.md": crlf, "/tpl.md": RELEASE_TPL });
  assert.equal(crlfEditor.originalSource, crlf);
  assert.equal(crlfEditor.get("version"), "1.2.0");
  assert.equal(crlfEditor.render(), crlf);

  const cr = RELEASE_DOC.replaceAll("\n", "\r").replace(/\r$/, "");
  const crEditor = await openDoc({ "/doc.md": cr, "/tpl.md": RELEASE_TPL });
  assert.equal(crEditor.originalSource, cr);
  assert.equal(crEditor.render(), cr);
});

test("Editor.open preserves NFC and intra-line whitespace", async () => {
  const tpl = '{% doc.line().as("title") %}\n';
  const nfc = "caf\u00e9  \n";
  const nfd = "cafe\u0301  \n";
  const nfcEditor = await openDoc({ "/doc.md": nfc, "/tpl.md": tpl });
  const nfdEditor = await openDoc({ "/doc.md": nfd, "/tpl.md": tpl });
  assert.equal(nfcEditor.originalSource, nfc);
  assert.equal(nfdEditor.originalSource, nfd);
  assert.notEqual(nfcEditor.originalSource, nfdEditor.originalSource);
  assert.equal(nfcEditor.get("title"), "caf\u00e9  ");
  assert.equal(nfdEditor.get("title"), "cafe\u0301  ");

  const spaced = "hello  \t  \nworld   ";
  const spacedEditor = await openDoc({
    "/doc.md": spaced,
    "/tpl.md": '{% doc.line().as("a") %}\n{% doc.line().as("b") %}\n',
  });
  assert.equal(spacedEditor.originalSource, spaced);
});

test("Editor.open missing io, file, or template throws DO_MD_USER_ERROR", async () => {
  const io = new Virtual({ "/doc.md": RELEASE_DOC, "/tpl.md": RELEASE_TPL });
  await assert.rejects(() => Editor.open({}), (err) => err.code === ERROR_CODES.DO_MD_USER_ERROR);
  await assert.rejects(() => Editor.open({ io }), (err) => err.code === ERROR_CODES.DO_MD_USER_ERROR);
  await assert.rejects(
    () => Editor.open({ io, file: "/doc.md" }),
    (err) => err.code === ERROR_CODES.DO_MD_USER_ERROR,
  );
});

test("Editor.open throws DO_MD_PARSE_ERROR with validate diagnostics", async () => {
  await assert.rejects(
    () => openDoc({ "/doc.md": "not a heading\n", "/tpl.md": RELEASE_TPL }),
    (err) => {
      assert.equal(err.code, ERROR_CODES.DO_MD_PARSE_ERROR);
      assert.ok(Array.isArray(err.errors));
      assert.equal(err.errors[0].code, ERROR_CODES.DO_MD_PARSE_ERROR);
      assert.ok(err.locations[0].source);
      assert.ok(err.locations[0].range.start.line >= 1);
      assert.ok(err.locations[0].range.start.column >= 1);
      return true;
    },
  );
});

test("get, has, and keys resolve dotted and bracketed paths against ctx", async () => {
  const editor = await openDoc({ "/doc.md": RELEASE_DOC, "/tpl.md": RELEASE_TPL });
  assert.equal(editor.get("version"), "1.2.0");
  assert.equal(editor.get("date"), "2026-08-22");
  assert.deepEqual(editor.get("changes"), ["Added Writer round-trip", "Added conformance fixtures"]);
  assert.equal(editor.get("changes[0]"), "Added Writer round-trip");
  assert.equal(editor.get("changes[1]"), "Added conformance fixtures");
  assert.equal(editor.get("missing"), undefined);
  assert.equal(editor.get("changes[9]"), undefined);
  assert.equal(editor.has("version"), true);
  assert.equal(editor.has("changes[0]"), true);
  assert.equal(editor.has("missing"), false);
  assert.deepEqual(editor.keys(), ["version", "date", "changes"]);
});

test("get and has resolve scoped and asArray descendant paths", async () => {
  const chapters = await openDoc({ "/doc.md": CHAPTERS_DOC, "/tpl.md": CHAPTERS_TPL });
  assert.equal(chapters.get("title"), "Book");
  assert.equal(chapters.get("chapters[0].name"), "One");
  assert.equal(chapters.get("chapters[1].intro"), "Intro two");
  assert.deepEqual(chapters.get("chapters[1]"), { name: "Two", intro: "Intro two" });
  assert.equal(chapters.has("chapters[0]"), true);
  assert.equal(chapters.has("chapters[0].name"), true);
  assert.equal(chapters.has("chapters[9].name"), false);
  assert.deepEqual(chapters.keys(), ["title", "chapters"]);

  const notes = await openDoc({ "/doc.md": NOTES_DOC, "/tpl.md": NOTES_TPL });
  assert.deepEqual(notes.get("notes"), ["alpha", "beta"]);
  assert.equal(notes.get("notes[1]"), "beta");
  assert.equal(notes.has("notes[0]"), true);
  assert.deepEqual(notes.keys(), ["notes"]);
});

test("context and original are protected snapshots", async () => {
  const editor = await openDoc({ "/doc.md": RELEASE_DOC, "/tpl.md": RELEASE_TPL });
  const ctx = editor.context;
  const original = editor.original;
  assert.deepEqual(ctx.version, "1.2.0");
  assert.deepEqual(original.version, "1.2.0");
  assert.notEqual(ctx, editor._context);
  assert.notEqual(original, editor._original);

  try {
    ctx.version = "nope";
    ctx.changes.push("mutated");
    original.version = "nope";
    original.changes.push("mutated");
  } catch {
    // frozen copies may throw
  }

  assert.equal(editor.get("version"), "1.2.0");
  assert.equal(editor.original.version, "1.2.0");
  assert.equal(editor.context.changes.length, 2);
  assert.equal(editor.original.changes.length, 2);

  editor.set("version", "2.0.0");
  assert.equal(editor.get("version"), "2.0.0");
  assert.equal(editor.context.version, "2.0.0");
  assert.equal(editor.original.version, "1.2.0");
});

test("path parsing accepts dotted keys and bracketed indexes and rejects unsafe keys", async () => {
  const editor = await openDoc({ "/doc.md": CHAPTERS_DOC, "/tpl.md": CHAPTERS_TPL });
  assert.equal(editor.get("title"), "Book");
  assert.equal(editor.get("chapters[1].name"), "Two");

  const invalid = [
    "",
    ".",
    "a.",
    ".a",
    "a..b",
    "a[",
    "a]",
    "[]",
    "a[b]",
    "a[-1]",
    "a[2]b",
    "__proto__",
    "constructor",
    "prototype",
    "a.__proto__",
    "foo.constructor",
    "chapters[0].prototype",
  ];
  for (const path of invalid) {
    assert.throws(
      () => editor.get(path),
      (err) => err.code === ERROR_CODES.DO_MD_USER_ERROR && /invalid path/.test(err.message),
    );
    assert.throws(
      () => editor.has(path),
      (err) => err.code === ERROR_CODES.DO_MD_USER_ERROR && /invalid path/.test(err.message),
    );
  }
});

test("lookupSlot classifies exact slots, aggregate descendants, and unknown paths", async () => {
  const release = await openDoc({ "/doc.md": RELEASE_DOC, "/tpl.md": RELEASE_TPL });
  assert.equal(lookupSlot(release.slotMap, "version").kind, "exact");
  assert.equal(lookupSlot(release.slotMap, "version").slot.leafType, "line");
  assert.equal(lookupSlot(release.slotMap, "changes").kind, "exact");
  assert.equal(lookupSlot(release.slotMap, "changes[0]").kind, "descendant");
  assert.equal(lookupSlot(release.slotMap, "changes[0]").slot.key, "changes");
  assert.equal(lookupSlot(release.slotMap, "changes[0]").slot.leafType, "list");
  assert.equal(lookupSlot(release.slotMap, "missing").kind, "unknown");
  assert.equal(lookupSlot(release.slotMap, "missing").slot, null);

  const chapters = await openDoc({ "/doc.md": CHAPTERS_DOC, "/tpl.md": CHAPTERS_TPL });
  assert.equal(lookupSlot(chapters.slotMap, "chapters[1].name").kind, "exact");
  assert.equal(lookupSlot(chapters.slotMap, "chapters[1]").kind, "descendant");
  assert.equal(lookupSlot(chapters.slotMap, "chapters").kind, "descendant");
  assert.equal(lookupSlot(chapters.slotMap, "chapters[9].name").kind, "unknown");

  const notes = await openDoc({ "/doc.md": NOTES_DOC, "/tpl.md": NOTES_TPL });
  assert.equal(lookupSlot(notes.slotMap, "notes[0]").kind, "exact");
  assert.equal(lookupSlot(notes.slotMap, "notes[0]").slot.isArrayElement, true);
  assert.equal(lookupSlot(notes.slotMap, "notes").kind, "descendant");
});

test("set stages exact scalar replacements and descendant aggregate mutations", async () => {
  const io = new Virtual({ "/doc.md": RELEASE_DOC, "/tpl.md": RELEASE_TPL });
  const editor = await Editor.open({ io, file: "/doc.md", template: "/tpl.md" });
  editor.set("version", "2.0.0");
  editor.set("changes[0]", "First change");
  assert.equal(editor.get("version"), "2.0.0");
  assert.equal(editor.get("changes[0]"), "First change");
  assert.equal(editor.original.version, "1.2.0");
  assert.equal(editor._structuralDirty, true);
  assert.equal(await io.readFileAsync("/doc.md"), RELEASE_DOC);
});

test("set requires an exact slot or aggregate descendant and checks exact scalar shapes", async () => {
  const editor = await openDoc({ "/doc.md": RELEASE_DOC, "/tpl.md": RELEASE_TPL });
  assert.throws(
    () => editor.set("missing", "x"),
    (err) => err.code === ERROR_CODES.DO_MD_USER_ERROR && /unknown slot/.test(err.message),
  );
  assert.throws(
    () => editor.set("version", 2),
    (err) => err.code === ERROR_CODES.DO_MD_USER_ERROR && /type mismatch/.test(err.message),
  );
  assert.equal(editor.get("version"), "1.2.0");
  editor.set("changes", ["one", "two"]);
  assert.deepEqual(editor.get("changes"), ["one", "two"]);
  assert.equal(editor._structuralDirty, false);
  editor.set("changes", ["only"]);
  assert.equal(editor._structuralDirty, true);
});

test("set on scoped descendants is structural and skips leaf-shape checks", async () => {
  const editor = await openDoc({ "/doc.md": CHAPTERS_DOC, "/tpl.md": CHAPTERS_TPL });
  editor.set("chapters[0].name", "Renamed");
  assert.equal(editor.get("chapters[0].name"), "Renamed");
  assert.equal(editor._structuralDirty, false);
  editor.set("chapters[1]", { name: "Next", intro: "Later" });
  assert.deepEqual(editor.get("chapters[1]"), { name: "Next", intro: "Later" });
  assert.equal(editor._structuralDirty, true);
});

test("patch shallow-merges at root and marks the document structural-dirty", async () => {
  const editor = await openDoc({ "/doc.md": RELEASE_DOC, "/tpl.md": RELEASE_TPL });
  editor.patch({ version: "9.0.0", extra: "allowed" });
  assert.equal(editor.get("version"), "9.0.0");
  assert.equal(editor.get("date"), "2026-08-22");
  assert.equal(editor.get("extra"), "allowed");
  assert.equal(editor.original.version, "1.2.0");
  assert.equal(editor._structuralDirty, true);
  assert.throws(
    () => editor.patch(["nope"]),
    (err) => err.code === ERROR_CODES.DO_MD_USER_ERROR,
  );
});

test("merge deep-merges and marks the document structural-dirty", async () => {
  const editor = await openDoc({ "/doc.md": CHAPTERS_DOC, "/tpl.md": CHAPTERS_TPL });
  editor.merge({ title: "Renamed Book", extra: { nested: true } });
  assert.equal(editor.get("title"), "Renamed Book");
  assert.equal(editor.get("extra.nested"), true);
  assert.equal(editor.get("chapters[0].name"), "One");
  assert.equal(editor._structuralDirty, true);
});

test("merge rejects __proto__, constructor, and prototype at any depth", async () => {
  const editor = await openDoc({ "/doc.md": CHAPTERS_DOC, "/tpl.md": CHAPTERS_TPL });
  const cases = [
    [{ ["__proto__"]: { polluted: true } }, "__proto__"],
    [{ constructor: { polluted: true } }, "constructor"],
    [{ prototype: { polluted: true } }, "prototype"],
    [{ extra: { ["__proto__"]: { polluted: true } } }, "extra.__proto__"],
    [{ extra: { nested: { constructor: true } } }, "extra.nested.constructor"],
    [{ chapters: [{ name: "X", ["__proto__"]: { polluted: true } }] }, "chapters[0].__proto__"],
    [{ chapters: [{ prototype: true }] }, "chapters[0].prototype"],
    [{ chapters: [{ intro: { constructor: {} } }] }, "chapters[0].intro.constructor"],
  ];
  for (const [patch, path] of cases) {
    assert.throws(
      () => editor.merge(patch),
      (err) => {
        assert.equal(err.code, ERROR_CODES.DO_MD_USER_ERROR);
        assert.match(err.message, /unsafe patch key/);
        assert.match(err.message, new RegExp(path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
        return true;
      },
    );
  }
  assert.equal(editor.isDirty, false);
  assert.equal(editor.get("title"), "Book");
  assert.equal(editor.get("chapters[0].name"), "One");
  assert.equal(editor._structuralDirty, false);
  assert.equal(Object.getPrototypeOf(editor._context), Object.prototype);
});

test("delete removes exact slots or aggregate descendants", async () => {
  const editor = await openDoc({ "/doc.md": RELEASE_DOC, "/tpl.md": RELEASE_TPL });
  editor.delete("changes[0]");
  assert.deepEqual(editor.get("changes"), ["Added conformance fixtures"]);
  editor.delete("version");
  assert.equal(editor.get("version"), undefined);
  assert.equal(editor._structuralDirty, true);
  assert.throws(
    () => editor.delete("missing"),
    (err) => err.code === ERROR_CODES.DO_MD_USER_ERROR && /unknown slot/.test(err.message),
  );
});

test("append prepend insert and move require an array slot or descendant array", async () => {
  const editor = await openDoc({ "/doc.md": RELEASE_DOC, "/tpl.md": RELEASE_TPL });
  editor.append("changes", "Third");
  editor.prepend("changes", "Zeroth");
  editor.insert("changes", 2, "Inserted");
  editor.move("changes", 0, 4);
  assert.deepEqual(editor.get("changes"), [
    "Added Writer round-trip",
    "Inserted",
    "Added conformance fixtures",
    "Third",
    "Zeroth",
  ]);
  assert.equal(editor._structuralDirty, true);
  assert.throws(
    () => editor.append("version", "x"),
    (err) => err.code === ERROR_CODES.DO_MD_USER_ERROR && /type mismatch/.test(err.message),
  );
  assert.throws(
    () => editor.prepend("missing", "x"),
    (err) => err.code === ERROR_CODES.DO_MD_USER_ERROR && /unknown slot/.test(err.message),
  );
  assert.throws(
    () => editor.insert("changes[0]", 0, "x"),
    (err) => err.code === ERROR_CODES.DO_MD_USER_ERROR && /type mismatch/.test(err.message),
  );
});

test("array mutations accept descendant arrays under aggregate slots", async () => {
  const chapters = await openDoc({ "/doc.md": CHAPTERS_DOC, "/tpl.md": CHAPTERS_TPL });
  chapters.append("chapters", { name: "Three", intro: "Intro three" });
  assert.equal(chapters.get("chapters").length, 3);
  assert.equal(chapters.get("chapters[2].name"), "Three");
  assert.equal(chapters._structuralDirty, true);

  const notes = await openDoc({ "/doc.md": NOTES_DOC, "/tpl.md": NOTES_TPL });
  notes.prepend("notes", "zero");
  notes.insert("notes", 2, "mid");
  notes.move("notes", 1, 3);
  assert.deepEqual(notes.get("notes"), ["zero", "mid", "beta", "alpha"]);
  assert.equal(notes._structuralDirty, true);
  notes.set("notes[0]", "zed");
  assert.equal(notes.get("notes[0]"), "zed");
});

test("isDirty and dirtyKeys track staged mutation paths", async () => {
  const editor = await openDoc({ "/doc.md": RELEASE_DOC, "/tpl.md": RELEASE_TPL });
  assert.equal(editor.isDirty, false);
  assert.deepEqual(editor.dirtyKeys, []);
  editor.set("version", "2.0.0");
  editor.set("changes[0]", "First change");
  assert.equal(editor.isDirty, true);
  assert.deepEqual(editor.dirtyKeys, ["version", "changes[0]"]);
  editor.set("version", "3.0.0");
  assert.deepEqual(editor.dirtyKeys, ["version", "changes[0]"]);
});

test("changes is a protected journal of path/before/after entries", async () => {
  const editor = await openDoc({ "/doc.md": RELEASE_DOC, "/tpl.md": RELEASE_TPL });
  editor.set("version", "2.0.0");
  editor.set("version", "3.0.0");
  editor.append("changes", "Third");
  const journal = editor.changes;
  assert.equal(journal.length, 3);
  assert.deepEqual(journal[0], { path: "version", before: "1.2.0", after: "2.0.0" });
  assert.deepEqual(journal[1], { path: "version", before: "2.0.0", after: "3.0.0" });
  assert.equal(journal[2].path, "changes");
  assert.deepEqual(journal[2].before, ["Added Writer round-trip", "Added conformance fixtures"]);
  assert.deepEqual(journal[2].after, ["Added Writer round-trip", "Added conformance fixtures", "Third"]);
  try {
    journal.push({ path: "nope", before: 1, after: 2 });
    journal[0].after = "mutated";
  } catch {
    // frozen copies may throw
  }
  assert.equal(editor.changes.length, 3);
  assert.equal(editor.changes[0].after, "2.0.0");
});

test("revert discards one journaled mutation without writing", async () => {
  const io = new Virtual({ "/doc.md": RELEASE_DOC, "/tpl.md": RELEASE_TPL });
  const editor = await Editor.open({ io, file: "/doc.md", template: "/tpl.md" });
  editor.set("version", "2.0.0");
  editor.set("version", "3.0.0");
  editor.set("changes[0]", "First change");
  editor.revert("version");
  assert.equal(editor.get("version"), "2.0.0");
  assert.equal(editor.get("changes[0]"), "First change");
  assert.deepEqual(editor.dirtyKeys, ["version", "changes[0]"]);
  assert.equal(editor.changes.length, 2);
  assert.equal(editor.isDirty, true);
  assert.equal(editor.original.version, "1.2.0");
  assert.equal(await io.readFileAsync("/doc.md"), RELEASE_DOC);
  editor.revert("changes[0]");
  assert.equal(editor.get("changes[0]"), "Added Writer round-trip");
  assert.equal(editor._structuralDirty, false);
  assert.throws(
    () => editor.revert("date"),
    (err) => err.code === ERROR_CODES.DO_MD_USER_ERROR && /unknown slot/.test(err.message),
  );
});

test("revertAll discards everything since open and does not touch the file", async () => {
  const io = new Virtual({ "/doc.md": RELEASE_DOC, "/tpl.md": RELEASE_TPL });
  const editor = await Editor.open({ io, file: "/doc.md", template: "/tpl.md" });
  editor.set("version", "2.0.0");
  editor.append("changes", "Third");
  editor.patch({ extra: "allowed" });
  editor.revertAll();
  assert.equal(editor.isDirty, false);
  assert.deepEqual(editor.dirtyKeys, []);
  assert.deepEqual(editor.changes, []);
  assert.equal(editor.get("version"), "1.2.0");
  assert.deepEqual(editor.get("changes"), ["Added Writer round-trip", "Added conformance fixtures"]);
  assert.equal(editor.get("extra"), undefined);
  assert.equal(editor._structuralDirty, false);
  assert.deepEqual(editor.context.version, editor.original.version);
  assert.equal(await io.readFileAsync("/doc.md"), RELEASE_DOC);
});

test("revert rebuilds later journal entries from the original snapshot", async () => {
  const editor = await openDoc({ "/doc.md": RELEASE_DOC, "/tpl.md": RELEASE_TPL });
  editor.append("changes", "Third");
  editor.delete("changes[0]");
  editor.revert("changes");
  assert.deepEqual(editor.get("changes"), ["Added conformance fixtures"]);
  assert.equal(editor.isDirty, true);
  assert.deepEqual(editor.dirtyKeys, ["changes[0]"]);
  editor.revertAll();
  editor.merge({ title: "ignored-unknown", version: "9.0.0" });
  editor.revert("version");
  assert.equal(editor.get("version"), "1.2.0");
  assert.equal(editor.get("title"), "ignored-unknown");
  assert.equal(editor.isDirty, true);
});

test("render returns composed text and does not write", async () => {
  const io = new Virtual({ "/doc.md": RELEASE_DOC, "/tpl.md": RELEASE_TPL });
  const writes = [];
  const originalWrite = io.writeFileAsync.bind(io);
  io.writeFileAsync = async (path, content) => {
    writes.push(path);
    return originalWrite(path, content);
  };
  const editor = await Editor.open({ io, file: "/doc.md", template: "/tpl.md" });
  editor.set("version", "2.0.0");
  const text = editor.render();
  assert.match(text, /# 2\.0\.0/);
  assert.match(text, /Released on 2026-08-22\./);
  assert.match(text, /- Added Writer round-trip/);
  assert.equal(await io.readFileAsync("/doc.md"), RELEASE_DOC);
  assert.deepEqual(writes, []);
});

test("save overwrites the original file without changing final-newline state", async () => {
  const io = new Virtual({ "/doc.md": RELEASE_DOC, "/tpl.md": RELEASE_TPL });
  const editor = await Editor.open({ io, file: "/doc.md", template: "/tpl.md" });
  editor.set("version", "2.0.0");
  assert.equal(await io.readFileAsync("/doc.md"), RELEASE_DOC);
  await editor.save();
  const written = await io.readFileAsync("/doc.md");
  assert.match(written, /# 2\.0\.0/);
  assert.ok(written.endsWith("\n"));
  assert.equal(written, ensureSaved(editor.render()));
});

test("save({ to }) writes the alternate path and leaves the original untouched", async () => {
  const io = new Virtual({ "/doc.md": RELEASE_DOC, "/tpl.md": RELEASE_TPL });
  const editor = await Editor.open({ io, file: "/doc.md", template: "/tpl.md" });
  editor.set("version", "2.0.0");
  await editor.save({ to: "/other.md" });
  assert.equal(await io.readFileAsync("/doc.md"), RELEASE_DOC);
  const written = await io.readFileAsync("/other.md");
  assert.match(written, /# 2\.0\.0/);
  assert.ok(written.endsWith("\n"));
  assert.equal(written, ensureSaved(editor.render()));
});

test("save without writeFileAsync throws DO_MD_USER_ERROR and writes nothing", async () => {
  const io = new Virtual({ "/doc.md": RELEASE_DOC, "/tpl.md": RELEASE_TPL });
  const editor = await Editor.open({ io, file: "/doc.md", template: "/tpl.md" });
  editor.set("version", "2.0.0");
  editor.io = { readFileAsync: io.readFileAsync.bind(io) };
  await assert.rejects(
    () => editor.save(),
    (err) => err.code === ERROR_CODES.DO_MD_USER_ERROR,
  );
  assert.equal(await io.readFileAsync("/doc.md"), RELEASE_DOC);
});

test("structural mutations full-re-render on save and do not write on render failure", async () => {
  const io = new Virtual({ "/doc.md": CHAPTERS_DOC, "/tpl.md": CHAPTERS_TPL });
  const editor = await Editor.open({ io, file: "/doc.md", template: "/tpl.md" });
  editor.append("chapters", { name: "Three", intro: "Intro three" });
  const preview = editor.render();
  assert.match(preview, /## Three/);
  assert.match(preview, /Intro three/);
  assert.equal(await io.readFileAsync("/doc.md"), CHAPTERS_DOC);
  await editor.save();
  const written = await io.readFileAsync("/doc.md");
  assert.match(written, /## Three/);
  assert.match(written, /Intro three/);
  assert.match(written, /## One/);

  const failing = await Editor.open({ io, file: "/doc.md", template: "/tpl.md" });
  failing.merge({ chapters: "nope" });
  await assert.rejects(
    () => failing.save({ to: "/broken.md" }),
    (err) => err.code === ERROR_CODES.DO_MD_TEMPLATE_ERROR,
  );
  assert.equal(io.entries.has("/broken.md") || io.entries.has("broken.md"), false);
  assert.match(await io.readFileAsync("/doc.md"), /## Three/);
});

test("save rejects concurrent disk edits unless force is true", async () => {
  const io = new Virtual({ "/doc.md": RELEASE_DOC, "/tpl.md": RELEASE_TPL });
  const editor = await Editor.open({ io, file: "/doc.md", template: "/tpl.md" });
  editor.set("version", "2.0.0");
  await io.writeFileAsync("/doc.md", "externally changed\n");
  await assert.rejects(() => editor.save(), (err) => err.code === ERROR_CODES.DO_MD_CONFLICT);
  assert.equal(await io.readFileAsync("/doc.md"), "externally changed\n");
  await editor.save({ force: true });
  const written = await io.readFileAsync("/doc.md");
  assert.match(written, /# 2\.0\.0/);
  assert.doesNotMatch(written, /externally changed/);
});

test("revertAll render matches an unmodified open-time composition", async () => {
  const editor = await openDoc({ "/doc.md": RELEASE_DOC, "/tpl.md": RELEASE_TPL });
  const originalRender = editor.render();
  editor.set("version", "2.0.0");
  editor.append("changes", "Third");
  editor.revertAll();
  assert.equal(editor.render(), originalRender);
});

test("unmutated render is the original source bytes", async () => {
  const editor = await openDoc({ "/doc.md": RELEASE_DOC, "/tpl.md": RELEASE_TPL });
  assert.equal(editor.render(), RELEASE_DOC);
});

test("scalar set splices only the original slot byte range", async () => {
  const editor = await openDoc({ "/doc.md": RELEASE_DOC, "/tpl.md": RELEASE_TPL });
  const version = editor.slotMap.find((slot) => slot.key === "version");
  editor.set("version", "2.0.0");
  const rendered = editor.render();
  const expected =
    RELEASE_DOC.slice(0, version.sourceOffsetStart) +
    "2.0.0" +
    RELEASE_DOC.slice(version.sourceOffsetEnd);
  assert.equal(rendered, expected);
  assert.equal(rendered.slice(0, version.sourceOffsetStart), RELEASE_DOC.slice(0, version.sourceOffsetStart));
  assert.equal(rendered.slice(version.sourceOffsetStart + "2.0.0".length), RELEASE_DOC.slice(version.sourceOffsetEnd));
});

test("multiple scalar mutations splice from the original source in descending offset order", async () => {
  const editor = await openDoc({ "/doc.md": RELEASE_DOC, "/tpl.md": RELEASE_TPL });
  const version = editor.slotMap.find((slot) => slot.key === "version");
  const date = editor.slotMap.find((slot) => slot.key === "date");
  assert.ok(version.sourceOffsetStart < date.sourceOffsetStart);
  editor.set("version", "2.0.0-beta");
  editor.set("date", "2026-1-1");
  const rendered = editor.render();
  let expected = RELEASE_DOC;
  expected = expected.slice(0, date.sourceOffsetStart) + "2026-1-1" + expected.slice(date.sourceOffsetEnd);
  expected = expected.slice(0, version.sourceOffsetStart) + "2.0.0-beta" + expected.slice(version.sourceOffsetEnd);
  assert.equal(rendered, expected);
  assert.match(rendered, /# 2\.0\.0-beta\n/);
  assert.match(rendered, /Released on 2026-1-1\./);
  assert.match(rendered, /- Added Writer round-trip\n- Added conformance fixtures\n/);
});

test("same-length list replacement splices only the list slot range", async () => {
  const editor = await openDoc({ "/doc.md": RELEASE_DOC, "/tpl.md": RELEASE_TPL });
  const changes = editor.slotMap.find((slot) => slot.key === "changes");
  editor.set("changes", ["one", "two"]);
  const rendered = editor.render();
  assert.equal(
    rendered,
    RELEASE_DOC.slice(0, changes.sourceOffsetStart) + "- one\n- two" + RELEASE_DOC.slice(changes.sourceOffsetEnd),
  );
  assert.equal(editor._structuralDirty, false);
});

test("heading and asArray exact slots splice their recorded ranges", async () => {
  const chapters = await openDoc({ "/doc.md": CHAPTERS_DOC, "/tpl.md": CHAPTERS_TPL });
  const name = chapters.slotMap.find((slot) => slot.key === "chapters[0].name");
  chapters.set("chapters[0].name", "Renamed");
  const chapterText = chapters.render();
  assert.equal(
    chapterText,
    CHAPTERS_DOC.slice(0, name.sourceOffsetStart) + "## Renamed" + CHAPTERS_DOC.slice(name.sourceOffsetEnd),
  );

  const notes = await openDoc({ "/doc.md": NOTES_DOC, "/tpl.md": NOTES_TPL });
  notes.set("notes[0]", "zed");
  assert.equal(notes.render(), "zed\nbeta\n");
});

test("exact aggregate structural mutations splice only their owning range", async () => {
  const padded = RELEASE_DOC.replace("# 1.2.0\n\n", "# 1.2.0\n\n\n\n");
  const io = new Virtual({ "/doc.md": padded, "/tpl.md": RELEASE_TPL });
  const editor = await Editor.open({ io, file: "/doc.md", template: "/tpl.md" });
  editor.set("version", "2.0.0-beta");
  editor.append("changes", "Third");
  const rendered = editor.render();
  const changes = editor.slotMap.find((slot) => slot.key === "changes");
  let expected = `${padded.slice(0, changes.sourceOffsetStart)}- Added Writer round-trip\n- Added conformance fixtures\n- Third${padded.slice(changes.sourceOffsetEnd)}`;
  expected = expected.replace("1.2.0", "2.0.0-beta");
  assert.match(rendered, /# 2\.0\.0-beta/);
  assert.match(rendered, /- Third/);
  assert.match(rendered, /# 2\.0\.0-beta\n\n\n\nReleased/);
  assert.equal(rendered, expected);
  assert.equal(await io.readFileAsync("/doc.md"), padded);
});

test("listTree checkbox descendants splice only their three-byte markers", async () => {
  const template = '{% doc.listTree().as("tasks") %}\n';
  const source = "- [ ] parent\r\n  - [x] nested\r\n- [x] sibling\r\n";
  const editor = await openDoc({ "/doc.md": source, "/tpl.md": template });
  const tasks = editor.slotMap.find((slot) => slot.key === "tasks");
  assert.deepEqual(tasks.items.map((item) => item.key), [
    "tasks.items[0]",
    "tasks.items[0].children[1].children[0]",
    "tasks.items[1]",
  ]);

  editor.set("tasks.items[0].children[1].children[0].checked", false);
  assert.equal(editor.render(), "- [ ] parent\r\n  - [ ] nested\r\n- [x] sibling\r\n");
});

test("top-level scope append remove and move replace only the scope source range", async () => {
  const template = `HEAD \n{% doc.scope("items", (item) => { item.literal("- "); item.line().as("name"); item.literal("\\n") }) %}TAIL \n`;
  const source = "HEAD  \r\n- one\r\n- two\r\nTAIL\t\r\n";
  const cases = [
    [(editor) => editor.append("items", { name: "three" }), "- one\r\n- two\r\n- three\r\n"],
    [(editor) => editor.prepend("items", { name: "zero" }), "- zero\r\n- one\r\n- two\r\n"],
    [(editor) => editor.insert("items", 1, { name: "middle" }), "- one\r\n- middle\r\n- two\r\n"],
    [(editor) => editor.delete("items[0]"), "- two\r\n"],
    [(editor) => editor.move("items", 1, 0), "- two\r\n- one\r\n"],
    [(editor) => editor.set("items", [{ name: "replacement" }]), "- replacement\r\n"],
  ];
  for (const [mutate, scoped] of cases) {
    const editor = await openDoc({ "/doc.md": source, "/tpl.md": template });
    const region = editor.regionMap.find((item) => item.path === "items");
    mutate(editor);
    const rendered = editor.render();
    assert.equal(rendered, `HEAD  \r\n${scoped}TAIL\t\r\n`);
    assert.equal(rendered.slice(0, region.sourceOffsetStart), source.slice(0, region.sourceOffsetStart));
    assert.ok(rendered.endsWith(source.slice(region.sourceOffsetEnd)));
  }
});

test("BOM-prefixed scope edits shift structural regions with slot offsets", async () => {
  const template = `{% doc.scope("items", (item) => { item.literal("- "); item.line().as("name"); item.literal("\\n") }) %}tail\n`;
  const source = "\uFEFF- one\r\ntail\r\n";
  const editor = await openDoc({ "/doc.md": source, "/tpl.md": template });
  editor.append("items", { name: "two" });
  assert.equal(editor.render(), "\uFEFF- one\r\n- two\r\ntail\r\n");
});

test("empty scope append uses matching zero-width Reader and Writer anchors", async () => {
  const template = `before\n{% doc.scope("items", (item) => { item.literal("- "); item.line().as("name"); item.literal("\\n") }) %}after\n`;
  const source = "before\r\nafter\r\n";
  const editor = await openDoc({ "/doc.md": source, "/tpl.md": template });
  const region = editor.regionMap.find((item) => item.path === "items");
  assert.equal(region.sourceOffsetStart, region.sourceOffsetEnd);
  assert.equal(editor.has("items"), true);
  assert.deepEqual(editor.keys(), ["items"]);
  editor.append("items", { name: "inserted" });
  assert.equal(editor.render(), "before\r\n- inserted\r\nafter\r\n");
});

test("nested scope structural edits preserve its parent and all outside bytes", async () => {
  const template = `START \n{% doc.scope("chapters", (chapter) => {
  chapter.heading(2).as("name")
  chapter.literal("\\n")
  chapter.scope("sections", (section) => { section.literal("* "); section.line().as("name"); section.literal("\\n") })
}) %}END \n`;
  const source = "START  \r\n## One\r\n* A\r\n* B\r\nEND\t\r\n";
  const editor = await openDoc({ "/doc.md": source, "/tpl.md": template });
  const nested = editor.regionMap.find((item) => item.path === "chapters[0].sections");
  editor.append("chapters[0].sections", { name: "C" });
  const rendered = editor.render();
  assert.equal(rendered, "START  \r\n## One\r\n* A\r\n* B\r\n* C\r\nEND\t\r\n");
  assert.equal(rendered.slice(0, nested.sourceOffsetStart), source.slice(0, nested.sourceOffsetStart));
  assert.ok(rendered.endsWith(source.slice(nested.sourceOffsetEnd)));
});

test("save reparses and refreshes scoped regions", async () => {
  const template = `before\n{% doc.scope("items", (item) => { item.literal("- "); item.line().as("name"); item.literal("\\n") }) %}after\n`;
  const source = "before\r\n- one\r\nafter\r\n";
  const io = new Virtual({ "/doc.md": source, "/tpl.md": template });
  const editor = await Editor.open({ io, file: "/doc.md", template: "/tpl.md" });
  const before = editor.regionMap.find((item) => item.path === "items");
  editor.append("items", { name: "two" });
  await editor.save();
  const after = editor.regionMap.find((item) => item.path === "items");
  assert.equal(after.elements.length, 2);
  assert.ok(after.sourceOffsetEnd > before.sourceOffsetEnd);
  editor.append("items", { name: "three" });
  assert.equal(editor.render(), "before\r\n- one\r\n- two\r\n- three\r\nafter\r\n");
});

test("save rebasing retains context-only patch properties", async () => {
  const io = new Virtual({ "/doc.md": RELEASE_DOC, "/tpl.md": RELEASE_TPL });
  const editor = await Editor.open({ io, file: "/doc.md", template: "/tpl.md" });
  editor.merge({ version: "2.0.0", extra: { retained: true } });
  await editor.save();
  assert.deepEqual(editor.get("extra"), { retained: true });
  assert.deepEqual(editor.original.extra, { retained: true });
});

test("resized table replacement preserves all bytes outside the table span", async () => {
  const source = "Before\r\n\r\n| A | B |\r\n| --- | --- |\r\n| 1 | 2 |\r\n\r\nAfter";
  const template = 'Before\n\n{% doc.table().as("table") %}\n\nAfter\n';
  const editor = await openDoc({ "/doc.md": source, "/tpl.md": template });
  const slot = editor.slotMap.find((item) => item.key === "table");
  editor.set("table", {
    headers: ["A", "B"],
    align: [null, null],
    rows: [["x", "y"], ["z", "w"]],
  });
  const rendered = editor.render();
  assert.equal(rendered.slice(0, slot.sourceOffsetStart), source.slice(0, slot.sourceOffsetStart));
  assert.ok(rendered.endsWith(source.slice(slot.sourceOffsetEnd)));
  assert.match(rendered, /\| x\s+\| y\s+\|/);
  assert.match(rendered, /\| z\s+\| w\s+\|/);
});

test("save({ to }) after scalar splice leaves the original path untouched", async () => {
  const io = new Virtual({ "/doc.md": RELEASE_DOC, "/tpl.md": RELEASE_TPL });
  const editor = await Editor.open({ io, file: "/doc.md", template: "/tpl.md" });
  editor.set("version", "2.0.0");
  await editor.save({ to: "/out.md" });
  assert.equal(await io.readFileAsync("/doc.md"), RELEASE_DOC);
  assert.equal(await io.readFileAsync("/out.md"), ensureSaved(RELEASE_DOC.replace("1.2.0", "2.0.0")));
});

test("save preserves a missing final newline and rebases editor state", async () => {
  const io = new Virtual({ "/doc.md": "# Hello", "/tpl.md": '# {% doc.line().as("title") %}\n' });
  const editor = await Editor.open({ io, file: "/doc.md", template: "/tpl.md" });
  editor.set("title", "World");
  await editor.save();
  assert.equal(await io.readFileAsync("/doc.md"), "# World");
  assert.equal(editor.isDirty, false);
  assert.deepEqual(editor.dirtyKeys, []);
  assert.equal(editor.original.title, "World");
  editor.set("title", "Again");
  assert.equal(editor.render(), "# Again");
});

test("mutation methods return this and do not write before save", async () => {
  const io = new Virtual({ "/doc.md": RELEASE_DOC, "/tpl.md": RELEASE_TPL });
  const editor = await Editor.open({ io, file: "/doc.md", template: "/tpl.md" });
  assert.equal(editor.set("version", "2.0.0"), editor);
  assert.equal(editor.patch({ extra: "allowed" }), editor);
  assert.equal(editor.merge({ extra: "merged" }), editor);
  assert.equal(editor.append("changes", "Third"), editor);
  assert.equal(editor.prepend("changes", "Zeroth"), editor);
  assert.equal(editor.insert("changes", 1, "Inserted"), editor);
  assert.equal(editor.move("changes", 0, 1), editor);
  assert.equal(editor.delete("changes[0]"), editor);
  assert.equal(editor.revert("changes[0]"), editor);
  assert.equal(editor.revertAll(), editor);
  assert.equal(await io.readFileAsync("/doc.md"), RELEASE_DOC);
});

test("set type mismatches reject list, checkbox, table, codeBlock, link, image, and thematicBreak shapes", async () => {
  const release = await openDoc({ "/doc.md": RELEASE_DOC, "/tpl.md": RELEASE_TPL });
  assert.throws(
    () => release.set("changes", "nope"),
    (err) => err.code === ERROR_CODES.DO_MD_USER_ERROR && /type mismatch/.test(err.message),
  );
  assert.throws(
    () => release.set("changes", [1, 2]),
    (err) => err.code === ERROR_CODES.DO_MD_USER_ERROR && /type mismatch/.test(err.message),
  );

  const checkbox = await openDoc({
    "/doc.md": "- [x] ship it\n",
    "/tpl.md": '- {% doc.checkbox().as("done") %} {% doc.line().as("text") %}\n',
  });
  assert.throws(
    () => checkbox.set("done", "yes"),
    (err) => err.code === ERROR_CODES.DO_MD_USER_ERROR && /type mismatch/.test(err.message),
  );
  checkbox.set("done", false);
  assert.equal(checkbox.get("done"), false);

  const table = await openDoc({
    "/doc.md": "| A | B |\n| --- | --- |\n| 1 | 2 |\n",
    "/tpl.md": '{% doc.table().as("table") %}\n',
  });
  assert.throws(
    () => table.set("table", { headers: ["A"], rows: [["1", "2"]], align: [null] }),
    (err) => err.code === ERROR_CODES.DO_MD_USER_ERROR && /type mismatch/.test(err.message),
  );
  assert.throws(
    () => table.set("table", { headers: [], rows: [], align: [] }),
    (err) => err.code === ERROR_CODES.DO_MD_USER_ERROR && /type mismatch/.test(err.message),
  );

  const code = await openDoc({
    "/doc.md": "```js\nconst x = 1;\n```\n",
    "/tpl.md": '{% doc.codeBlock().as("sample") %}\n',
  });
  assert.throws(
    () => code.set("sample", "nope"),
    (err) => err.code === ERROR_CODES.DO_MD_USER_ERROR && /type mismatch/.test(err.message),
  );
  assert.throws(
    () => code.set("sample", { language: "ts", meta: 1, value: "const y = 2;" }),
    (err) => err.code === ERROR_CODES.DO_MD_USER_ERROR && /type mismatch/.test(err.message),
  );
  code.set("sample", { language: "ts", value: "const y = 2;" });
  assert.deepEqual(new Reader(code.render()).codeBlock().value, { language: "ts", meta: "", value: "const y = 2;" });

  const link = await openDoc({
    "/doc.md": '[docs](https://example.com "Guide")\n',
    "/tpl.md": '{% doc.link().as("homepage") %}\n',
  });
  assert.throws(
    () => link.set("homepage", "https://example.com"),
    (err) => err.code === ERROR_CODES.DO_MD_USER_ERROR && /type mismatch/.test(err.message),
  );

  const image = await openDoc({
    "/doc.md": '![logo](logo.png "Company")\n',
    "/tpl.md": '{% doc.image().as("logo") %}\n',
  });
  assert.throws(
    () => image.set("logo", "logo.png"),
    (err) => err.code === ERROR_CODES.DO_MD_USER_ERROR && /type mismatch/.test(err.message),
  );

  const hr = await openDoc({
    "/doc.md": "---\n",
    "/tpl.md": '{% doc.thematicBreak().as("hr") %}\n',
  });
  assert.throws(
    () => hr.set("hr", false),
    (err) => err.code === ERROR_CODES.DO_MD_USER_ERROR && /type mismatch/.test(err.message),
  );
  hr.set("hr", true);
  assert.equal(hr.get("hr"), true);
});

test("insert and move throw for unknown paths and invalid indexes", async () => {
  const editor = await openDoc({ "/doc.md": RELEASE_DOC, "/tpl.md": RELEASE_TPL });
  assert.throws(
    () => editor.insert("missing", 0, "x"),
    (err) => err.code === ERROR_CODES.DO_MD_USER_ERROR && /unknown slot/.test(err.message),
  );
  assert.throws(
    () => editor.move("missing", 0, 1),
    (err) => err.code === ERROR_CODES.DO_MD_USER_ERROR && /unknown slot/.test(err.message),
  );
  assert.throws(
    () => editor.append("missing", "x"),
    (err) => err.code === ERROR_CODES.DO_MD_USER_ERROR && /unknown slot/.test(err.message),
  );
  assert.throws(
    () => editor.insert("changes", -1, "x"),
    (err) => err.code === ERROR_CODES.DO_MD_USER_ERROR && /type mismatch/.test(err.message),
  );
  assert.throws(
    () => editor.insert("changes", 1.5, "x"),
    (err) => err.code === ERROR_CODES.DO_MD_USER_ERROR && /type mismatch/.test(err.message),
  );
  assert.throws(
    () => editor.move("changes", 9, 0),
    (err) => err.code === ERROR_CODES.DO_MD_USER_ERROR && /type mismatch/.test(err.message),
  );
  assert.throws(
    () => editor.move("changes", -1, 0),
    (err) => err.code === ERROR_CODES.DO_MD_USER_ERROR && /type mismatch/.test(err.message),
  );
  assert.equal(editor.isDirty, false);
});

test("patch rejects unsafe keys at any depth and stays shallow", async () => {
  const editor = await openDoc({ "/doc.md": RELEASE_DOC, "/tpl.md": RELEASE_TPL });
  const cases = [
    [{ ["__proto__"]: { polluted: true } }, "__proto__"],
    [{ constructor: { polluted: true } }, "constructor"],
    [{ prototype: { polluted: true } }, "prototype"],
    [{ extra: { nested: { constructor: true } } }, "extra.nested.constructor"],
    [{ extra: [{ prototype: true }] }, "extra[0].prototype"],
  ];
  for (const [patch, path] of cases) {
    assert.throws(
      () => editor.patch(patch),
      (err) => {
        assert.equal(err.code, ERROR_CODES.DO_MD_USER_ERROR);
        assert.match(err.message, /unsafe patch key/);
        assert.match(err.message, new RegExp(path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
        return true;
      },
    );
  }
  assert.equal(editor.isDirty, false);
  editor.patch({ extra: { a: 1, b: 2 } });
  editor.patch({ extra: { c: 3 } });
  assert.deepEqual(editor.get("extra"), { c: 3 });
  assert.equal(editor.get("version"), "1.2.0");
  assert.equal(editor._structuralDirty, true);
});

test("merge deep-merges existing objects and leaves sibling keys", async () => {
  const editor = await openDoc({ "/doc.md": RELEASE_DOC, "/tpl.md": RELEASE_TPL });
  editor.patch({ extra: { a: 1, b: 2 } });
  editor.merge({ extra: { b: 3, c: 4 }, version: "9.0.0" });
  assert.deepEqual(editor.get("extra"), { a: 1, b: 3, c: 4 });
  assert.equal(editor.get("version"), "9.0.0");
  assert.equal(editor.get("date"), "2026-08-22");
});

test("patch and merge type mismatches throw during full render", async () => {
  const patched = await openDoc({ "/doc.md": RELEASE_DOC, "/tpl.md": RELEASE_TPL });
  patched.patch({ changes: "nope" });
  assert.throws(
    () => patched.render(),
    (err) => err.code === ERROR_CODES.DO_MD_USER_ERROR,
  );

  const merged = await openDoc({ "/doc.md": RELEASE_DOC, "/tpl.md": RELEASE_TPL });
  merged.merge({ changes: "nope" });
  assert.throws(
    () => merged.render(),
    (err) => err.code === ERROR_CODES.DO_MD_USER_ERROR,
  );
  assert.equal(merged.isDirty, true);
});

test("delete removes scoped descendants and unknown delete still throws", async () => {
  const editor = await openDoc({ "/doc.md": CHAPTERS_DOC, "/tpl.md": CHAPTERS_TPL });
  editor.delete("chapters[0].name");
  assert.equal(editor.get("chapters[0].name"), undefined);
  assert.deepEqual(editor.get("chapters[0]"), { intro: "Intro one" });
  editor.delete("chapters[0]");
  assert.equal(editor.get("chapters[0].name"), "Two");
  assert.equal(editor.get("chapters").length, 1);
  assert.throws(
    () => editor.delete("chapters[9].name"),
    (err) => err.code === ERROR_CODES.DO_MD_USER_ERROR && /unknown slot/.test(err.message),
  );
});

const SERIALIZER_TPL = `{%
ctx.seenBullet = options.bullet
ctx.seenFlag = options.myCustomFlag
ctx.seenQuiet = options.quiet
%}{% doc.heading(1).as("title") %}

{% doc.list().as("items") %}

{% doc.codeBlock().as("block") %}

{% doc.table().as("table") %}
`;

const SERIALIZER_DOC = `# Hello

- a
- b

\`\`\`js
x
\`\`\`

| A | B |
| --- | --- |
| 1 | 2 |
`;

test("Editor.open forwards options into the template and render honors serializer settings", async () => {
  const io = new Virtual({ "/doc.md": SERIALIZER_DOC, "/tpl.md": SERIALIZER_TPL });
  const editor = await Editor.open({
    io,
    file: "/doc.md",
    template: "/tpl.md",
    options: {
      bullet: "*",
      orderedDelim: ")",
      fence: "~",
      headingStyle: "setext",
      tightLists: false,
      tablePadding: false,
      myCustomFlag: "yes",
      quiet: true,
      json: true,
    },
  });

  assert.equal(editor.get("seenBullet"), "*");
  assert.equal(editor.get("seenFlag"), "yes");
  assert.equal(editor.get("seenQuiet"), true);

  editor.merge({ items: ["x", "y"] });
  const output = editor.render();
  assert.match(output, /^# Hello/);
  assert.match(output, /\* x\n\n\* y/);
  assert.match(output, /```js\nx\n```/);
  assert.match(output, /\| A \| B \|/);
});

function ensureSaved(text) {
  const value = String(text ?? "");
  return value.endsWith("\n") ? value : `${value}\n`;
}
