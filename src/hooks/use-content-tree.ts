"use client";

import * as React from "react";
import { loadCategoryTree, loadContentByUid, flattenTree, collectLeafUids } from "@/lib/osler/content";
import { loadConfig, enabledEngines } from "@/lib/osler/config";
import type {
  ContentTreeNode,
  AnyContent,
  EngineType,
  FlashcardContent,
} from "@/lib/osler/types";
import { flashcardReview } from "@/lib/osler/storage";

type LeafItem = { node: ContentTreeNode; content: AnyContent | null };

interface UseContentTreeOptions {
  /** Only load these engine types (default: all enabled engines) */
  types?: EngineType[];
}

interface UseContentTreeResult {
  /** Per-category trees (keyed by engine type) */
  trees: Record<string, ContentTreeNode[]>;
  /** Flat list of leaf items across all categories */
  items: LeafItem[];
  /** Map from uid to leaf content */
  leafContent: Map<string, AnyContent>;
  /** True while the category manifests are loading */
  loading: boolean;

  /**
   * Ensure all leaf content under a node is loaded (fetches on demand when
   * the background warm-load has not reached it yet). Resolves once the
   * node's cards are available in `leafContent`.
   */
  ensureLoaded(node: ContentTreeNode): Promise<void>;

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
  const [leafContent, setLeafContent] = React.useState<Map<string, AnyContent>>(new Map());
  const [loading, setLoading] = React.useState(true);

  const typesKey = options?.types?.join(",") ?? "all";
  const types = React.useMemo(
    () => (options?.types?.length ? options.types : null),
    [typesKey],
  );

  const [versionTick, setVersionTick] = React.useState(0);
  React.useEffect(() => {
    const handler = () => setVersionTick((v) => v + 1);
    window.addEventListener("osler-content-invalidated", handler);
    return () => window.removeEventListener("osler-content-invalidated", handler);
  }, []);

  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);

    const run = async () => {
      await loadConfig();
      const engineTypes = types ?? enabledEngines().filter((t) => t !== "library");
      const loaded = await Promise.all(
        engineTypes.map((type) => loadCategoryTree(type))
      );
      if (cancelled) return;

      const nextTrees: Record<string, ContentTreeNode[]> = {};
      engineTypes.forEach((type, i) => {
        nextTrees[type] = loaded[i];
      });
      setTrees(nextTrees);
      // Manifest-first: the hub paints from the manifest immediately; the
      // leaf content below is warmed in the background so due counts, stats
      // and card data populate progressively instead of blocking first paint.
      setLoading(false);

      const leaves = engineTypes.flatMap((type) =>
        flattenTree(nextTrees[type] ?? [])
      );
      for (const leaf of leaves) {
        loadContentByUid(leaf.uid, leaf.type)
          .then((content) => {
            if (cancelled) return;
            setLeafContent((prev) => {
              if (prev.has(leaf.uid)) return prev;
              const next = new Map(prev);
              next.set(leaf.uid, content);
              return next;
            });
          })
          .catch(() => {
            // Leave unset — ensureLoaded() retries on demand.
          });
      }
    };

    run().catch(() => {
      if (!cancelled) setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [typesKey, types, versionTick]);

  const items = React.useMemo<LeafItem[]>(() => {
    const list: LeafItem[] = [];
    for (const nodes of Object.values(trees)) {
      for (const leaf of flattenTree(nodes)) {
        list.push({ node: leaf, content: leafContent.get(leaf.uid) ?? null });
      }
    }
    return list;
  }, [trees, leafContent]);

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
    // Manifest itemCount is authoritative for counts and avoids waiting on
    // card content — falls back to content-derived count once loaded.
    if (typeof node.itemCount === "number" && node.itemCount > 0) return node.itemCount;
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

  async function ensureLoaded(node: ContentTreeNode): Promise<void> {
    const leaves = flattenTree([node]);

    await Promise.all(
      leaves.map(async (leaf) => {
        if (leafContent.get(leaf.uid)) return;
        try {
          const content = await loadContentByUid(leaf.uid, leaf.type);
          setLeafContent((prev) => {
            if (prev.has(leaf.uid)) return prev;
            const next = new Map(prev);
            next.set(leaf.uid, content);
            return next;
          });
        } catch {
          // Content genuinely missing — mergeCards simply yields no cards.
        }
      })
    );
  }

  return {
    trees,
    items,
    leafContent,
    loading,
    ensureLoaded,
    collectLeafUids,
    mergeCards,
    nodeCardCount,
    nodeDueCount,
    flattenTree,
  };
}