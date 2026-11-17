# Browser slice

Import the explicit portable entry with a browser-aware ESM bundler:

```js
import {
  Fetch,
  Virtual,
  Editor,
  Template,
  Reader,
  Writer,
  exportDoc,
  formatDiagnostic,
} from "@p10i/do-md/browser";
```

The root, `/io`, `/http` and `/mcp` entries remain Node integrations. The browser
entry does not export NodeFilesystem, package-file Skill reading, transports or
terminal color options. It includes document commands, the language reference,
source maps, diagnostics, Fetch and Virtual. No Node polyfills are required.
Use esbuild, Vite or Rollup to resolve dependencies; there is no CDN dependency
or prebuilt global script-tag distribution.

## Load and extract over HTTP

```js
const io = new Fetch();
const base = new URL("./documents/", location.href).href;
const result = await exportDoc({
  io,
  cwd: base,
  file: "document.md",
  template: "shape.md.template",
});
if (!result.ok) {
  document.querySelector("#error").textContent = formatDiagnostic(result.errors[0]);
} else {
  console.log(result.context);
}
```

Omitting `savePath` makes library `exportDoc` read-only and returns context inline,
in Node as well as browsers. Providing it requests a write through the adapter.
The CLI still requires `--save`; MCP keeps its existing optional-save behavior.

Fetch is read-only and follows browser fetch/CORS rules. Relative URLs without
`cwd` resolve against the document base. Explicit URL bases avoid that dependency.
Fetch decodes UTF-8 bytes with BOM preservation rather than Response.text(), which
consumes the BOM.

## Edit in memory

```js
const [source, template] = await Promise.all([
  io.readFileAsync(new URL("document.md", base).href),
  io.readFileAsync(new URL("shape.md.template", base).href),
]);
const memory = new Virtual({ "document.md": source, "shape.md.template": template });
const editor = await Editor.open({
  io: memory,
  file: "document.md",
  template: "shape.md.template",
});
editor.set("title", "Updated");
const markdown = editor.render();
await editor.save();
```

Virtual revisions and conflict checks have the same semantics in both runtimes.
Revisions remain synchronous `sha256:<hex>` over UTF-8 strings or exact byte views;
hashing needs neither Web Crypto nor a secure context. Byte-returning adapters use
TextDecoder, retaining BOMs and measuring raw input limits. Precise edits preserve
untouched spans and line endings.

Without `cwd`, defaults belong to the adapter: disk uses the Node working directory,
Virtual uses virtual keys, and Fetch can use relative URLs. Custom resolvers must
handle that default instead of assuming process.cwd() was supplied by the command.

## Generate without I/O

```js
const data = { title: "Generated" };
const writer = new Writer(data);
Template.wrap('# {% doc.line().as("title") %}')(writer, data, data);
console.log(writer.toMarkdown());
```

The same synchronous template language drives Reader and Writer. Template code
executes with the authority of the page; it is trusted JavaScript, not a sandbox.

## Diagnostics and CSP

Syntax diagnostics use Acorn and the same source maps in every runtime. Runtime
frames use error-stack-parser. Function-wrapper offsets are calibrated once per
engine, without user-agent sniffing or a hardcoded V8 offset. Missing stacks do
not fabricate exact template positions. Display frames with `formatDiagnostic()`
and DOM `textContent`; browser frames are plain text. A stable plain inspection
hook belongs to the model; explicit Node formatting alone adds ANSI.

Compilation uses `new Function()`. CSP without `'unsafe-eval'` blocks it; DoMdError
explains the blocked operation and retains its native EvalError cause. The demo's
`/strict` page tests that policy. Direct Reader/Writer operations remain usable.
Precompiled artifacts for strict-CSP deployment are outside this slice.

## Example and verification

```sh
npm ci
npm run browser:serve
# Isolated tarball build and import-graph check, without starting engines:
npm run browser:pack
# Real Chromium, Firefox and WebKit:
npx playwright install --with-deps chromium firefox webkit
npm run test:browser
```

See [the playground](../examples/browser/README.md). Tests build an isolated
installed tarball, not private checkout imports. The build rejects transitive
Node built-ins and free Node globals in core sources using lexical scope analysis.
The prepared browser matrix covers Fetch, precise edits, revisions, generation, provenance,
data spans, downloads and strict CSP. The deferred manual Ubuntu job installs browser system dependencies.
Targets are modern browsers with ES2022, structuredClone, TextEncoder/TextDecoder
and Intl.Segmenter; older browsers need separate support work.

The Node suite additionally runs the browser bundle in a realm without process,
Buffer or Node inspection dependencies. That is a portability check, not real-browser proof.
Playwright's downloaded engines do not run on Alpine/musl: use a supported glibc
host or the Ubuntu CI job. Engine checks must pass before promoting this slice
to a browser-verified release.
