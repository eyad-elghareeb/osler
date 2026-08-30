"use client";

import * as React from "react";
import { ChevronRight, ListChecks, Folder, Grid3x3, Search, ArrowLeft } from "lucide-react";
import { ENGINE_META, nodeUrls, collectLeafUids } from "@/lib/osler/content";
import type { AnyContent, EngineType, ContentTreeNode } from "@/lib/osler/types";
import { storage } from "@/lib/osler/storage";
import { cn } from "@/lib/utils";
import { ContentCacheButton } from "@/components/osler/content-cache-button";
import { haptic } from "@/lib/osler/native";
import { useI18n } from "@/components/osler/i18n-provider";
import { NavigationStack } from "@/components/osler/navigation-stack";
import { EmptyState, ComingSoonState, HubSkeleton, MetricBar } from "@/components/osler/ui-primitives";
import { PackEntry, ENGINE_ICONS, countQuestions } from "./shared";
import { routeFor } from "@/lib/osler/navigation";
import { ctxLinkAttrs } from "@/lib/osler/deep-link";




































































export const PackCard = React.memo(function PackCard({
  node,
  content,
  index,
  onLoadPack,
  onOpenPack,
}: {
  node: ContentTreeNode;
  content: AnyContent | null | undefined;
  index: number;
  onLoadPack: (node: ContentTreeNode) => Promise<AnyContent | null>;
  onOpenPack?: (item: ContentTreeNode) => void;
}) {
  const { t, rtl } = useI18n();
  const meta = ENGINE_META[node.type as EngineType];
  const Icon = ENGINE_ICONS[node.type as EngineType] ?? ListChecks;
  const count = content ? countQuestions(content) : node.questionCount ?? 0;
  const packProgress = storage.packProgress(node.uid);
  const isAr = (content?.meta.lang ?? node.lang) === "ar";

  const packUrls = React.useMemo(() => nodeUrls(node), [node]);

  const handleCardClick = async () => {
    haptic("light");
    if (content || await onLoadPack(node)) onOpenPack?.(node);
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={handleCardClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          handleCardClick();
        }
      }}
      // The global context menu reads these: deep link for share/copy-link,
      // export uid for "Export as PDF" (see content-context-menu.tsx).
      data-ctx-export={node.uid}
      {...ctxLinkAttrs(routeFor("qbank", { uid: node.uid }), node.title)}
      className={cn(
        "osler-fade-in text-start bg-card border border-border rounded-xl p-5 hover:border-primary/40 hover:shadow-e2 transition-all active:scale-[0.98] group flex flex-col gap-3 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
        isAr && "osler-content-ar",
      )}
      dir={isAr ? "rtl" : undefined}
      lang={isAr ? "ar" : undefined}
      style={{ animationDelay: `${index * 0.03}s` }}
    >
      {/* Top row: icon + title + cache button */}
      <div className="flex items-center gap-3.5">
        <div
          className="size-12 rounded-xl flex items-center justify-center shrink-0"
          style={{ backgroundColor: `color-mix(in oklch, ${meta.color} 12%, transparent)`, color: meta.color }}
        >
          <Icon className="size-6" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-sm truncate text-foreground leading-snug">{node.title}</h3>
            {isAr && (
              <span className="text-[11px] px-1.5 py-0.5 rounded bg-primary/15 text-primary font-semibold shrink-0">
                {t("lang.badge.ar")}
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">{t("qbank.home.questions", { n: count })}</p>
        </div>
        <ContentCacheButton packId={node.uid} urls={packUrls} />
      </div>

      {/* Description */}
      {(content?.meta.description ?? node.description) && (
        <p className="text-xs text-muted-foreground/80 line-clamp-2 leading-relaxed">
          {content?.meta.description ?? node.description}
        </p>
      )}

      {/* Footer: completion bar or start prompt */}
      <div className="flex items-center justify-between gap-3">
        {packProgress.attempted > 0 ? (
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between text-xs mb-1">
              <span className="text-muted-foreground">{t("osce.home.progress")}</span>
              <span className="text-primary font-semibold tabular-nums">
                {Math.round((packProgress.attempted / count) * 100)}%
              </span>
            </div>
            <MetricBar
              value={packProgress.attempted}
              max={count}
              color="primary"
              label={t("osce.home.progress")}
            />
          </div>
        ) : (
          <span className="text-xs text-muted-foreground/50">{t("qbank.home.start")}</span>
        )}
        <ChevronRight className={cn("size-4 text-muted-foreground/40 group-hover:text-primary transition-colors shrink-0", rtl && "rtl-flip-x")} />
      </div>
    </div>
  );
});

export function ContentTab({
  data,
  onLoadPack,
  onOpenPack,
  onPickForCreateTest,
}: {
  data: { items: PackEntry[]; trees: Record<string, ContentTreeNode[]> } | null;
  onLoadPack: (node: ContentTreeNode) => Promise<AnyContent | null>;
  onOpenPack?: (item: ContentTreeNode) => void;
  /** P1-2: leaf pack click hands off to Create Test instead of starting a quiz. */
  onPickForCreateTest?: (node: ContentTreeNode) => void;
}) {
  const { t, rtl, contentFilter } = useI18n();
  const [selectedFolders, setSelectedFolders] = React.useState<ContentTreeNode[]>([]);

  // Build a uid → content map for O(1) lookup when computing per-folder stats.
  const contentByUid = React.useMemo(() => {
    const map = new Map<string, AnyContent>();
    if (!data) return map;
    for (const { node, content } of data.items) {
      if (content) map.set(node.uid, content);
    }
    return map;
  }, [data]);

  // The qbank tree — all packs share one folder, types are in the JSON.
  // All qbank engine types (quiz/bank/written) share the same tree.
  const qbankTree = React.useMemo(() => {
    if (!data) return [] as ContentTreeNode[];
    // Try quiz first, then bank, then written — they all share the same tree.
    return data.trees.quiz ?? data.trees.bank ?? data.trees.written ?? [];
  }, [data]);

  // Apply content-language filter to root nodes
  const filteredRootTree = React.useMemo(() => {
    if (contentFilter === "all") return qbankTree;
    return qbankTree.filter((node) => {
      const lang = node.lang ?? contentByUid.get(node.uid)?.meta.lang ?? "en";
      return lang === contentFilter;
    });
  }, [qbankTree, contentFilter, contentByUid]);

  /**
   * Per-folder stat rollup - aggregates all leaf packs under a node.
   * Question counts come straight from the manifest (`node.questionCount` is
   * rolled up by the generator), so no pack JSON needs to load for the hub
   * stat bars - keeps the deck grid cheap even for large trees.
   */
  const folderStats = React.useCallback(
    (node: ContentTreeNode): { packs: number; questions: number; attempted: number; correct: number } => {
      const uids = collectLeafUids(node);
      let packs = 0;
      let questions = node.questionCount ?? 0;
      let attempted = 0;
      let correct = 0;
      for (const uid of uids) {
        packs += 1;
        const p = storage.packProgress(uid);
        attempted += p.attempted;
        correct += p.correct;
      }
      return { packs, questions, attempted, correct };
    },
    [collectLeafUids],
  );

  const handleNodeClick = React.useCallback(
    (node: ContentTreeNode) => {
      if (node.items.length > 0) {
        setSelectedFolders((folders) => [...folders, node]);
      } else if (node.type === "quiz" || node.type === "bank" || node.type === "written") {
        // Quiz, bank, and written packs open their launch experience first.
        // Banks and written packs can still hand off to the advanced Create
        // tab from that dialog.
        onOpenPack?.(node);
      } else if (onPickForCreateTest) {
        onPickForCreateTest(node);
      } else {
        onOpenPack?.(node);
      }
    },
    [filteredRootTree, onPickForCreateTest, onOpenPack],
  );

  if (!data) {
    return (
      <HubSkeleton statCount={3} cardCount={6} />
    );
  }

  if (data.items.length === 0) {
    return (
      <div className="osler-page">
        <div className="osler-page__inner">
          <ComingSoonState icon={Grid3x3} />
        </div>
      </div>
    );
  }

  const selectedFolder = selectedFolders.at(-1) ?? null;

  // ── DECKS VIEW (root-level pack/folder grid) ──────────────────────────
  const decksView = (
    <div className="max-w-5xl mx-auto px-4 md:px-6 lg:px-8 py-6 md:py-8">

      {/* Pack / folder grid */}
      {filteredRootTree.length === 0 ? (
        <EmptyState icon={Search} title={t("qbank.home.empty")} description={t("qbank.home.search")} />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredRootTree.map((node, idx) => {
            const isBranch = node.items.length > 0;
            const nodeType = node.type as EngineType;
            const meta = ENGINE_META[nodeType];
            const Icon = ENGINE_ICONS[nodeType] ?? ListChecks;

            if (isBranch) {
              const fs = folderStats(node);
              const acc = fs.attempted > 0 ? Math.round((fs.correct / fs.attempted) * 100) : 0;
              const pct = fs.questions > 0 ? Math.min(100, Math.round((fs.attempted / fs.questions) * 100)) : 0;
              return (
                <button
                  type="button"
                  aria-label={node.title}
                  key={node.uid}
                  onClick={() => setSelectedFolders([node])}
                  // Folders export too — the dialog collects every leaf
                  // pack under the target.
                  data-ctx-export={node.uid}
                  className="osler-fade-in text-start bg-card border border-border rounded-xl p-5 hover:border-primary/40 hover:shadow-e2 transition-all group flex flex-col gap-3 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 w-full"
                  style={{ animationDelay: `${idx * 0.04}s` }}
                >
                  {/* Top row: folder icon + title + pack count.
                      Folders use a Folder icon (not the engine icon) so
                      they read as containers, not tests. The icon chip
                      uses the engine color tint so the folder still reads
                      as part of its category. */}
                  <div className="flex items-center gap-3.5">
                    <div
                      className="size-12 rounded-xl flex items-center justify-center shrink-0"
                      style={{ backgroundColor: `color-mix(in oklch, ${meta.color} 12%, transparent)`, color: meta.color }}
                    >
                      <Folder className="size-6" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <h3 className="font-semibold text-sm truncate text-foreground leading-snug">{node.title}</h3>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {t("qbank.home.packs", { n: fs.packs })}
                      </p>
                    </div>
                  </div>

                  {/* Summary — how many questions / files the folder contains.
                      Uses line-clamp-2 to match PackCard's description height
                      so both card types are the same height in the grid. */}
                  <p className="text-xs text-muted-foreground/80 line-clamp-2 leading-relaxed">
                    {t("qbank.home.questions", { n: fs.questions })}
                    {fs.attempted > 0 && (
                      <span className="text-success font-medium">
                        {" · "}{acc}% {t("qbank.tracker.accuracy").toLowerCase()}
                      </span>
                    )}
                  </p>

                  {/* Footer: progress bar when started, or "Start" prompt.
                      Matches PackCard's footer exactly. */}
                  <div className="flex items-center justify-between gap-3">
                    {fs.attempted > 0 ? (
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between text-xs mb-1">
                          <span className="text-muted-foreground">{t("osce.home.progress")}</span>
                          <span className="text-primary font-semibold tabular-nums">{pct}%</span>
                        </div>
                        <MetricBar value={pct} color="primary" label={t("osce.home.progress")} />
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground/50">{t("qbank.home.start")}</span>
                    )}
                    <ChevronRight className={cn("size-4 text-muted-foreground/40 group-hover:text-primary transition-colors shrink-0", rtl && "rtl-flip-x")} />
                  </div>
                </button>
              );
            }

            // Leaf — render as a pack card (same pattern as flashcard leaf)
            return <PackCard key={node.uid} node={node} content={contentByUid.get(node.uid)} index={idx} onLoadPack={onLoadPack} onOpenPack={handleNodeClick} />;
          })}
        </div>
      )}
    </div>
  );

  // ── SUBFOLDER VIEW (folder selected) — subpage of the NavigationStack ──
  let subfolderView: React.ReactNode = null;
  if (selectedFolder) {
    const nodeType = selectedFolder.type as EngineType;
    const meta = ENGINE_META[nodeType];
    const fs = folderStats(selectedFolder);
    const acc = fs.attempted > 0 ? Math.round((fs.correct / fs.attempted) * 100) : 0;

    // Local search removed — the unified global search bar at the top
    // handles all content discovery. Just render the folder's children
    // directly; the grid below handles empty state.
    const childTree = selectedFolder.items.filter((child) => {
      const qbankTypes = new Set(["quiz", "bank", "written"]);
      return qbankTypes.has(child.type);
    });

    subfolderView = (
      <div className="max-w-5xl mx-auto px-4 md:px-6 lg:px-8 py-6 md:py-8">
        {/* Header with back button */}
        <div className="mb-6">
          <button
            onClick={() => setSelectedFolders((folders) => folders.slice(0, -1))}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors mb-3"
          >
            <ArrowLeft className={cn("size-3.5", rtl && "rtl-flip-x")} />
            {t("qbank.home.allPacks")}
          </button>
          <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
            <Folder className="size-3.5" style={{ color: meta.color }} />
            <span style={{ color: meta.color }}>{t(`engine.${nodeType}` as any)}</span>
          </div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight mb-1">
            {selectedFolder.title}
          </h1>
          <p className="text-sm text-muted-foreground">
            {fs.packs} {t("dash.packsStarted").toLowerCase()} · {t("qbank.home.questions", { n: fs.questions })}
            {fs.attempted > 0 && (
              <>
                {" · "}
                <span className="text-success font-medium tabular-nums">{acc}%</span>{" "}
                {t("dash.accuracy")}
              </>
            )}
          </p>
        </div>

        {/* Child items grid */}
        {childTree.length === 0 ? (
          <ComingSoonState icon={Folder} />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {childTree.map((child, idx) => {
              const isBranch = child.items.length > 0;
              const childType = child.type as EngineType;
              const childMeta = ENGINE_META[childType];
              const ChildIcon = ENGINE_ICONS[childType] ?? ListChecks;

              if (isBranch) {
                const cfs = folderStats(child);
                const cacc = cfs.attempted > 0 ? Math.round((cfs.correct / cfs.attempted) * 100) : 0;
                const cpct = cfs.questions > 0 ? Math.min(100, Math.round((cfs.attempted / cfs.questions) * 100)) : 0;
                return (
                  <button
                    type="button"
                    aria-label={child.title}
                    key={child.uid}
                    onClick={() => setSelectedFolders((folders) => [...folders, child])}
                    data-ctx-export={child.uid}
                    className="osler-fade-in text-start bg-card border border-border rounded-xl p-5 hover:border-primary/40 hover:shadow-e2 transition-all group flex flex-col gap-3 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 w-full"
                    style={{ animationDelay: `${idx * 0.04}s` }}
                  >
                    <div className="flex items-center gap-3.5">
                      <div
                        className="size-12 rounded-xl flex items-center justify-center shrink-0"
                        style={{ backgroundColor: `color-mix(in oklch, ${childMeta.color} 12%, transparent)`, color: childMeta.color }}
                      >
                        <Folder className="size-6" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <h3 className="font-semibold text-sm truncate text-foreground leading-snug">{child.title}</h3>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {t("qbank.home.packs", { n: cfs.packs })}
                        </p>
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground/80 line-clamp-2 leading-relaxed">
                      {t("qbank.home.questions", { n: cfs.questions })}
                      {cfs.attempted > 0 && (
                        <span className="text-success font-medium">
                          {" · "}{cacc}% {t("qbank.tracker.accuracy").toLowerCase()}
                        </span>
                      )}
                    </p>
                    <div className="flex items-center justify-between gap-3">
                      {cfs.attempted > 0 ? (
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between text-xs mb-1">
                            <span className="text-muted-foreground">{t("osce.home.progress")}</span>
                            <span className="text-primary font-semibold tabular-nums">{cpct}%</span>
                          </div>
                          <MetricBar value={cpct} color="primary" label={t("osce.home.progress")} />
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground/50">{t("qbank.home.start")}</span>
                      )}
                      <ChevronRight className={cn("size-4 text-muted-foreground/40 group-hover:text-primary transition-colors shrink-0", rtl && "rtl-flip-x")} />
                    </div>
                  </button>
                );
              }

              // Leaf child — pack card
              const childContent = contentByUid.get(child.uid);
              return <PackCard key={child.uid} node={child} content={childContent} index={idx} onLoadPack={onLoadPack} onOpenPack={handleNodeClick} />;
            })}
          </div>
        )}
      </div>
    );
  }

  // NavigationStack: home (decks grid) is always rendered underneath.
  // When a folder is selected, the subfolder view slides in on top.
  return (
    <NavigationStack
      className="h-full"
      homeClassName="osler-page"
      subpageClassName="osler-page"
      rtl={rtl}
      home={decksView}
      subpage={subfolderView}
      onBack={() => setSelectedFolders((folders) => folders.slice(0, -1))}
    />
  );
}