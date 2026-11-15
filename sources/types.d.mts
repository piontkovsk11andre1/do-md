export type ErrorCode =
  | "DO_MD_USER_ERROR"
  | "DO_MD_PARSE_ERROR"
  | "DO_MD_TEMPLATE_ERROR"
  | "DO_MD_IO_ERROR"
  | "DO_MD_CONFLICT";

export interface Diagnostic {
  code: ErrorCode | (string & {});
  message: string;
  file: string | null;
  line: number;
  column: number;
  snippet: string | null;
}

export interface SourcePoint {
  offset: number;
  line: number;
  column: number;
}

export interface SourcePosition {
  start: SourcePoint;
  end: SourcePoint;
}

export interface PositionedNode {
  position?: SourcePosition;
}

export interface TextNode extends PositionedNode {
  type: "text";
  value: string;
}

export interface CodeSpanNode extends PositionedNode {
  type: "code_span";
  value: string;
}

export interface HtmlInlineNode extends PositionedNode {
  type: "html_inline";
  value: string;
}

export interface BreakNode extends PositionedNode {
  type: "soft_break" | "hard_break";
}

export interface EmphasisNode extends PositionedNode {
  type: "emphasis" | "strong";
  children: MarkdownInlineNode[];
}

export interface LinkNode extends PositionedNode {
  type: "link";
  url: string;
  title: string | null;
  children: MarkdownInlineNode[];
}

export interface ImageNode extends PositionedNode {
  type: "image";
  url: string;
  alt: string;
  title: string | null;
}

export interface AutolinkNode extends PositionedNode {
  type: "autolink";
  url: string;
  kind: "url" | "email";
  children: MarkdownInlineNode[];
}

export type MarkdownInlineNode =
  | TextNode
  | CodeSpanNode
  | HtmlInlineNode
  | BreakNode
  | EmphasisNode
  | LinkNode
  | ImageNode
  | AutolinkNode;

export interface DocumentNode extends PositionedNode {
  type: "document";
  children: MarkdownBlockNode[];
}

export interface HeadingNode extends PositionedNode {
  type: "heading";
  level: 1 | 2 | 3 | 4 | 5 | 6;
  children: MarkdownInlineNode[];
}

export interface ParagraphNode extends PositionedNode {
  type: "paragraph";
  children: MarkdownInlineNode[];
}

export interface ThematicBreakNode extends PositionedNode {
  type: "thematic_break";
}

export interface CodeBlockNode extends PositionedNode {
  type: "code_block";
  language: string | null;
  meta: string;
  value: string;
  fenced: boolean;
}

export interface BlockQuoteNode extends PositionedNode {
  type: "block_quote";
  children: MarkdownBlockNode[];
}

export interface ListItemNode extends PositionedNode {
  type: "list_item";
  checked: boolean | null;
  checkboxPosition?: SourcePosition;
  children: MarkdownBlockNode[];
}

export interface ListNode extends PositionedNode {
  type: "list";
  ordered: boolean;
  start: number | null;
  tight: boolean;
  children: ListItemNode[];
}

export type TableAlignment = "left" | "right" | "center" | null;

export interface TableCell {
  children: MarkdownInlineNode[];
}

export interface TableNode extends PositionedNode {
  type: "table";
  align: TableAlignment[];
  headers: TableCell[];
  rows: TableCell[][];
  readonly extraCells?: boolean;
}

export interface HtmlBlockNode extends PositionedNode {
  type: "html_block";
  value: string;
}

export interface FrontmatterNode<T extends Record<string, unknown> = Record<string, unknown>> extends PositionedNode {
  type: "frontmatter";
  format: "yaml";
  raw: string;
  content: string;
  data: T;
  readonly source?: string;
}

export interface RawNode extends PositionedNode {
  type: "raw";
  value: string;
}

export type MarkdownBlockNode =
  | HeadingNode
  | ParagraphNode
  | ThematicBreakNode
  | CodeBlockNode
  | BlockQuoteNode
  | ListNode
  | ListItemNode
  | TableNode
  | HtmlBlockNode
  | FrontmatterNode
  | RawNode;

export type MarkdownNode = DocumentNode | MarkdownBlockNode | MarkdownInlineNode;

export interface ListTreeItem {
  checked: boolean | null;
  children: MarkdownBlockNode[];
}

export interface ListTreeValue {
  ordered: boolean;
  start: number | null;
  tight: boolean;
  items: ListTreeItem[];
}

export interface TableValue {
  headers: string[];
  rows: string[][];
  align: TableAlignment[];
}

export interface CodeBlockValue {
  language: string | null;
  meta: string;
  value: string;
}

export interface LinkValue {
  url: string;
  text: string;
  title: string | null;
}

export interface ImageValue {
  url: string;
  alt: string;
  title: string | null;
}

export interface FrontmatterValue<T extends Record<string, unknown> = Record<string, unknown>> {
  format: "yaml";
  raw: string;
  content: string;
  data: T;
  readonly source?: string;
}

export type RawValue = string;

export type SafeParseResult<T> =
  | { success: true; data: T }
  | { success: false; error?: { message?: string } };

export interface SafeParseSchema<T> {
  safeParse(value: unknown): SafeParseResult<T>;
}

export interface ReadSnapshot<T = string> {
  content: T;
  revision: string;
}

export interface WriteSnapshot {
  revision: string;
}

export interface AtomicWriteOptions {
  expectedRevision?: string | null;
  ifAbsent?: boolean;
  force?: boolean;
  mode?: number;
  [option: string]: unknown;
}

export interface FileStat {
  isFile: boolean;
  isDirectory: boolean;
  size: number;
}

export interface IOAdapter {
  globAsync?(pattern: string, options?: { cwd?: string }): Promise<string[]>;
  readFileAsync(path: string, options?: unknown): Promise<string | Uint8Array>;
  writeFileAsync(path: string, content: string | Uint8Array, options?: unknown): Promise<void>;
  readFileSnapshotAsync?(path: string, options?: unknown): Promise<ReadSnapshot<string | Uint8Array>>;
  writeFileAtomicAsync?(path: string, content: string | Uint8Array, options?: AtomicWriteOptions): Promise<WriteSnapshot>;
  statAsync(path: string): Promise<FileStat>;
  resolvePath(cwd: string, path: string): string;
}

export interface ReaderOptions {
  file?: string;
  path?: string;
  [option: string]: unknown;
}

export interface WriterOptions extends ReaderOptions {
  bullet?: string;
  orderedDelim?: string;
  fence?: string;
  headingStyle?: "atx" | "setext";
  tightLists?: boolean;
  tablePadding?: boolean;
  eol?: "\n" | "\r\n" | "\r";
}

export type LeafType =
  | "value" | "line" | "text" | "heading" | "paragraph" | "list" | "listTree"
  | "frontmatter" | "rawUntil" | "rawUntilElement" | "rawBlock" | "rawRest" | "table" | "codeBlock"
  | "blockQuote" | "thematicBreak" | "htmlBlock" | "link" | "image" | "autolink"
  | "codeSpan" | "checkbox";

export interface SlotMetadata {
  key: string;
  leafType: LeafType;
  sourceOffsetStart: number;
  sourceOffsetEnd: number;
  isArrayElement: boolean;
  headingLevel?: number;
  items?: ListTreeItemMetadata[];
}

export interface ListTreeItemMetadata {
  key: string;
  sourceOffsetStart: number;
  sourceOffsetEnd: number;
  checked: null | {
    key: string;
    sourceOffsetStart: number;
    sourceOffsetEnd: number;
  };
}

export interface RegionElement {
  path: string;
  sourceOffsetStart: number;
  sourceOffsetEnd: number;
}

export interface RegionMetadata {
  key: string;
  path: string;
  sourceOffsetStart: number;
  sourceOffsetEnd: number;
  elements: RegionElement[];
}

export interface QueryRegionMetadata {
  sourceOffsetStart: number;
  sourceOffsetEnd: number;
}

export interface OutputRegionElement {
  path: string;
  outputOffsetStart: number;
  outputOffsetEnd: number;
}

export interface OutputRegionMetadata {
  key: string;
  path: string;
  outputOffsetStart: number;
  outputOffsetEnd: number;
  elements: OutputRegionElement[];
}

export interface CursorSnapshot {
  offset: number;
  line: number;
  char: number;
}

export type TemplateFunction<TContext extends Record<string, unknown> = Record<string, unknown>> = (
  doc: unknown,
  context: TContext,
  data: TContext | null,
  options: Record<string, unknown>,
  io?: IOAdapter,
) => void;

export interface CommandOptions {
  maxInputBytes?: number | false;
  [option: string]: unknown;
}

export interface BaseCommandOptions {
  io: IOAdapter;
  cwd?: string;
  options?: CommandOptions;
}

export interface ValidateOptions extends BaseCommandOptions {
  file: string;
  template: string;
}

export interface CreateOptions<TData extends Record<string, unknown> = Record<string, unknown>> extends BaseCommandOptions {
  file: string;
  template: string;
  data: TData;
  force?: boolean;
}

export interface ExportOptions extends ValidateOptions {
  savePath: string;
}

export interface SetOptions extends ValidateOptions {
  key?: string;
  value?: unknown;
  patch?: Record<string, unknown>;
  out?: string;
}

export interface RenderOptions extends BaseCommandOptions {
  file: string;
  parseTemplate: string;
  renderTemplate: string;
  outFile: string;
}

export interface MatchOptions extends BaseCommandOptions {
  file: string;
  templates: string;
  all?: boolean;
}

export interface MatchContext {
  matches: string[];
}

export interface QueryOptions extends ValidateOptions {
  all?: boolean;
}

export interface QueryMatch<TContext extends Record<string, unknown> = Record<string, unknown>> {
  start: number;
  end: number;
  context: TContext;
}

export interface QueryContext<TContext extends Record<string, unknown> = Record<string, unknown>> {
  matches: QueryMatch<TContext>[];
}

export interface CommandSuccess<TContext = unknown> {
  ok: true;
  exitCode: 0;
  output: string | null;
  context: TContext | null;
  errors: [];
}

export interface CommandFailure<TContext = unknown> {
  ok: false;
  exitCode: number;
  output: string | null;
  context: TContext | null;
  errors: Diagnostic[];
}

export type CommandResult<TContext = unknown> = CommandSuccess<TContext> | CommandFailure<TContext>;

export interface EditorChange {
  path: string;
  before: unknown;
  after: unknown;
}

export interface EditorOpenOptions {
  io: IOAdapter;
  file: string;
  template: string;
  options?: WriterOptions;
}

export interface EditorOptions<TContext extends Record<string, unknown> = Record<string, unknown>> {
  io?: IOAdapter;
  file?: string;
  template?: string;
  context?: TContext;
  options?: WriterOptions;
}

export interface EditorSaveOptions {
  to?: string | null;
  force?: boolean;
}
