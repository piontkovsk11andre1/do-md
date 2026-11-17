import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { createContext, Script } from "node:vm";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { portableGraph } from "../scripts/browser/Build.mjs";
import { createContentRevision } from "../sources/ContentRevision.mjs";
import { equalData } from "../sources/DataEquality.mjs";
import { Fetch } from "../sources/IO/Fetch.mjs";
import { readText } from "../sources/commands/helpers.mjs";

test("portable SHA-256 matches Node for strings, random bytes and sliced views", () => {
  for (const input of [
    "",
    "abc",
    "\uFEFF😀\r\n",
    "\ud800",
    randomBytes(1000),
    randomBytes(500).subarray(17, 211),
  ]) {
    assert.equal(
      createContentRevision(input),
      `sha256:${createHash("sha256").update(input).digest("hex")}`,
    );
  }
});

test("YAML data equality preserves signed zero, NaN, constructors and cycles", () => {
  assert.equal(equalData({ n: -0 }, { n: 0 }), false);
  assert.equal(equalData(-0, 0), false);
  assert.equal(equalData({ n: NaN }, { n: NaN }), true);
  assert.equal(equalData(Object.assign(Object.create(null), { x: 1 }), { x: 1 }), false);
  const left = { value: 1 };
  left.self = left;
  const right = { value: 1 };
  right.self = right;
  assert.equal(equalData(left, right), true);
  right.value = 2;
  assert.equal(equalData(left, right), false);
});

test("Fetch retains network BOMs and byte adapters enforce raw byte limits", async (t) => {
  const source = "\uFEFF# café\r\n";
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response(source);
  t.after(() => {
    globalThis.fetch = original;
  });
  const snapshot = await new Fetch().readFileSnapshotAsync("https://example.test/doc.md");
  assert.equal(snapshot.content, source);
  assert.equal(snapshot.revision, createContentRevision(source));
  const bytes = new Uint8Array([0xff]);
  const io = { readFileAsync: async () => bytes };
  assert.equal(await readText(io, "doc", { maxInputBytes: 1 }), "\ufffd");
  await assert.rejects(readText(io, "doc", { maxInputBytes: 0 }), /maxInputBytes/);
});

test("browser public entry builds without polyfills and runs in a realm without Node globals", async () => {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const bundle = await build({
    stdin: {
      contents: "import * as api from '@p10i/do-md/browser'; globalThis.api = api;",
      resolveDir: root,
      loader: "js",
    },
    absWorkingDir: root,
    bundle: true,
    platform: "browser",
    format: "iife",
    target: "es2022",
    write: false,
    metafile: true,
    plugins: [portableGraph(root)],
  });
  const realm = createContext({ TextEncoder, TextDecoder, structuredClone, URL, fetch, console });
  new Script(bundle.outputFiles[0].text).runInContext(realm);
  const result = await new Script(`(async () => {
    const io = new api.Virtual({ 'doc.md': '# Old\\r\\nbody 😀', 'shape.md.template': '# {% doc.line().as("title") %}\\n{% doc.rawRest().as("body"); %}' });
    const input = { io, file: 'doc.md', template: 'shape.md.template' };
    const editor = await api.Editor.open(input);
    editor.set('title', 'New');
    await editor.save();
    const data = await api.exportDoc(input);
    const matches = await api.match({ ...input, templates: '*.md.template' });
    return JSON.stringify({ text: await io.readFileAsync('doc.md'), title: data.context.title, matched: matches.ok,
      process: typeof process, Buffer: typeof Buffer, inspection: Object.hasOwn(api.DoMdError.prototype, Symbol.for('nodejs.util.inspect.custom')),
      disk: 'NodeFilesystem' in api, skill: 'readSkill' in api });
  })()`).runInContext(realm);
  assert.deepEqual(JSON.parse(result), {
    text: "# New\r\nbody 😀",
    title: "New",
    matched: true,
    process: "undefined",
    Buffer: "undefined",
    inspection: true,
    disk: false,
    skill: false,
  });

  const restricted = createContext(
    { TextEncoder, TextDecoder, structuredClone, URL, fetch, console },
    { codeGeneration: { strings: false, wasm: false } },
  );
  new Script(bundle.outputFiles[0].text).runInContext(restricted);
  assert.throws(
    () => restricted.api.Template.wrap("{% return; %}"),
    (error) => {
      assert.equal(error.code, "DO_MD_TEMPLATE_ERROR");
      assert.match(error.message, /new Function/);
      assert.match(error.message, /Content Security Policy/);
      assert.equal(error.cause.name, "EvalError");
      return true;
    },
  );
});
