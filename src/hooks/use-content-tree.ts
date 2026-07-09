"use client";

import * as React from "react";
import { loadAllContent, loadCategoryTree, loadNodeContent } from "@/lib/osler/content";
import type {
  ContentTreeNode,
  AnyContent,
  EngineType,
  FlashcardContent,
} from "@/lib/osler/types";
import { flashcardReview } from "@/lib/osler/storage";

type LeafItem = { node: ContentTreeNode; content: AnyContent | null };

interface UseContentTreeOptions {
  /** Only load these engine types (default: all) */
  types?: EngineType[];
}

interface UseContentTreeResult {
  /** Per-category trees (keyed by engine type) */
  trees: Record<string, ContentTreeNode[]>;
  /** Flat list of leaf items across all categories */
  items: LeafItem[];
  /** Map from uid to leaf content */
  leafContent: Map<string, AnyContent>;
  /** True while initial load is in progress */
  loading: boolean;

  /** Collect all leaf uids under a tree node */
  collectLeafUids(node: ContentTreeNode): string[];

  /** Merge cards from multiple uids (flashcard content only) */
  mergeCards(uids: string[]): FlashcardContent["cards"];

  /** Count total cards under a node */
  nodeCardCount(node: ContentTreeNode): number;

  /** Count due cards under a node */
  nodeDueCount(node: ContentTreeNode): number;

  /** Flatten a tree to leaf nodes */
  flattenTree(nodes: ContentTreeNode[]): ContentTreeNode[];
}

export function useContentTree(options?: UseContentTreeOptions): UseContentTreeResult {
  const [trees, setTrees] = React.useState<Record<string, ContentTreeNode[]>>({});
  const [items, setItems] = React.useState<LeafItem[]>([]);
  const [leafContent, setLeafContent] = React.useState<Map<string, AnyContent>>(new Map());
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);

    loadAllContent()
      .then((result) => {
        if (cancelled) return;
        let allItems = result.items;
        if (options?.types) {
          allItems = allItems.filter((entry) => options.types!.includes(entry.node.type as EngineType));
        }
        const map = new Map<string, AnyContent>();
        for (const { node, content } of allItems) {
          if (content) map.set(node.uid, content);
        }
        setTrees(result.trees);
        setItems(allItems);
        setLeafContent(map);
        setLoading(false);
      })
      .catch(() => setLoading(false));
    return () => { cancelled = true; };
  }, [options?.types?.join(",")]);

  function collectLeafUids(node: ContentTreeNode): string[] {
    if (node.items.length === 0) return [node.uid];
    return node.items.flatMap(collectLeafUids);
  }

  function mergeCards(uids: string[]): FlashcardContent["cards"] {
    const allCards: FlashcardContent["cards"] = [];
    for (const uid of uids) {
      const content = leafContent.get(uid);
      if (content?.type === "flashcard") {
        allCards.push(...(content as FlashcardContent).cards);
      }
    }
    return allCards;
  }

  function nodeCardCount(node: ContentTreeNode): number {
    return mergeCards(collectLeafUids(node)).length;
  }

  function nodeDueCount(node: ContentTreeNode): number {
    const uids = collectLeafUids(node);
    let sum = 0;
    for (const uid of uids) {
      const content = leafContent.get(uid);
      if (content?.type === "flashcard") {
        const cardIds = (content as FlashcardContent).cards.map((c) => c.id);
        sum += flashcardReview.getCardsDue(uid, cardIds).length;
      }
    }
    return sum;
  }

  function flattenTree(nodes: ContentTreeNode[]): ContentTreeNode[] {
    const leaves: ContentTreeNode[] = [];
    function walk(list: ContentTreeNode[]) {
      for (const node of list) {
        if (node.items.length === 0) leaves.push(node);
        else walk(node.items);
      }
    }
    walk(nodes);
    return leaves;
  }

  return {
    trees,
    items,
    leafContent,
    loading,
    collectLeafUids,
    mergeCards,
    nodeCardCount,
    nodeDueCount,
    flattenTree,
  };
}
