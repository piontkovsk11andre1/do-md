import { build } from "esbuild";
import { parse } from "acorn";
import { analyze } from "eslint-scope";
import { builtinModules } from "node:module";
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const builtins = new Set(builtinModules.map((name) => name.replace(/^node:/, "")));
const checkoutSources = fileURLToPath(new URL("../../sources/", import.meta.url));

/** Reject Node dependencies and free Node globals before a browser artifact can be accepted. */
export function portableGraph(packageRoot) {
  return {
    name: "do-md-portable-graph",
    setup(builder) {
      builder.onResolve({ filter: /.*/ }, (args) => {
        if (args.path.startsWith("node:") || builtins.has(args.path)) {
          return {
            errors: [{ text: `Node dependency in browser graph: ${args.path} (${args.importer})` }],
          };
        }
        return undefined;
      });
      builder.onLoad({ filter: /\.mjs$/ }, async (args) => {
        const local = relative(join(packageRoot, "sources"), args.path);
        if (local.startsWith("..") || isAbsolute(local)) {
          return undefined;
        }
        const contents = await readFile(args.path, "utf8");
        const tree = parse(contents, { ecmaVersion: "latest", sourceType: "module", ranges: true });
        const scopes = analyze(tree, { ecmaVersion: 2024, sourceType: "module" });
        for (const reference of scopes.globalScope.through) {
          const name = reference.identifier.name;
          if (["process", "Buffer", "require", "__dirname", "__filename"].includes(name)) {
            throw new Error(`Node global ${name} in browser source: ${args.path}`);
          }
        }
        return { contents, loader: "js" };
      });
    },
  };
}

/** Build a specific installed package into an invocation-owned directory. */
export async function buildBrowser({ packageRoot, output, packed = false }) {
  await mkdir(output, { recursive: true });
  const example = join(packageRoot, "examples", "browser");
  const common = {
    bundle: true,
    platform: "browser",
    format: "esm",
    target: "es2022",
    absWorkingDir: packageRoot,
    plugins: [portableGraph(packageRoot)],
    metafile: true,
  };
  const app = await build({
    ...common,
    entryPoints: [join(example, "app.mjs")],
    outfile: join(output, "bundle.js"),
  });
  const api = await build({
    ...common,
    stdin: {
      contents: `import * as api from '@p10i/do-md/browser'; globalThis.doMd = api; globalThis.doMdPacked = ${packed};`,
      resolveDir: packageRoot,
      sourcefile: "browser-api.mjs",
      loader: "js",
    },
    outfile: join(output, "api.js"),
  });
  for (const metadata of [app.metafile, api.metafile]) {
    const inputs = Object.keys(metadata.inputs).map((path) => resolve(packageRoot, path));
    if (!inputs.includes(join(packageRoot, "sources", "browser.mjs"))) {
      throw new Error("Browser build did not resolve the selected public entry");
    }
    for (const path of inputs) {
      if (relative(packageRoot, path).replace(/\\/g, "/") === "sources/index.mjs") {
        throw new Error("Browser build imported the Node root");
      }
      if (packed && path.startsWith(checkoutSources)) {
        throw new Error("Packed browser build leaked checkout sources");
      }
    }
  }
  await writeFile(
    join(output, "metafile.json"),
    JSON.stringify({ app: app.metafile, api: api.metafile }, null, 2),
  );
  for (const file of ["index.html", "styles.css", "document.md", "template.md.template"]) {
    await cp(join(example, file), join(output, file));
  }
}
