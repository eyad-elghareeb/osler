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
  r2Items: R2Item[],
  stagedItems: R2Item[],
  managed: ContentObject[],
  statusFilter: string,
  categoryLabel: string,
): ContentTreeNode[] {
  const managedByBasename = new Map<string, ContentObject>();
  const managedByPublishedKey = new Map<string, ContentObject>();
  for (const obj of managed) {
    if (obj.published_r2_key) managedByPublishedKey.set(obj.published_r2_key, obj);
    const tail = (obj.r2_key_base || "").split("/").pop();
    if (!tail) continue;
    const expected = obj.content_type === "library" ? `${tail}.md` : `${tail}.json`;
    managedByBasename.set(expected, obj);
  }

  const roots: ContentTreeNode[] = [];
  const folderMap = new Map<string, ContentTreeNode>();
  const consumedObjectIds = new Set<string>();

  function placeLeaf(rel: string, leaf: ContentTreeNode): void {
    const parts = rel.split("/");
    parts.pop();
    let parent: ContentTreeNode | null = null;
    let cur = "";
    for (const seg of parts) {
      cur = cur ? `${cur}/${seg}` : seg;
      if (!folderMap.has(cur)) {
        const folder: ContentTreeNode = {
          id: `r2-folder-${cur}`,
          name: seg,
          kind: "folder",
          r2Key: `content-files/${cur}`,
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

  for (const item of r2Items) {
    const rel = item.key.replace(/^content-files\//, "");
    const parts = rel.split("/");
    const fileName = parts.pop() ?? "";
    if (fileName === ".keep") continue;

    const matched = managedByPublishedKey.get(item.key) ?? managedByBasename.get(fileName);
    const passesFilter = !matched || statusFilter === "all" || matched.status === statusFilter;
    if (matched && !passesFilter) continue;

    const fileNode: ContentTreeNode = {
      id: `r2-file-${rel}`,
      name: fileName,
      kind: "file",
      ext: fileName.split(".").pop() ?? "",
      size: item.size,
      r2Key: item.key,
      sourcePath: item.key,
      managed: !!matched,
      cloudObject: matched,
    };
    if (matched) consumedObjectIds.add(matched.id);
    placeLeaf(rel, fileNode);
  }

  for (const item of stagedItems) {
    const rel = item.key.replace(/^content-staging\//, "");
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

  const orphanManaged = managed.filter((o) => !consumedObjectIds.has(o.id));
  const visibleOrphans = orphanManaged.filter((o) => statusFilter === "all" || o.status === statusFilter);
  if (visibleOrphans.length > 0) {
    const draftsFolder: ContentTreeNode = {
      id: `r2-folder-${categoryFolder}-__drafts__`,
      name: `${categoryLabel} · drafts (managed only)`,
      kind: "folder",
      r2Key: `content-files/${categoryFolder}`,
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
