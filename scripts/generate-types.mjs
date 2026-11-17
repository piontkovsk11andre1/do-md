import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

// Use TypeScript's stable CLI (the v7 JS compiler API is experimental). Generated
// files go to an ignored directory; --check never changes tracked declarations.
const root = fileURLToPath(new URL("../", import.meta.url));
const compiler = fileURLToPath(new URL("bin/tsc", import.meta.resolve("typescript/package.json")));
const config = JSON.parse(await readFile(`${root}tsconfig.core.json`, "utf8"));
const generated = new Set(
  config.files.map((source) => source.replace(/^sources\//, "").replace(/\.mjs$/, ".d.mts")),
);
await mkdir(join(root, ".types"), { recursive: true });
const temporary = await mkdtemp(join(root, ".types", "declarations-"));
try {
  // Compile without the old generated declarations shadowing their JS sources.
  // This makes generation bootstrappable after a type is added or renamed, and
  // keeps --check read-only even when the committed declarations are stale.
  const sources = join(temporary, "sources");
  await cp(join(root, "sources"), sources, {
    recursive: true,
    filter: (path) => !generated.has(relative(join(root, "sources"), path).replace(/\\/g, "/")),
  });
  const temporaryConfig = {
    ...config,
    files: config.files.map((source) => join(temporary, source)),
    compilerOptions: {
      ...config.compilerOptions,
      rootDir: sources,
      outDir: join(temporary, "output"),
    },
  };
  const configPath = join(temporary, "tsconfig.json");
  await writeFile(configPath, JSON.stringify(temporaryConfig));
  const result = spawnSync(process.execPath, [compiler, "--project", configPath], {
    cwd: root,
    stdio: "inherit",
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`Declaration compilation failed (${result.status})`);
  }
  for (const source of config.files) {
    const declaration = source.replace(/^sources\//, "").replace(/\.mjs$/, ".d.mts");
    const target = `${root}sources/${declaration}`;
    const text = await readFile(join(temporary, "output", declaration), "utf8");
    const expected = `// Generated from checked JSDoc by npm run types. Do not edit.\n${text.replace(/\r\n/g, "\n")}`;
    if (process.argv.includes("--check")) {
      if ((await readFile(target, "utf8")) !== expected) {
        throw new Error(`Stale declaration: ${target}; run npm run types`);
      }
    } else {
      await writeFile(target, expected, "utf8");
    }
  }
} finally {
  // Only remove the unique directory created by this invocation, never user state.
  await rm(temporary, { recursive: true, force: true });
}
