"use client";

import type { ContentTreeNode as ManifestNode } from "@/lib/osler/types";
import type { ContentTreeNode } from "@/components/osler/admin/content-tree-pane";

function keyFor(folder: string, path: string, file?: string): string {
  const parts = ["content-files", folder, path.replace(/^\/+|\/+$/g, ""), file ?? ""];
  return parts.filter(Boolean).join("/");
}

function fileNode(folder: string, path: string, file: string): ContentTreeNode {
  return {
    id: `manifest-file-${keyFor(folder, path, file)}`,
    name: file,
    kind: "file",
    ext: file.split(".").pop() ?? "",
    r2Key: keyFor(folder, path, file),
    sourcePath: keyFor(folder, path, file),
  };
}

function convertNode(folder: string, node: ManifestNode): ContentTreeNode {
  const path = node.path.replace(/^\/+|\/+$/g, "");
  const children = node.items.flatMap((child) => [convertNode(folder, child)]);
  const files = (node.files ?? []).filter((file) => !/\.meta\.json$/i.test(file));

  if (children.length > 0) {
    return {
      id: `manifest-folder-${keyFor(folder, path)}`,
      name: node.title,
      kind: "folder",
      r2Key: keyFor(folder, path),
      items: children,
    };
  }

  if (files.length === 1) {
    return {
      ...fileNode(folder, path, files[0]),
      name: node.title || files[0],
    };
  }

  return {
    id: `manifest-folder-${keyFor(folder, path)}`,
    name: node.title,
    kind: "folder",
    r2Key: keyFor(folder, path),
    items: files.map((file) => fileNode(folder, path, file)),
  };
}

export function buildManifestAdminTree(
  folder: string,
  label: string,
  nodes: ManifestNode[],
): ContentTreeNode {
  return {
    id: `unified-root-${folder}`,
    name: label,
    kind: "folder",
    r2Key: `content-files/${folder}`,
    items: nodes.map((node) => convertNode(folder, node)),
  };
}
