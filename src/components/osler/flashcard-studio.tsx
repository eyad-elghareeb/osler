"use client";

import * as React from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Layers,
  RotateCcw,
  Check,
  X,
  Clock,
  BarChart3,
  Sparkles,
  Brain,
  Zap,
  BookOpen,
  ArrowLeft,
  ChevronRight,
  Lightbulb,
  Folder,
  Download,
  X as XIcon,
  GraduationCap,
} from "lucide-react";
import { loadAllContent, ENGINE_META } from "@/lib/osler/content";
import type {
  FlashcardContent,
  FlashcardSubdeck,
  ManifestItem,
  AnyContent,
} from "@/lib/osler/types";
import { flashcardReview, storage } from "@/lib/osler/storage";
import { useShortcutListener } from "@/hooks/use-shortcuts";
import { cn } from "@/lib/utils";

type ViewMode = "decks" | "subdecks" | "study" | "complete";

interface FlashcardStudioProps {
  activeItem?: ManifestItem | null;
  activeContent?: AnyContent | null;
  onExit: () => void;
  onOpenPack?: (item: ManifestItem) => void;
  onNavigateHome?: () => void;
}

const FLASHCARD_COLOR = "oklch(0.7 0.18 145)";

const SUBDECK_ICONS: Record<string, string> = {
  cardiology: "heart",
  neurology: "brain",
  pulmonology: "lungs",
  pharmacology: "pill",
  gastroenterology: "stomach",
};

export function FlashcardStudio({
  activeItem,
  activeContent,
  onExit,
  onOpenPack,
  onNavigateHome,
}: FlashcardStudioProps) {
  const [data, setData] = React.useState<{
    items: Array<{ item: ManifestItem; content: AnyContent | null }>;
  } | null>(null);
  const [mode, setMode] = React.useState<ViewMode>("decks");
  const [deckIndex, setDeckIndex] = React.useState(0);
  const [activeSubdeckId, setActiveSubdeckId] = React.useState<string | null>(null);
  const [cardIndex, setCardIndex] = React.useState(0);
  const [flipped, setFlipped] = React.useState(false);
  const [sessionCards, setSessionCards] = React.useState<string[]>([]);
  const [sessionResults, setSessionResults] = React.useState<
    { cardId: string; rating: "again" | "hard" | "good" | "easy" }[]
  >([]);
  const [stats, setStats] = React.useState({ new: 0, due: 0, total: 0 });

  React.useEffect(() => {
    loadAllContent().then(setData).catch(console.error);
  }, []);

  React.useEffect(() => {
    const update = () => {
      if (!data) return;
      let newC = 0;
      let dueC = 0;
      let totalC = 0;
      for (const { item, content } of data.items) {
        if (content?.type !== "flashcard") continue;
        const cards = (content as FlashcardContent).cards;
        totalC += cards.length;
        const cardIds = cards.map((c) => c.id);
        const dueIds = flashcardReview.getCardsDue(item.uid, cardIds);
        dueC += dueIds.length;
        newC += cardIds.length - dueIds.length;
      }
      setStats({ new: newC, due: dueC, total: totalC });
    };
    update();
    return flashcardReview.subscribe(update);
  }, [data]);

  const flashcardPacks = React.useMemo(() => {
    if (!data) return [];
    return data.items
      .map(({ item, content }) => ({ item, content }))
      .filter((x) => x.content?.type === "flashcard")
      .map(({ item, content }) => {
        const fc = content as FlashcardContent;
        const cardIds = fc.cards.map((c) => c.id);
        const dueIds = flashcardReview.getCardsDue(item.uid, cardIds);
        const progress = storage.packProgress(item.uid);
        return { item, deck: fc, dueIds, progress };
      });
  }, [data]);

  const currentDeck = flashcardPacks[deckIndex];
  const currentDeckCards = React.useMemo(() => {
    if (!currentDeck) return [];
    if (!activeSubdeckId) return currentDeck.deck.cards;
    return currentDeck.deck.cards.filter((c) => c.subdeckId === activeSubdeckId);
  }, [currentDeck, activeSubdeckId]);

  const currentCard = currentDeckCards[cardIndex];
  const isSessionCard = currentCard
    ? sessionCards.includes(currentCard.id)
    : false;

  const subdecks = currentDeck?.deck.subdecks ?? [];
  const hasSubdecks = subdecks.length > 0;

  function startDeck(deckIdx: number, subdeckId?: string | null) {
    setDeckIndex(deckIdx);
    setActiveSubdeckId(subdeckId ?? null);
    const deck = flashcardPacks[deckIdx];
    if (!deck) return;
    let cardsForSession = deck.deck.cards;
    if (subdeckId) {
      cardsForSession = deck.deck.cards.filter((c) => c.subdeckId === subdeckId);
    }
    const cardIds = cardsForSession.map((c) => c.id);
    const dueIds = flashcardReview.getCardsDue(deck.item.uid, cardIds);
    const cardsToStudy =
      dueIds.length > 0
        ? cardsForSession.filter((c) => dueIds.includes(c.id))
        : cardsForSession.slice(0, 10);
    setSessionCards(cardsToStudy.map((c) => c.id));
    setCardIndex(0);
    setFlipped(false);
    setSessionResults([]);
    setMode("study");
  }

  function flipCard() {
    setFlipped((f) => !f);
  }

  function rateCard(rating: "again" | "hard" | "good" | "easy") {
    if (!currentDeck || !currentCard) return;
    flashcardReview.recordReview(currentDeck.item.uid, currentCard.id, rating);
    setSessionResults((prev) => [
      ...prev,
      { cardId: currentCard.id, rating },
    ]);

    if (cardIndex < sessionCards.length - 1) {
      setCardIndex((i) => i + 1);
      setFlipped(false);
    } else {
      setMode("complete");
    }
  }

  useShortcutListener(
    React.useCallback(
      (actionId: string) => {
        if (mode !== "study") return;
        if (actionId === "flashcard.flip") flipCard();
        if (actionId === "flashcard.again") rateCard("again");
        if (actionId === "flashcard.hard") rateCard("hard");
        if (actionId === "flashcard.good") rateCard("good");
        if (actionId === "flashcard.easy") rateCard("easy");
      },
      [mode, cardIndex, flipped, currentCard, currentDeckCards, sessionCards],
    ),
    { enabled: mode === "study" },
  );

  function restartDeck() {
    if (!currentDeck) return;
    startDeck(deckIndex, activeSubdeckId);
  }

  function openSubdecks(deckIdx: number) {
    setDeckIndex(deckIdx);
    setMode("subdecks");
  }

  function backToDecks() {
    setMode("decks");
    setActiveSubdeckId(null);
    setCardIndex(0);
    setFlipped(false);
    setSessionCards([]);
    setSessionResults([]);
  }

  function closeStudy() {
    setMode("decks");
    setActiveSubdeckId(null);
    setCardIndex(0);
    setFlipped(false);
    setSessionCards([]);
    setSessionResults([]);
  }

  function exportToAnki() {
    if (!currentDeck) return;
    const deck = currentDeck.deck;
    const title = currentDeck.item.title;
    const subdeckMap = new Map(deck.subdecks?.map((s) => [s.id, s.title]) ?? []);
    const lines: string[] = [];

    const cardGroups = new Map<string, typeof deck.cards>();
    for (const card of deck.cards) {
      const sdId = card.subdeckId ?? "";
      if (!cardGroups.has(sdId)) cardGroups.set(sdId, []);
      cardGroups.get(sdId)!.push(card);
    }

    for (const [sdId, cards] of cardGroups) {
      const subdeckTitle = subdeckMap.get(sdId) ?? "";
      const tagPrefix = subdeckTitle
        ? `${title.replace(/\s+/g, "::")}::${subdeckTitle.replace(/\s+/g, "::")}`
        : title.replace(/\s+/g, "::");
      for (const card of cards) {
        const tags = [tagPrefix, ...(card.tags ?? [])]
          .map((t) => t.replace(/\s+/g, "-"))
          .join(" ");
        const front = card.front.replace(/\t/g, " ").replace(/\n/g, "<br>");
        const back = card.back.replace(/\t/g, " ").replace(/\n/g, "<br>");
        lines.push(`${front}\t${back}\t${tags}`);
      }
    }

    const blob = new Blob([lines.join("\n")], { type: "text/tab-separated-values" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${title.replace(/\s+/g, "-").toLowerCase()}-anki-import.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  const doneCount = sessionResults.length;
  const totalCount = sessionCards.length;
  const correctCount = sessionResults.filter(
    (r) => r.rating === "good" || r.rating === "easy",
  ).length;
  const accuracy = doneCount > 0 ? Math.round((correctCount / doneCount) * 100) : 0;

  /* ── Complete view ──────────────────────────────────────────────── */
  if (mode === "complete" && currentDeck) {
    return (
      <div className="h-full overflow-y-auto medos-scroll">
        <div className="max-w-lg mx-auto px-4 py-12 text-center">
          <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: "spring", stiffness: 200, damping: 20 }}
            className="size-20 rounded-full bg-emerald-500/15 border-2 border-emerald-500/30 flex items-center justify-center mx-auto mb-6"
          >
            <Brain className="size-9 text-emerald-500" />
          </motion.div>

          <h2 className="text-2xl font-bold mb-2">Session Complete!</h2>
          <p className="text-sm text-muted-foreground mb-8">
            You reviewed {doneCount} card{doneCount !== 1 ? "s" : ""} in{" "}
            {currentDeck.item.title}
            {activeSubdeckId && subdecks.find((s) => s.id === activeSubdeckId)
              ? ` :: ${subdecks.find((s) => s.id === activeSubdeckId)!.title}`
              : ""}
          </p>

          <div className="grid grid-cols-3 gap-3 mb-8">
            <div className="bg-card border border-border rounded-xl p-4">
              <div className="text-2xl font-bold text-foreground">{doneCount}</div>
              <div className="text-[11px] text-muted-foreground mt-1">Reviewed</div>
            </div>
            <div className="bg-card border border-border rounded-xl p-4">
              <div className="text-2xl font-bold text-emerald-500">{accuracy}%</div>
              <div className="text-[11px] text-muted-foreground mt-1">Accuracy</div>
            </div>
            <div className="bg-card border border-border rounded-xl p-4">
              <div className="text-2xl font-bold text-amber-500">
                {sessionResults.filter((r) => r.rating === "again").length}
              </div>
              <div className="text-[11px] text-muted-foreground mt-1">Again</div>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <button
              onClick={restartDeck}
              className="w-full h-11 rounded-xl bg-primary text-primary-foreground font-medium hover:bg-primary/90 transition-colors flex items-center justify-center gap-2"
            >
              <RotateCcw className="size-4" />
              Study Again
            </button>
            <button
              onClick={backToDecks}
              className="w-full h-11 rounded-xl border border-border text-foreground font-medium hover:bg-muted/60 transition-colors flex items-center justify-center gap-2"
            >
              <Layers className="size-4" />
              All Decks
            </button>
          </div>
        </div>
      </div>
    );
  }

  /* ── Study view (full-screen) ────────────────────────────────────── */
  if (mode === "study" && currentDeck && currentCard) {
    return (
      <div className="fixed inset-0 z-50 bg-background flex flex-col safe-screen">
        {/* Top bar */}
        <header className="h-12 flex items-center px-2 sm:px-4 gap-2 shrink-0 border-b border-border/60 bg-card safe-pt">
          <button
            onClick={closeStudy}
            className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors medos-touch-target"
            title="Exit study session"
          >
            <XIcon className="size-4" />
            <span className="hidden sm:inline">Exit</span>
          </button>

          <div className="h-5 w-px bg-border/60 hidden sm:block" />

          <div className="hidden sm:flex items-center gap-2 text-xs text-muted-foreground">
            <BookOpen className="size-3.5" />
            <span className="font-medium text-foreground">{currentDeck.item.title}</span>
            {activeSubdeckId && subdecks.find((s) => s.id === activeSubdeckId) && (
              <>
                <span className="opacity-50">·</span>
                <span>{subdecks.find((s) => s.id === activeSubdeckId)!.title}</span>
              </>
            )}
          </div>

          <div className="flex-1" />

          <div className="text-xs text-muted-foreground tabular-nums">
            {cardIndex + 1} / {totalCount}
          </div>
        </header>

        {/* Progress bar */}
        <div className="shrink-0 h-1 bg-muted/40">
          <div
            className="h-full bg-primary transition-all duration-300"
            style={{ width: `${(doneCount / totalCount) * 100}%` }}
          />
        </div>

        {/* Card area */}
        <div className="flex-1 flex items-center justify-center p-4 sm:p-8 bg-muted/20">
          <div
            onClick={flipCard}
            className="w-full max-w-2xl aspect-[16/10] cursor-pointer select-none"
          >
            <div className="relative w-full h-full">
              <AnimatePresence mode="wait">
                {!flipped ? (
                  <motion.div
                    key="front"
                    initial={{ opacity: 0, scale: 0.96 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.96 }}
                    transition={{ duration: 0.15 }}
                    className="absolute inset-0 bg-card border border-border rounded-xl p-6 sm:p-10 flex flex-col items-center justify-center text-center shadow-lg"
                  >
                    <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-4 flex items-center gap-1.5">
                      <Lightbulb className="size-3" />
                      Question
                    </div>
                    <div className="text-lg sm:text-xl leading-relaxed max-w-lg uworld-prose">
                      {currentCard.front}
                    </div>
                    <div className="mt-auto pt-6 text-xs text-muted-foreground/60">
                      Tap to reveal answer
                    </div>
                  </motion.div>
                ) : (
                  <motion.div
                    key="back"
                    initial={{ opacity: 0, scale: 0.96 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.96 }}
                    transition={{ duration: 0.15 }}
                    className="absolute inset-0 bg-[color-mix(in_oklch,var(--primary)_4%,var(--card))] border border-border rounded-xl p-6 sm:p-10 flex flex-col items-center justify-center text-center shadow-lg"
                  >
                    <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-4 flex items-center gap-1.5">
                      <Sparkles className="size-3" />
                      Answer
                    </div>
                    <div className="text-base sm:text-lg leading-relaxed max-w-lg uworld-prose">
                      {currentCard.back}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </div>

        {/* Rating buttons */}
        <AnimatePresence>
          {flipped && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 20 }}
              transition={{ duration: 0.2 }}
              className="shrink-0 border-t border-border bg-card px-4 py-4 sm:py-5"
            >
              <div className="max-w-lg mx-auto">
                <div className="text-[11px] uppercase tracking-wider text-muted-foreground text-center mb-3">
                  How well did you know this?
                </div>
                <div className="grid grid-cols-4 gap-2">
                  <RateButton
                    label="Again"
                    description="1 min"
                    rating="again"
                    color="red"
                    icon={X}
                    onRate={rateCard}
                  />
                  <RateButton
                    label="Hard"
                    description="6 min"
                    rating="hard"
                    color="orange"
                    icon={RotateCcw}
                    onRate={rateCard}
                  />
                  <RateButton
                    label="Good"
                    description="10 min"
                    rating="good"
                    color="emerald"
                    icon={Check}
                    onRate={rateCard}
                  />
                  <RateButton
                    label="Easy"
                    description="4 d"
                    rating="easy"
                    color="blue"
                    icon={Zap}
                    onRate={rateCard}
                  />
                </div>
                <div className="flex items-center justify-center gap-4 mt-3 text-[10px] text-muted-foreground/60">
                  <span>1 · Again</span>
                  <span>2 · Hard</span>
                  <span>3 · Good</span>
                  <span>4 · Easy</span>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  }

  /* ── Subdecks view ───────────────────────────────────────────────── */
  if (mode === "subdecks" && currentDeck) {
    const subdecksList = currentDeck.deck.subdecks ?? [];
    const totalCards = currentDeck.deck.cards.length;
    const totalDue = currentDeck.dueIds.length;

    function subdeckCardCount(subdeckId: string) {
      return currentDeck.deck.cards.filter((c) => c.subdeckId === subdeckId).length;
    }

    function subdeckDueCount(subdeckId: string) {
      const cardIds = currentDeck.deck.cards
        .filter((c) => c.subdeckId === subdeckId)
        .map((c) => c.id);
      return flashcardReview.getCardsDue(currentDeck.item.uid, cardIds).length;
    }

    return (
      <div className="h-full overflow-y-auto medos-scroll">
        <div className="max-w-5xl mx-auto px-4 md:px-8 py-8">
          {/* Header */}
          <div className="mb-6">
            <button
              onClick={backToDecks}
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors mb-3"
            >
              <ArrowLeft className="size-3.5" />
              All Decks
            </button>
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
              <Layers className="size-3.5" />
              <span>{ENGINE_META.flashcard.label}</span>
            </div>
            <h1 className="text-2xl md:text-3xl font-bold tracking-tight mb-1">
              {currentDeck.item.title}
            </h1>
            <p className="text-sm text-muted-foreground">
              {totalDue} cards due today &middot; {totalCards} total
            </p>
          </div>

          {/* Study All + Export buttons */}
          <div className="flex items-center gap-2 mb-6">
            <button
              onClick={() => startDeck(deckIndex, null)}
              className="h-10 px-4 rounded-xl bg-primary text-primary-foreground font-medium text-sm hover:bg-primary/90 transition-colors flex items-center gap-2"
            >
              <GraduationCap className="size-4" />
              Study All
            </button>
            <button
              onClick={exportToAnki}
              className="h-10 px-4 rounded-xl border border-border text-foreground font-medium text-sm hover:bg-muted/60 transition-colors flex items-center gap-2"
            >
              <Download className="size-4" />
              Export to Anki
            </button>
          </div>

          {/* Subdeck grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {subdecksList.map((subdeck) => {
              const count = subdeckCardCount(subdeck.id);
              const dueCount = subdeckDueCount(subdeck.id);
              return (
                <motion.button
                  key={subdeck.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.2 }}
                  onClick={() => startDeck(deckIndex, subdeck.id)}
                  className="text-left bg-card border border-border rounded-xl p-5 hover:border-primary/40 hover:shadow-md hover:bg-primary/[0.02] transition-all group"
                >
                  <div className="flex items-center gap-3 mb-3">
                    <div
                      className="size-11 rounded-xl flex items-center justify-center shrink-0"
                      style={{
                        backgroundColor: `${FLASHCARD_COLOR}/15`,
                        color: FLASHCARD_COLOR,
                      }}
                    >
                      <Folder className="size-5" />
                    </div>
                    <div className="min-w-0">
                      <h3 className="font-semibold truncate">{subdeck.title}</h3>
                      <p className="text-xs text-muted-foreground">
                        {count} card{count !== 1 ? "s" : ""}
                      </p>
                    </div>
                    <ChevronRight className="size-4 text-muted-foreground/40 group-hover:text-muted-foreground transition-colors ml-auto shrink-0" />
                  </div>
                  {subdeck.description && (
                    <p className="text-xs text-muted-foreground/70 line-clamp-2 mb-3">
                      {subdeck.description}
                    </p>
                  )}
                  {dueCount > 0 && (
                    <div className="flex items-center gap-1.5">
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-500 bg-emerald-500/10 px-2 py-0.5 rounded-full">
                        <Clock className="size-3" />
                        {dueCount} due
                      </span>
                    </div>
                  )}
                  {dueCount === 0 && count > 0 && (
                    <span className="text-xs text-muted-foreground/50">All reviewed</span>
                  )}
                </motion.button>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  /* ── Decks view (grid) ───────────────────────────────────────────── */
  return (
    <div className="h-full overflow-y-auto medos-scroll">
      <div className="max-w-5xl mx-auto px-4 md:px-8 py-8">
        {/* Header */}
        <div className="mb-6">
          <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
            <Layers className="size-3.5" />
            <span>{ENGINE_META.flashcard.label}</span>
          </div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight mb-1">
            Decks
          </h1>
          <p className="text-sm text-muted-foreground">
            {stats.due} cards due today &middot; {stats.total} total
          </p>
        </div>

        {/* Stat bar */}
        <div className="grid grid-cols-3 gap-3 mb-6">
          <div className="bg-card border border-border rounded-xl p-3.5">
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
              <Clock className="size-3.5" />
              Due
            </div>
            <div className="text-xl font-bold">{stats.due}</div>
          </div>
          <div className="bg-card border border-border rounded-xl p-3.5">
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
              <BarChart3 className="size-3.5" />
              New
            </div>
            <div className="text-xl font-bold">{stats.new}</div>
          </div>
          <div className="bg-card border border-border rounded-xl p-3.5">
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
              <Brain className="size-3.5" />
              Total
            </div>
            <div className="text-xl font-bold">{stats.total}</div>
          </div>
        </div>

        {/* Deck grid */}
        {flashcardPacks.length === 0 ? (
          <div className="text-center py-16">
            <div className="size-14 rounded-full bg-muted/40 flex items-center justify-center mx-auto mb-4">
              <Layers className="size-6 text-muted-foreground" />
            </div>
            <h3 className="text-base font-semibold mb-1">No decks found</h3>
            <p className="text-sm text-muted-foreground">
              Flashcard content packs will appear here.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {flashcardPacks.map((deck, idx) => {
              const totalCards = deck.deck.cards.length;
              const dueCount = deck.dueIds.length;
              const pct = totalCards > 0
                ? Math.round(((totalCards - dueCount) / totalCards) * 100)
                : 0;
              const subdecks = deck.deck.subdecks ?? [];
              return (
                <motion.button
                  key={deck.item.uid}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: idx * 0.04, duration: 0.2 }}
                  onClick={() => {
                    if (subdecks.length > 0) {
                      openSubdecks(idx);
                    } else {
                      startDeck(idx, null);
                    }
                  }}
                  className="text-left bg-card border border-border rounded-xl p-5 hover:border-primary/40 hover:shadow-md hover:bg-primary/[0.02] transition-all group"
                >
                  <div className="flex items-center gap-3 mb-3">
                    <div
                      className="size-11 rounded-xl flex items-center justify-center shrink-0"
                      style={{
                        backgroundColor: `${FLASHCARD_COLOR}/15`,
                        color: FLASHCARD_COLOR,
                      }}
                    >
                      {subdecks.length > 0 ? (
                        <Folder className="size-5" />
                      ) : (
                        <Layers className="size-5" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <h3 className="font-semibold truncate">{deck.item.title}</h3>
                      <p className="text-xs text-muted-foreground">
                        {subdecks.length > 0
                          ? `${subdecks.length} subdeck${subdecks.length !== 1 ? "s" : ""}`
                          : `${totalCards} cards`}
                      </p>
                    </div>
                    <ChevronRight className="size-4 text-muted-foreground/40 group-hover:text-muted-foreground transition-colors ml-auto shrink-0" />
                  </div>
                  <p className="text-xs text-muted-foreground/70 line-clamp-2 mb-3">
                    {deck.deck.meta.description}
                  </p>
                  <div className="flex items-center gap-3 text-xs">
                    <span className="text-emerald-500 font-medium tabular-nums">
                      {dueCount} due
                    </span>
                    <span className="text-muted-foreground">
                      {totalCards} total
                    </span>
                  </div>
                  <div className="mt-2 h-1.5 rounded-full bg-muted/40 overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-300"
                      style={{
                        width: `${pct}%`,
                        backgroundColor: FLASHCARD_COLOR,
                      }}
                    />
                  </div>
                </motion.button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function RateButton({
  label,
  description,
  rating,
  color,
  icon: Icon,
  onRate,
}: {
  label: string;
  description: string;
  rating: "again" | "hard" | "good" | "easy";
  color: "red" | "orange" | "emerald" | "blue";
  icon: React.ComponentType<{ className?: string }>;
  onRate: (r: "again" | "hard" | "good" | "easy") => void;
}) {
  const colorMap = {
    red: "border-red-500/40 hover:border-red-500 hover:bg-red-500/10 text-red-500",
    orange:
      "border-orange-500/40 hover:border-orange-500 hover:bg-orange-500/10 text-orange-500",
    emerald:
      "border-emerald-500/40 hover:border-emerald-500 hover:bg-emerald-500/10 text-emerald-500",
    blue: "border-blue-500/40 hover:border-blue-500 hover:bg-blue-500/10 text-blue-500",
  };

  return (
    <button
      onClick={() => onRate(rating)}
      className={cn(
        "flex flex-col items-center gap-1 px-2 py-3 rounded-xl border-2 transition-all",
        colorMap[color],
      )}
    >
      <Icon className="size-5" />
      <span className="text-sm font-semibold">{label}</span>
      <span className="text-[10px] opacity-70">{description}</span>
    </button>
  );
}
