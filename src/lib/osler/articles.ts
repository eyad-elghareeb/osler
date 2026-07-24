import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkRehype from "remark-rehype";
import rehypeRaw from "rehype-raw";
import rehypeStringify from "rehype-stringify";
import type { Plugin } from "unified";
import { loadCategoryTree } from "./content";
import { contentFileUrl } from "./content-url";
import type { ContentTreeNode, ContentLang } from "./types";

/** Base URL for library article files. */
function libraryBaseUrl(): string {
  return contentFileUrl("library", "");
}

export type ArticleContentType = "md" | "pdf" | "html";

/**
 * Resolve an image src used inside a library article against the article's
 * own folder. Mirrors the QBank/Flashcard convention: bare filenames and
 * `images/<name>` are looked up in the `<articleDir>/images/` subfolder next
 * to the `.md` file; absolute URLs, `data:` URIs, and `/`-rooted paths are
 * returned untouched.
 */
export function resolveArticleAsset(src: string, articleDir: string): string {
  if (!src) return src;
  if (/^(https?:)?\/\//.test(src) || src.startsWith("data:") || src.startsWith("/")) {
    return src;
  }
  const base = src.includes("/") ? src : `images/${src}`;
  return `${libraryBaseUrl()}/${articleDir}${base}`;
}

export interface ArticleMeta {
  /** Relative file path from library root (e.g. "cardiology/ischemic-syndrome/stemi.md") */
  file: string;
  /** Extracted from frontmatter (md) or filename */
  title: string;
  specialty?: string;
  system?: string;
  readTimeMin?: number;
  tags?: string[];
  /** Language the article body is authored in. `en` if not specified. */
  lang?: ContentLang;
  /** Content type. Defaults to "md". */
  contentType?: ArticleContentType;
}

export interface Article extends ArticleMeta {
  content: string;
  html: string;
  /** Full URL to the raw file (used for PDF/HTML iframes). */
  fileUrl?: string;
}

let treeCache: ContentTreeNode[] | null = null;
let leafArticleCache: Map<string, ArticleMeta[]> | null = null;

function parseFrontmatter(md: string): { meta: Record<string, unknown>; body: string } {
  const lines = md.split("\n");
  if (lines[0]?.trim() !== "---") return { meta: {}, body: md };

  let end = 1;
  while (end < lines.length && lines[end]?.trim() !== "---") end++;

  const fm: Record<string, unknown> = {};
  let lastKey = "";

  for (let i = 1; i < end; i++) {
    const line = lines[i];
    const kvMatch = line.match(/^(\w+):\s*(.*)/);
    if (kvMatch) {
      lastKey = kvMatch[1];
      const val = kvMatch[2].trim();
      if (val) {
        fm[lastKey] = val;
      } else {
        fm[lastKey] = [];
      }
    } else if (lastKey && line.match(/^\s+-\s+/)) {
      const item = line.replace(/^\s+-\s+/, "").trim();
      if (Array.isArray(fm[lastKey])) {
        (fm[lastKey] as string[]).push(item);
      }
    }
  }

  const body = lines.slice(end + 1).join("\n").trim();
  return { meta: fm, body };
}

/**
 * Rehype plugin: converts ```mermaid fenced blocks into
 * <div class="osler-mermaid" data-diagram="…encoded…"> placeholders.
 * The client-side renderer picks these up after hydration.
 */
const rehypeMermaid: Plugin<[]> = () => (tree: any) => {
  function walk(node: any, parent: any, index: number) {
    if (
      node.type === "element" &&
      node.tagName === "pre" &&
      parent !== null
    ) {
      const code = node.children?.find(
        (c: any) => c.type === "element" && c.tagName === "code"
      );
      if (code) {
        const cls: string[] = (code.properties?.className as string[]) ?? [];
        if (cls.some((c) => c === "language-mermaid")) {
          const text: string = code.children
            .filter((c: any) => c.type === "text")
            .map((c: any) => c.value as string)
            .join("");
          parent.children[index] = {
            type: "element",
            tagName: "div",
            properties: {
              className: ["osler-mermaid"],
              "data-diagram": encodeURIComponent(text),
            },
            children: [],
          };
          return; // don't recurse into replaced node
        }
      }
    }
    if (Array.isArray(node.children)) {
      for (let i = 0; i < node.children.length; i++) {
        walk(node.children[i], node, i);
      }
    }
  }
  walk(tree, null, 0);
};


/**
 * Rehype plugin: rewrite image `src` attributes so relative references
 * resolve against the article's own folder (where its `images/` subfolder
 * lives). Absolute URLs, `data:` URIs, and `/`-rooted paths pass through.
 */
const rehypeArticleImages: Plugin<[string]> = (articleDir: string) => (tree: any) => {
  function walk(node: any) {
    if (
      node.type === "element" &&
      node.tagName === "img" &&
      node.properties?.src
    ) {
      node.properties.src = resolveArticleAsset(node.properties.src, articleDir);
    }
    if (Array.isArray(node.children)) {
      for (const child of node.children) walk(child);
    }
  }
  walk(tree);
};

async function mdToHtml(md: string, articleDir: string): Promise<string> {
  const result = await unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeRaw)
    .use(rehypeMermaid)
    .use(rehypeArticleImages, articleDir)
    .use(rehypeStringify)
    .process(md);
  return String(result);
}

function extOf(file: string): string {
  return file.split(".").pop()?.toLowerCase() ?? "";
}

/** Load the library content tree. Cached after first call. */
export async function loadArticleTree(): Promise<ContentTreeNode[]> {
  if (treeCache) return treeCache;
  treeCache = await loadCategoryTree("library");
  return treeCache;
}

/** List all leaf nodes in the library tree (flattened). */
export async function listLeafNodes(): Promise<ContentTreeNode[]> {
  const tree = await loadArticleTree();
  const result: ContentTreeNode[] = [];
  function walk(nodes: ContentTreeNode[]) {
    for (const n of nodes) {
      if (n.items.length === 0) result.push(n);
      else walk(n.items);
    }
  }
  walk(tree);
  return result;
}

/** Fetch and parse metadata from files in a leaf node (md, pdf, html). */
async function loadLeafMeta(node: ContentTreeNode): Promise<ArticleMeta[]> {
  const files = node.files ?? [];
  const results = await Promise.all(
    files.map(async (file) => {
      const ext = extOf(file);
      const filePath = `${node.path}${file}`;

      if (ext === "pdf") {
        return {
          file: filePath,
          title: file.replace(/\.pdf$/, "").replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
          specialty: node.title,
          lang: node.lang ?? "en",
          contentType: "pdf" as ArticleContentType,
        } as ArticleMeta;
      }

      if (ext === "html") {
        const res = await fetch(`${libraryBaseUrl()}/${filePath}`, { cache: "no-store" });
        if (!res.ok) return null;
        const text = await res.text();
        // Extract <title> from HTML if present
        const titleMatch = text.match(/<title[^>]*>([^<]+)<\/title>/i);
        return {
          file: filePath,
          title: titleMatch?.[1]?.trim() ?? file.replace(/\.html$/, "").replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
          specialty: node.title,
          lang: node.lang ?? "en",
          contentType: "html" as ArticleContentType,
        } as ArticleMeta;
      }

      // Default: markdown
      const res = await fetch(`${libraryBaseUrl()}/${filePath}`, { cache: "no-store" });
      if (!res.ok) return null;
      const text = await res.text();
      const { meta } = parseFrontmatter(text);
      return {
        file: filePath,
        title: (meta.title as string) ?? file.replace(/\.md$/, ""),
        specialty: meta.specialty as string | undefined,
        system: meta.system as string | undefined,
        readTimeMin: meta.readTimeMin ? Number(meta.readTimeMin) : undefined,
        tags: meta.tags as string[] | undefined,
        lang: (meta.lang === "ar" || meta.lang === "en") ? meta.lang : (node.lang ?? "en"),
        contentType: "md" as ArticleContentType,
      } as ArticleMeta;
    })
  );
  return results.filter((r): r is ArticleMeta => r !== null);
}

/** Return all articles across all library leaf nodes, with metadata only (no html). */
export async function listAllArticles(): Promise<ArticleMeta[]> {
  if (leafArticleCache) {
    return Array.from(leafArticleCache.values()).flat();
  }
  leafArticleCache = new Map();
  const leaves = await listLeafNodes();
  const all: ArticleMeta[] = [];
  for (const leaf of leaves) {
    const metas = await loadLeafMeta(leaf);
    leafArticleCache.set(leaf.uid, metas);
    all.push(...metas);
  }
  return all;
}

/** Fetch and parse a single file into an Article (with html). */
export async function loadArticleContent(filePath: string): Promise<Article | null> {
  const ext = extOf(filePath);

  if (ext === "pdf") {
    return {
      file: filePath.split("/").pop() ?? "",
      title: (filePath.split("/").pop() ?? "").replace(/\.pdf$/, "").replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
      content: "",
      html: "",
      fileUrl: `${libraryBaseUrl()}/${filePath}`,
      lang: "en",
      contentType: "pdf",
    };
  }

  if (ext === "html") {
    const res = await fetch(`${libraryBaseUrl()}/${filePath}`, { cache: "no-store" });
    if (!res.ok) return null;
    const text = await res.text();
    const titleMatch = text.match(/<title[^>]*>([^<]+)<\/title>/i);
    return {
      file: filePath.split("/").pop() ?? "",
      title: titleMatch?.[1]?.trim() ?? (filePath.split("/").pop() ?? "").replace(/\.html$/, "").replace(/-/g, " "),
      content: text,
      html: text,
      fileUrl: `${libraryBaseUrl()}/${filePath}`,
      lang: "en",
      contentType: "html",
    };
  }

  // Default: markdown
  const res = await fetch(`${libraryBaseUrl()}/${filePath}`, { cache: "no-store" });
  if (!res.ok) return null;
  const text = await res.text();
  const { meta, body } = parseFrontmatter(text);
  const articleDir = filePath.includes("/")
    ? filePath.slice(0, filePath.lastIndexOf("/") + 1)
    : "";
  const html = await mdToHtml(body, articleDir);
  const nodeLang = await lookupNodeLangForFile(filePath);
  return {
    file: filePath.split("/").pop() ?? "",
    title: (meta.title as string) ?? "Untitled",
    specialty: meta.specialty as string | undefined,
    system: meta.system as string | undefined,
    readTimeMin: meta.readTimeMin ? Number(meta.readTimeMin) : undefined,
    tags: meta.tags as string[] | undefined,
    lang: (meta.lang === "ar" || meta.lang === "en")
      ? meta.lang
      : (nodeLang ?? "en"),
    content: body,
    html,
    contentType: "md",
  };
}

/** Best-effort lookup of a content node's `lang` for a given article path. */
async function lookupNodeLangForFile(filePath: string): Promise<ContentLang | undefined> {
  try {
    const leaves = await listLeafNodes();
    const leaf = leaves.find((n) => (n.files ?? []).some((f) => `${n.path}${f}` === filePath));
    return leaf?.lang;
  } catch {
    return undefined;
  }
}

/** Load articles in a leaf node (metadata only). */
export async function loadNodeArticles(node: ContentTreeNode): Promise<ArticleMeta[]> {
  if (leafArticleCache?.has(node.uid)) {
    return leafArticleCache.get(node.uid)!;
  }
  const metas = await loadLeafMeta(node);
  if (leafArticleCache) leafArticleCache.set(node.uid, metas);
  return metas;
}

/** Search articles by title, specialty, or tags. */
export async function searchArticles(query: string): Promise<ArticleMeta[]> {
  const q = query.trim().toLowerCase();
  const all = await listAllArticles();
  if (!q) return all;
  return all.filter((a) => {
    const hay = `${a.title} ${a.specialty ?? ""} ${(a.tags ?? []).join(" ")}`.toLowerCase();
    return hay.includes(q);
  });
}

export function clearArticleCache(): void {
  treeCache = null;
  leafArticleCache = null;
}
