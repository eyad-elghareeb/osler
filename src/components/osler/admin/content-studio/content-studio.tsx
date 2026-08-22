"use client";

/**
 * Content Studio — the revamped admin content management UI.
 *
 *   ┌─────────┬────────────────────────────────────────┬──────────┐
 *   │ Category│ Toolbar (single row: nav, breadcrumbs, │  Detail  │
 *   │ Rail    │ search, filters, Upload/New actions)   │  Panel   │
 *   │         ├────────────────────────────────────────┤          │
 *   │ Library │   File Explorer (grid/list)            │          │
 *   │ Q-Bank  │                                        │          │
 *   │ Flashcrd│                                        │          │
 *   │ OSCE    │                                        │          │
 *   │ Videos  │                                        │          │
 *   └─────────┴────────────────────────────────────────┴──────────┘
 *
 * This file is a slim orchestrator — it owns the studio's *state* (which
 * folder is open, which items are selected, the view mode) and delegates:
 *   - Side effects (API calls, toasts)        → useContentActions hook
 *   - Tree merging                            → buildUnifiedTree helper
 *   - Dialogs                                 → dialogs.tsx
 *   - Sub-views (rail, toolbar, explorer, …)  → sibling components
 *
 * Keeping this file under ~400 lines makes the data-flow easy to follow:
 * state lives here, mutations flow through the hook, rendering flows down
 * to the sub-components.
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, RefreshCw, Loader2 } from "lucide-react";
import { useI18n } from "@/components/osler/i18n-provider";
import { haptic } from "@/lib/osler/native";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useToast } from "@/hooks/use-toast";
import {
  adminApi,
  type ContentObject,
  type AdminCapabilities,
} from "@/components/osler/admin/admin-api";
import { EmptyState, LoadingState } from "@/components/osler/ui-primitives";

import type { ContentTreeNode } from "@/components/osler/admin/content-tree-pane";

import {
  CATEGORIES,
  folderPathOf,
  parentPath,
  pathToBreadcrumbs,
  findFolderNode,
  findNodeInTree,
  type ValidationState,
  type ViewMode,
  type R2Item,
  type UploadProgress,
} from "./types";
import { buildUnifiedTree, countLeaves } from "./unified-tree";
import { CategoryRail } from "./category-rail";
import { FileExplorer, type ContextMenuActions } from "./file-explorer";
import { DetailPanel } from "./detail-panel";
import { ExplorerToolbar, type StatusFilter } from "./explorer-toolbar";
import { ConvertDialog } from "./convert-dialog";
import { MoveContentDialog } from "./move-dialog";
import { ContentSearchModal } from "./search-modal";
import {
  PathInputDialog,
  DeleteConfirmDialog,
  CreateContentDialog,
  UploadDialog,
} from "./dialogs";
import {
  filesToDropped,
  stagedKeyFor,
  uploadStagedFile,
  type DroppedFile,
} from "@/components/osler/admin/content-dropzone";
import { useContentActions } from "./use-content-actions";

// ── Main component ──────────────────────────────────────────────────────────

export interface ContentStudioProps {
  capabilities: AdminCapabilities;
}

export function ContentStudio({ capabilities }: ContentStudioProps) {
  const { t } = useI18n();
  const { toast } = useToast();
  const router = useRouter();

  // ── Tree state ────────────────────────────────────────────────────────
  const [unifiedObjects, setUnifiedObjects] = React.useState<ContentObject[]>([]);
  const [unifiedR2ByCat, setUnifiedR2ByCat] = React.useState<Record<string, R2Item[]>>({});
  const [unifiedStagedByCat, setUnifiedStagedByCat] = React.useState<Record<string, R2Item[]>>({});
  const [unifiedLoading, setUnifiedLoading] = React.useState(true);
  const [statusFilter, setStatusFilter] = React.useState<StatusFilter>("all");
  const [r2Missing, setR2Missing] = React.useState(false);

  // ── Navigation state ──────────────────────────────────────────────────
  const [activeFolder, setActiveFolder] = React.useState<string>("");
  const [history, setHistory] = React.useState<string[]>([""]);
  const [historyIdx, setHistoryIdx] = React.useState(0);

  // ── UI state ──────────────────────────────────────────────────────────
  const [viewMode, setViewModeState] = React.useState<ViewMode>(() => {
    if (typeof window === "undefined") return "grid";
    try {
      return (localStorage.getItem("osler-studio-view-mode") as ViewMode) || "grid";
    } catch {
      return "grid";
    }
  });

  const setViewMode = React.useCallback((m: ViewMode) => {
    setViewModeState(m);
    try {
      localStorage.setItem("osler-studio-view-mode", m);
    } catch {}
  }, []);

  const [search, setSearch] = React.useState("");
  const [searchModalOpen, setSearchModalOpen] = React.useState(false);
  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(new Set());
  const [validationStates, setValidationStates] = React.useState<Map<string, ValidationState>>(new Map());
  // Collapsible side panels — persisted to localStorage so the choice
  // survives reloads. Both default to open.
  const [railOpen, setRailOpen] = React.useState(() => {
    if (typeof window === "undefined") return true;
    try { return localStorage.getItem("osler-studio-rail-open") !== "0"; } catch { return true; }
  });
  const [detailOpen, setDetailOpen] = React.useState(() => {
    if (typeof window === "undefined") return true;
    try { return localStorage.getItem("osler-studio-detail-open") !== "0"; } catch { return true; }
  });
  const [mobileRailOpen, setMobileRailOpen] = React.useState(false);
  const [mobileDetailOpen, setMobileDetailOpen] = React.useState(false);
  React.useEffect(() => {
    try { localStorage.setItem("osler-studio-rail-open", railOpen ? "1" : "0"); } catch {}
  }, [railOpen]);
  React.useEffect(() => {
    try { localStorage.setItem("osler-studio-detail-open", detailOpen ? "1" : "0"); } catch {}
  }, [detailOpen]);

  // ── Dialog state (create / upload) ────────────────────────────────────
  const [createOpen, setCreateOpen] = React.useState(false);
  const [uploadOpen, setUploadOpen] = React.useState(false);
  // Live progress of a direct-staging drag-and-drop upload.
  const [uploadJob, setUploadJob] = React.useState<UploadProgress | null>(null);

  // ── Load unified tree (managed objects + loose R2 keys) ──────────────
  const loadUnified = React.useCallback(async () => {
    setUnifiedLoading(true);
    setR2Missing(false);
    try {
      const res = await adminApi.listAllContent("all");
      setUnifiedObjects(res);

      // Fetch loose R2 keys (content-files/ + content-staging/) per category so
      // folders created via `.keep` markers and files outside the managed set
      // still render. Follows the cursor so categories with many keys don't
      // silently truncate.
      const r2ByCat: Record<string, R2Item[]> = {};
      const stagedByCat: Record<string, R2Item[]> = {};
      if (capabilities.manageUsers) {
        const results = await Promise.allSettled(
          CATEGORIES.map(async (cat) => {
            const collect = async (scope: "content-files" | "content-staging") => {
              const items: R2Item[] = [];
              let cursor: string | undefined;
              for (let page = 0; page < 10; page++) {
                const listed = await adminApi.listR2Keys(cat.folder, cursor, scope);
                items.push(...(listed.items || []));
                if (!listed.cursor) break;
                cursor = listed.cursor;
              }
              return items;
            };
            const [r2, staged] = await Promise.all([collect("content-files"), collect("content-staging")]);
            return { folder: cat.folder, items: r2, stagedItems: staged };
          }),
        );
        for (const r of results) {
          if (r.status === "fulfilled") {
            r2ByCat[r.value.folder] = r.value.items;
            stagedByCat[r.value.folder] = r.value.stagedItems;
          } else if ((r.reason as any)?.status === 503) {
            setR2Missing(true);
          }
        }
      }
      setUnifiedR2ByCat(r2ByCat);
      setUnifiedStagedByCat(stagedByCat);
    } catch (err: any) {
      if (err?.status === 503) {
        setR2Missing(true);
        setUnifiedObjects([]);
        setUnifiedR2ByCat({});
        setUnifiedStagedByCat({});
        return;
      }
      toast({ title: t("admin.toast.failedLoadContent"), variant: "destructive" });
    } finally {
      setUnifiedLoading(false);
    }
  }, [capabilities.manageUsers, toast, t]);

  React.useEffect(() => { loadUnified(); }, [loadUnified]);

  // ── Build the unified tree ────────────────────────────────────────────
  const unifiedTree = React.useMemo(() => {
    const typeToCat: Record<string, string> = {
      quiz: "qbank", bank: "qbank", written: "qbank",
      flashcard: "flashcard", osce: "osce",
      library: "library", video: "videos",
    };
    const managedByCat = new Map<string, ContentObject[]>();
    for (const obj of unifiedObjects) {
      const cat = typeToCat[obj.content_type] ?? obj.content_type;
      if (!managedByCat.has(cat)) managedByCat.set(cat, []);
      managedByCat.get(cat)!.push(obj);
    }

    return CATEGORIES.map((cat) => ({
      id: `unified-root-${cat.folder}`,
      name: t(cat.labelKey as any),
      kind: "folder" as const,
      items: buildUnifiedTree(
        cat.folder,
        cat.contentType,
        unifiedR2ByCat[cat.folder] ?? [],
        unifiedStagedByCat[cat.folder] ?? [],
        managedByCat.get(cat.folder) ?? [],
        statusFilter,
        t(cat.labelKey as any),
      ),
    }));
  }, [unifiedObjects, unifiedR2ByCat, unifiedStagedByCat, statusFilter, t]);

  // ── Derived: current category + path ──────────────────────────────────
  const { currentCategory, currentPathWithinCat } = React.useMemo(() => {
    if (!activeFolder) return { currentCategory: null, currentPathWithinCat: "" };
    const parts = activeFolder.split("/");
    const cat = CATEGORIES.find((c) => c.folder === parts[0]) ?? null;
    return { currentCategory: cat, currentPathWithinCat: parts.slice(1).join("/") };
  }, [activeFolder]);

  // ── Derived: items in the current folder ──────────────────────────────
  const currentFolderItems = React.useMemo<ContentTreeNode[]>(() => {
    if (!activeFolder) {
      // "All categories" — show the 5 category tiles as folder entries
      return CATEGORIES.map((cat) => ({
        id: `unified-root-${cat.folder}`,
        name: t(cat.labelKey as any),
        kind: "folder" as const,
        r2Key: `content-files/${cat.folder}`,
        items: unifiedTree.find((n) => n.id === `unified-root-${cat.folder}`)?.items ?? [],
      })) as ContentTreeNode[];
    }
    const node = findFolderNode(unifiedTree, currentCategory!.folder, currentPathWithinCat);
    return node?.items ?? [];
  }, [activeFolder, unifiedTree, currentCategory, currentPathWithinCat, t]);

  // ── Derived: filtered + counts + selected ─────────────────────────────
  const filteredItems = React.useMemo(() => {
    if (!search.trim()) return currentFolderItems;
    const q = search.toLowerCase();
    return currentFolderItems.filter((n) => n.name.toLowerCase().includes(q));
  }, [currentFolderItems, search]);

  const counts = React.useMemo(() => {
    const out: Record<string, number> = {};
    let total = 0;
    for (const cat of CATEGORIES) {
      const root = unifiedTree.find((n) => n.id === `unified-root-${cat.folder}`);
      const count = root ? countLeaves(root) : 0;
      out[cat.folder] = count;
      total += count;
    }
    out.__total = total;
    return out;
  }, [unifiedTree]);

  const selectedNodes = React.useMemo(
    () => selectedIds.size === 0
      ? []
      : Array.from(selectedIds).map((id) => findNodeInTree(unifiedTree, id)).filter((n): n is ContentTreeNode => n != null),
    [unifiedTree, selectedIds],
  );

  // Tree view mode renders the full category hierarchy (not just the current
  // folder's children). At the root level it shows every category; once a
  // category is active it narrows to that category's tree.
  const treeViewRoots = React.useMemo(() => {
    if (!currentCategory) return unifiedTree;
    return unifiedTree.filter((n) => n.id === `unified-root-${currentCategory.folder}`);
  }, [unifiedTree, currentCategory]);

  // ── Auto-validate managed objects (automation) ────────────────────────
  // Validation runs with a small concurrency pool. Each call is a Worker
  // round-trip that re-reads + validates the draft body server-side, so a
  // sequential loop turns a folder with many managed files into a long
  // serial waterfall — the pool keeps badge fill-in fast without
  // stampeding the Worker with all requests at once.
  React.useEffect(() => {
    if (!capabilities.manageContent) return;
    // Library articles (.md) aren't JSON — the server validator only checks
    // JSON pack shapes, so validating them here would flag every article
    // invalid. Skip them; the editor's markdown preview is the check.
    const managedInView = currentFolderItems.filter(
      (n) => n.managed && n.cloudObject && n.cloudObject.content_type !== "library"
    );
    if (managedInView.length === 0) return;

    setValidationStates((prev) => {
      const next = new Map(prev);
      for (const n of managedInView) {
        if (!next.has(n.id)) next.set(n.id, "checking");
      }
      return next;
    });

    let cancelled = false;
    let cursor = 0;
    async function validateNext() {
      while (!cancelled && cursor < managedInView.length) {
        const n = managedInView[cursor++];
        if (!n.cloudObject) continue;
        try {
          const res = await adminApi.validateContent(n.cloudObject.id);
          if (cancelled) return;
          setValidationStates((prev) => {
            const next = new Map(prev);
            next.set(n.id, res.errors.length === 0 ? "valid" : "invalid");
            return next;
          });
        } catch {
          if (cancelled) return;
          setValidationStates((prev) => {
            const next = new Map(prev);
            next.delete(n.id);
            return next;
          });
        }
      }
    }
    const workers = Array.from(
      { length: Math.min(4, managedInView.length) },
      () => validateNext(),
    );
    void Promise.all(workers);
    return () => { cancelled = true; };
  }, [currentFolderItems, capabilities.manageContent]);

  // ── Actions hook (side effects) ───────────────────────────────────────
  const { actions, dialog, setDialog } = useContentActions({
    capabilities,
    onMutated: () => { setSelectedIds(new Set()); loadUnified(); },
    onPromoted: (id) => router.push(`/admin/content?id=${encodeURIComponent(id)}`),
    onConverted: (id) => router.push(`/admin/content?id=${encodeURIComponent(id)}`),
  });

  // ── Navigation handlers ───────────────────────────────────────────────
  function navigateTo(path: string) {
    if (path === activeFolder) return;
    const newHistory = history.slice(0, historyIdx + 1).concat(path);
    setHistory(newHistory);
    setHistoryIdx(newHistory.length - 1);
    setActiveFolder(path);
    setSelectedIds(new Set());
    setSearch("");
  }
  function goBack() {
    if (historyIdx <= 0) return;
    const newIdx = historyIdx - 1;
    setHistoryIdx(newIdx);
    setActiveFolder(history[newIdx]);
    setSelectedIds(new Set());
    setSearch("");
  }
  function goForward() {
    if (historyIdx >= history.length - 1) return;
    const newIdx = historyIdx + 1;
    setHistoryIdx(newIdx);
    setActiveFolder(history[newIdx]);
    setSelectedIds(new Set());
    setSearch("");
  }
  function goUp() {
    if (!activeFolder) return;
    const parent = parentPath(currentPathWithinCat);
    if (parent === currentPathWithinCat) return;
    const newPath = currentCategory ? `${currentCategory.folder}${parent ? "/" + parent : ""}` : "";
    navigateTo(newPath);
  }

  // ── Selection / open handlers ─────────────────────────────────────────
  function handleOpenFolder(node: ContentTreeNode) {
    navigateTo(folderPathOf(node));
  }
  function handleOpen(node: ContentTreeNode) {
    haptic("selection");
    if (node.managed && node.cloudObject) {
      router.push(`/admin/content?id=${encodeURIComponent(node.cloudObject.id)}`);
    } else if (node.r2Key) {
      router.push(`/admin/content/raw?key=${encodeURIComponent(node.r2Key)}`);
    }
  }
  /**
   * Seamless drag-and-drop into an open folder: files dropped on the explorer
   * (or on a folder tile) are staged directly into content-staging/<target>/
   * with an inline progress overlay, then the tree reloads and the explorer
   * navigates into the resolved folder so the files appear right where they
   * landed. Falls back to the upload dialog when no folder resolved.
   */
  async function handleDropFiles(
    files: File[],
    paths: Map<File, string>,
    targetPath?: string,
  ) {
    if (!capabilities.manageUsers) return;
    haptic("light");
    const dest = (targetPath || activeFolder || "").trim();
    if (!dest || dest.split("/").includes("__drafts__")) {
      setUploadOpen(true);
      return;
    }

    let dropped: DroppedFile[];
    try {
      dropped = await filesToDropped(files, paths);
    } catch {
      toast({ title: t("admin.toast.failedReadFiles"), variant: "destructive" });
      return;
    }
    // Deduplicate by the exact staging key a re-drop would overwrite.
    const seen = new Set<string>();
    const unique = dropped.filter((d) => {
      try {
        const k = stagedKeyFor(d, dest);
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      } catch {
        return false;
      }
    });
    if (unique.length === 0) return;

    setUploadJob({ done: 0, total: unique.length, dest });
    let done = 0;
    let failed = 0;
    for (const d of unique) {
      try {
        await uploadStagedFile(d, dest);
        done += 1;
      } catch {
        failed += 1;
      }
      setUploadJob({ done, total: unique.length, dest });
    }
    setUploadJob(null);

    if (failed === 0) {
      toast({ title: t("admin.studio.dropStaged", { n: done, dest: `content-staging/${dest}/` }) });
    } else if (done > 0) {
      toast({ title: t("admin.studio.dropStagedPartial", { ok: done, total: unique.length, fail: failed }), variant: "destructive" });
    } else {
      toast({ title: t("admin.studio.dropFailed"), variant: "destructive" });
    }

    if (dest !== activeFolder) navigateTo(dest);
    loadUnified();
  }

  // ── Global Keyboard Shortcuts ─────────────────────────────────────────
  React.useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const activeEl = document.activeElement;
      const isInput = activeEl && (
        activeEl.tagName === "INPUT" ||
        activeEl.tagName === "TEXTAREA" ||
        activeEl.tagName === "SELECT" ||
        (activeEl as HTMLElement).isContentEditable
      );

      // Ctrl+K / Cmd+K -> Search Modal (available anywhere)
      if ((e.ctrlKey || e.metaKey) && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        setSearchModalOpen(true);
        return;
      }

      // Global shortcuts active when not typing in an input
      if (!isInput) {
        // Alt+1 / Alt+2 / Alt+3 -> View mode
        if (e.altKey && e.key === "1") {
          e.preventDefault();
          setViewMode("tree");
          return;
        }
        if (e.altKey && e.key === "2") {
          e.preventDefault();
          setViewMode("grid");
          return;
        }
        if (e.altKey && e.key === "3") {
          e.preventDefault();
          setViewMode("list");
          return;
        }

        // Ctrl+N -> New content
        if ((e.ctrlKey || e.metaKey) && !e.shiftKey && (e.key === "n" || e.key === "N")) {
          e.preventDefault();
          if (capabilities.manageUsers) setCreateOpen(true);
          return;
        }

        // Ctrl+Shift+N -> New folder
        if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === "n" || e.key === "N")) {
          e.preventDefault();
          if (capabilities.manageUsers) {
            actions.openNewFolderDialog(activeFolder.endsWith("/__drafts__") ? "" : activeFolder);
          }
          return;
        }

        // Ctrl+U -> Upload
        if ((e.ctrlKey || e.metaKey) && (e.key === "u" || e.key === "U")) {
          e.preventDefault();
          if (capabilities.manageUsers) setUploadOpen(true);
          return;
        }

        // F2 -> Rename selected
        if (e.key === "F2" && selectedNodes.length === 1 && capabilities.manageUsers) {
          e.preventDefault();
          actions.openRenameDialog(selectedNodes[0]);
          return;
        }

        // Ctrl+M -> Move selected
        if ((e.ctrlKey || e.metaKey) && (e.key === "m" || e.key === "M") && selectedNodes.length > 0 && capabilities.manageUsers) {
          e.preventDefault();
          actions.openMoveDialog(selectedNodes);
          return;
        }
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [actions, activeFolder, selectedNodes, setViewMode, capabilities.manageUsers]);

  // ── Context menu actions (wire the hook into the explorer's shape) ────
  const contextActions: ContextMenuActions = {
    onOpen: handleOpen,
    onRename: actions.openRenameDialog,
    onDelete: actions.openDeleteDialog,
    onMove: (nodes) => actions.openMoveDialog(nodes),
    onDuplicate: actions.duplicate,
    onDownload: actions.download,
    onPromote: actions.promote,
    onPublishStaged: actions.publishStaged,
    onDiscardStaged: actions.discardStaged,
    // When a folder node is right-clicked, the context menu passes its path.
    // When the empty area is right-clicked, it passes "". We fall back to
    // activeFolder so new files/folders always land in the current directory.
    onNewFile: (path) => actions.openNewFileDialog(
      path || (activeFolder.endsWith("/__drafts__") ? "" : activeFolder)
    ),
    onNewFolder: (path) => actions.openNewFolderDialog(
      path || (activeFolder.endsWith("/__drafts__") ? "" : activeFolder)
    ),
    onNewContent: () => setCreateOpen(true),
    onUpload: () => setUploadOpen(true),
    onSearch: () => setSearchModalOpen(true),
    onSelectAll: () => setSelectedIds(new Set(filteredItems.map((i) => i.id))),
    onConvert: actions.openConvertDialog,
    onPublish: actions.publish,
    onUnpublish: actions.unpublish,
  };

  // ── Render: R2 not configured ─────────────────────────────────────────
  if (r2Missing && unifiedTree.length === 0) {
    return (
      <EmptyState
        icon={AlertCircle}
        title={t("admin.content.noR2")}
        description={t("admin.content.noR2Desc")}
      />
    );
  }

  const breadcrumbs = currentCategory
    ? pathToBreadcrumbs(currentCategory.folder, t(currentCategory.labelKey as any), currentPathWithinCat)
        .map((crumb) => (crumb.path === "__drafts__"
          ? { ...crumb, label: t("admin.studio.draftsFolder") }
          : crumb))
    : [{ path: "", label: t("admin.studio.breadcrumbRoot") }];

  // ── Render ────────────────────────────────────────────────────────────
  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Single toolbar — navigation, breadcrumbs, search/filters, and the
          Upload / New folder / New content actions all live in one row. */}
      <ExplorerToolbar
        breadcrumbs={breadcrumbs}
        canGoBack={historyIdx > 0}
        canGoForward={historyIdx < history.length - 1}
        canGoUp={!!currentPathWithinCat}
        onBack={goBack}
        onForward={goForward}
        onUp={goUp}
        onBreadcrumbClick={(path) => {
          const newPath = currentCategory ? `${currentCategory.folder}${path ? "/" + path : ""}` : "";
          navigateTo(newPath);
        }}
        onOpenSearchModal={() => setSearchModalOpen(true)}
        statusFilter={statusFilter}
        onStatusFilterChange={setStatusFilter}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        onRefresh={loadUnified}
        loading={unifiedLoading}
        canManage={capabilities.manageUsers}
        onNewFile={() => actions.openNewFileDialog(activeFolder.endsWith("/__drafts__") ? "" : activeFolder)}
        onNewFolder={() => actions.openNewFolderDialog(activeFolder.endsWith("/__drafts__") ? "" : activeFolder)}
        onUpload={() => setUploadOpen(true)}
        onNewContent={() => setCreateOpen(true)}
        onRegenerateManifests={actions.regenerateManifests}
        regenerating={actions.regenerating}
        onBackfill={actions.backfill}
        backfilling={actions.backfilling}
        onGcOrphans={actions.gcOrphans}
        gcRunning={actions.gcRunning}
        railOpen={railOpen}
        onToggleRail={() => {
          if (window.innerWidth < 768) {
            setMobileRailOpen(true);
          } else {
            setRailOpen((v) => !v);
          }
        }}
        detailOpen={detailOpen}
        onToggleDetail={() => {
          if (window.innerWidth < 768) {
            setMobileDetailOpen(true);
          } else {
            setDetailOpen((v) => !v);
          }
        }}
      />

      {/* Three-pane layout — all panes are resizable via drag handles.
          Side panes are conditionally rendered based on the collapse
          toggles in the header. When a side pane is collapsed, its
          resize handle is removed too so the center pane fills the space. */}
      <ResizablePanelGroup direction="horizontal" className="flex-1 min-h-0">
        {railOpen && (
          <>
            <ResizablePanel
              id="rail"
              order={1}
              defaultSize={16}
              minSize={10}
              maxSize={25}
              className="hidden md:flex min-h-0 bg-card/30"
            >
              <aside className="h-full w-full border-e border-border bg-card/30">
                <CategoryRail
                  activeFolder={activeFolder || null}
                  onSelect={navigateTo}
                  counts={counts}
                  totalCount={counts.__total ?? 0}
                  onDropFiles={handleDropFiles}
                />
              </aside>
            </ResizablePanel>
            <ResizableHandle />
          </>
        )}

        <ResizablePanel id="explorer" order={2} minSize={30} className="flex min-h-0 flex-col">
          <section className="flex h-full min-h-0 flex-col">
            <div className="relative flex-1 min-h-0 overflow-hidden">
              {unifiedLoading ? (
                <LoadingState label={t("common.loading")} className="h-full" />
              ) : (
                <FileExplorer
                  items={filteredItems}
                  treeRoots={treeViewRoots}
                  query={search}
                  selectedIds={selectedIds}
                  onSelectionChange={setSelectedIds}
                  onOpen={handleOpen}
                  onOpenFolder={handleOpenFolder}
                  viewMode={viewMode}
                  loading={unifiedLoading}
                  canManage={capabilities.manageUsers}
                  onDropFiles={handleDropFiles}
                  dropTargetPath={activeFolder}
                  uploadJob={uploadJob}
                  contextActions={contextActions}
                />
              )}
            </div>

            {/* Status bar */}
            <div className="flex shrink-0 items-center gap-2 border-t border-border bg-card px-2 sm:px-3 py-1 text-[11px] text-muted-foreground">
              <span>{t("admin.studio.statusBar.items", { n: String(filteredItems.length) })}</span>
              {selectedIds.size > 0 && (
                <>
                  <span className="hidden sm:inline">·</span>
                  <span className="hidden sm:inline font-medium text-primary">
                    {t("admin.studio.statusBar.selected", { n: String(selectedIds.size) })}
                  </span>
                </>
              )}
              <span className="ms-auto flex items-center gap-1">
                {unifiedLoading ? (
                  <><Loader2 className="size-3 animate-spin" /></>
                ) : (
                  <><RefreshCw className="size-3" /> <span className="hidden sm:inline">{t("admin.studio.refresh")}</span></>
                )}
              </span>
            </div>
          </section>
        </ResizablePanel>

        {detailOpen && (
          <>
            <ResizableHandle />
            <ResizablePanel
              id="detail"
              order={3}
              defaultSize={24}
              minSize={15}
              maxSize={40}
              className="hidden md:flex min-h-0 bg-card/30"
            >
              <aside className="h-full w-full border-s border-border bg-card/30">
                <DetailPanel
                  selectedNodes={selectedNodes}
                  categoryContentType={currentCategory?.contentType ?? "library"}
                  validationStates={validationStates}
                  onOpen={handleOpen}
                  onRename={actions.openRenameDialog}
                  onDelete={actions.openDeleteDialog}
                  onMove={(nodes) => actions.openMoveDialog(nodes)}
                  onDuplicate={actions.duplicate}
                  onDownload={actions.download}
                  onConvert={actions.openConvertDialog}
                  onPromote={actions.promote}
                  onPublishStaged={actions.publishStaged}
                  onDiscardStaged={actions.discardStaged}
                  onPublish={actions.publish}
                  onUnpublish={actions.unpublish}
                  canManage={capabilities.manageUsers}
                />
              </aside>
            </ResizablePanel>
          </>
        )}
      </ResizablePanelGroup>

      {/* ── Mobile sheets for side panels ──────────────────────────────── */}
      <Sheet open={mobileRailOpen} onOpenChange={setMobileRailOpen}>
        <SheetContent side="left" className="w-72 p-0">
          <SheetHeader className="sr-only">
            <SheetTitle>{t("admin.studio.allCategories")}</SheetTitle>
          </SheetHeader>
          <div className="flex h-full flex-col">
            <div className="h-14 shrink-0 border-b border-border flex items-center px-4">
              <h2 className="text-sm font-semibold">{t("admin.studio.allCategories")}</h2>
            </div>
            <div className="flex-1 overflow-y-auto">
              <CategoryRail
                activeFolder={activeFolder || null}
                onSelect={(folder) => {
                  navigateTo(folder);
                  setMobileRailOpen(false);
                }}
                counts={counts}
                totalCount={counts.__total ?? 0}
                onDropFiles={handleDropFiles}
              />
            </div>
          </div>
        </SheetContent>
      </Sheet>

      <Sheet open={mobileDetailOpen} onOpenChange={setMobileDetailOpen}>
        <SheetContent side="right" className="w-80 p-0">
          <SheetHeader className="sr-only">
            <SheetTitle>{t("admin.studio.noSelection")}</SheetTitle>
          </SheetHeader>
          <div className="flex h-full flex-col">
            <div className="h-14 shrink-0 border-b border-border flex items-center px-4">
              <h2 className="text-sm font-semibold">{t("admin.studio.quickActions")}</h2>
            </div>
            <div className="flex-1 overflow-y-auto">
              <DetailPanel
                selectedNodes={selectedNodes}
                categoryContentType={currentCategory?.contentType ?? "library"}
                validationStates={validationStates}
                onOpen={handleOpen}
                onRename={actions.openRenameDialog}
                onDelete={actions.openDeleteDialog}
                onMove={(nodes) => actions.openMoveDialog(nodes)}
                onDuplicate={actions.duplicate}
                onDownload={actions.download}
                onConvert={actions.openConvertDialog}
                onPromote={actions.promote}
                onPublishStaged={actions.publishStaged}
                onDiscardStaged={actions.discardStaged}
                onPublish={actions.publish}
                onUnpublish={actions.unpublish}
                canManage={capabilities.manageUsers}
              />
            </div>
          </div>
        </SheetContent>
      </Sheet>

      {/* ── Dialogs ──────────────────────────────────────────────────────── */}
      <CreateContentDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(id) => router.push(`/admin/content?id=${encodeURIComponent(id)}`)}
      />
      <UploadDialog
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        onStagedUploaded={() => { setUploadOpen(false); loadUnified(); }}
        canAdmin={capabilities.manageUsers}
      />
      <PathInputDialog
        dialog={dialog}
        onPathChange={(path) => setDialog((d) => ({ ...d, pathInput: path }))}
        onClose={actions.closePathDialog}
        onSubmit={actions.submitPathDialog}
        busy={actions.mutating}
      />
      <DeleteConfirmDialog
        node={dialog.deleteNode}
        open={dialog.deleteOpen}
        onClose={actions.closeDeleteDialog}
        onConfirm={actions.confirmDelete}
        busy={actions.mutating}
      />
      <ConvertDialog
        open={dialog.convertOpen}
        onOpenChange={(o) => !o && actions.closeConvertDialog()}
        node={dialog.convertNode}
        onConverted={(id) => { actions.closeConvertDialog(); router.push(`/admin/content?id=${encodeURIComponent(id)}`); }}
      />
      <MoveContentDialog
        open={dialog.moveOpen}
        onClose={actions.closeMoveDialog}
        targetNodes={dialog.moveNodes}
        categoryFolder={currentCategory?.folder ?? "library"}
        unifiedTree={unifiedTree}
        onConfirmMove={actions.confirmMove}
      />
      <ContentSearchModal
        open={searchModalOpen}
        onClose={() => setSearchModalOpen(false)}
        unifiedTree={unifiedTree}
        onOpenItem={handleOpen}
        onNavigateToFolder={navigateTo}
        initialCategory={currentCategory?.folder ?? null}
      />
    </div>
  );
}
