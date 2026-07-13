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
  ChevronLeft,
  Lightbulb,
  Folder,
  Download,
  X as XIcon,
  GraduationCap,
} from "lucide-react";
import { ENGINE_META } from "@/lib/osler/content";
import type { FlashcardContent, FlashcardSubdeck, ContentTreeNode, AnyContent } from "@/lib/osler/types";
import { flashcardReview, storage } from "@/lib/osler/storage";
import { useContentTree } from "@/hooks/use-content-tree";
import { useShortcutBindings } from "@/hooks/use-shortcuts";
import { SwipeGallery } from "./swipe-gallery";

import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";
import { haptic } from "@/lib/osler/native";
import { setImmersiveMode } from "./immersive-mode";
import { useI18n } from "./i18n-provider";
import { ContentCacheButton } from "./content-cache-button";
import { ContentLangFilter } from "./qbank-studio";

type ViewMode = "decks" | "subdecks" | "study" | "complete";

interface FlashcardStudioProps {
  activeItem?: ContentTreeNode | null;
  activeContent?: AnyContent | null;
  onExit: () => void;
  onOpenPack?: (item: ContentTreeNode) => void;
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
  const { t, rtl } = useI18n();
  const {
    trees,
    leafContent,
    collectLeafUids,
    mergeCards,
    nodeCardCount,
    nodeDueCount,
  } = useContentTree({ types: ["flashcard"] });

  const tree = trees.flashcard ?? [];

  const [mode, setMode] = React.useState<ViewMode>("decks");

  // Hide the global mobile tab bar while actively studying flashcards
  React.useEffect(() => {
    setImmersiveMode(mode === "study" || mode === "complete");
    return () => setImmersiveMode(false);
  }, [mode]);

  const [deckIndex, setDeckIndex] = React.useState(0);
  const [activeSubdeckId, setActiveSubdeckId] = React.useState<string | null>(null);
  const [cardIndex, setCardIndex] = React.useState(0);
  const [flipped, setFlipped] = React.useState(false);
  const [isFlipping, setIsFlipping] = React.useState(false);
  const [navDir, setNavDir] = React.useState<"next" | "prev">("next");
  const [sessionCards, setSessionCards] = React.useState<string[]>([]);
  const [sessionResults, setSessionResults] = React.useState<
    { cardId: string; rating: "again" | "hard" | "good" | "easy" }[]
  >([]);
  const [stats, setStats] = React.useState({ new: 0, due: 0, total: 0 });

  // Compute stats from leafContent
  React.useEffect(() => {
    const compute = () => {
      let newC = 0, dueC = 0, totalC = 0;
      for (const [uid, content] of leafContent) {
        if (content.type !== "flashcard") continue;
        const fc = content as FlashcardContent;
        const cards = fc.cards;
        totalC += cards.length;
        const cardIds = cards.map((c) => c.id);
        const dueIds = flashcardReview.getCardsDue(uid, cardIds);
        dueC += dueIds.length;
      }
      newC = totalC - dueC;
      setStats({ new: newC, due: dueC, total: totalC });
    };
    compute();
    return flashcardReview.subscribe(compute);
  }, [leafContent]);

  const currentDeck = tree[deckIndex];
  const currentSubdecks = React.useMemo(() => {
    if (!currentDeck) return [];
    return currentDeck.items ?? [];
  }, [currentDeck]);

  const currentDeckCards = React.useMemo(() => {
    if (!currentDeck) return [];
    if (activeSubdeckId) {
      const subdeck = currentDeck.items.find((c) => c.uid === activeSubdeckId);
      if (subdeck) return mergeCards(collectLeafUids(subdeck));
    }
    return mergeCards(collectLeafUids(currentDeck));
  }, [currentDeck, activeSubdeckId, leafContent]);

  const currentCard = currentDeckCards[cardIndex];
  const isSessionCard = currentCard
    ? sessionCards.includes(currentCard.id)
    : false;

  function startSession(cards: FlashcardContent["cards"], uid: string) {
    const cardIds = cards.map((c) => c.id);
    const dueIds = flashcardReview.getCardsDue(uid, cardIds);
    const cardsToStudy =
      dueIds.length > 0
        ? cards.filter((c) => dueIds.includes(c.id))
        : cards.slice(0, 10);
    setSessionCards(cardsToStudy.map((c) => c.id));
    setCardIndex(0);
    setFlipped(false);
    setIsFlipping(false);
    setSessionResults([]);
    setMode("study");
  }

  function startDeck(deckIdx: number) {
    setDeckIndex(deckIdx);
    setActiveSubdeckId(null);
    const node = tree[deckIdx];
    if (!node) return;
    const cards = mergeCards(collectLeafUids(node));
    if (cards.length === 0) return;
    startSession(cards, node.uid);
  }

  function startSubdeck(deckIdx: number, subdeckUid: string) {
    setDeckIndex(deckIdx);
    setActiveSubdeckId(subdeckUid);
    const node = tree[deckIdx];
    if (!node) return;
    const child = node.items.find((c) => c.uid === subdeckUid);
    if (!child) return;
    const cards = mergeCards(collectLeafUids(child));
    if (cards.length === 0) return;
    startSession(cards, child.uid);
  }

  function flipCard() {
    if (isFlipping) return;
    setIsFlipping(true);
    setFlipped((f) => !f);
    setTimeout(() => setIsFlipping(false), 350);
  }

  function rateCard(rating: "again" | "hard" | "good" | "easy") {
    if (!currentDeck || !currentCard) return;
    flashcardReview.recordReview(currentDeck.uid, currentCard.id, rating);
    setSessionResults((prev) => [
      ...prev,
      { cardId: currentCard.id, rating },
    ]);

    if (cardIndex < sessionCards.length - 1) {
      setCardIndex((i) => i + 1);
      setFlipped(false);
      setIsFlipping(false);
    } else {
      setMode("complete");
    }
  }

  function nextCard() {
    if (cardIndex < sessionCards.length - 1) {
      setNavDir("next");
      setCardIndex((i) => i + 1);
      setFlipped(false);
      setIsFlipping(false);
    }
  }

  function prevCard() {
    if (cardIndex > 0) {
      setNavDir("prev");
      setCardIndex((i) => i - 1);
      setFlipped(false);
      setIsFlipping(false);
    }
  }

  const bindings = useShortcutBindings();

  React.useEffect(() => {
    if (mode !== "study") return;
    const handler = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const key = e.key.toLowerCase();
      if (key === " ") { e.preventDefault(); flipCard(); return; }
      if (key === "escape") { e.preventDefault(); closeStudy(); return; }
      if (key === "arrowleft") { e.preventDefault(); prevCard(); return; }
      if (key === "arrowright") { e.preventDefault(); nextCard(); return; }
      if (key === "r" && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); restartDeck(); return; }
      if (!flipped) return;
      if (key === "1") { e.preventDefault(); rateCard("again"); }
      else if (key === "2") { e.preventDefault(); rateCard("hard"); }
      else if (key === "3") { e.preventDefault(); rateCard("good"); }
      else if (key === "4") { e.preventDefault(); rateCard("easy"); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [mode, flipped, cardIndex, isFlipping, currentCard, sessionCards, currentDeck]);

  // Mobile swipe — handled by the reusable SwipeGallery component.
  // The gallery renders prev/current/next cards and drives them with a
  // single motion value for the iOS Photos "connected cards" feel.
  // Tap-to-flip is preserved via the onTap callback (suppressed after a swipe).
  const isMobile = useIsMobile();
  const canSwipe = mode === "study" && isMobile;

  function restartDeck() {
    if (!currentDeck) return;
    if (activeSubdeckId) {
      startSubdeck(deckIndex, activeSubdeckId);
    } else {
      startDeck(deckIndex);
    }
  }

  // Render a single flashcard face (back layer with Q&A + sliding front cover).
  // Used for the current card AND the prev/next preview cards in the swipe
  // gallery. The `isFlipped` parameter only affects the front cover position —
  // preview cards are always shown unflipped (front cover down).
  const renderFlashcardFace = (
    card: { front: string; back: string } | undefined,
    isFlipped: boolean,
  ) => {
    if (!card) return null;
    return (
      <div className="relative w-full h-full overflow-hidden rounded-xl border border-border shadow-lg">
        {/* Back layer — shows both Q and A when front slides away */}
        <div className="absolute inset-0 flex flex-col bg-card rounded-xl">
          <div className="h-1/2 flex flex-col items-center justify-center p-4 sm:p-6">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1.5">
              <Lightbulb className="size-3" />
              {t("flash.question")}
            </div>
            <div className="text-sm sm:text-base leading-relaxed max-w-lg uworld-prose text-center">
              {card.front}
            </div>
          </div>
          <div className="shrink-0 h-px bg-border/60 mx-4" />
          <div className="h-1/2 flex flex-col items-center justify-center p-4 sm:p-6 bg-[color-mix(in_oklch,var(--primary)_4%,var(--card))] rounded-b-xl">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1.5">
              <Sparkles className="size-3" />
              {t("flash.answer")}
            </div>
            <div className="text-sm sm:text-base leading-relaxed max-w-lg uworld-prose text-center">
              {card.back}
            </div>
          </div>
        </div>
        {/* Front cover — slides up to reveal both Q and A */}
        <motion.div
          className="absolute inset-0 flex flex-col items-center justify-center p-6 sm:p-10 bg-card rounded-xl"
          animate={{ y: isFlipped ? "-100%" : "0%" }}
          transition={{ duration: 0.25, ease: "easeOut" }}
        >
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-4 flex items-center gap-1.5">
            <Lightbulb className="size-3" />
            {t("flash.question")}
          </div>
          <div className="text-lg sm:text-xl leading-relaxed max-w-lg uworld-prose text-center">
            {card.front}
          </div>
          <div className="mt-auto pt-6 text-xs text-muted-foreground/60">
            {t("flash.tapToReveal")}
          </div>
        </motion.div>
      </div>
    );
  };

  function openSubdecks(deckIdx: number) {
    setDeckIndex(deckIdx);
    setMode("subdecks");
  }

  function backToDecks() {
    setMode("decks");
    setActiveSubdeckId(null);
    setCardIndex(0);
    setFlipped(false);
    setIsFlipping(false);
    setSessionCards([]);
    setSessionResults([]);
  }

  function closeStudy() {
    setMode("decks");
    setActiveSubdeckId(null);
    setCardIndex(0);
    setFlipped(false);
    setIsFlipping(false);
    setSessionCards([]);
    setSessionResults([]);
  }

  function exportToAnki() {
    if (!currentDeck) return;
    const cards = mergeCards(collectLeafUids(currentDeck));
    const title = currentDeck.title;
    const lines: string[] = [];

    for (const card of cards) {
      const sdId = card.subdeckId ?? "";
      const tagPrefix = sdId
        ? `${title.replace(/\s+/g, "::")}::${sdId.replace(/\s+/g, "::")}`
        : title.replace(/\s+/g, "::");
      const tags = [tagPrefix, ...(card.tags ?? [])]
        .map((t) => t.replace(/\s+/g, "-"))
        .join(" ");
      const front = card.front.replace(/\t/g, " ").replace(/\n/g, "<br>");
      const back = card.back.replace(/\t/g, " ").replace(/\n/g, "<br>");
      lines.push(`${front}\t${back}\t${tags}`);
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

          <h2 className="text-2xl font-bold mb-2">{t("flash.session.completeTitle")}</h2>
          <p className="text-sm text-muted-foreground mb-8">
            {t("flash.session.reviewedIn", { count: doneCount, deck: currentDeck.title })}
            {activeSubdeckId && currentDeck.items.find((c) => c.uid === activeSubdeckId)
              ? ` :: ${currentDeck.items.find((c) => c.uid === activeSubdeckId)!.title}`
              : ""}
          </p>

          <div className="grid grid-cols-3 gap-3 mb-8">
            <div className="bg-card border border-border rounded-xl p-4">
              <div className="text-2xl font-bold text-foreground">{doneCount}</div>
              <div className="text-[11px] text-muted-foreground mt-1">{t("flash.session.reviewed")}</div>
            </div>
            <div className="bg-card border border-border rounded-xl p-4">
              <div className="text-2xl font-bold text-emerald-500">{accuracy}%</div>
              <div className="text-[11px] text-muted-foreground mt-1">{t("flash.session.accuracy")}</div>
            </div>
            <div className="bg-card border border-border rounded-xl p-4">
              <div className="text-2xl font-bold text-amber-500">
                {sessionResults.filter((r) => r.rating === "again").length}
              </div>
              <div className="text-[11px] text-muted-foreground mt-1">{t("flash.session.rateAgain")}</div>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <button
              onClick={restartDeck}
              className="w-full h-11 rounded-xl bg-primary text-primary-foreground font-medium hover:bg-primary/90 transition-colors flex items-center justify-center gap-2"
            >
              <RotateCcw className="size-4" />
              {t("flash.home.studyAgain")}
            </button>
            <button
              onClick={backToDecks}
              className="w-full h-11 rounded-xl border border-border text-foreground font-medium hover:bg-muted/60 transition-colors flex items-center justify-center gap-2"
            >
              <Layers className="size-4" />
              {t("flash.home.allDecks")}
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
            title={t("flash.exitTooltip")}
          >
            <XIcon className="size-4" />
            <span className="hidden sm:inline">{t("flash.exit")}</span>
          </button>

          <div className="h-5 w-px bg-border/60 hidden sm:block" />

          <div className="hidden sm:flex items-center gap-2 text-xs text-muted-foreground">
            <BookOpen className="size-3.5" />
            <span className="font-medium text-foreground">{currentDeck.title}</span>
            {activeSubdeckId && currentDeck.items.find((c) => c.uid === activeSubdeckId) && (
              <>
                <span className="opacity-50">&middot;</span>
                <span>{currentDeck.items.find((c) => c.uid === activeSubdeckId)!.title}</span>
              </>
            )}
          </div>

          <div className="flex-1" />

          {/* Navigation arrows + counter */}
          <div className="flex items-center gap-1.5">
            <button
              onClick={prevCard}
              disabled={cardIndex === 0}
              className={cn(
                "size-7 rounded-md flex items-center justify-center transition-colors",
                cardIndex === 0
                  ? "text-muted-foreground/30 cursor-not-allowed"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/60",
              )}
              title={t("flash.prevCardTooltip")}
            >
              <ChevronLeft className="size-4" />
            </button>
            <div className="text-xs text-muted-foreground tabular-nums min-w-[3.5rem] text-center">
              {cardIndex + 1} / {totalCount}
            </div>
            <button
              onClick={nextCard}
              disabled={cardIndex >= sessionCards.length - 1}
              className={cn(
                "size-7 rounded-md flex items-center justify-center transition-colors",
                cardIndex >= sessionCards.length - 1
                  ? "text-muted-foreground/30 cursor-not-allowed"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/60",
              )}
              title={t("flash.nextCardTooltip")}
            >
              <ChevronRight className="size-4" />
            </button>
          </div>

          <button
            onClick={restartDeck}
            className="hidden sm:flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors ml-1"
            title={t("flash.restartTooltip")}
          >
            <RotateCcw className="size-3.5" />
            <span>{t("flash.restart")}</span>
          </button>
        </header>

        {/* Progress bar */}
        <div className="shrink-0 h-1 bg-muted/40">
          <div
            className="h-full bg-primary transition-all duration-300"
            style={{ width: `${(doneCount / totalCount) * 100}%` }}
          />
        </div>

        {/* Card area — iOS photo gallery swipe.
            The SwipeGallery component handles the three-card layout, rubber-
            band edges, tap-to-flip (via onTap, suppressed after a swipe),
            and visibility-hidden preview cards at rest. */}
        <div className="flex-1 flex items-center justify-center p-4 sm:p-8 bg-card">
          <div className="w-full max-w-2xl aspect-[16/10]">
            <SwipeGallery
              items={currentDeckCards}
              currentIndex={cardIndex}
              onNavigateNext={nextCard}
              onNavigatePrev={prevCard}
              onTap={flipCard}
              disabled={!canSwipe}
              className="w-full h-full"
              cardClassName="w-full h-full"
              renderItem={(card, idx, _interactive) =>
                renderFlashcardFace(card, idx === cardIndex ? flipped : false)
              }
            />
          </div>
        </div>

        {/* Rating buttons */}
        <AnimatePresence>
          {flipped && (
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 16 }}
              transition={{ duration: 0.15, ease: "easeOut" }}
              className="shrink-0 border-t border-border bg-card px-4 py-3 sm:py-3"
            >
              <div className="max-w-lg mx-auto">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground text-center mb-2">
                  {t("flash.ratePrompt")}
                </div>
                <div className="grid grid-cols-4 gap-1.5">
                  <RateButton
                    label={t("flash.session.rateAgain")}
                    description={t("flash.session.timeAgain")}
                    shortcut="1"
                    rating="again"
                    color="red"
                    icon={X}
                    onRate={rateCard}
                  />
                  <RateButton
                    label={t("flash.session.rateHard")}
                    description={t("flash.session.timeHard")}
                    shortcut="2"
                    rating="hard"
                    color="orange"
                    icon={RotateCcw}
                    onRate={rateCard}
                  />
                  <RateButton
                    label={t("flash.session.rateGood")}
                    description={t("flash.session.timeGood")}
                    shortcut="3"
                    rating="good"
                    color="emerald"
                    icon={Check}
                    onRate={rateCard}
                  />
                  <RateButton
                    label={t("flash.session.rateEasy")}
                    description={t("flash.session.timeEasy")}
                    shortcut="4"
                    rating="easy"
                    color="blue"
                    icon={Zap}
                    onRate={rateCard}
                  />
                </div>
                <div className="flex items-center justify-center gap-2 mt-2 text-[9px] text-muted-foreground/40">
                  <span><kbd className="px-1 py-0.5 rounded border border-border/30 text-[8px]">1</kbd> {t("flash.session.rateAgain")}</span>
                  <span><kbd className="px-1 py-0.5 rounded border border-border/30 text-[8px]">2</kbd> {t("flash.session.rateHard")}</span>
                  <span><kbd className="px-1 py-0.5 rounded border border-border/30 text-[8px]">3</kbd> {t("flash.session.rateGood")}</span>
                  <span><kbd className="px-1 py-0.5 rounded border border-border/30 text-[8px]">4</kbd> {t("flash.session.rateEasy")}</span>
                  <span className="hidden sm:inline"><kbd className="px-1 py-0.5 rounded border border-border/30 text-[8px]">←</kbd><kbd className="px-1 py-0.5 rounded border border-border/30 text-[8px]">→</kbd> {t("flash.keyboardNav")}</span>
                  <span className="hidden sm:inline"><kbd className="px-1 py-0.5 rounded border border-border/30 text-[8px]">Esc</kbd> {t("flash.exit")}</span>
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
    const childNodes = currentDeck.items ?? [];
    const allCards = mergeCards(collectLeafUids(currentDeck));
    const totalCards = allCards.length;
    const totalDue = nodeDueCount(currentDeck);

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
              {t("flash.home.allDecks")}
            </button>
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
              <Layers className="size-3.5" />
              <span>{ENGINE_META.flashcard.label}</span>
            </div>
            <h1 className="text-2xl md:text-3xl font-bold tracking-tight mb-1">
              {currentDeck.title}
            </h1>
            <p className="text-sm text-muted-foreground">
              {t("flash.dueToday", { due: totalDue, total: totalCards })}
            </p>
          </div>

          {/* Study All + Export buttons */}
          <div className="flex items-center gap-2 mb-6">
            <button
              onClick={() => startDeck(deckIndex)}
              className="h-10 px-4 rounded-xl bg-primary text-primary-foreground font-medium text-sm hover:bg-primary/90 transition-colors flex items-center gap-2"
            >
              <GraduationCap className="size-4" />
              {t("flash.home.studyAll")}
            </button>
            <button
              onClick={exportToAnki}
              className="h-10 px-4 rounded-xl border border-border text-foreground font-medium text-sm hover:bg-muted/60 transition-colors flex items-center gap-2"
            >
              <Download className="size-4" />
              {t("flash.exportAnki")}
            </button>
          </div>

          {/* Child deck grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {childNodes.map((child) => {
              const isBranch = child.items.length > 0;
              const count = nodeCardCount(child);
              const dueCount = nodeDueCount(child);
              return (
                <button
                  key={child.uid}
                  onClick={() => {
                    if (isBranch) {
                      /* drill deeper — open this branch in subdecks view */
                      const idx = tree.indexOf(currentDeck); // won't work for nested
                      startDeck(deckIndex); // start session with merged cards for now
                    } else {
                      startSubdeck(deckIndex, child.uid);
                    }
                  }}
                  className="medos-fade-in text-left bg-card border border-border rounded-xl p-5 hover:border-primary/40 hover:shadow-md hover:bg-primary/[0.02] transition-colors group"
                >
                  <div className="flex items-center gap-3 mb-3">
                    <div
                      className="size-11 rounded-xl flex items-center justify-center shrink-0"
                      style={{
                        backgroundColor: `${FLASHCARD_COLOR}/15`,
                        color: FLASHCARD_COLOR,
                      }}
                    >
                      {isBranch ? <Folder className="size-5" /> : <Layers className="size-5" />}
                    </div>
                    <div className="min-w-0">
                      <h3 className="font-semibold truncate">{child.title}</h3>
                      <p className="text-xs text-muted-foreground">
                        {isBranch
                          ? t("flash.home.subdecks", { n: child.items.length })
                          : t("flash.home.cards", { n: count })}
                      </p>
                    </div>
                    <ChevronRight className="size-4 text-muted-foreground/40 group-hover:text-muted-foreground transition-colors ml-auto shrink-0" />
                  </div>
                  {child.description && (
                    <p className="text-xs text-muted-foreground/70 line-clamp-2 mb-3">
                      {child.description}
                    </p>
                  )}
                  {dueCount > 0 && (
                    <div className="flex items-center gap-1.5">
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-500 bg-emerald-500/10 px-2 py-0.5 rounded-full">
                        <Clock className="size-3" />
                        {t("flash.dueCount", { count: dueCount })}
                      </span>
                    </div>
                  )}
                  {dueCount === 0 && count > 0 && (
                    <span className="text-xs text-muted-foreground/50">{t("flash.allReviewed")}</span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  /* ── Decks view (grid) ───────────────────────────────────────────── */
  return (
    <div className="h-full overflow-y-auto medos-scroll medos-tabbar-pad">
      <div className="max-w-5xl mx-auto px-4 md:px-8 py-8">
        {/* Header */}
        <div className="mb-6">
          <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
            <Layers className="size-3.5" />
            <span>{t("engine.flashcard")}</span>
          </div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight mb-1">
            {t("flash.home.title")}
          </h1>
          <p className="text-sm text-muted-foreground">
            {t("flash.home.subtitle")}
          </p>
        </div>

        {/* Stat bar */}
        <div className="grid grid-cols-3 gap-3 mb-6">
          <div className="bg-card border border-border rounded-xl p-3.5">
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
              <Clock className="size-3.5" />
              {t("flash.home.due")}
            </div>
            <div className="text-xl font-bold">{stats.due}</div>
          </div>
          <div className="bg-card border border-border rounded-xl p-3.5">
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
              <BarChart3 className="size-3.5" />
              {t("flash.home.new")}
            </div>
            <div className="text-xl font-bold">{stats.new}</div>
          </div>
          <div className="bg-card border border-border rounded-xl p-3.5">
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
              <Brain className="size-3.5" />
              {t("flash.home.total")}
            </div>
            <div className="text-xl font-bold">{stats.total}</div>
          </div>
        </div>

        <ContentLangFilter />

        {/* Deck grid */}
        {tree.length === 0 ? (
          <div className="text-center py-16">
            <div className="size-14 rounded-full bg-muted/40 flex items-center justify-center mx-auto mb-4">
              <Layers className="size-6 text-muted-foreground" />
            </div>
            <h3 className="text-base font-semibold mb-1">{t("flash.home.empty")}</h3>
            <p className="text-sm text-muted-foreground">
              {t("flash.home.empty")}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {tree.map((node, idx) => {
              const isBranch = node.items.length > 0;
              const totalCards = mergeCards(collectLeafUids(node)).length;
              const dueCount = nodeDueCount(node);
              const pct = totalCards > 0
                ? Math.round(((totalCards - dueCount) / totalCards) * 100)
                : 0;
              // Per-pack content URLs (for the offline download button).
              // For branch nodes (folders), include all leaf descendant files.
              // Computed inline (cheap) to avoid hook-in-loop violations.
              const collectPackUrls = (n: ContentTreeNode): string[] => {
                const ownBase = `/osler-content/flashcard/${n.path}`;
                const own = (n.files ?? []).map((f) => `${ownBase}${f}`);
                if (n.items.length === 0) return own;
                const childUrls: string[] = [];
                for (const child of n.items) {
                  childUrls.push(...collectPackUrls(child));
                }
                return [...own, ...childUrls];
              };
              const packUrls = collectPackUrls(node);
              return (
                <div
                  key={node.uid}
                  role="button"
                  tabIndex={0}
                  onClick={() => {
                    if (isBranch) {
                      openSubdecks(idx);
                    } else {
                      startDeck(idx);
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      if (isBranch) openSubdecks(idx);
                      else startDeck(idx);
                    }
                  }}
                  className={cn(
                    "medos-fade-in text-start bg-card border border-border rounded-xl p-5 hover:border-primary/40 hover:shadow-md hover:bg-primary/[0.02] transition-colors group cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
                    node.lang === "ar" && "osler-content-ar",
                  )}
                  dir={node.lang === "ar" ? "rtl" : undefined}
                  lang={node.lang ?? undefined}
                  style={{ animationDelay: `${idx * 0.04}s` }}
                >
                  <div className="flex items-center gap-3 mb-3">
                    <div
                      className="size-11 rounded-xl flex items-center justify-center shrink-0"
                      style={{
                        backgroundColor: `${FLASHCARD_COLOR}/15`,
                        color: FLASHCARD_COLOR,
                      }}
                    >
                      {isBranch ? (
                        <Folder className="size-5" />
                      ) : (
                        <Layers className="size-5" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <h3 className="font-semibold truncate">{node.title}</h3>
                      <p className="text-xs text-muted-foreground">
                        {isBranch
                          ? t("flash.home.subdecks", { n: node.items.length })
                          : t("flash.home.cards", { n: totalCards })}
                      </p>
                    </div>
                    <ContentCacheButton packId={node.uid} urls={packUrls} />
                    <ChevronRight className="size-4 text-muted-foreground/40 group-hover:text-muted-foreground transition-colors ml-auto shrink-0" />
                  </div>
                  {node.description && (
                    <p className="text-xs text-muted-foreground/70 line-clamp-2 mb-3">
                      {node.description}
                    </p>
                  )}
                  <div className="flex items-center gap-3 text-xs">
                    <span className="text-emerald-500 font-medium tabular-nums">
                      {t("flash.dueCount", { count: dueCount })}
                    </span>
                    <span className="text-muted-foreground">
                      {t("flash.totalCount", { count: totalCards })}
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
                </div>
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
  shortcut,
  rating,
  color,
  icon: Icon,
  onRate,
}: {
  label: string;
  description: string;
  shortcut: string;
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
        "flex flex-col items-center gap-0.5 px-1.5 py-2 rounded-xl border-2 transition-all",
        colorMap[color],
      )}
    >
      <Icon className="size-4" />
      <span className="text-xs font-semibold">{label}</span>
      <span className="text-[9px] opacity-70">{description}</span>
      <kbd className="text-[8px] px-1 py-0.5 rounded border border-current/20 opacity-50">{shortcut}</kbd>
    </button>
  );
}
