"use client";

import * as React from "react";
import { Trash2, Check, Download, HardDrive, FolderTree, Layers, ChevronRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/components/osler/i18n-provider";
import { type StringKey } from "@/lib/osler/i18n";
import { cn } from "@/lib/utils";
import { haptic } from "@/lib/osler/native";
import { loadCategoryTrees, getEngineMeta, nodeUrls } from "@/lib/osler/content";
import type { EngineType, ContentTreeNode } from "@/lib/osler/types";
import { useContentCache, type DownloadState } from "@/hooks/use-content-cache";
import { ContentCacheButton } from "@/components/osler/content-cache-button";
function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export function DownloadsSettingsSection() {
  const { t, rtl } = useI18n();
  const { getState, checkStatus, precache, remove } = useContentCache();
  const [stats, setStats] = React.useState<{ count: number; size: number } | null>(null);
  const [confirmClear, setConfirmClear] = React.useState(false);
  const [clearing, setClearing] = React.useState(false);
  const [trees, setTrees] = React.useState<Record<string, ContentTreeNode[]> | null>(null);
  const [typeFilter, setTypeFilter] = React.useState<EngineType | "all">("all");
  const [expanded, setExpanded] = React.useState<Set<string>>(new Set());

  const swAvailable =
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    !!navigator.serviceWorker.controller;

  const refreshStats = React.useCallback(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
    if (!navigator.serviceWorker.controller) return;
    const handler = (event: MessageEvent) => {
      if (event.data?.type === "CONTENT_CACHE_STATS") {
        setStats({ count: event.data.count, size: event.data.size });
        navigator.serviceWorker.removeEventListener("message", handler);
      }
    };
    navigator.serviceWorker.addEventListener("message", handler);
    navigator.serviceWorker.controller.postMessage({ type: "GET_CONTENT_CACHE_STATS" });
    setTimeout(() => {
      navigator.serviceWorker.removeEventListener("message", handler);
    }, 3000);
  }, []);

  React.useEffect(() => {
    loadCategoryTrees()
      .then(setTrees)
      .catch(() => setTrees({}));
  }, []);

  React.useEffect(() => {
    refreshStats();
    const timer = setTimeout(refreshStats, 2000);
    return () => clearTimeout(timer);
  }, [refreshStats]);

  // Check cache status for visible leaf packs once trees load / SW becomes ready
  React.useEffect(() => {
    if (!trees || !swAvailable) return;
    const leaves: ContentTreeNode[] = [];
    const walk = (nodes: ContentTreeNode[]) => {
      for (const n of nodes) {
        if (n.items.length === 0) leaves.push(n);
        else walk(n.items);
      }
    };
    for (const nodes of Object.values(trees)) walk(nodes);
    for (const leaf of leaves) {
      const urls = nodeUrls(leaf);
      if (urls.length > 0) checkStatus(leaf.uid, urls);
    }
  }, [trees, swAvailable, checkStatus]);

  const handleClear = React.useCallback(() => {
    if (!swAvailable) return;
    setClearing(true);
    navigator.serviceWorker.controller!.postMessage({ type: "CLEAR_CONTENT_CACHE" });
    setTimeout(() => {
      setClearing(false);
      setConfirmClear(false);
      refreshStats();
      if (trees) {
        const walk = (nodes: ContentTreeNode[]) => {
          for (const n of nodes) {
            if (n.items.length === 0) checkStatus(n.uid, nodeUrls(n));
            else walk(n.items);
          }
        };
        for (const nodes of Object.values(trees)) walk(nodes);
      }
    }, 800);
  }, [swAvailable, refreshStats, trees, checkStatus]);

  const visibleTypes = React.useMemo<EngineType[]>(() => {
    if (!trees) return [];
    const order: EngineType[] = ["quiz", "bank", "written", "flashcard", "osce", "library", "video"];
    return order.filter((et) => (trees[et]?.length ?? 0) > 0);
  }, [trees]);

  const filteredTypes = typeFilter === "all" ? visibleTypes : [typeFilter];

  const collapsedAll = () => {
    const next = new Set<string>();
    setExpanded(next);
  };
  const expandAll = () => {
    const next = new Set<string>();
    if (trees) {
      const walk = (nodes: ContentTreeNode[]) => {
        for (const n of nodes) {
          if (n.items.length > 0) {
            next.add(n.uid);
            walk(n.items);
          }
        }
      };
      for (const et of filteredTypes) walk(trees[et] ?? []);
    }
    setExpanded(next);
  };

  const toggle = (uid: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(uid)) next.delete(uid);
      else next.add(uid);
      return next;
    });

  const bulkAction = (action: "download" | "remove") => {
    if (!trees) return;
    const walk = (nodes: ContentTreeNode[]) => {
      for (const n of nodes) {
        const urls = nodeUrls(n);
        if (urls.length > 0) {
          if (action === "download") precache(n.uid, urls);
          else remove(n.uid, urls);
        }
        if (n.items.length > 0) walk(n.items);
      }
    };
    for (const et of filteredTypes) walk(trees[et] ?? []);
    haptic(action === "download" ? "success" : "warning");
  };

  const renderNode = (node: ContentTreeNode, depth: number): React.ReactNode => {
    const isBranch = node.items.length > 0;
    const urls = nodeUrls(node);
    const state = getState(node.uid);
    if (isBranch) {
      const open = expanded.has(node.uid);
      const leafCount = countLeaves(node);
      const cachedCount = countCached(node, getState);
      return (
        <div key={node.uid}>
          <button
            type="button"
            onClick={() => toggle(node.uid)}
            className="w-full flex items-center gap-2 py-2 px-2 rounded-lg hover:bg-muted/60 transition-colors text-start"
            style={{ paddingInlineStart: `${depth * 12 + 8}px` }}
          >
            <ChevronRight
              className={cn("size-4 text-muted-foreground shrink-0 transition-transform", open && "rotate-90", rtl && "rtl-flip-x")}
            />
            <FolderTree className="size-4 text-muted-foreground shrink-0" />
            <span className="text-sm font-medium truncate">{node.title}</span>
            <span className="text-[11px] text-muted-foreground ms-auto shrink-0">
              {t("settings.downloads.cachedCount", { cached: cachedCount, total: leafCount })}
            </span>
          </button>
          {open && <div>{node.items.map((c) => renderNode(c, depth + 1))}</div>}
        </div>
      );
    }
    return (
      <div
        key={node.uid}
        className="flex items-center gap-2 py-2 px-2 rounded-lg hover:bg-muted/40 transition-colors"
        style={{ paddingInlineStart: `${depth * 12 + 8}px` }}
      >
        <Layers className="size-4 text-muted-foreground/60 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="text-sm truncate">{node.title}</div>
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <span>{t("settings.downloads.leafCount", { n: node.files?.length ?? 0 })}</span>
            {(node.images?.length ?? 0) > 0 && (
              <span>· {t("settings.downloads.images", { n: node.images!.length })}</span>
            )}
            <StatusBadge state={state} t={t} />
          </div>
        </div>
        <ContentCacheButton packId={node.uid} urls={urls} />
      </div>
    );
  };

  return (
    <Card className="p-5">
      <h2 className="text-base font-semibold flex items-center gap-2 mb-3">
        <Download className="size-4 text-primary" />
        {t("settings.downloads.title")}
      </h2>
      <p className="text-xs text-muted-foreground mb-4 leading-relaxed">
        {t("settings.downloads.subtitle")}
      </p>

      {!swAvailable ? (
        <div className="bg-muted/40 border border-border rounded-lg p-4 text-sm text-muted-foreground">
          {t("settings.downloads.swUnavailable")}
        </div>
      ) : (
        <>
          <div className="bg-card border border-border rounded-lg p-4 flex items-center justify-between gap-3 mb-4">
            <div className="flex items-center gap-3">
              <div className="size-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
                <HardDrive className="size-5" />
              </div>
              <div>
                <div className="text-sm font-medium">
                  {stats
                    ? stats.count === 1
                      ? t("settings.downloads.oneFileCached")
                      : t("settings.downloads.filesCached", { n: stats.count })
                    : t("settings.downloads.loading")}
                </div>
                <div className="text-xs text-muted-foreground">
                  {stats ? formatBytes(stats.size) : ""}
                </div>
              </div>
            </div>
          </div>

          {!confirmClear ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setConfirmClear(true)}
              disabled={!stats || stats.count === 0 || clearing}
            >
              <Trash2 className="size-3.5 me-1.5" />
              {t("settings.downloads.clearAll")}
            </Button>
          ) : (
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium">{t("settings.downloads.confirm")}</span>
              <Button
                size="sm"
                variant="destructive"
                className="h-7 text-xs"
                onClick={handleClear}
                disabled={clearing}
              >
                {clearing ? t("settings.downloads.clearing") : t("settings.downloads.confirmYes")}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-xs"
                onClick={() => setConfirmClear(false)}
                disabled={clearing}
              >
                {t("settings.downloads.cancel")}
              </Button>
            </div>
          )}

          <div className="mt-6">
            <div className="flex items-center justify-between gap-2 mb-3">
              <h3 className="text-sm font-semibold">{t("settings.downloads.managerTitle")}</h3>
              {trees && visibleTypes.length > 0 && (
                <div className="flex items-center gap-1.5">
                  <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={expandAll}>
                    {t("settings.downloads.expandAll")}
                  </Button>
                  <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={collapsedAll}>
                    {t("settings.downloads.collapseAll")}
                  </Button>
                </div>
              )}
            </div>
            <p className="text-xs text-muted-foreground mb-3">
              {t("settings.downloads.managerSubtitle")}
            </p>

            {!trees ? (
              <div className="text-sm text-muted-foreground py-4">{t("settings.downloads.loading")}</div>
            ) : visibleTypes.length === 0 ? (
              <div className="text-sm text-muted-foreground py-4">{t("settings.downloads.empty")}</div>
            ) : (
              <>
                <div className="flex flex-wrap gap-1.5 mb-4">
                  <FilterPill
                    active={typeFilter === "all"}
                    onClick={() => setTypeFilter("all")}
                    label={t("settings.downloads.allTypes")}
                  />
                  {visibleTypes.map((et) => (
                    <FilterPill
                      key={et}
                      active={typeFilter === et}
                      onClick={() => setTypeFilter(et)}
                      label={t(`engine.${et}` as any)}
                    />
                  ))}
                </div>

                <div className="flex items-center gap-2 mb-3">
                  <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => bulkAction("download")}>
                    <Download className="size-3.5 me-1.5" />
                    {t("settings.downloads.downloadAll")}
                  </Button>
                  <Button variant="ghost" size="sm" className="h-7 text-xs text-destructive" onClick={() => bulkAction("remove")}>
                    <Trash2 className="size-3.5 me-1.5" />
                    {t("settings.downloads.removeAll")}
                  </Button>
                </div>

                <div className="border border-border rounded-lg p-1 max-h-[420px] overflow-y-auto osler-scroll">
                  {filteredTypes.map((et) => (
                    <div key={et} className="py-1">
                      <div className="flex items-center gap-2 px-2 py-1.5">
                        <span
                          className="size-2 rounded-full shrink-0"
                          style={{ background: getEngineMeta(et).color }}
                        />
                        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                          {t("settings.downloads.typeLabel", {
                            label: t(`engine.${et}` as any),
                            n: countLeaves({ uid: "", title: "", type: et, path: "", items: trees[et] ?? [] }),
                          })}
                        </span>
                      </div>
                      {(trees[et] ?? []).map((n) => renderNode(n, 0))}
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </>
      )}
    </Card>
  );
}

function FilterPill({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={() => {
        onClick();
        haptic("selection");
      }}
      className={cn(
        "px-3 py-1 rounded-full text-xs font-medium transition-colors",
        active
          ? "bg-primary text-primary-foreground"
          : "bg-muted/60 text-muted-foreground hover:text-foreground"
      )}
    >
      {label}
    </button>
  );
}

function StatusBadge({
  state,
  t,
}: {
  state: DownloadState;
  t: (key: StringKey, params?: Record<string, string | number>) => string;
}) {
  if (state === "cached") {
    return <span className="text-success">{t("settings.downloads.cachedBadge")}</span>;
  }
  if (state === "partial") {
    return <span className="text-warning">{t("settings.downloads.cachedBadge")}</span>;
  }
  if (state === "downloading") {
    return <span className="text-primary">{t("cache.downloadingSimple")}</span>;
  }
  if (state === "error") {
    return <span className="text-destructive">{t("cache.error")}</span>;
  }
  return <span className="text-muted-foreground">{t("settings.downloads.notCachedBadge")}</span>;
}

function countLeaves(node: ContentTreeNode): number {
  if (node.items.length === 0) return 1;
  return node.items.reduce((sum, c) => sum + countLeaves(c), 0);
}

function countCached(
  node: ContentTreeNode,
  getState: (id: string) => string
): number {
  if (node.items.length === 0) {
    return getState(node.uid) === "cached" || getState(node.uid) === "partial" ? 1 : 0;
  }
  return node.items.reduce((sum, c) => sum + countCached(c, getState), 0);
}

/* ─── Backup & Restore section (file export/import) ──────────────────── */