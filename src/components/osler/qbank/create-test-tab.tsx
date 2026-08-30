"use client";

import * as React from "react";
import { ChevronRight, Minus, Flag, X, Clock, RotateCcw, Plus, ListChecks, Timer as TimerIcon, Sparkles, FileText, Folder, Layers, ArrowLeft, ArrowUpDown, Tag } from "lucide-react";
import { ENGINE_META } from "@/lib/osler/content";
import { buildQuestionPool, filterPoolByTags, filterPoolByProgress, pickQuestions, poolFamilyForEngine, sharedPoolFamily, canPoolTogether, type PoolQuestion, type OnlyMode, type OrderMode } from "@/lib/osler/qbank-pool";
import type { AnyContent, EngineType, ContentTreeNode } from "@/lib/osler/types";
import { sessions, type WrittenDraft } from "@/lib/osler/storage";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { haptic } from "@/lib/osler/native";
import { useI18n } from "@/components/osler/i18n-provider";
import { SectionHeading, HubSkeleton, OslerCard, SelectableCard, Pill } from "@/components/osler/ui-primitives";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { TestMode, PackEntry, ENGINE_ICONS, findNodeByUid, Lightbulb, SummaryRow, countQuestions } from "./shared";




































































export function CreateTestTab({
  data,
  onLoadPack,
  testMode,
  onTestModeChange,
  onOpenPack,
  onSetQuestionLimit,
  initialSourceUid,
  onConsumeInitialSource,
  onStartCustomSession,
}: {
  data: { items: PackEntry[]; trees: Record<string, ContentTreeNode[]> } | null;
  onLoadPack: (node: ContentTreeNode) => Promise<AnyContent | null>;
  testMode: TestMode;
  onTestModeChange: (m: TestMode) => void;
  onOpenPack?: (item: ContentTreeNode) => void;
  onSetQuestionLimit?: (n: number) => void;
  /** P2-2: uid of a pack picked in Content tab — pre-check it in the source picker. */
  initialSourceUid?: string | null;
  /** Called once the pre-selection has been consumed (so a remount doesn't re-apply it). */
  onConsumeInitialSource?: () => void;
  /** P2-4: start a custom multi-pack session from a built question pool. */
  onStartCustomSession?: (
    pool: PoolQuestion[],
    meta: {
      title: string;
      engine: EngineType;
      mode?: TestMode;
      timerMinutes?: number;
      tagsFilter?: string[];
      onlyMode?: OnlyMode;
      savedDrafts?: Record<string, WrittenDraft>;
      savedRubricState?: Record<string, boolean[]>;
    }
  ) => void;
}) {
  const { t, rtl } = useI18n();
  // Source picker state — list of selected pack uids (any folder, any engine
  // family — but quiz+bank only OR written only, never mixed).
  const [selectedSourceUids, setSelectedSourceUids] = React.useState<string[]>([]);
  // Tag filter operates on question-level tags (P2-3).
  const [selectedTags, setSelectedTags] = React.useState<string[]>([]);
  // Progress-mode filter (P4-2): "all" | "wrong" | "flagged".
  const [onlyMode, setOnlyMode] = React.useState<OnlyMode>("new");
  // Order: sequential | random.
  const [order, setOrder] = React.useState<OrderMode>("sequential");
  // Stepper value (P4-1).
  const [countInput, setCountInput] = React.useState("20");
  const [timerMinutes, setTimerMinutes] = React.useState("20");
  const timerEditedRef = React.useRef(false);
  // Tree search (mirrors the Content tab pattern).
  // Folder navigation for source picker (flashcard-style deck browser).
  const [selectedFolders, setSelectedFolders] = React.useState<ContentTreeNode[]>([]);
  // Ref for scrolling a pre-selected source into view.
  const preselectScrollRef = React.useRef<HTMLElement | null>(null);

  // uid → {node, content} map for O(1) lookup.
  const entryByUid = React.useMemo(() => {
    const map = new Map<string, PackEntry>();
    if (!data) return map;
    for (const entry of data.items) map.set(entry.node.uid, entry);
    return map;
  }, [data]);

  // The qbank tree — all packs share one folder, types are in the JSON.
  // All qbank engine types (quiz/bank/written) share the same tree, so
  // we only read one key to avoid duplicating content.
  const qbankTree = React.useMemo(() => {
    if (!data) return [] as ContentTreeNode[];
    return data.trees.quiz ?? data.trees.bank ?? data.trees.written ?? [];
  }, [data]);

  /**
   * Recursively filter the tree by a search substring AND by
   * enabled engine family (so we don't show flashcard/osce leaves QBank
   * doesn't own).
   */
  const filteredTree = React.useMemo(() => {
    if (!qbankTree.length) return [] as ContentTreeNode[];
    const qbankEngineTypes = new Set(["quiz", "bank", "written"]);
    function walk(list: ContentTreeNode[]): ContentTreeNode[] {
      const out: ContentTreeNode[] = [];
      for (const node of list) {
        if (!qbankEngineTypes.has(node.type)) continue;
        if (node.items.length === 0) {
          out.push(node);
        } else {
          const children = walk(node.items);
          if (children.length > 0) {
            out.push({ ...node, items: children });
          }
        }
      }
      return out;
    }
    return walk(qbankTree);
  }, [qbankTree]);

  // P2-2: when `initialSourceUid` changes, pre-check that source and scroll
  // it into view. Consume the prop so a remount doesn't re-trigger.
  //
  // `qbankTree` comes from an async fetch (HomeView's `data` state) and is
  // empty on first mount — which is exactly when this fires, since "More
  // options" on the launch dialog is usually clicked before that fetch
  // resolves. We must NOT consume `initialSourceUid` (or mark it selected)
  // until the node is actually found: consuming it early means the source
  // never gets checked/loaded, and once the tree finishes loading there's
  // no `initialSourceUid` left to retry with — the pre-selection is
  // silently dropped. Instead, bail out and let the effect re-run (via the
  // `qbankTree` dependency) once the tree has loaded far enough to contain
  // this node.
  React.useEffect(() => {
    if (!initialSourceUid) return;
    const node = findNodeByUid(qbankTree, initialSourceUid);
    if (!node) return; // tree not loaded yet — retry on the next qbankTree update
    setSelectedSourceUids((prev) =>
      prev.includes(initialSourceUid) ? prev : [...prev, initialSourceUid],
    );
    void onLoadPack(node);
    // Defer the scroll until after the DOM updates.
    requestAnimationFrame(() => {
      preselectScrollRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    });
    onConsumeInitialSource?.();
  }, [initialSourceUid, onConsumeInitialSource, onLoadPack, qbankTree]);

  // Selected pack entries (resolved from uids).
  const selectedEntries = React.useMemo(
    () =>
      selectedSourceUids
        .map((uid) => entryByUid.get(uid))
        .filter((e): e is PackEntry => !!e && !!e.content),
    [selectedSourceUids, entryByUid],
  );

  // Engine types currently selected — used to enforce the quiz+bank-only merge rule.
  const selectedEngineTypes = React.useMemo(
    () => Array.from(new Set(selectedEntries.map((e) => e.node.type as EngineType))),
    [selectedEntries],
  );

  // The shared pool family — "mcq" (quiz/bank only), "written" (written only),
  // or null (no selection yet, or a mixed mcq+written session).
  const sharedFamily = React.useMemo(
    () => sharedPoolFamily(selectedEngineTypes),
    [selectedEngineTypes],
  );

  // Whether the current selection contains both mcq and written packs.
  const isMixedSession = React.useMemo(() => {
    if (selectedEngineTypes.length === 0) return false;
    const families = new Set(selectedEngineTypes.map(poolFamilyForEngine).filter(Boolean));
    return families.has("mcq") && families.has("written");
  }, [selectedEngineTypes]);

  // Build the merged question pool from selected sources (question-level stamped).
  const mergedPool = React.useMemo(
    () => buildQuestionPool(selectedEntries),
    [selectedEntries],
  );

  // Available question-level tags across the selected sources only (P2-3).
  // Recomputed when selection changes.
  const availableTags = React.useMemo(() => {
    const set = new Set<string>();
    for (const q of mergedPool) {
      if (q.tags) for (const tag of q.tags) set.add(tag);
    }
    return Array.from(set).sort();
  }, [mergedPool]);

  // Prune selectedTags if they're no longer in the available set (e.g. user
  // removed the only source that had a given tag).
  React.useEffect(() => {
    if (selectedTags.length === 0) return;
    const available = new Set(availableTags);
    const next = selectedTags.filter((t) => available.has(t));
    if (next.length !== selectedTags.length) setSelectedTags(next);
  }, [availableTags, selectedTags]);

  // Final pool after tag + progress filters are applied.
  const filteredPool = React.useMemo(() => {
    let pool = filterPoolByTags(mergedPool, selectedTags);
    pool = filterPoolByProgress(pool, onlyMode);
    return pool;
  }, [mergedPool, selectedTags, onlyMode]);

  const totalAvailable = filteredPool.length;
  const desiredCount = Math.max(1, Math.min(parseInt(countInput) || 1, Math.max(1, totalAvailable)));
  React.useEffect(() => {
    if (!timerEditedRef.current) setTimerMinutes(String(desiredCount));
  }, [desiredCount]);
  // Clamp the stepper value if it overshoots the new pool size.
  React.useEffect(() => {
    const parsed = parseInt(countInput) || 0;
    if (parsed > totalAvailable && totalAvailable > 0) {
      setCountInput(String(totalAvailable));
    }
  }, [totalAvailable, countInput]);

  // Toggle a leaf source on/off, allowing mcq+written mixing.
  const toggleSource = React.useCallback(
    async (uid: string) => {
      const entry = entryByUid.get(uid);
      if (!entry) return;
      if (!entry.content && !await onLoadPack(entry.node)) return;
      const engine = entry.node.type as EngineType;
      const newFamily = poolFamilyForEngine(engine);
      if (!newFamily) return;

      setSelectedSourceUids((prev) => {
        if (prev.includes(uid)) {
          return prev.filter((x) => x !== uid);
        }
        // Adding — check compatibility with the existing selection.
        if (prev.length > 0) {
          const existingEngines = prev
            .map((u) => entryByUid.get(u)?.node.type as EngineType)
            .filter(Boolean);
          const candidateEngines = [...existingEngines, engine];
          if (!canPoolTogether(candidateEngines)) {
            return prev;
          }
        }
        return [...prev, uid];
      });
    },
    [entryByUid, onLoadPack],
  );

  // Build & start a custom session.
  const handleCreateTest = () => {
    if (!onStartCustomSession) {
      // Fallback for legacy single-pack path (no callback wired up).
      onSetQuestionLimit?.(desiredCount);
      const first = selectedEntries[0];
      if (first) onOpenPack?.(first.node);
      return;
    }
    if (mergedPool.length === 0) return;
    const finalPool = pickQuestions(filteredPool, desiredCount, order);
    if (finalPool.length === 0) return;
    // The session's engine — for mixed sessions, use the first question's
    // type. Per-question rendering is driven by qIsMCQ (correct >= 0).
    const engine = isMixedSession
      ? (finalPool[0].correct >= 0 ? "quiz" : "written")
      : sharedFamily === "written" ? "written" : (selectedEntries[0]?.node.type as EngineType) ?? "quiz";
    const title =
      selectedEntries.length === 1
        ? selectedEntries[0].node.title
        : `${selectedEntries.length} ${t("qbank.create.sources")}`;
    onStartCustomSession(finalPool, {
      title,
      engine,
      mode: testMode,
      timerMinutes: testMode === "timed"
        ? Math.max(1, Math.min(720, parseInt(timerMinutes, 10) || desiredCount))
        : undefined,
      tagsFilter: selectedTags,
      onlyMode,
    });
  };

  if (!data) {
    return (
      <HubSkeleton statCount={0} cardCount={4} />
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* Builder column */}
      <div className="lg:col-span-2 space-y-5">
        {/* Test Mode */}
        <OslerCard>
          <SectionHeading
            number={1}
            icon={TimerIcon}
            description={t("qbank.home.timed") + " / " + t("qbank.home.tutor")}
          >
            {t("qbank.home.testMode")}
          </SectionHeading>
          <div className="grid grid-cols-2 gap-2 mt-3">
            <SelectableCard
              active={testMode === "timed"}
              onClick={() => { haptic("selection"); onTestModeChange("timed"); }}
              icon={TimerIcon}
              label={t("qbank.home.timed")}
              description={t("qbank.home.timedDesc")}
            />
            <SelectableCard
              active={testMode === "tutor"}
              onClick={() => { haptic("selection"); onTestModeChange("tutor"); }}
              icon={Sparkles}
              label={t("qbank.home.tutor")}
              description={t("qbank.home.tutorDesc")}
            />
          </div>
        </OslerCard>

        {/* Source packs — flashcard-style deck browser with folder hierarchy */}
        <OslerCard>
          <SectionHeading
            number={2}
            icon={Folder}
            description={t("qbank.create.sourceHint")}
          >
            {t("qbank.create.sources")}
          </SectionHeading>
          <div className="mt-4 space-y-3">
            {/* Folder hierarchy browser — local search removed; the unified
                global search bar handles content discovery. */}
            <div className="rounded-xl border border-border bg-card max-h-80 overflow-y-auto osler-scroll">
              {selectedFolders.length > 0 ? (
                /* Subfolder view — children of the selected folder */
                <div className="p-3">
                  <button
                    onClick={() => setSelectedFolders((folders) => folders.slice(0, -1))}
                    className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors mb-3"
                  >
                    <ArrowLeft className={cn("size-3.5", rtl && "rtl-flip-x")} />
                    {t("qbank.home.allPacks")}
                  </button>
                  <div className="grid grid-cols-1 gap-2">
                    {selectedFolders.at(-1)?.items
                      .filter((child) => {
                        const qbankTypes = new Set(["quiz", "bank", "written"]);
                        return qbankTypes.has(child.type);
                      })
                      .map((child) => {
                        const isLeaf = child.items.length === 0;
                        const childType = child.type as EngineType;
                        const childMeta = ENGINE_META[childType];
                        const ChildIcon = ENGINE_ICONS[childType] ?? ListChecks;
                        if (isLeaf) {
                          const entry = entryByUid.get(child.uid);
                          const isChecked = selectedSourceUids.includes(child.uid);
                          const qCount = entry?.content ? countQuestions(entry.content) : child.questionCount ?? 0;
                          return (
                            <button
                              key={child.uid}
                              onClick={() => toggleSource(child.uid)}
                              className={cn(
                                "flex items-center gap-3 p-3 rounded-xl border transition-colors text-start",
                                isChecked ? "border-primary bg-primary/5" : "border-border hover:border-primary/30",
                              )}
                              ref={child.uid === initialSourceUid ? preselectScrollRef as React.Ref<HTMLButtonElement> : undefined}
                            >
                              <div
                                className="size-9 rounded-lg flex items-center justify-center shrink-0"
                                style={{ backgroundColor: `color-mix(in oklch, ${childMeta.color} 12%, transparent)`, color: childMeta.color }}
                              >
                                <ChildIcon className="size-4" />
                              </div>
                              <div className="min-w-0 flex-1">
                                <h4 className="text-sm font-medium truncate">{child.title}</h4>
                                <p className="text-[11px] text-muted-foreground">{qCount} {t("qbank.home.questions", { n: qCount }).split(" ").slice(1).join(" ")}</p>
                              </div>
                              <Checkbox
                                checked={isChecked}
                                onCheckedChange={() => toggleSource(child.uid)}
                                onClick={(e) => e.stopPropagation()}
                                className="size-4 shrink-0"
                              />
                            </button>
                          );
                        }
                        return (
                          <button
                            key={child.uid}
                            onClick={() => setSelectedFolders((folders) => [...folders, child])}
                            className="flex items-center gap-3 p-3 rounded-xl border border-border"
                          >
                            <div
                              className="size-9 rounded-lg flex items-center justify-center shrink-0"
                              style={{ backgroundColor: `color-mix(in oklch, ${childMeta.color} 12%, transparent)`, color: childMeta.color }}
                            >
                              <Folder className="size-4" />
                            </div>
                            <div className="min-w-0 flex-1">
                              <h4 className="text-sm font-medium truncate">{child.title}</h4>
                              <p className="text-[11px] text-muted-foreground">{child.items.length} {t("qbank.home.packs", { n: child.items.length }).split(" ").slice(1).join(" ")}</p>
                            </div>
                          </button>
                        );
                      })}
                  </div>
                </div>
              ) : (
                /* Root view — top-level folders and packs */
                <div className="p-3 grid grid-cols-1 gap-2">
                  {filteredTree.length === 0 ? (
                    <p className="text-xs text-muted-foreground text-center py-6">
                      {t("qbank.home.noItems")}
                    </p>
                  ) : (
                    filteredTree.map((node, idx) => {
                      const isBranch = node.items.length > 0;
                      const nodeType = node.type as EngineType;
                      const meta = ENGINE_META[nodeType];
                      const NodeIcon = ENGINE_ICONS[nodeType] ?? ListChecks;

                      if (isBranch) {
                        const childCount = node.items.length;
                        return (
                          <button
                            key={node.uid}
                            onClick={() => setSelectedFolders([node])}
                            className="flex items-center gap-3 p-3 rounded-xl border border-border hover:border-primary/30 hover:bg-primary/[0.02] transition-colors text-start group"
                          >
                            <div
                              className="size-9 rounded-lg flex items-center justify-center shrink-0"
                              style={{ backgroundColor: `color-mix(in oklch, ${meta.color} 12%, transparent)`, color: meta.color }}
                            >
                              <Folder className="size-4" />
                            </div>
                            <div className="min-w-0 flex-1">
                              <h4 className="text-sm font-medium truncate">{node.title}</h4>
                              <p className="text-[11px] text-muted-foreground">
                                {childCount} {t("qbank.home.packs", { n: childCount }).split(" ").slice(1).join(" ")}
                              </p>
                            </div>
                            <ChevronRight className="size-4 text-muted-foreground/40 group-hover:text-muted-foreground transition-colors shrink-0" />
                          </button>
                        );
                      }

                      // Leaf — pack with checkbox
                      const entry = entryByUid.get(node.uid);
                      const isChecked = selectedSourceUids.includes(node.uid);
                      const qCount = entry?.content ? countQuestions(entry.content) : node.questionCount ?? 0;
                      return (
                        <button
                          key={node.uid}
                          onClick={() => toggleSource(node.uid)}
                          className={cn(
                            "flex items-center gap-3 p-3 rounded-xl border transition-colors text-start",
                            isChecked ? "border-primary bg-primary/5" : "border-border hover:border-primary/30",
                          )}
                          ref={node.uid === initialSourceUid ? preselectScrollRef as React.Ref<HTMLButtonElement> : undefined}
                        >
                          <div
                            className="size-9 rounded-lg flex items-center justify-center shrink-0"
                            style={{ backgroundColor: `color-mix(in oklch, ${meta.color} 12%, transparent)`, color: meta.color }}
                          >
                            <NodeIcon className="size-4" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <h4 className="text-sm font-medium truncate">{node.title}</h4>
                            <p className="text-[11px] text-muted-foreground">{qCount} {t("qbank.home.questions", { n: qCount }).split(" ").slice(1).join(" ")}</p>
                          </div>
                          <Checkbox
                            checked={isChecked}
                            onCheckedChange={() => toggleSource(node.uid)}
                            onClick={(e) => e.stopPropagation()}
                            className="size-4 shrink-0"
                          />
                        </button>
                      );
                    })
                  )}
                </div>
              )}
            </div>

            {selectedEntries.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {selectedEntries.map(({ node }) => (
                  <span
                    key={node.uid}
                    className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full bg-primary/10 text-primary text-xs font-medium"
                  >
                    {node.title}
                    <button
                      onClick={() => toggleSource(node.uid)}
                      className="hover:bg-primary/20 rounded-full size-4 flex items-center justify-center"
                      aria-label={t("common.remove")}
                    >
                      <X className="size-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>
        </OslerCard>

        {/* Tag filter (P2-3) — question-level tags from selected sources */}
        {availableTags.length > 0 && (
          <OslerCard>
            <SectionHeading number={3} icon={Tag} description={t("qbank.home.tagsTopics")}>
              {t("qbank.create.tagQuestionLevel")}
            </SectionHeading>
            <div className="mt-4 flex flex-wrap gap-2">
              {availableTags.map((tag) => (
                <Pill
                  key={tag}
                  active={selectedTags.includes(tag)}
                  onClick={() =>
                    setSelectedTags((prev) =>
                      prev.includes(tag) ? prev.filter((x) => x !== tag) : [...prev, tag],
                    )
                  }
                >
                  {tag}
                </Pill>
              ))}
            </div>
          </OslerCard>
        )}

        {/* Progress-mode filter (P4-2) */}
        <OslerCard>
          <SectionHeading number={4} icon={Flag} description={t("qbank.tracker.wrongAndFlagged")}>
            {t("qbank.create.onlyMode")}
          </SectionHeading>
          <div className="mt-4 flex flex-wrap gap-2">
            {([
              { id: "all" as const, label: t("qbank.create.onlyAll"), icon: Layers },
              { id: "new" as const, label: t("qbank.create.onlyNew"), icon: Sparkles },
              { id: "wrong" as const, label: t("qbank.create.onlyWrong"), icon: RotateCcw },
              { id: "flagged" as const, label: t("qbank.create.onlyFlagged"), icon: Flag },
            ]).map((opt) => (
              <Pill
                key={opt.id}
                active={onlyMode === opt.id}
                icon={opt.icon}
                onClick={() => { haptic("selection"); setOnlyMode(opt.id); }}
              >
                {opt.label}
              </Pill>
            ))}
          </div>
        </OslerCard>

        {/* Count + order (P4-1) */}
        <OslerCard>
          <SectionHeading number={5} icon={ArrowUpDown} description={t("qbank.home.questionOrder")}>
            {t("qbank.create.countStepper")}
          </SectionHeading>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            {/* Stepper */}
            <div className="flex items-center gap-1">
              <button
                onClick={() => {
                  haptic("light");
                  const nextCount = Math.max(1, desiredCount - 5);
                  setCountInput(String(nextCount));
                  if (!timerEditedRef.current) setTimerMinutes(String(nextCount));
                }}
                disabled={desiredCount <= 1}
                className="size-9 rounded-lg border border-border bg-card hover:bg-muted/60 flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                aria-label={t("qbank.home.decrementCount")}
              >
                <Minus className="size-3.5" />
              </button>
              <input
                type="number"
                min={1}
                max={totalAvailable > 0 ? totalAvailable : 1}
                value={countInput}
                onChange={(e) => {
                  const v = parseInt(e.target.value);
                  if (isNaN(v)) setCountInput("");
                  else {
                    const nextCount = Math.max(1, Math.min(v, totalAvailable || 1));
                    setCountInput(String(nextCount));
                    if (!timerEditedRef.current) setTimerMinutes(String(nextCount));
                  }
                }}
                className="w-20 h-9 rounded-lg border border-border bg-card text-sm text-center font-medium tabular-nums focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              />
              <button
                onClick={() => {
                  haptic("light");
                  const nextCount = Math.min(totalAvailable || 1, desiredCount + 5);
                  setCountInput(String(nextCount));
                  if (!timerEditedRef.current) setTimerMinutes(String(nextCount));
                }}
                disabled={desiredCount >= totalAvailable || totalAvailable === 0}
                className="size-9 rounded-lg border border-border bg-card hover:bg-muted/60 flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                aria-label={t("qbank.home.incrementCount")}
              >
                <Plus className="size-3.5" />
              </button>
            </div>
            <span className="text-xs text-muted-foreground">
              {t("qbank.create.availableAfterFilter", { n: totalAvailable })}
            </span>

            {/* Order toggle */}
            <div className="ms-auto flex items-center gap-2">
              <span className="text-xs text-muted-foreground">{t("qbank.home.questionOrder")}:</span>
              <div className="flex rounded-lg border border-border bg-card overflow-hidden">
                <button
                  onClick={() => { haptic("selection"); setOrder("sequential"); }}
                  className={cn(
                    "px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none",
                    order === "sequential" ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {t("qbank.home.defaultOrder")}
                </button>
                <button
                  onClick={() => { haptic("selection"); setOrder("random"); }}
                  className={cn(
                    "px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none",
                    order === "random" ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {t("qbank.home.randomized")}
                </button>
              </div>
            </div>

            {testMode === "timed" && (
              <div className="flex basis-full items-center gap-2 border-t border-border pt-3">
                <Clock className="size-3.5 shrink-0 text-primary" />
                <label htmlFor="create-timer-minutes" className="text-xs font-medium text-foreground">
                  {t("qbank.launch.timerMinutes")}
                </label>
                <input
                  id="create-timer-minutes"
                  type="number"
                  min={1}
                  max={720}
                  value={timerMinutes}
                  onChange={(event) => {
                    timerEditedRef.current = true;
                    setTimerMinutes(String(Math.max(1, Math.min(720, parseInt(event.target.value, 10) || 1))));
                  }}
                  className="ms-auto h-8 w-16 rounded-lg border border-border bg-card text-center text-sm font-semibold tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                />
                <span className="text-xs text-muted-foreground">{t("qbank.launch.minutes")}</span>
              </div>
            )}
          </div>
        </OslerCard>
      </div>

      {/* Right rail — Test Summary */}
      <div className="lg:col-span-1">
        <div className="lg:sticky lg:top-6 space-y-4">
          <OslerCard>
            <h3 className="text-base font-semibold text-foreground flex items-center gap-2">
              <FileText className="size-4 text-primary" />
              {t("qbank.home.testSummary")}
            </h3>
            <div className="mt-4 space-y-2.5 text-sm">
              <SummaryRow label={t("qbank.home.testMode")} value={testMode === "timed" ? t("qbank.home.timed") : t("qbank.home.tutor")} />
              <SummaryRow
                label={t("qbank.home.questionsLabel")}
                value={totalAvailable > 0 ? String(desiredCount) : "—"}
              />
              {testMode === "timed" && (
                <SummaryRow
                  label={t("qbank.launch.timerMinutes")}
                  value={`${Math.max(1, Math.min(720, parseInt(timerMinutes, 10) || desiredCount))} ${t("qbank.launch.minutes")}`}
                />
              )}
              <SummaryRow
                label={t("qbank.home.packs")}
                value={String(selectedEntries.length)}
              />
              <SummaryRow
                label={t("qbank.home.totalAvailable")}
                value={String(totalAvailable)}
              />
              <SummaryRow
                label={t("qbank.home.tags")}
                value={selectedTags.length > 0 ? selectedTags.length + t("qbank.home.selected") : t("qbank.home.all")}
              />
              <SummaryRow
                label={t("qbank.create.onlyMode")}
                value={onlyMode === "all" ? t("qbank.create.onlyAll") : onlyMode === "new" ? t("qbank.create.onlyNew") : onlyMode === "wrong" ? t("qbank.create.onlyWrong") : t("qbank.create.onlyFlagged")}
              />
            </div>

            <div className="mt-5 pt-4 border-t border-border">
              <Button
                onClick={handleCreateTest}
                disabled={selectedEntries.length === 0 || totalAvailable === 0}
                className="w-full h-11 text-sm font-semibold rounded-xl"
              >
                <Plus className="size-4 me-2" />
                {t("qbank.create.startCustom")}
              </Button>
              <p className="text-[11px] text-muted-foreground text-center mt-2">
                {selectedEntries.length > 0
                  ? t("qbank.create.availableAfterFilter", { n: totalAvailable })
                  : t("qbank.home.noItems")}
              </p>
            </div>
          </OslerCard>

          {/* Selected packs preview */}
          {selectedEntries.length > 0 && (
            <OslerCard>
              <h3 className="text-sm font-semibold text-foreground flex items-center gap-2 mb-3">
                <ListChecks className="size-4 text-primary" />
                {t("qbank.create.matchingPacks")}
              </h3>
              <div className="space-y-2 max-h-64 overflow-y-auto osler-scroll">
                {selectedEntries.slice(0, 20).map(({ node, content }) => (
                  <div
                    key={node.uid}
                    className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-muted/30"
                  >
                    <div className="size-6 rounded flex items-center justify-center bg-primary/15 text-primary shrink-0">
                      <ListChecks className="size-3" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <span className="text-xs font-medium truncate block">{node.title}</span>
                      <span className="text-[11px] text-muted-foreground">
                        {ENGINE_META[node.type as EngineType].label}
                        {content && ` · ${countQuestions(content)} questions`}
                      </span>
                    </div>
                  </div>
                ))}
                {selectedEntries.length > 20 && (
                  <p className="text-xs text-muted-foreground text-center pt-1">
                    +{selectedEntries.length - 20} more
                  </p>
                )}
              </div>
            </OslerCard>
          )}

          <OslerCard>
            <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
              <Lightbulb className="size-4 text-warning" />
              {t("qbank.home.tip")}
            </h3>
            <p className="text-xs text-muted-foreground mt-2 leading-relaxed">
              {t("qbank.home.tipTutor")} {t("qbank.home.tipTimed")}
            </p>
          </OslerCard>
        </div>
      </div>
    </div>
  );
}
export function CheckboxColumn({
  title,
  items,
  selected,
  onChange,
  onClear,
}: {
  title: string;
  items: { id: string; label: string; count: number }[];
  selected: string[];
  onChange: (ids: string[]) => void;
  onClear: () => void;
}) {
  const { t } = useI18n();
  const allSelected = items.length > 0 && selected.length === items.length;
  const someSelected = selected.length > 0 && !allSelected;

  const toggleAll = () => {
    if (allSelected) onClear();
    else onChange(items.map((i) => i.id));
  };

  const toggleOne = (id: string) => {
    if (selected.includes(id)) onChange(selected.filter((x) => x !== id));
    else onChange([...selected, id]);
  };

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden flex flex-col">
      <div className="px-3 py-2.5 bg-muted/40 border-b border-border flex items-center gap-2">
        <Checkbox
          checked={allSelected ? true : someSelected ? "indeterminate" : false}
          onCheckedChange={toggleAll}
          className="size-4"
          title={t("qbank.home.selectAll")}
        />
        <span className="text-xs font-semibold uppercase tracking-wider text-foreground flex-1">{title}</span>
        <span className="text-[11px] text-muted-foreground tabular-nums">
          {selected.length}/{items.length}
        </span>
      </div>
      <div className="max-h-48 overflow-y-auto osler-scroll p-1.5">
        {items.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-4">{t("qbank.home.noItems")}</p>
        ) : (
          items.map((item) => {
            const isSel = selected.includes(item.id);
            return (
              <label
                key={item.id}
                className={`flex items-center gap-2 px-2 py-1.5 rounded-lg cursor-pointer transition-colors ${
                  isSel ? "bg-primary/8" : "hover:bg-muted/60"
                }`}
              >
                <Checkbox
                  checked={isSel}
                  onCheckedChange={() => toggleOne(item.id)}
                  className="size-4"
                />
                <span className={`text-sm flex-1 truncate ${isSel ? "text-foreground font-medium" : "text-foreground"}`}>
                  {item.label}
                </span>
                <span className="text-[11px] text-muted-foreground tabular-nums shrink-0">({item.count})</span>
              </label>
            );
          })
        )}
      </div>
    </div>
  );
}