"use client";

/**
 * Shared types, constants, and helpers for the Admin Content Studio.
 *
 * The studio is a file-explorer-style UI that replaces the previous narrow
 * tree+preview layout. It exposes the 5 student-facing content categories
 * (library, qbank, flashcard, osce, videos) as top-level "Category" tiles
 * rather than folders, so admins can think of them as sections of the app
 * rather than directories on disk.
 */

import type { LucideIcon } from "lucide-react";
import { BookOpen, Brain, Stethoscope, Video, ListChecks } from "lucide-react";
import type { ContentType } from "@/components/osler/admin/admin-api";

// Re-exported so existing imports from content-browser.tsx still work.
export type { ContentTreeNode } from "@/components/osler/admin/content-tree-pane";
import type { ContentTreeNode } from "@/components/osler/admin/content-tree-pane";

// ── R2 item shape (a single key in content-files/ or content-staging/) ──────

export interface R2Item {
  key: string;
  size: number;
  uploaded: string | null;
}

// ── Category definitions ────────────────────────────────────────────────────

export interface CategoryDef {
  /** R2 keyspace folder name, e.g. "library". */
  folder: string;
  /** i18n key for the category label. */
  labelKey: string;
  /** i18n key for the one-line description shown under the label. */
  descKey: string;
  /** The ContentType managed objects in this category use. */
  contentType: ContentType;
  /** Icon component for the category tile. */
  icon: LucideIcon;
  /** Tailwind color accent for the category tile + badges. */
  accent: "violet" | "amber" | "rose" | "emerald" | "sky" | "slate";
}

/** The 5 student-facing content categories, in the order they appear in the
 *  left rail. Order matters — library first because it's the most generic,
 *  videos last because they're the most passive. */
export const CATEGORIES: CategoryDef[] = [
  {
    folder: "library",
    labelKey: "admin.studio.categoryLibrary",
    descKey: "admin.studio.categoryLibraryDesc",
    contentType: "library",
    icon: BookOpen,
    accent: "violet",
  },
  {
    folder: "qbank",
    labelKey: "admin.studio.categoryQbank",
    descKey: "admin.studio.categoryQbankDesc",
    contentType: "quiz",
    icon: ListChecks,
    accent: "amber",
  },
  {
    folder: "flashcard",
    labelKey: "admin.studio.categoryFlashcard",
    descKey: "admin.studio.categoryFlashcardDesc",
    contentType: "flashcard",
    icon: Brain,
    accent: "rose",
  },
  {
    folder: "osce",
    labelKey: "admin.studio.categoryOsce",
    descKey: "admin.studio.categoryOsceDesc",
    contentType: "osce",
    icon: Stethoscope,
    accent: "emerald",
  },
  {
    folder: "videos",
    labelKey: "admin.studio.categoryVideos",
    descKey: "admin.studio.categoryVideosDesc",
    contentType: "video",
    icon: Video,
    accent: "sky",
  },
];

/** Map a ContentType to the category folder it lives in. */
export function contentTypeToFolder(ct: ContentType): string {
  switch (ct) {
    case "library": return "library";
    case "quiz":
    case "bank":
    case "written":
      return "qbank";
    case "flashcard": return "flashcard";
    case "osce": return "osce";
    case "video": return "videos";
  }
}

/** Map a category folder to its primary ContentType. */
export function folderToContentType(folder: string): ContentType | null {
  const cat = CATEGORIES.find((c) => c.folder === folder);
  return cat?.contentType ?? null;
}

// ── View modes ──────────────────────────────────────────────────────────────

export type ViewMode = "grid" | "list";

// ── Accent color classes (Tailwind 4 tokens, kept here so they're static) ──

export const ACCENT_CLASSES: Record<CategoryDef["accent"], {
  tile: string;       // background tint for the category rail tile
  tileActive: string; // active state for the category rail tile
  badge: string;      // small badge background/text color
  dot: string;        // small accent dot
  ring: string;       // focus ring color
}> = {
  violet: {
    tile: "bg-violet-500/5 hover:bg-violet-500/10 border-violet-500/20",
    tileActive: "bg-violet-500/15 border-violet-500/40 text-violet-700 dark:text-violet-300",
    badge: "bg-violet-500/15 text-violet-700 dark:text-violet-300 border-violet-500/30",
    dot: "bg-violet-500",
    ring: "ring-violet-500/40",
  },
  amber: {
    tile: "bg-amber-500/5 hover:bg-amber-500/10 border-amber-500/20",
    tileActive: "bg-amber-500/15 border-amber-500/40 text-amber-700 dark:text-amber-300",
    badge: "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30",
    dot: "bg-amber-500",
    ring: "ring-amber-500/40",
  },
  rose: {
    tile: "bg-rose-500/5 hover:bg-rose-500/10 border-rose-500/20",
    tileActive: "bg-rose-500/15 border-rose-500/40 text-rose-700 dark:text-rose-300",
    badge: "bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/30",
    dot: "bg-rose-500",
    ring: "ring-rose-500/40",
  },
  emerald: {
    tile: "bg-emerald-500/5 hover:bg-emerald-500/10 border-emerald-500/20",
    tileActive: "bg-emerald-500/15 border-emerald-500/40 text-emerald-700 dark:text-emerald-300",
    badge: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30",
    dot: "bg-emerald-500",
    ring: "ring-emerald-500/40",
  },
  sky: {
    tile: "bg-sky-500/5 hover:bg-sky-500/10 border-sky-500/20",
    tileActive: "bg-sky-500/15 border-sky-500/40 text-sky-700 dark:text-sky-300",
    badge: "bg-sky-500/15 text-sky-700 dark:text-sky-300 border-sky-500/30",
    dot: "bg-sky-500",
    ring: "ring-sky-500/40",
  },
  slate: {
    tile: "bg-slate-500/5 hover:bg-slate-500/10 border-slate-500/20",
    tileActive: "bg-slate-500/15 border-slate-500/40 text-slate-700 dark:text-slate-300",
    badge: "bg-slate-500/15 text-slate-700 dark:text-slate-300 border-slate-500/30",
    dot: "bg-slate-500",
    ring: "ring-slate-500/40",
  },
};

// ── Status badge colors (shared between list, grid, detail panel) ──────────

export const STATUS_BADGE: Record<string, string> = {
  draft: "bg-muted text-muted-foreground border-border",
  pending: "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30",
  published: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30",
  rejected: "bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/30",
};

// ── Breadcrumb helpers ──────────────────────────────────────────────────────

export interface Breadcrumb {
  /** Path relative to the category root, e.g. "cardiology/acute-coronary". */
  path: string;
  /** Display label for this segment. */
  label: string;
}

/** Split a folder path into breadcrumb segments. The first segment is always
 *  the category root, the last is the current folder. */
export function pathToBreadcrumbs(categoryFolder: string, categoryLabel: string, path: string): Breadcrumb[] {
  const crumbs: Breadcrumb[] = [{ path: "", label: categoryLabel }];
  if (!path) return crumbs;
  const parts = path.split("/").filter(Boolean);
  let cur = "";
  for (const p of parts) {
    cur = cur ? `${cur}/${p}` : p;
    crumbs.push({ path: cur, label: p });
  }
  return crumbs;
}

// ── Tree helpers (used by the file explorer to enumerate the current folder) ──

/** Find the node at a given path inside a tree. Returns null if not found. */
export function findFolderNode(tree: ContentTreeNode[], categoryFolder: string, path: string): ContentTreeNode | null {
  if (!path) {
    return tree.find((n) => n.id === `unified-root-${categoryFolder}`) ?? null;
  }
  const root = tree.find((n) => n.id === `unified-root-${categoryFolder}`);
  if (!root) return null;
  return findInTree(root, path);
}

function findInTree(node: ContentTreeNode, path: string): ContentTreeNode | null {
  if (folderPathOf(node) === path) return node;
  for (const child of node.items ?? []) {
    const found = findInTree(child, path);
    if (found) return found;
  }
  return null;
}

/** Compute the relative folder path (e.g. "cardiology/acute-coronary") for a
 *  tree node. Returns "" for the category root. */
export function folderPathOf(node: ContentTreeNode): string {
  const k = node.r2Key ?? "";
  return k.replace(/^content-files\//, "").replace(/^content-staging\//, "").replace(/\/$/, "");
}

/** Parent path of a given folder path. "cardiology/acute" → "cardiology".
 *  Empty string means "no parent" (already at category root). */
export function parentPath(path: string): string {
  if (!path) return "";
  const idx = path.lastIndexOf("/");
  return idx >= 0 ? path.slice(0, idx) : "";
}

/** Collect every staged (content-staging/) key under a node — the node's
 *  own key if it's a staged file, or all staged descendant keys if it's a
 *  folder. */
export function collectStagedKeys(node: ContentTreeNode): string[] {
  const keys: string[] = [];
  if (node.r2Key?.startsWith("content-staging/")) keys.push(node.r2Key);
  for (const child of node.items ?? []) keys.push(...collectStagedKeys(child));
  return keys;
}

/** True if a node or any descendant is staged. */
export function nodeContainsStaged(n: ContentTreeNode): boolean {
  if (n.staged) return true;
  return !!n.items?.some(nodeContainsStaged);
}

// ── Validation status ──────────────────────────────────────────────────────

export type ValidationState = "unknown" | "valid" | "invalid" | "checking";

// ── Format helpers (re-exported so studio files don't import content-tree-pane) ──

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatRelativeTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)}d ago`;
  return new Date(ts).toLocaleDateString();
}
