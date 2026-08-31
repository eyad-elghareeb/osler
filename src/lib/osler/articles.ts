import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkRehype from "remark-rehype";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import rehypeStringify from "rehype-stringify";
import type { Plugin } from "unified";
import { CALLOUT_DEFAULT_TITLES, parseCalloutMarker } from "./callouts";
import { loadCategoryTree, fetchWithLocalFallback } from "./content";
import { contentFileUrl, localContentUrl } from "./content-url";
import { loadConfig } from "./config";
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
  return `${libraryBaseUrl()}${articleDir}${base}`;
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

/**
 * Sidecar metadata stored NEXT TO the article file as
 * `<basename>.meta.json` — lets the admin editor manage metadata through
 * form fields without ever touching the .md body (frontmatter conflicts
 * with the WYSIWYG editor). When present, sidecar fields override
 * frontmatter.
 */
export interface ArticleSidecarMeta {
  title?: string;
  specialty?: string;
  system?: string;
  readTimeMin?: number;
  tags?: string[];
  lang?: ContentLang;
}

/** R2/URL path of an article's sidecar meta file. */
export function articleSidecarPathFor(filePath: string): string {
  const slash = filePath.lastIndexOf("/");
  const dir = slash >= 0 ? filePath.slice(0, slash + 1) : "";
  const base = slash >= 0 ? filePath.slice(slash + 1) : filePath;
  const dot = base.lastIndexOf(".");
  return `${dir}${dot > 0 ? base.slice(0, dot) : base}.meta.json`;
}

// Negative-cached sidecar lookups — most articles have no sidecar yet and
// we don't want every listAllArticles() run to re-request the same 404s.
const sidecarCache = new Map<string, ArticleSidecarMeta | null>();

async function fetchSidecarMeta(filePath: string): Promise<ArticleSidecarMeta | null> {
  const sidePath = articleSidecarPathFor(filePath);
  if (sidecarCache.has(sidePath)) return sidecarCache.get(sidePath)!;
  let result: ArticleSidecarMeta | null = null;
  try {
    // Prefer the bundled (same-origin) sidecar first: it is the source of
    // truth for open-source deployments and avoids a cross-origin Worker
    // 404 when the sidecar simply doesn't exist. Fall back to the Worker
    // URL only if the local file misses, so a missing sidecar costs one
    // 404 instead of two and an existing local sidecar costs zero Worker
    // requests.
    let res: Response | null = null;
    try {
      const localRes = await fetch(localContentUrl("library", sidePath));
      if (localRes.ok) res = localRes;
      else if (localRes.status !== 404) res = localRes;
      else {
        const remoteUrl = contentFileUrl("library", sidePath);
        if (remoteUrl !== localContentUrl("library", sidePath)) {
          const remoteRes = await fetch(remoteUrl);
          if (remoteRes.ok) res = remoteRes;
        }
      }
    } catch {
      // local fetch throw (offline) — try remote as fallback
      try {
        const remoteRes = await fetch(contentFileUrl("library", sidePath));
        if (remoteRes.ok) res = remoteRes;
      } catch {}
    }
    if (res?.ok) {
      const parsed = JSON.parse(await res.text());
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        result = parsed as ArticleSidecarMeta;
      }
    }
  } catch {}
  sidecarCache.set(sidePath, result);
  return result;
}

/** Merge sidecar fields over frontmatter-derived meta (sidecar wins). */
function applySidecarMeta(meta: ArticleMeta, side: ArticleSidecarMeta | null): void {
  if (!side) return;
  if (typeof side.title === "string" && side.title.trim()) meta.title = side.title.trim();
  if (typeof side.specialty === "string" && side.specialty.trim()) meta.specialty = side.specialty.trim();
  if (typeof side.system === "string" && side.system.trim()) meta.system = side.system.trim();
  if (Number.isFinite(side.readTimeMin) && (side.readTimeMin as number) > 0) meta.readTimeMin = Number(side.readTimeMin);
  if (Array.isArray(side.tags)) meta.tags = side.tags.map(String).filter(Boolean);
  if (side.lang === "ar" || side.lang === "en") meta.lang = side.lang;
}

/** Invalidate cached sidecar lookups (called after admin edits). */
export function clearSidecarCache(sidePath?: string): void {
  if (sidePath) sidecarCache.delete(sidePath);
  else sidecarCache.clear();
}

/** Invalidate all library article caches. */
export function clearArticlesCache(): void {
  treeCache = null;
  leafArticleCache = null;
  sidecarCache.clear();
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
 * Remark plugin: upgrades Obsidian-style callout blockquotes
 * (`> [!warning] Title`) into styled `<blockquote class="osler-callout
 * osler-callout--warning" data-callout="warning">` elements with a title
 * paragraph. The marker line is stripped from the body; when no custom
 * title is given, the type's default label (CALLOUT_DEFAULT_TITLES) is
 * used. Blockquotes that don't carry a marker pass through untouched.
 */
const remarkCallouts: Plugin<[]> = () => (tree: any) => {
  function titleParagraph(text: string) {
    return {
      type: "paragraph",
      data: { hProperties: { className: ["osler-callout-title"] } },
      children: [{ type: "text", value: text }],
    };
  }

  function transformCallout(node: any): void {
    const first = node.children?.[0];
    if (!first || first.type !== "paragraph") return;
    const textNode = first.children?.[0];
    if (!textNode || textNode.type !== "text") return;

    const [firstLine, ...restLines] = String(textNode.value).split("\n");
    const parsed = parseCalloutMarker(firstLine);
    if (!parsed) return;

    const title = parsed.title ?? CALLOUT_DEFAULT_TITLES[parsed.type] ?? parsed.type;
    const remainder = restLines.join("\n").trim();

    if (!remainder) {
      // The marker was the paragraph's first line and nothing followed it.
      if (first.children.length > 1) {
        // Inline siblings continue the paragraph — drop only the marker text.
        first.children = [titleParagraph(title), ...first.children.slice(1)];
      } else {
        node.children = [titleParagraph(title), ...node.children.slice(1)];
      }
    } else {
      textNode.value = remainder;
      node.children = [titleParagraph(title), ...node.children];
    }

    node.data = {
      ...node.data,
      hName: "blockquote",
      hProperties: {
        ...(node.data?.hProperties ?? {}),
        className: ["osler-callout", `osler-callout--${parsed.type}`],
        "data-callout": parsed.type,
      },
    };
  }

  function walk(node: any): void {
    if (node.type === "blockquote") transformCallout(node);
    if (Array.isArray(node.children)) {
      for (const child of node.children) walk(child);
    }
  }
  walk(tree);
};

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

/**
 * Sanitizer schema: extends GitHub's default with everything the article
 * pipeline actually renders — GFM tables/strikethrough/tasklists, code
 * attributes used by syntax highlighting, and the mermaid placeholder div
 * produced by rehypeMermaid (its data-diagram payload is re-encoded text,
 * decoded only for diagram rendering, never injected as HTML). Raw HTML in
 * authored content is parsed by rehypeRaw but every tag not listed here and
 * every on* / javascript: URL is dropped before it can reach the DOM.
 */
const ARTICLE_SANITIZE_SCHEMA = {
  ...defaultSchema,
  tagNames: [
    ...(defaultSchema.tagNames ?? []),
    "div",
    "figure",
    "figcaption",
    "details",
    "summary",
    "video",
    "audio",
    "source",
  ],
  attributes: {
    ...defaultSchema.attributes,
    "*": [...(defaultSchema.attributes?.["*"] ?? []), "className", "dir", "lang"],
    div: ["className", "data-diagram"],
    blockquote: ["className", "data-callout"],
    span: ["className"],
    code: [...(defaultSchema.attributes?.code ?? []), "className"],
    th: ["style", "align"],
    td: ["style", "align"],
    video: ["src", "controls", "poster", "width", "height", "preload"],
    audio: ["src", "controls"],
    source: ["src", "type"],
    img: [...(defaultSchema.attributes?.img ?? []), "loading", "decoding"],
  },
  protocols: { ...defaultSchema.protocols, src: ["http", "https", "mailto"] },
};

async function mdToHtml(md: string, articleDir: string): Promise<string> {
  const result = await unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkCallouts)
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeRaw)
    .use(rehypeSanitize, ARTICLE_SANITIZE_SCHEMA)
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
  await loadConfig();
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
        const res = await fetchWithLocalFallback(contentFileUrl("library", filePath), localContentUrl("library", filePath));
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

      // Default: markdown — list view uses frontmatter only (no sidecar fetch)
      // to avoid N× 404s for articles without a sidecar. Full sidecar merge
      // happens in loadArticleContent() when the article is actually opened.
      const res = await fetchWithLocalFallback(contentFileUrl("library", filePath), localContentUrl("library", filePath));
      if (!res.ok) return null;
      const text = await res.text();
      const { meta } = parseFrontmatter(text);
      const articleMeta: ArticleMeta = {
        file: filePath,
        title: (meta.title as string) ?? file.replace(/\.md$/, ""),
        specialty: meta.specialty as string | undefined,
        system: meta.system as string | undefined,
        readTimeMin: meta.readTimeMin ? Number(meta.readTimeMin) : undefined,
        tags: meta.tags as string[] | undefined,
        lang: (meta.lang === "ar" || meta.lang === "en") ? meta.lang : (node.lang ?? "en"),
        contentType: "md",
      };
      return articleMeta;
    })
  );
  return results.filter((r): r is ArticleMeta => r !== null);
}

/**
 * Build ArticleMeta[] purely from the manifest tree — slug titles, folder
 * specialty, no network fetches. Lets the library list paint instantly and
 * enrich once `listAllArticles()` resolves with real frontmatter metadata.
 */
export function articlesFromManifestTree(tree: ContentTreeNode[]): ArticleMeta[] {
  const result: ArticleMeta[] = [];
  function walk(nodes: ContentTreeNode[]) {
    for (const node of nodes) {
      if (node.items.length === 0 && (node.files?.length ?? 0) > 0) {
        for (const file of node.files ?? []) {
          const ext = extOf(file);
          const slug = file.replace(/\.[a-z0-9]+$/i, "").replace(/-/g, " ");
          result.push({
            file: `${node.path}${file}`,
            title: slug.replace(/\b\w/g, (c) => c.toUpperCase()),
            specialty: node.title,
            lang: node.lang ?? "en",
            contentType: ext === "pdf" || ext === "html" ? ext : "md",
          });
        }
      } else {
        walk(node.items);
      }
    }
  }
  walk(tree);
  return result;
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

/** Synchronous getter for articles already loaded into memory. */
export function getCachedAllArticles(): ArticleMeta[] | null {
  if (!leafArticleCache) return null;
  return Array.from(leafArticleCache.values()).flat();
}

/** Fetch and parse a single file into an Article (with html). */
export async function loadArticleContent(filePath: string): Promise<Article | null> {
  await loadConfig();
  const ext = extOf(filePath);

  if (ext === "pdf") {
    return {
      file: filePath.split("/").pop() ?? "",
      title: (filePath.split("/").pop() ?? "").replace(/\.pdf$/, "").replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
      content: "",
      html: "",
      fileUrl: `${libraryBaseUrl()}${filePath}`,
      lang: "en",
      contentType: "pdf",
    };
  }

  if (ext === "html") {
    const res = await fetchWithLocalFallback(contentFileUrl("library", filePath), localContentUrl("library", filePath));
    if (!res.ok) return null;
    const text = await res.text();
    const titleMatch = text.match(/<title[^>]*>([^<]+)<\/title>/i);
    return {
      file: filePath.split("/").pop() ?? "",
      title: titleMatch?.[1]?.trim() ?? (filePath.split("/").pop() ?? "").replace(/\.html$/, "").replace(/-/g, " "),
      content: text,
      html: text,
      fileUrl: `${libraryBaseUrl()}${filePath}`,
      lang: "en",
      contentType: "html",
    };
  }

  // Default: markdown
  const res = await fetchWithLocalFallback(contentFileUrl("library", filePath), localContentUrl("library", filePath));
  if (!res.ok) return null;
  const text = await res.text();
  const { meta, body } = parseFrontmatter(text);
  const articleDir = filePath.includes("/")
    ? filePath.slice(0, filePath.lastIndexOf("/") + 1)
    : "";
  const html = await mdToHtml(body, articleDir);
  const nodeLang = await lookupNodeLangForFile(filePath);
  const article: Article = {
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
  applySidecarMeta(article, await fetchSidecarMeta(filePath));
  return article;
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
  sidecarCache.clear();
}
