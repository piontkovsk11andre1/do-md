import type {
  AutolinkNode,
  DocumentNode,
  FrontmatterNode,
  HeadingNode,
  ImageNode,
  LinkNode,
  ListNode,
  MarkdownBlockNode,
  MarkdownInlineNode,
  MarkdownNode,
  CodeSpanNode,
  SourcePosition,
} from "../types.d.mts";
export type Parsed<T> = T & { position: SourcePosition };
export function parseFrontmatter(source?: unknown): Parsed<FrontmatterNode> | null;
export function flattenInlines(nodes?: readonly MarkdownInlineNode[] | null): string;
export function flattenNode(node?: MarkdownNode | null): string;
export function parseMarkdown(source?: unknown): DocumentNode;
export function parseNextBlock(source: unknown, offset?: number): Parsed<MarkdownBlockNode> | null;
export function findNextListBlock(source: unknown, offset?: number): Parsed<ListNode> | null;
export function collectHeadings(node: MarkdownNode | null, out?: HeadingNode[]): HeadingNode[];
export interface InlineLeafNodes {
  link: LinkNode;
  image: ImageNode;
  autolink: AutolinkNode;
  codeSpan: CodeSpanNode;
}
export function parseInlineLeaf<K extends keyof InlineLeafNodes>(
  source: unknown,
  offset: number,
  line: number,
  column: number,
  kind: K,
): Parsed<InlineLeafNodes[K]> | null;
export function parseCheckboxAt(
  source: unknown,
  offset: number,
): { value: boolean; length: 3 } | null;
