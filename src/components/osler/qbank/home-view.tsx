"use client";

import * as React from "react";
import { motion, animate } from "framer-motion";
import { ClipboardCheck, Plus, Activity, Grid3x3 } from "lucide-react";
import { loadCategoryTree, getCachedCategoryTree, loadContentByUid, flattenTree } from "@/lib/osler/content";
import { type PoolQuestion, type OnlyMode } from "@/lib/osler/qbank-pool";
import type { AnyContent, EngineType, ContentTreeNode } from "@/lib/osler/types";
import { storage, sessions, type SavedSession, type WrittenDraft } from "@/lib/osler/storage";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";
import { useHideOnScroll } from "@/hooks/use-hide-on-scroll";
import { useI18n } from "@/components/osler/i18n-provider";
import { PageHeader } from "@/components/osler/ui-primitives";
import { MOTION_TRANSITION } from "@/lib/osler/motion";
import { WalkthroughDialog, isWalkthroughCompleted } from "@/components/osler/walkthrough";
import { TestMode, HomeTab, PackEntry } from "./shared";
import { ContentTab } from "./content-tab";
import { CreateTestTab } from "./create-test-tab";
import { TrackerTab } from "./tracker-tab";
import { PackExportDialog } from "./pack-export-dialog";


export function HomeView({
  testMode,
  onTestModeChange,
  onOpenPack,
  homeTab,
  onHomeTabChange,
  onSetQuestionLimit,
  pendingCreateTestSourceUid,
  onPickForCreateTest,
  onClearPendingCreateTestSource,
  onStartCustomSession,
  onResumeActive,
}: {
  testMode: TestMode;
  onTestModeChange: (m: TestMode) => void;
  onOpenPack?: (item: ContentTreeNode) => void;
  homeTab: HomeTab;
  onHomeTabChange: (t: HomeTab) => void;
  onSetQuestionLimit?: (n: number) => void;
  /** Uid of the pack the user just clicked in Content tab — pre-checks it in Create Test. */
  pendingCreateTestSourceUid?: string | null;
  /** Called when a leaf pack is clicked in Content tab (P1-2). */
  onPickForCreateTest?: (node: ContentTreeNode) => void;
  /** Clear the pending pre-selection after Create Test has consumed it. */
  onClearPendingCreateTestSource?: () => void;
  /** Start a custom session from a built question pool (P2-4 / P3-2 / P5-5). */
  onStartCustomSession?: (
    pool: PoolQuestion[],
    meta: {
      title: string;
      engine: EngineType;
      mode?: TestMode;
      timerMinutes?: number;
      dismissAfterCorrect?: boolean;
      tagsFilter?: string[];
      onlyMode?: OnlyMode;
      isReview?: boolean;
      savedDrafts?: Record<string, WrittenDraft>;
      savedRubricState?: Record<string, boolean[]>;
      savedAnswers?: Record<number, number>;
      savedRevealed?: Record<number, boolean>;
      savedFlagged?: Record<number, boolean>;
      savedRatings?: Record<string, "easy" | "hard" | "unknown">;
      savedQuestionTimes?: Record<string, number>;
    }
  ) => void;
  /** Resume the active in-progress session in place (Tracker / in-session). */
  onResumeActive?: () => boolean;
}) {
  const [data, setData] = React.useState<{
    items: PackEntry[];
    trees: Record<string, ContentTreeNode[]>;
  } | null>(() => {
    const cachedTree = getCachedCategoryTree("quiz");
    if (!cachedTree) return null;
    const leaves = flattenTree(cachedTree).filter(
      (node) => node.type === "quiz" || node.type === "bank" || node.type === "written",
    );
    return {
      items: leaves.map((node) => ({ node, content: null })),
      trees: { quiz: cachedTree, bank: cachedTree, written: cachedTree },
    };
  });
  const [, force] = React.useReducer((x) => x + 1, 0);
  const { t } = useI18n();
  const [savedSessions, setSavedSessions] = React.useState<SavedSession[]>([]);
  const [exportDialogOpen, setExportDialogOpen] = React.useState(false);
  const [contextMenuNode, setContextMenuNode] = React.useState<ContentTreeNode | null>(null);
  const [walkthroughOpen, setWalkthroughOpen] = React.useState(false);

  // First-time interactive tour for new users
  React.useEffect(() => {
    if (!isWalkthroughCompleted("qbank-hub")) {
      setWalkthroughOpen(true);
    }
  }, []);

  // Pack export moved into the app-wide context menu: the menu sees
  // [data-ctx-export] on a pack/folder card and asks for the dialog via
  // this event (the dialog needs the tree + loader that live here).
  React.useEffect(() => {
    const open = (e: Event) => {
      const uid = (e as CustomEvent<{ uid?: string }>).detail?.uid;
      if (!uid) return;
      const node = (data?.items ?? []).find((entry) => entry.node.uid === uid)?.node
        ?? Object.values(data?.trees ?? {}).flatMap((root) => flattenTree(root)).find((n) => n.uid === uid);
      if (!node) return;
      setContextMenuNode(node);
      setExportDialogOpen(true);
    };
    window.addEventListener("osler-pack-export-request", open);
    return () => window.removeEventListener("osler-pack-export-request", open);
  }, [data]);

  // Hide-on-scroll / collapsible app bar — shared hysteresis hook (re-runs
  // its container lookup per tab). Mobile only: when scrolled down, the
  // header unmounts entirely so the lean tab strip is all that remains.
  // reservePx covers this header (~95px) PLUS the app shell's scroll-away
  // bar (54px) — both collapse on the same down-scroll, so the hook needs
  // the combined reclaim to avoid collapsing pages into unscrollability.
  const isMobileHome = useIsMobile();
  const scrolledDown = useHideOnScroll(homeTab, { reservePx: 150 });
  const headerCollapsed = isMobileHome && scrolledDown;

  const loadTreeData = React.useCallback(() => {
    loadCategoryTree("quiz")
      .then((tree) => {
        const leaves = flattenTree(tree).filter(
          (node) => node.type === "quiz" || node.type === "bank" || node.type === "written",
        );
        setData({
          items: leaves.map((node) => ({ node, content: null })),
          trees: { quiz: tree, bank: tree, written: tree },
        });
      })
      .catch(console.error);
  }, []);

  React.useEffect(() => {
    loadTreeData();
    const handler = () => loadTreeData();
    window.addEventListener("osler-content-invalidated", handler);
    return () => window.removeEventListener("osler-content-invalidated", handler);
  }, [loadTreeData]);

  const loadPack = React.useCallback(async (node: ContentTreeNode): Promise<AnyContent | null> => {
    const cached = data?.items.find((entry) => entry.node.uid === node.uid)?.content;
    if (cached) return cached;
    try {
      const content = await loadContentByUid(node.uid, node.type as EngineType);
      setData((current) => current && {
        ...current,
        items: current.items.map((entry) => entry.node.uid === node.uid ? { ...entry, content } : entry),
      });
      return content;
    } catch (error) {
      console.error(`Failed to load ${node.path}:`, error);
      return null;
    }
  }, [data]);

  React.useEffect(() => {
    const update = () => setSavedSessions(sessions.list());
    update();
    const unsub = sessions.subscribe(update);
    const unsubHydrated = storage.onHydrated(update);
    return () => {
      unsub();
      unsubHydrated();
    };
  }, []);

  React.useEffect(() => storage.subscribe(force), []);

  return (
    <div className="flex h-full overflow-hidden bg-background">
      <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
        {/* Page header — mobile: animates away on scroll-down exactly like
            the app scroll-away bar (height + staggered opacity via the
            collapseBar preset), leaving the lean 3-tab strip. Desktop: static. */}
        <motion.div
          initial={false}
          animate={{
            height: headerCollapsed ? 0 : "auto",
            opacity: headerCollapsed ? 0 : 1,
          }}
          transition={MOTION_TRANSITION.collapseBar}
          className={cn(
            "overflow-hidden shrink-0",
            // Same containment + hit-test skip as the app scroll-away bar.
            "[contain:layout_paint]",
            headerCollapsed && "pointer-events-none",
          )}
        >
          <div className="px-4 md:px-6 lg:px-8 w-full max-w-7xl mx-auto pt-3 md:pt-4 pb-2">
            <PageHeader
              inline
              inlineIcon={ClipboardCheck}
              title={t("qbank.home.title")}
              subtitle={t("qbank.home.subtitle")}
            />
          </div>
        </motion.div>
        {/* Tab bar — in-flow sibling above the scroller (nothing renders
            behind it), so it stays opaque; no backdrop blur to pay for on
            every frame of the collapse. Shadow flips instantly rather than
            transitioning — an animating box-shadow repaints the full-width
            strip every frame and competes with the height tween. */}
        <div className={cn(
          "shrink-0 border-b border-border w-full max-w-7xl mx-auto px-4 md:px-6 lg:px-8 bg-background z-20",
          headerCollapsed ? "shadow-e1" : "shadow-xs"
        )}>
          {/* 3-col grid: [spacer | centered tabs | filter]
              The 1fr cols balance each other so the auto center is always
              geometrically centred. items-end aligns the border-b-2 underline
              of active tabs flush with the container's border-b. */}
          <div className="-mb-px grid grid-cols-[1fr_auto_1fr]">
            <div />
            <nav className="flex" data-walkthrough="qbank-tabs">
              {[
                { id: "content" as const, label: t("qbank.home.tabContent"), icon: Grid3x3 },
                { id: "create" as const, label: t("qbank.home.tabCreate"), icon: Plus },
                { id: "tracker" as const, label: t("qbank.home.tabTracker"), icon: Activity },
              ].map((tab) => {
                const Icon = tab.icon;
                const active = homeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    data-walkthrough={`qbank-${tab.id}-tab-btn`}
                    onClick={() => onHomeTabChange(tab.id)}
                    className={cn(
                      "flex items-center gap-2 px-5 py-3 text-sm font-medium transition-colors",
                      active
                        ? "border-b-2 border-primary text-primary"
                        : "border-b-2 border-transparent text-muted-foreground hover:text-foreground"
                    )}
                  >
                    <Icon className="size-4" />
                    {tab.label}
                  </button>
                );
              })}
            </nav>
          </div>
        </div>

        {/* Content zone — fills remaining height; each tab owns its own
            padding and scroll so we don't double-apply horizontal padding.
            Keyed motion.div gives an enter-only fade on tab switch — no exit
            animation, which blanked the pane between tabs. */}
        <div className="flex-1 min-h-0 overflow-hidden">
          <motion.div
            key={homeTab}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={MOTION_TRANSITION.quick}
            className="h-full"
          >
              {homeTab === "content" && (
                <div data-walkthrough="qbank-packs" className="h-full">
                  <ContentTab
                    data={data}
                    onLoadPack={loadPack}
                    onOpenPack={onOpenPack}
                    onPickForCreateTest={onPickForCreateTest}
                  />
                </div>
              )}
              {homeTab === "create" && (
                <div className="osler-page" data-walkthrough="qbank-create">
                  <div className="osler-page__inner">
                    <CreateTestTab
                      data={data}
                      onLoadPack={loadPack}
                      testMode={testMode}
                      onTestModeChange={onTestModeChange}
                      onOpenPack={onOpenPack}
                      onSetQuestionLimit={onSetQuestionLimit}
                      initialSourceUid={pendingCreateTestSourceUid}
                      onConsumeInitialSource={onClearPendingCreateTestSource}
                      onStartCustomSession={onStartCustomSession}
                    />
                  </div>
                </div>
              )}
              {homeTab === "tracker" && (
                <div className="osler-page" data-walkthrough="qbank-tracker">
                  <div className="osler-page__inner">
                    <TrackerTab
                      data={data}
                      sessions={savedSessions}
                      onDelete={(id) => sessions.delete(id)}
                      onStartCustomSession={onStartCustomSession}
                      onResume={onResumeActive}
                      onLoadPack={loadPack}
                    />
                  </div>
                </div>
              )}
          </motion.div>
        </div>
      </div>

      {/* Right-click export dialog for content packs */}
      {exportDialogOpen && contextMenuNode && (
        <PackExportDialog
          open={exportDialogOpen}
          onOpenChange={setExportDialogOpen}
          node={contextMenuNode}
          items={data?.items ?? []}
          onLoadPack={loadPack}
        />
      )}

      {/* Interactive Walkthrough */}
      <WalkthroughDialog
        tour="qbank-hub"
        open={walkthroughOpen}
        onOpenChange={setWalkthroughOpen}
        onAction={(tabId) => {
          if (tabId === "content" || tabId === "create" || tabId === "tracker") {
            onHomeTabChange(tabId);
          }
        }}
      />
    </div>
  );
}