# Browser playground

From a development checkout:

```sh
npm ci
npm run browser:serve
```

Open the printed localhost URL. The page imports `@p10i/do-md/browser`, loads its
document/template with Fetch, parses JSON, applies precise in-memory title edits,
renders edited JSON and downloads Markdown. Errors show code frames and locations.

The server is a static development server. No document writes are sent to it.
Templates are trusted JavaScript. The page permits dynamic compilation through
CSP `script-src 'self' 'unsafe-eval'`; `/strict` demonstrates the error produced
when `unsafe-eval` is omitted. Do not enter untrusted template code.

`npm run browser:build` prints a unique artifact directory under ignored `.browser/`.
`npm run browser:pack` verifies the installed tarball build without starting engines.
`npm run test:browser` builds the example and API tests from an isolated installed
tarball, checks the import graph, and runs Chromium, Firefox and WebKit. Install
their binaries/dependencies first with `npx playwright install --with-deps`.

Build/pack/serve/test invocations never share their output directory. Windows and
real-engine verification are currently deferred/manual; the scenarios remain available.
