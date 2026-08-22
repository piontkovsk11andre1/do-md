import { readdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export function collectTests(dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectTests(full));
    } else if (entry.name.endsWith(".test.mjs")) {
      files.push(full);
    }
  }
  return files;
}

export async function loadTests(dir) {
  await Promise.all(collectTests(dir).map((file) => import(pathToFileURL(file).href)));
}
