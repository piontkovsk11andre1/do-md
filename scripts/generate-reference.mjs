import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { renderTemplateReference } from "../sources/TemplateLanguage.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const path = resolve(root, "docs/template-language.md");
const expected = `${renderTemplateReference({ format: "markdown" })}\n`;
if (process.argv.includes("--check")) {
  if ((await readFile(path, "utf8")) !== expected) {
    throw new Error("Reference is stale; run npm run docs");
  }
} else {
  await mkdir(resolve(root, "docs"), { recursive: true });
  await writeFile(path, expected, "utf8");
}
