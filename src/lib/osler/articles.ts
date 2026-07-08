import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkRehype from "remark-rehype";
import rehypeRaw from "rehype-raw";
import rehypeStringify from "rehype-stringify";

const BASE = "/osler-content/library";

export interface ArticleTocNode {
  id: string;
  label: string;
  children?: ArticleTocNode[];
  articleId?: string;
}

export interface Article {
  id: string;
  title: string;
  specialty: string;
  system: string;
  readTimeMin: number;
  content: string;
  html: string;
  tags?: string[];
}

interface ArticleMeta {
  id: string;
  title: string;
  specialty: string;
  system: string;
  readTimeMin: number;
  tags?: string[];
}

let markdownCache: Record<string, string> | null = null;
let manifestCache: ArticleMeta[] | null = null;
let tocCache: ArticleTocNode[] | null = null;

function parseFrontmatter(md: string): { meta: Record<string, unknown>; body: string } {
  const lines = md.split("\n");
  if (lines[0]?.trim() !== "---") return { meta: {}, body: md };

  let end = 1;
  while (end < lines.length && lines[end]?.trim() !== "---") end++;

  const fm: Record<string, unknown> = {};
  const currentTags: string[] = [];
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
        // Start of a list (tags:)
        fm[lastKey] = [];
      }
    } else if (lastKey && line.match(/^\s+-\s+/)) {
      // Array item
      const item = line.replace(/^\s+-\s+/, "").trim();
      if (Array.isArray(fm[lastKey])) {
        (fm[lastKey] as string[]).push(item);
      }
    }
  }

  const body = lines.slice(end + 1).join("\n").trim();
  return { meta: fm, body };
}

async function mdToHtml(md: string): Promise<string> {
  const result = await unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeRaw)
    .use(rehypeStringify)
    .process(md);
  return String(result);
}

async function loadAllMarkdown(): Promise<Record<string, string>> {
  if (markdownCache) return markdownCache;
  const manifest = await loadArticleManifest();
  const entries = await Promise.all(
    manifest.map(async (m) => {
      const res = await fetch(`${BASE}/${m.id}.md`, { cache: "no-store" });
      if (!res.ok) {
        console.warn(`Failed to load article ${m.id}: ${res.status}`);
        return [m.id, ""] as const;
      }
      const text = await res.text();
      return [m.id, text] as const;
    })
  );
  markdownCache = Object.fromEntries(entries);
  return markdownCache;
}

export async function loadArticleToc(): Promise<ArticleTocNode[]> {
  if (tocCache) return tocCache;
  const res = await fetch(`${BASE}/toc.json`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to load TOC: ${res.status}`);
  tocCache = (await res.json()) as ArticleTocNode[];
  return tocCache;
}

async function loadArticleManifest(): Promise<ArticleMeta[]> {
  if (manifestCache) return manifestCache;
  const res = await fetch(`${BASE}/manifest.json`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to load article manifest: ${res.status}`);
  manifestCache = (await res.json()) as ArticleMeta[];
  return manifestCache;
}

export async function loadArticleContent(id: string): Promise<Article | null> {
  const manifests = await loadArticleManifest();
  const meta = manifests.find((m) => m.id === id);
  if (!meta) {
    console.warn(`Article not found in manifest: ${id}`);
    return null;
  }

  const mds = await loadAllMarkdown();
  const md = mds[id];
  if (!md) return null;

  const { body } = parseFrontmatter(md);
  const html = await mdToHtml(body);

  return {
    id: meta.id,
    title: meta.title,
    specialty: meta.specialty,
    system: meta.system,
    readTimeMin: meta.readTimeMin,
    tags: meta.tags,
    content: body,
    html,
  };
}

export async function listAllArticles(): Promise<Article[]> {
  const manifest = await loadArticleManifest();
  return manifest.map((m) => ({
    id: m.id,
    title: m.title,
    specialty: m.specialty,
    system: m.system,
    readTimeMin: m.readTimeMin,
    tags: m.tags,
    content: "",
    html: "",
  }));
}

export async function searchArticles(query: string): Promise<Article[]> {
  const q = query.trim().toLowerCase();
  const manifest = await loadArticleManifest();

  if (!q) return manifest.slice(0, 8).map((m) => ({
    id: m.id,
    title: m.title,
    specialty: m.specialty,
    system: m.system,
    readTimeMin: m.readTimeMin,
    tags: m.tags,
    content: "",
    html: "",
  }));

  return manifest
    .filter((a) => {
      const hay = `${a.title} ${a.specialty} ${(a.tags ?? []).join(" ")}`.toLowerCase();
      return hay.includes(q);
    })
    .map((m) => ({
      id: m.id,
      title: m.title,
      specialty: m.specialty,
      system: m.system,
      readTimeMin: m.readTimeMin,
      tags: m.tags,
      content: "",
      html: "",
    }));
}

export function clearArticleCache(): void {
  markdownCache = null;
  manifestCache = null;
  tocCache = null;
}
