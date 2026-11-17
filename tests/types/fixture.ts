import {
  Editor,
  Fetch,
  NodeFilesystem,
  Parser,
  Reader,
  Slot,
  DoMdError,
  Template,
  Virtual,
  Writer,
  create,
  exportDoc,
  match,
  query,
  render,
  set,
  validate,
  type CodeBlockValue,
  type Diagnostic,
  type DocumentNode,
  type FrontmatterValue,
  type IOAdapter,
  type ImageValue,
  type LinkValue,
  type ListTreeValue,
  type TableValue,
  createSourceMap,
  composeSourceMaps,
  mapDiagnostic,
  mapPosition,
  mapRange,
  primaryLocation,
  formatDiagnostic,
  sourcePoint,
  sourceOffset,
  type DiagnosticLocation,
  type SourceMap,
} from "@p10i/do-md";
import { IO, createContentRevision } from "@p10i/do-md/io";
import { lookupSlot } from "../../sources/Editor.mjs";
import { parseMarkdown } from "@p10i/do-md/markdown";
import { handleValidate } from "../../sources/MCP/tools/validate.mjs";
import { Server } from "@p10i/do-md/mcp";
import {
  createServer as createHttpServer,
  type ServerOptions as HttpOptions,
  Client as HttpClient,
} from "@p10i/do-md/http";
import { ScopedFilesystem } from "../../sources/Service/ScopedFilesystem.mjs";
import { execute } from "../../sources/Service/Executor.mjs";
import { TOOL_DEFINITIONS } from "../../sources/Service/Definitions.mjs";
import {
  Virtual as BrowserIO,
  Template as BrowserTemplate,
  formatDiagnostic as browserDiagnostic,
  type Diagnostic as BrowserDiagnostic,
} from "@p10i/do-md/browser";

const browserIO: IOAdapter = new BrowserIO({ "doc.md": "# Browser" });
const browserCompilation = BrowserTemplate.compile("{% return; %}");
const browserError: BrowserDiagnostic = {
  code: "DO_MD_TEMPLATE_ERROR",
  message: "bad",
  locations: [],
};
void [browserIO, browserCompilation, browserDiagnostic(browserError, { includeGenerated: true })];

const httpOptions: HttpOptions = { root: "/workspace", port: 0, maxConcurrency: 2 };
const httpServer = createHttpServer(httpOptions);
const httpClient = new HttpClient({ url: "http://do-md:8080", root: "/workspace" });
const remoteMcp = new Server({ root: "/workspace", host: "do-md", port: 8080 });
const scopedIo: IOAdapter = new ScopedFilesystem("/workspace", 1024);
void [httpServer, httpClient, remoteMcp, scopedIo, execute, TOOL_DEFINITIONS];

const io: IOAdapter = new Virtual({ "doc.md": "# Hello" });
const filesystem: IOAdapter = new NodeFilesystem();
const fetchIo: IOAdapter = new Fetch();
const baseIo: IOAdapter = new IO();
void [filesystem, fetchIo, baseIo];

const parser = new Parser<{ title?: string }>("hello");
parser.parse("hello").allowNewlines();
const textSlot: Slot<string> = parser.parseRegExp(/hello/);
textSlot
  .trim()
  .notEmpty()
  .default("fallback")
  .validate((value) => value !== "bad");

const reader = new Reader<{ title?: string }>("# Hello");
reader.reset().replaceSource("# New", { file: "new.md" }).seek(0);
const lineNumber: number = reader.lineNumber;
const checkboxSlot: Slot<boolean> = reader.checkbox();
void [lineNumber, checkboxSlot];
// @ts-expect-error derived coordinates are read-only
reader.char = 7;
// @ts-expect-error source identity can only change via replaceSource
reader.file = "other.md";
// @ts-expect-error checkbox values must not erase to any
const invalidCheckbox: Slot<string> = reader.checkbox();
void invalidCheckbox;
reader.heading(1).as("title");
const document: DocumentNode = Reader.fromMarkdown("# Heading");
const parsed: DocumentNode = parseMarkdown("- [x] task");
void [document, parsed];

const table: TableValue = { headers: ["Name"], rows: [["Ada"]], align: ["left"] };
const listTree: ListTreeValue = {
  ordered: false,
  start: null,
  tight: true,
  items: [
    {
      checked: true,
      children: [{ type: "paragraph", children: [{ type: "text", value: "Task" }] }],
    },
  ],
};
const code: CodeBlockValue = { language: "ts", meta: "", value: "const x = 1" };
const link: LinkValue = { url: "https://example.com", text: "example", title: null };
const image: ImageValue = { url: "image.png", alt: "image", title: null };
const frontmatter: FrontmatterValue<{ title: string }> = {
  format: "yaml",
  raw: "title: Test\n",
  content: "title: Test\n",
  data: { title: "Test" },
};

const writer = new Writer({ table, listTree, code, link, image, frontmatter });
writer.table().as("table");
writer.listTree().as("listTree");
writer.codeBlock().as("code");
writer.link().as("link");
writer.image().as("image");
writer.frontmatter<{ title: string }>().as("frontmatter");
writer.append(document).writeHeading(2, "More").toAst();

const template = new Template("{% doc.heading(1).as('title') %}", { file: "template.md" });
template.renderBlocks();
template.wrap<{ title: string }>();

const editor = new Editor({
  io,
  file: "doc.md",
  template: "template.md",
  context: { title: "Hello" },
});
editor.set("title", "World").revertAll();
editor.save({ force: true });
const revision: string = createContentRevision("content");
void revision;

const diagnostic: Diagnostic = new DoMdError("bad").toDiagnostic();
const formattedDiagnostic: string = formatDiagnostic(diagnostic, {
  colors: false,
  includeGenerated: true,
});
void formattedDiagnostic;
const compilation = Template.compile("{% return; %}", { file: "template.md.template" });
const sourceMap: SourceMap = createSourceMap(compilation.sourceMap);
const location: DiagnosticLocation | null = mapPosition(sourceMap, 0);
const mapped: Diagnostic = mapDiagnostic(diagnostic, sourceMap, { role: "template" });
const composed: SourceMap = composeSourceMaps(
  sourceMap,
  createSourceMap({
    generated: sourceMap.original,
    original: sourceMap.original,
    segments: [
      {
        generatedStart: 0,
        generatedEnd: sourceMap.original.text.length,
        originalStart: 0,
        originalEnd: sourceMap.original.text.length,
        kind: "exact",
      },
    ],
  }),
);
void [
  location,
  composed,
  primaryLocation(mapped),
  mapRange(sourceMap, { start: 0, end: 1 }),
  sourceOffset("text", sourcePoint("text", 1)),
  template.compile(),
  Template.compilation(template.wrap()),
];
const lookup = lookupSlot([], "title");
if (lookup.kind === "unknown") lookup.slot satisfies null;

void validate({ io, file: "doc.md", template: "template.md" });
void create({ io, file: "new.md", template: "template.md", data: { title: "Hello" } });
void exportDoc<{ title: string }>({
  io,
  file: "doc.md",
  template: "template.md",
  savePath: "data.json",
});
void set({ io, file: "doc.md", template: "template.md", key: "title", value: "New" });
void render({
  io,
  file: "doc.md",
  parseTemplate: "read.md",
  renderTemplate: "write.md",
  outFile: "out.md",
});
void match({ io, file: "doc.md", templates: "templates/**/*.tpl.md", all: true });
void query({ io, file: "doc.md", template: "query.tpl.md", all: true });
void handleValidate({ file: "doc.md", template: "template.md" }, { io, root: "/" });
void new Server({ root: "/", timeoutMs: 1000 }).callTool("validate", {});
void diagnostic;

// @ts-expect-error heading levels are limited to Markdown's six levels
reader.heading(7);
// @ts-expect-error create requires input data
void create({ io, file: "new.md", template: "template.md" });
// @ts-expect-error table alignment is a closed set
const invalidTable: TableValue = { headers: ["x"], rows: [], align: ["diagonal"] };
void invalidTable;
