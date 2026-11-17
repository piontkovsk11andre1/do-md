import { test, expect } from "@playwright/test";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

async function loadAPI(page) {
  await page.goto("/");
  await page.addScriptTag({ type: "module", url: "/api.js" });
  await page.waitForFunction(() => globalThis.doMd);
  expect(await page.evaluate(() => globalThis.doMdPacked)).toBe(true);
}

test("packed example loads, parses, edits, renders and downloads without Node globals", async ({
  page,
}) => {
  const unhandled = [];
  page.on("pageerror", (error) => unhandled.push(error.message));
  await page.goto("/");
  await expect(page.locator("#status")).toHaveText("Parsed in the browser");
  const initial = await page.locator("#document").inputValue();
  const parsed = JSON.parse(await page.locator("#data").inputValue());
  expect(parsed.title).toBe("Browser release");
  await page.locator("#title").fill("Changed 😀");
  await page.locator("#edit").click();
  await expect(page.locator("#status")).toHaveText("Precise edit applied");
  const expected = initial.replace("# Browser release", "# Changed 😀");
  expect(await page.locator("#document").inputValue()).toBe(expected);
  const downloadPromise = page.waitForEvent("download");
  await page.locator("#download").click();
  const download = await downloadPromise;
  expect(await readFile(await download.path(), "utf8")).toBe(expected);
  await page.locator("#data").fill(JSON.stringify({ ...parsed, title: "From JSON" }));
  await page.locator("#render").click();
  await expect(page.locator("#output")).toContainText("# From JSON");
  await page.locator("#template").fill("{%\nconst = 1;\n%}");
  await page.locator("#parse").click();
  await expect(page.locator("#diagnostic")).toContainText("shape.md.template:2:7");
  expect(unhandled).toEqual([]);
  expect(await page.evaluate(() => [typeof globalThis.process, typeof globalThis.Buffer])).toEqual([
    "undefined",
    "undefined",
  ]);
});

test("Fetch reads document and template over HTTP and remains read-only", async ({ page }) => {
  await loadAPI(page);
  const result = await page.evaluate(async () => {
    const { Fetch, exportDoc } = globalThis.doMd;
    const io = new Fetch();
    const parsed = await exportDoc({
      io,
      cwd: `${location.origin}/`,
      file: "document.md",
      template: "template.md.template",
    });
    const snapshot = await io.readFileSnapshotAsync(`${location.origin}/document.md`);
    let code;
    try {
      await io.writeFileAsync("document.md", "no");
    } catch (error) {
      code = error.code;
    }
    return { parsed, snapshot, code };
  });
  expect(result.parsed.ok).toBe(true);
  expect(result.parsed.context.title).toBe("Browser release");
  expect(result.snapshot.revision).toBe(
    `sha256:${createHash("sha256").update(result.snapshot.content).digest("hex")}`,
  );
  expect(result.code).toBe("DO_MD_IO_ERROR");
});

test("Virtual edits preserve BOM, Unicode, line endings and revision conflicts", async ({
  page,
}) => {
  await loadAPI(page);
  const results = await page.evaluate(async () => {
    const { Virtual, Editor, exportDoc, Template, Writer } = globalThis.doMd;
    const results = [];
    for (const eol of ["\n", "\r\n", "\r"]) {
      const original = `\uFEFF# Old${eol}<!-- untouched 😀 café -->${eol}body`;
      const template = '# {% doc.line().as("title") %}\n{% doc.rawRest().as("body"); %}';
      const io = new Virtual({ "/doc.md": original, "/shape.md.template": template });
      const input = { io, file: "/doc.md", template: "/shape.md.template" };
      const editor = await Editor.open(input);
      const stale = await Editor.open(input);
      editor.set("title", "New");
      await editor.save();
      stale.set("title", "Stale");
      let conflict;
      try {
        await stale.save();
      } catch (error) {
        conflict = error.code;
      }
      const parsed = await exportDoc(input);
      const writer = new Writer(parsed.context);
      Template.wrap(template)(writer, parsed.context, parsed.context);
      results.push({
        original,
        edited: await io.readFileAsync("/doc.md"),
        conflict,
        title: parsed.context.title,
        rendered: writer.toMarkdown(),
      });
    }
    return results;
  });
  for (const result of results) {
    expect(result.edited).toBe(result.original.replace("# Old", "# New"));
    expect(result.conflict).toBe("DO_MD_CONFLICT");
    expect(result.title).toBe("New");
    expect(result.rendered.startsWith("# New\n")).toBe(true);
    expect(result.rendered).toContain("<!-- untouched 😀 café -->");
  }
});

test("portable byte revisions match Node SHA-256 including offset views and lone surrogates", async ({
  page,
}) => {
  await loadAPI(page);
  const strings = ["", "abc", "\uFEFF# hi\r\n", "😀 café", "\ud800"];
  const result = await page.evaluate((strings) => {
    const { createContentRevision } = globalThis.doMd;
    return {
      strings: strings.map(createContentRevision),
      bytes: createContentRevision(new Uint8Array([5, 0, 255, 128, 5]).subarray(1, 4)),
    };
  }, strings);
  expect(result.strings).toEqual(
    strings.map((text) => `sha256:${createHash("sha256").update(text).digest("hex")}`),
  );
  expect(result.bytes).toBe(
    `sha256:${createHash("sha256")
      .update(new Uint8Array([0, 255, 128]))
      .digest("hex")}`,
  );
});

test("byte-returning adapters preserve UTF-8 BOMs without Buffer or process", async ({ page }) => {
  await loadAPI(page);
  const result = await page.evaluate(async () => {
    const source = "\uFEFF# byte 😀\r\n";
    const template = '# {% doc.line().as("title") %}\n';
    const io = {
      readFileAsync: async (path) => new TextEncoder().encode(path === "doc" ? source : template),
      resolvePath: (_cwd, path) => path,
    };
    return globalThis.doMd.exportDoc({ io, file: "doc", template: "template" });
  });
  expect(result.ok).toBe(true);
  expect(result.context.title).toBe("byte 😀");
});

test("syntax and runtime errors map to templates and enclosing Markdown", async ({ page }) => {
  await loadAPI(page);
  const result = await page.evaluate(() => {
    const { Template, createSourceMap, mapDiagnostic, formatDiagnostic } = globalThis.doMd;
    const syntax = "prefix\n\n{%\nconst = 1;\n%}";
    const runtime = 'prefix\n\n{%\nthrow new Error("boom");\n%}';
    const errors = [];
    for (const source of [syntax, runtime]) {
      try {
        Template.wrap(source, "inline.md.template")({ literal() {} });
      } catch (error) {
        const prefix = "# Command\n\n```template\n";
        const document = `${prefix}${source}\n\`\`\`\n`;
        const map = createSourceMap({
          generated: { source: "inline.md.template", text: source },
          original: { source: "workflow.md", text: document },
          segments: [
            {
              generatedStart: 0,
              generatedEnd: source.length,
              originalStart: prefix.length,
              originalEnd: prefix.length + source.length,
              kind: "exact",
            },
          ],
        });
        const diagnostic = mapDiagnostic(error, map);
        errors.push({
          diagnostic,
          formatted: formatDiagnostic(diagnostic),
          cause: error.cause?.message,
        });
      }
    }
    return errors;
  });
  expect(result).toHaveLength(2);
  for (const { diagnostic, formatted } of result) {
    const template = diagnostic.locations.find((location) => location.role === "template");
    expect(template?.source).toBe("inline.md.template");
    expect(template?.range.start.line).toBe(4);
    expect(template?.precision).toBe("exact");
    expect(diagnostic.locations.at(-1).source).toBe("workflow.md");
    expect(diagnostic.locations.at(-1).range.start.line).toBe(7);
    expect(formatted).toContain("workflow.md:7:");
    expect(formatted).toContain("^");
    expect(formatted).not.toContain("\x1b");
  }
  expect(result[0].diagnostic.locations.at(-1).range.start.column).toBe(7);
  expect(result[1].cause).toBe("boom");
});

test("validator failures carry data spans and template origins", async ({ page }) => {
  await loadAPI(page);
  const result = await page.evaluate(() => {
    const { Reader, Template, DoMdError } = globalThis.doMd;
    const reader = new Reader("# bad\n", { file: "input.md" });
    try {
      Template.wrap(
        '{% doc.heading(1).validate(() => {throw new Error("invalid");}).as("title"); %}',
        "shape.md.template",
      )(reader);
    } catch (error) {
      return {
        diagnostic: error.toDiagnostic(),
        inspectHook: Object.hasOwn(DoMdError.prototype, Symbol.for("nodejs.util.inspect.custom")),
      };
    }
  });
  expect(result.inspectHook).toBe(true);
  expect(result.diagnostic.locations.find((location) => location.role === "template")?.source).toBe(
    "shape.md.template",
  );
  const data = result.diagnostic.locations.find((location) => location.relation === "processing");
  expect(data.source).toBe("input.md");
  expect(data.precision).toBe("range");
  expect(data.range.start.offset).toBe(0);
  expect(data.range.end.offset).toBeGreaterThan(0);
});

test("match and query use adapter-owned defaults when cwd is omitted", async ({ page }) => {
  await loadAPI(page);
  const result = await page.evaluate(async () => {
    const { Virtual, match, query } = globalThis.doMd;
    const io = new Virtual({
      doc: "# One\n# Two\n",
      "shape.md.template": '{% doc.rawRest().as("body"); %}',
      "query.template":
        '{% doc.query(d => {d.literal("# "); d.line().as("title"); d.literal("\\n");}); doc.rawRest(); %}',
    });
    return {
      match: await match({ io, file: "doc", templates: "*.md.template" }),
      query: await query({ io, file: "doc", template: "query.template", all: true }),
    };
  });
  expect(result.match.ok).toBe(true);
  expect(result.query.context.matches.map((match) => match.context.title)).toEqual(["One", "Two"]);
});

test("strict CSP reports blocked compilation while direct Reader remains usable", async ({
  page,
}) => {
  await page.goto("/strict");
  await expect(page.locator("#status")).toHaveText("Error");
  await expect(page.locator("#diagnostic")).toContainText("Content Security Policy");
  await expect(page.locator("#diagnostic")).toContainText("new Function");
  await page.addScriptTag({ type: "module", url: "/api.js" });
  await page.waitForFunction(() => globalThis.doMd);
  expect(
    await page.evaluate(() => {
      const reader = new globalThis.doMd.Reader("# Safe");
      reader.heading(1).as("title");
      return reader.context.title;
    }),
  ).toBe("Safe");
});
