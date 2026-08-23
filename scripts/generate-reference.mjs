import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { renderTemplateReference } from "../sources/TemplateLanguage.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
await mkdir(resolve(root, "docs"), { recursive: true });
await writeFile(
  resolve(root, "docs/template-language.md"),
  `${renderTemplateReference({ format: "markdown" })}\n`,
  "utf8",
);
