import { performance } from "node:perf_hooks";
import { SourceText, SourceMap, Template, Editor, Virtual } from "../sources/index.mjs";

const text = Array.from({ length: 25000 }, (_, index) => `line ${index}: retained source\n`).join(
  "",
);
const source = new SourceText(text, "large.md");
const template = '# {% doc.line().as("title") %}\n{% doc.rawRest(); %}';
const document = "# Original\n" + text;

async function measure(name, iterations, operation) {
  for (let index = 0; index < Math.min(iterations, 10); index++) {
    await operation(index);
  }
  const start = performance.now();
  for (let index = 0; index < iterations; index++) {
    await operation(index);
  }
  const elapsed = performance.now() - start;
  return {
    name,
    iterations,
    totalMs: Number(elapsed.toFixed(2)),
    microsecondsPerOperation: Number(((elapsed * 1000) / iterations).toFixed(2)),
  };
}

const segments = Array.from({ length: 10000 }, (_, index) => ({
  generatedStart: index * 2,
  generatedEnd: index * 2 + 2,
  originalStart: index * 2,
  originalEnd: index * 2 + 2,
  kind: "exact",
}));
const map = new SourceMap({
  generated: { source: "js", text },
  original: { source: "md", text },
  segments,
});
const results = [
  await measure("indexed source point", 10000, (index) =>
    source.pointAt((index * 53) % text.length),
  ),
  await measure("10k-segment map lookup", 10000, (index) => map.mapPosition(index * 2)),
  await measure("compile 100 JS blocks", 100, () =>
    Template.compile('{% doc.line().asArray("items"); %}\n'.repeat(100)),
  ),
  await measure("edit heading / retain large body", 20, async () => {
    const editor = await Editor.open({
      io: new Virtual({ "/doc.md": document, "/shape.md.template": template }),
      file: "/doc.md",
      template: "/shape.md.template",
    });
    editor.set("title", "Updated");
    if (!editor.render().endsWith(text)) {
      throw new Error("benchmark detected retained-text corruption");
    }
  }),
];
process.stdout.write(
  `${JSON.stringify({ node: process.version, sourceBytes: Buffer.byteLength(text), results }, null, 2)}\n`,
);
