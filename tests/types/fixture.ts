import {
  Editor,
  Fetch,
  NodeFilesystem,
  Parser,
  Reader,
  Slot,
  SyntaxError,
  Template,
  Virtual,
  Writer,
  create,
  exportDoc,
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
} from "@p10i/do-md";
import { IO, createContentRevision } from "@p10i/do-md/sources/IO.mjs";
import { lookupSlot } from "@p10i/do-md/sources/Editor.mjs";
import { parseMarkdown } from "@p10i/do-md/sources/Reader/Markdown.mjs";
import { handleValidate } from "@p10i/do-md/sources/MCP/tools/validate.mjs";
import { Server } from "@p10i/do-md/sources/MCP/Server.mjs";

const io: IOAdapter = new Virtual({ "doc.md": "# Hello" });
const filesystem: IOAdapter = new NodeFilesystem();
const fetchIo: IOAdapter = new Fetch();
const baseIo: IOAdapter = new IO();
void [filesystem, fetchIo, baseIo];

const parser = new Parser<{ title?: string }>("hello");
parser.parse("hello").allowNewlines();
const textSlot: Slot<string> = parser.parseRegExp(/hello/);
textSlot.trim().notEmpty().default("fallback").validate((value) => value !== "bad");

const reader = new Reader<{ title?: string }>("# Hello");
reader.heading(1).as("title");
const document: DocumentNode = Reader.fromMarkdown("# Heading");
const parsed: DocumentNode = parseMarkdown("- [x] task");
void [document, parsed];

const table: TableValue = { headers: ["Name"], rows: [["Ada"]], align: ["left"] };
const listTree: ListTreeValue = {
  ordered: false,
  start: null,
  tight: true,
  items: [{ checked: true, children: [{ type: "paragraph", children: [{ type: "text", value: "Task" }] }] }],
};
const code: CodeBlockValue = { language: "ts", value: "const x = 1" };
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

const editor = new Editor({ io, file: "doc.md", template: "template.md", context: { title: "Hello" } });
editor.set("title", "World").revertAll();
editor.save({ force: true });
const revision: string = createContentRevision("content");
void revision;

const diagnostic: Diagnostic = new SyntaxError("bad").toDiagnostic();
const lookup = lookupSlot([], "title");
if (lookup.kind === "unknown") lookup.slot satisfies null;

void validate({ io, file: "doc.md", template: "template.md" });
void create({ io, file: "new.md", template: "template.md", data: { title: "Hello" } });
void exportDoc<{ title: string }>({ io, file: "doc.md", template: "template.md", savePath: "data.json" });
void set({ io, file: "doc.md", template: "template.md", key: "title", value: "New" });
void render({ io, file: "doc.md", parseTemplate: "read.md", renderTemplate: "write.md", outFile: "out.md" });
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
