"use client";

/**
 * Unified tree builder for the Content Studio.
 *
 * Walks the R2 keys under content-files/<category>/ and produces a folder
 * tree. Each file leaf is then matched against the managed objects list —
 * if the file's basename matches "<objectId>.<ext>" and an object with that
 * id exists in `managed`, we attach the object to the leaf and mark it
 * managed=true. Managed objects that have no R2 counterpart (e.g. drafts
 * that have never been published) are appended under a synthetic
 * "Drafts (managed only)" folder per category, so admins can still find
 * and edit them.
 *
 * Extracted from content-studio.tsx so the studio component stays a slim
 * orchestrator and the tree-merge logic is testable in isolation.
 */

import type { ContentObject, ContentType } from "@/components/osler/admin/admin-api";
import type { ContentTreeNode } from "@/components/osler/admin/content-tree-pane";

export interface R2Item {
  key: string;
  size: number;
  uploaded: string | null;
}

export function buildUnifiedTree(
  categoryFolder: string,
  _contentType: ContentType,
  r2Items: R2Item[] = [],
  stagedItems: R2Item[] = [],
  managed: ContentObject[] = [],
  statusFilter: string,
  categoryLabel: string,
): ContentTreeNode[] {
  const roots: ContentTreeNode[] = [];
  const folderMap = new Map<string, ContentTreeNode>();
  const consumedObjectIds = new Set<string>();

  const catPrefix = `${categoryFolder}/`;
  const stripCat = (rel: string): string =>
    rel.startsWith(catPrefix) ? rel.slice(catPrefix.length) : rel;

  function placeLeaf(rel: string, leaf: ContentTreeNode): void {
    const parts = rel.split("/");
    parts.pop();
    let parent: ContentTreeNode | null = null;
    let cur = "";
    for (const seg of parts) {
      cur = cur ? `${cur}/${seg}` : seg;
      if (!folderMap.has(cur)) {
        const folder: ContentTreeNode = {
          id: `r2-folder-${categoryFolder}-${cur.replace(/\//g, "-")}`,
          name: seg,
          kind: "folder",
          r2Key: `content-files/${categoryFolder}${cur ? "/" + cur : ""}`,
          items: [],
        };
        folderMap.set(cur, folder);
        if (parent) parent.items!.push(folder);
        else roots.push(folder);
      }
      parent = folderMap.get(cur) ?? null;
    }
    if (parent) parent.items!.push(leaf);
    else roots.push(leaf);
  }

  // 1. Process managed items that have a published_r2_key
  for (const obj of managed) {
    if (obj.published_r2_key && obj.published_r2_key.startsWith(`content-files/${categoryFolder}/`)) {
      const passesFilter = statusFilter === "all" || obj.status === statusFilter;
      if (!passesFilter) {
        consumedObjectIds.add(obj.id);
        continue;
      }
      const rel = stripCat(obj.published_r2_key.replace(/^content-files\//, ""));
      const parts = rel.split("/");
      const fileName = parts[parts.length - 1] || obj.id;
      const fileNode: ContentTreeNode = {
        id: `cloud-${obj.id}`,
        name: obj.title || fileName,
        kind: "file",
        ext: obj.content_type === "library" ? "md" : "json",
        size: obj.body?.length,
        r2Key: obj.published_r2_key,
        sourcePath: obj.id,
        managed: true,
        cloudObject: obj,
      };
      consumedObjectIds.add(obj.id);
      placeLeaf(rel, fileNode);
    }
  }

  // 2. Process legacy raw R2 items if present (fallback)
  for (const item of r2Items) {
    const rel = stripCat(item.key.replace(/^content-files\//, ""));
    const parts = rel.split("/");
    const fileName = parts.pop() ?? "";
    if (fileName === ".keep") continue;
    if (managed.some((o) => o.published_r2_key === item.key && consumedObjectIds.has(o.id))) continue;

    const fileNode: ContentTreeNode = {
      id: `r2-file-${rel}`,
      name: fileName,
      kind: "file",
      ext: fileName.split(".").pop() ?? "",
      size: item.size,
      r2Key: item.key,
      sourcePath: item.key,
      managed: false,
    };
    placeLeaf(rel, fileNode);
  }

  // 3. Process staged items if present (fallback)
  for (const item of stagedItems) {
    const rel = stripCat(item.key.replace(/^content-staging\//, ""));
    const parts = rel.split("/");
    const fileName = parts.pop() ?? "";
    if (fileName === ".keep") continue;

    const fileNode: ContentTreeNode = {
      id: `staged-file-${rel}`,
      name: fileName,
      kind: "file",
      ext: fileName.split(".").pop() ?? "",
      size: item.size,
      r2Key: item.key,
      sourcePath: item.key,
      staged: true,
    };
    placeLeaf(rel, fileNode);
  }

  // 4. Drafts and unplaced managed objects
  const orphanManaged = managed.filter((o) => !consumedObjectIds.has(o.id));
  const visibleOrphans = orphanManaged.filter((o) => statusFilter === "all" || o.status === statusFilter);
  if (visibleOrphans.length > 0) {
    const draftsFolder: ContentTreeNode = {
      id: `r2-folder-${categoryFolder}-__drafts__`,
      name: `${categoryLabel} · drafts (managed only)`,
      kind: "folder",
      r2Key: `content-files/${categoryFolder}/__drafts__`,
      items: visibleOrphans
        .slice()
        .sort((a, b) => b.updated_at - a.updated_at)
        .map((obj) => ({
          id: `cloud-${obj.id}`,
          name: obj.title ?? "Untitled",
          kind: "file" as const,
          ext: obj.content_type === "library" ? "md" : "json",
          size: obj.body?.length,
          sourcePath: obj.id,
          cloudObject: obj,
          managed: true,
        })),
    };
    roots.push(draftsFolder);
  }

  function sortTree(nodes: ContentTreeNode[]): ContentTreeNode[] {
    nodes.sort((a, b) => {
      const aIsDrafts = a.id.endsWith("__drafts__") ? 1 : 0;
      const bIsDrafts = b.id.endsWith("__drafts__") ? 1 : 0;
      if (aIsDrafts !== bIsDrafts) return aIsDrafts - bIsDrafts;
      if (a.kind !== b.kind) return a.kind === "folder" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    for (const n of nodes) if (n.items) n.items = sortTree(n.items);
    return nodes;
  }
  return sortTree(roots);
}

/** Count leaf nodes (files) in a tree. */
export function countLeaves(node: ContentTreeNode): number {
  let n = 0;
  if (node.kind === "file") n += 1;
  for (const child of node.items ?? []) n += countLeaves(child);
  return n;
}
