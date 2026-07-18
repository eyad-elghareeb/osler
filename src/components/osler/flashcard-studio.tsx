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
import type {
  FlashcardContent,
  FlashcardSubdeck,
  ContentTreeNode,
  AnyContent,
  Flashcard,
  FlashcardImage,
} from "@/lib/osler/types";
import { flashcardReview, storage } from "@/lib/osler/storage";
import { useContentTree } from "@/hooks/use-content-tree";
import { useShortcutBindings } from "@/hooks/use-shortcuts";
import { VerticalSnapGallery } from "./vertical-snap-gallery";

import { cn } from "@/lib/utils";
import { haptic } from "@/lib/osler/native";
import { setImmersiveMode } from "./immersive-mode";
import { useI18n } from "./i18n-provider";
import { ContentCacheButton } from "./content-cache-button";
import { ContentLangFilter } from "./qbank-studio";
import { NavigationStack } from "./navigation-stack";
import { useSwipeBackDismiss } from "@/hooks/use-swipe-back-dismiss";

type ViewMode = "decks" | "subdecks" | "study" | "complete";

interface FlashcardStudioProps {
  activeItem?: ContentTreeNode | null;
  activeContent?: AnyContent | null;
  onExit: () => void;
  onOpenPack?: (item: ContentTreeNode) => void;
  onNavigateHome?: () => void;
  /** Called when the user swipes back to navigate to the Learn hub. */
  onNavigateBack?: () => void;
}

const FLASHCARD_COLOR = "oklch(0.7 0.18 145)";

const SUBDECK_ICONS: Record<string, string> = {
  cardiology: "heart",
  neurology: "brain",
  pulmonology: "lungs",
  pharmacology: "pill",
  gastroenterology: "stomach",
};

/* ── Rich-text rendering (markdown subset, shared with OSCE/AI chat) ──── */

/**
 * Render a small, safe markdown subset to HTML. Escapes first, then applies
 * bold / italic / inline-code / links / line-breaks. Deliberately narrow so
 * card content stays trustworthy without a full markdown pipeline.
 */
function renderCardMarkdown(text: string): string {
  if (!text) return "";
  let h = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
  // Inline code (before other inline rules so its content isn't re-processed).
  h = h.replace(/`([^`]+)`/g, "<code>$1</code>");
  // Bold, then italic.
  h = h.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  h = h.replace(/(^|[^*])\*(?!\*)([^*]+?)\*(?!\*)/g, "$1<em>$2</em>");
  // Markdown links [label](url).
  h = h.replace(
    /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>',
  );
  h = h.replace(/\n/g, "<br>");
  return h;
}

/**
 * Resolve a card asset (image / audio) src against the pack folder. Absolute
 * URLs and data URIs are returned untouched; bare filenames are prefixed with
 * the pack's public path.
 */
function resolveAsset(src: string, packPath: string): string {
  if (!src) return src;
  if (/^(https?:)?\/\//.test(src) || src.startsWith("data:") || src.startsWith("/")) {
    return src;
  }
  return `/osler-content/flashcard/${packPath}${src}`;
}

/** Normalize the `image` / `backImage` field (single or array) to an array. */
function asImageList(
  field: FlashcardImage | FlashcardImage[] | undefined,
): FlashcardImage[] {
  if (!field) return [];
  return Array.isArray(field) ? field : [field];
}

/* ── Anki export helpers ──────────────────────────────────────────────── */

/**
 * Take a resolved asset URL/path and return the bare filename Anki uses to
 * reference media in its collection.media folder (e.g. `/osler-content/.../ecg.png`
 * → `ecg.png`). Absolute http(s) URLs and data URIs are returned untouched so
 * Anki can fetch/inline them directly.
 */
function ankiMediaRef(resolved: string): string {
  if (/^https?:\/\//.test(resolved) || resolved.startsWith("data:")) return resolved;
  const clean = resolved.split(/[?#]/)[0];
  const parts = clean.split("/");
  return parts[parts.length - 1] || clean;
}

/**
 * Convert a card's markdown (bold/italic/code/links/line-breaks + inline
 * `![alt](src)` images) to HTML suitable for an Anki field. Images are
 * rewritten to `<img src="filename">` using {@link ankiMediaRef} so they line
 * up with files placed in Anki's media folder. `packPath` resolves bare
 * filenames the same way the in-app renderer does.
 */
function markdownToAnkiHtml(text: string, packPath: string): string {
  if (!text) return "";
  // Pull inline images out first so the escaping pass doesn't mangle them.
  const imgTokens: string[] = [];
  let src = text.replace(
    /!\[([^\]]*)\]\(([^\s)]+)\)/g,
    (_full, alt: string, url: string) => {
      const ref = ankiMediaRef(resolveAsset(url, packPath));
      const altAttr = alt.replace(/"/g, "&quot;");
      imgTokens.push(`<img src="${ref}" alt="${altAttr}">`);
      return `\u0000IMG${imgTokens.length - 1}\u0000`;
    },
  );
  let h = renderCardMarkdown(src);
  // Restore the image tokens.
  h = h.replace(/\u0000IMG(\d+)\u0000/g, (_m, i: string) => imgTokens[Number(i)] ?? "");
  return h;
}

/**
 * Convert Anki cloze source to an Anki-importable HTML field. The `{{cN::..}}`
 * braces MUST survive (Anki parses them), so markdown is only applied to the
 * text *outside* the braces and to the answer text *inside* each brace.
 */
function clozeToAnkiHtml(text: string, packPath: string): string {
  if (!text) return "";
  const clozeTokens: string[] = [];
  // Extract each cloze, markdown-render its answer/hint, stash a placeholder.
  const withoutCloze = text.replace(
    /\{\{c(\d+)::(.*?)(?:::(.*?))?\}\}/g,
    (_full, idx: string, answer: string, hint?: string) => {
      const ans = markdownToAnkiHtml(answer, packPath);
      const token = hint
        ? `{{c${idx}::${ans}::${hint}}}`
        : `{{c${idx}::${ans}}}`;
      clozeTokens.push(token);
      return `\u0000CLZ${clozeTokens.length - 1}\u0000`;
    },
  );
  let h = markdownToAnkiHtml(withoutCloze, packPath);
  h = h.replace(/\u0000CLZ(\d+)\u0000/g, (_m, i: string) => clozeTokens[Number(i)] ?? "");
  return h;
}

/** Escape a field for a tab-separated Anki import (tabs and newlines are structural). */
function ankiField(html: string): string {
  return html.replace(/\t/g, " ").replace(/\r?\n/g, "<br>");
}

/** Append `<img>` tags for a card's structured image field(s) to a field's HTML. */
function appendImagesHtml(html: string, images: FlashcardImage[], packPath: string): string {
  if (images.length === 0) return html;
  const imgs = images
    .map((img) => {
      const ref = ankiMediaRef(resolveAsset(img.src, packPath));
      const alt = (img.alt ?? "").replace(/"/g, "&quot;");
      const caption = img.caption
        ? `<div>${markdownToAnkiHtml(img.caption, packPath)}</div>`
        : "";
      return `<img src="${ref}" alt="${alt}">${caption}`;
    })
    .join("");
  return html ? `${html}<br>${imgs}` : imgs;
}

/** Trigger a browser download for a text blob. */
function downloadTextFile(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/* ── Cloze handling ───────────────────────────────────────────────────── */

const CLOZE_RE = /\{\{c(\d+)::(.*?)(?:::(.*?))?\}\}/g;

/** Collect the distinct cloze indices present in a source string. */
function clozeIndices(text: string): number[] {
  const set = new Set<number>();
  let m: RegExpExecArray | null;
  CLOZE_RE.lastIndex = 0;
  while ((m = CLOZE_RE.exec(text)) !== null) {
    set.add(parseInt(m[1], 10));
  }
  return Array.from(set).sort((a, b) => a - b);
}

/**
 * Render cloze text for a given active index.
 *  - reveal=false → the active deletion shows `[...]` (or `[hint]`), all other
 *    deletions show their answer text.
 *  - reveal=true  → the active deletion shows its highlighted answer, others
 *    show plain answer text.
 */
function renderCloze(text: string, activeIdx: number, reveal: boolean): string {
  // Extract each cloze so its braces survive markdown escaping/rendering,
  // then render markdown on the surrounding (non-cloze) text too. Cloze
  // braces MUST survive untouched — they are not markdown.
  const clozeTokens: string[] = [];
  const withoutCloze = text.replace(
    /\{\{c(\d+)::(.*?)(?:::(.*?))?\}\}/g,
    (_full, idxStr: string, answer: string, hint?: string) => {
      const idx = parseInt(idxStr, 10);
      const inner = renderCardMarkdown(answer);
      const token = hint
        ? `{{c${idx}::${inner}::${renderCardMarkdown(hint)}}}`
        : `{{c${idx}::${inner}}}`;
      clozeTokens.push(token);
      return `\u0000CLZ${clozeTokens.length - 1}\u0000`;
    },
  );
  let h = renderCardMarkdown(withoutCloze);
  h = h.replace(/\u0000CLZ(\d+)\u0000/g, (_m, i: string) => {
    const token = clozeTokens[Number(i)] ?? "";
    const m = token.match(/\{\{c(\d+)::(.*?)(?:::(.*?))?\}\}/);
    if (!m) return token;
    const idx = parseInt(m[1], 10);
    const inner = m[2];
    if (idx !== activeIdx) return inner;
    if (reveal) return `<span class="cloze-answer">${inner}</span>`;
    const label = m[3] ? `[${m[3]}]` : "[&hellip;]";
    return `<span class="cloze-blank">${label}</span>`;
  });
  return h;
}

/* ── Card expansion ───────────────────────────────────────────────────── */

/**
 * A study card is one reviewable unit. Cloze source cards expand into one
 * study card per cloze index (each with a derived `reviewId` so SM-2 tracks
 * them independently). Basic cards map 1:1.
 */
interface StudyCard {
  /** Stable id used for SM-2 review storage (card.id or card.id::c<idx>). */
  reviewId: string;
  card: Flashcard;
  /** Active cloze index (only meaningful for cloze cards). */
  clozeIdx: number | null;
}

function expandCards(cards: Flashcard[]): StudyCard[] {
  const out: StudyCard[] = [];
  for (const card of cards) {
    const isCloze = card.type === "cloze" || (!!card.text && CLOZE_RE.test(card.text));
    if (isCloze && card.text) {
      const indices = clozeIndices(card.text);
      if (indices.length === 0) {
        out.push({ reviewId: card.id, card, clozeIdx: null });
      } else {
        for (const idx of indices) {
          out.push({ reviewId: `${card.id}::c${idx}`, card, clozeIdx: idx });
        }
      }
    } else {
      out.push({ reviewId: card.id, card, clozeIdx: null });
    }
  }
  return out;
}

export function FlashcardStudio({
  activeItem,
  activeContent,
  onExit,
  onOpenPack,
  onNavigateHome,
  onNavigateBack,
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

  // Swipe-back gesture to navigate to Learn hub (disabled during study/complete modes)
  const swipeDismissProps = useSwipeBackDismiss({
    onDismiss: () => onNavigateBack?.(),
    direction: "horizontal",
    rtl,
    disabled: mode === "study" || mode === "complete",
  });

  // Compute stats from leafContent
  React.useEffect(() => {
    const compute = () => {
      let newC = 0, dueC = 0, totalC = 0;
      for (const [uid, content] of leafContent) {
        if (content.type !== "flashcard") continue;
        const fc = content as FlashcardContent;
        const studyCards = expandCards(fc.cards);
        totalC += studyCards.length;
        const cardIds = studyCards.map((c) => c.reviewId);
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

  // The active deck's cards, expanded into study cards (cloze cards split
  // into one reviewable unit per cloze index).
  const currentDeckCards = React.useMemo<StudyCard[]>(() => {
    if (!currentDeck) return [];
    if (activeSubdeckId) {
      const subdeck = currentDeck.items.find((c) => c.uid === activeSubdeckId);
      if (subdeck) return expandCards(mergeCards(collectLeafUids(subdeck)));
    }
    return expandCards(mergeCards(collectLeafUids(currentDeck)));
  }, [currentDeck, activeSubdeckId, leafContent]);

  // Map each card id to its source pack path so image / audio assets can be
  // resolved relative to the folder the card was authored in. Built by walking
  // the flashcard tree once and matching leaf uids to their content.
  const cardPathById = React.useMemo(() => {
    const map = new Map<string, string>();
    const walk = (node: ContentTreeNode) => {
      if (node.items.length === 0) {
        const content = leafContent.get(node.uid);
        if (content?.type === "flashcard") {
          for (const card of (content as FlashcardContent).cards) {
            map.set(card.id, node.path);
          }
        }
        return;
      }
      node.items.forEach(walk);
    };
    tree.forEach(walk);
    return map;
  }, [tree, leafContent]);

  const currentCard = currentDeckCards[cardIndex];
  const isSessionCard = currentCard
    ? sessionCards.includes(currentCard.reviewId)
    : false;

  function startSession(cards: Flashcard[], uid: string) {
    const studyCards = expandCards(cards);
    const cardIds = studyCards.map((c) => c.reviewId);
    const dueIds = flashcardReview.getCardsDue(uid, cardIds);
    const toStudy =
      dueIds.length > 0
        ? studyCards.filter((c) => dueIds.includes(c.reviewId))
        : studyCards.slice(0, 10);
    setSessionCards(toStudy.map((c) => c.reviewId));
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
    flashcardReview.recordReview(currentDeck.uid, currentCard.reviewId, rating);
    setSessionResults((prev) => [
      ...prev,
      { cardId: currentCard.reviewId, rating },
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

  // Vertical snap navigation — handled by the reusable VerticalSnapGallery
  // component. The gallery renders prev/current/next cards driven by a
  // single motion value for the Instagram-Reels / TikTok feel. Drag works
  // from anywhere on the screen that isn't an interactive control.
  // Tap-to-flip is preserved via the onTap callback (suppressed after a swipe).
  // Available on both touch and desktop — touch users drag up/down, desktop
  // users use wheel/trackpad.
  const canSwipe = mode === "study";

  function restartDeck() {
    if (!currentDeck) return;
    if (activeSubdeckId) {
      startSubdeck(deckIndex, activeSubdeckId);
    } else {
      startDeck(deckIndex);
    }
  }

  // Render an image list for a card face.
  const renderImages = (images: FlashcardImage[], packPath: string) => {
    if (images.length === 0) return null;
    return (
      <div className="flex flex-wrap items-center justify-center gap-3 my-3 w-full">
        {images.map((img, i) => (
          <figure key={i} className="flex flex-col items-center max-w-full">
            <img
              src={resolveAsset(img.src, packPath)}
              alt={img.alt ?? ""}
              className="max-h-[38vh] max-w-full rounded-lg border border-border object-contain"
              loading="lazy"
            />
            {img.caption && (
              <figcaption className="mt-1 text-xs text-muted-foreground text-center">
                {img.caption}
              </figcaption>
            )}
          </figure>
        ))}
      </div>
    );
  };

  // Render a single flashcard face.
  //
  // Basic cards use the vertical shrink-to-reveal flip (front cover collapses
  // upward to expose the answer underneath). Cloze cards render a single
  // surface where the flip toggles the active deletion between `[…]` and the
  // highlighted answer.
  //
  // `isFlipped` only affects the current card — preview cards in the
  // gallery (prev/next) are always rendered unflipped.
  const renderFlashcardFace = (
    study: StudyCard | undefined,
    isFlipped: boolean,
  ) => {
    if (!study) return null;
    const { card, clozeIdx } = study;
    const packPath = cardPathById.get(card.id) ?? "";
    const frontImages = asImageList(card.image);
    const backImages = asImageList(card.backImage);

    // ── Cloze card ──────────────────────────────────────────────────
    if (clozeIdx !== null && card.text) {
      const html = renderCloze(card.text, clozeIdx, isFlipped);
      return (
        <div className="relative w-full h-full overflow-hidden rounded-xl border border-border shadow-lg bg-card">
          <div className="absolute inset-0 flex flex-col">
            <div className="shrink-0 px-4 sm:px-6 pt-4 sm:pt-5 pb-2 border-b border-border/40">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                <Sparkles className="size-3" />
                {t("flash.cloze")}
              </div>
            </div>
            <div className="flex-1 min-h-0 flex flex-col items-center justify-center p-4 sm:p-8 overflow-y-auto medos-scroll">
              {renderImages(frontImages, packPath)}
              <div
                className="text-base sm:text-xl leading-relaxed max-w-2xl uworld-prose text-center"
                dangerouslySetInnerHTML={{ __html: html }}
              />
              {isFlipped && card.extra && (
                <div className="mt-5 pt-4 border-t border-border/40 w-full max-w-2xl">
                  <div
                    className="text-sm leading-relaxed text-muted-foreground uworld-prose text-center"
                    dangerouslySetInnerHTML={{ __html: renderCardMarkdown(card.extra) }}
                  />
                </div>
              )}
              {isFlipped && renderImages(backImages, packPath)}
              {!isFlipped && (
                <div className="mt-6 text-xs text-muted-foreground/60">
                  {t("flash.tapToReveal")}
                </div>
              )}
            </div>
          </div>
        </div>
      );
    }

    // ── Basic card ──────────────────────────────────────────────────
    return (
      <div className="relative w-full h-full overflow-hidden rounded-xl border border-border shadow-lg">
        {/* Back layer — full-card answer with a small question echo at top. */}
        <div className="absolute inset-0 flex flex-col bg-card rounded-xl">
          <div className="shrink-0 px-4 sm:px-6 pt-4 sm:pt-5 pb-2 border-b border-border/40">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1 flex items-center gap-1.5">
              <Lightbulb className="size-3" />
              {t("flash.question")}
            </div>
            <div
              className="text-xs sm:text-sm leading-snug max-w-lg uworld-prose text-muted-foreground line-clamp-3"
              dangerouslySetInnerHTML={{ __html: renderCardMarkdown(card.front ?? "") }}
            />
          </div>
          <div className="flex-1 min-h-0 flex flex-col items-center justify-center p-4 sm:p-6 bg-[color-mix(in_oklch,var(--primary)_4%,var(--card))] rounded-b-xl overflow-y-auto medos-scroll">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1.5">
              <Sparkles className="size-3" />
              {t("flash.answer")}
            </div>
            <div
              className="text-sm sm:text-base leading-relaxed max-w-lg uworld-prose text-center"
              dangerouslySetInnerHTML={{ __html: renderCardMarkdown(card.back ?? "") }}
            />
            {renderImages(backImages, packPath)}
          </div>
        </div>
        {/* Front cover — shrinks vertically to reveal the back. */}
        <motion.div
          className="absolute inset-0 flex flex-col items-center justify-center p-6 sm:p-10 bg-card rounded-xl overflow-y-auto medos-scroll"
          style={{ originY: 0 }}
          animate={{
            scaleY: isFlipped ? 0 : 1,
            opacity: isFlipped ? 0 : 1,
          }}
          transition={{ duration: 0.28, ease: [0.32, 0.72, 0, 1] }}
        >
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-4 flex items-center gap-1.5">
            <Lightbulb className="size-3" />
            {t("flash.question")}
          </div>
          {renderImages(frontImages, packPath)}
          <div
            className="text-lg sm:text-xl leading-relaxed max-w-lg uworld-prose text-center"
            dangerouslySetInnerHTML={{ __html: renderCardMarkdown(card.front ?? "") }}
          />
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
    haptic("success");
    const cards = mergeCards(collectLeafUids(currentDeck));
    const title = currentDeck.title;
    const deckName = title.replace(/::/g, "-").trim() || "Osler";
    const slug = title.replace(/\s+/g, "-").toLowerCase() || "deck";

    // Anki imports one note type per file, so basic and cloze rows are kept
    // in separate buckets and written to separate files when both exist.
    const basicRows: string[] = [];
    const clozeRows: string[] = [];

    for (const card of cards) {
      const packPath = cardPathById.get(card.id) ?? "";
      const sdId = card.subdeckId ?? "";
      const tagPrefix = sdId
        ? `${title.replace(/\s+/g, "::")}::${sdId.replace(/\s+/g, "::")}`
        : title.replace(/\s+/g, "::");
      const tags = [tagPrefix, ...(card.tags ?? [])]
        .map((tg) => tg.replace(/\s+/g, "-"))
        .join(" ");

      const isCloze =
        card.type === "cloze" || (!!card.text && /\{\{c\d+::/.test(card.text));

      if (isCloze && card.text) {
        // Cloze note type: Text + Extra fields. Braces are preserved so Anki
        // generates the deletions; markdown/images are converted to HTML.
        let textHtml = clozeToAnkiHtml(card.text, packPath);
        textHtml = appendImagesHtml(textHtml, asImageList(card.image), packPath);
        let extraHtml = markdownToAnkiHtml(card.extra ?? "", packPath);
        extraHtml = appendImagesHtml(extraHtml, asImageList(card.backImage), packPath);
        clozeRows.push(`${ankiField(textHtml)}\t${ankiField(extraHtml)}\t${tags}`);
      } else {
        // Basic note type: Front + Back fields.
        let frontHtml = markdownToAnkiHtml(card.front ?? "", packPath);
        frontHtml = appendImagesHtml(frontHtml, asImageList(card.image), packPath);
        let backHtml = markdownToAnkiHtml(card.back ?? "", packPath);
        backHtml = appendImagesHtml(backHtml, asImageList(card.backImage), packPath);
        basicRows.push(`${ankiField(frontHtml)}\t${ankiField(backHtml)}\t${tags}`);
      }
    }

    // Anki import header directives — tell Anki the columns are tab-separated,
    // fields contain HTML, which column holds tags, the note type, and the
    // target deck, so the user doesn't have to configure the import dialog.
    const header = (notetype: string, columns: string) =>
      [
        "#separator:tab",
        "#html:true",
        `#notetype:${notetype}`,
        `#deck:${deckName}`,
        "#tags column:3",
        `#columns:${columns}`,
      ].join("\n") + "\n";

    if (basicRows.length > 0) {
      downloadTextFile(
        `${slug}-anki-basic.txt`,
        header("Basic", "Front\tBack\tTags") + basicRows.join("\n"),
        "text/plain;charset=utf-8",
      );
    }
    if (clozeRows.length > 0) {
      downloadTextFile(
        `${slug}-anki-cloze.txt`,
        header("Cloze", "Text\tExtra\tTags") + clozeRows.join("\n"),
        "text/plain;charset=utf-8",
      );
    }
    // Nothing to export (empty deck) — still give feedback via a no-op file.
    if (basicRows.length === 0 && clozeRows.length === 0) {
      downloadTextFile(`${slug}-anki-basic.txt`, header("Basic", "Front\tBack\tTags"), "text/plain;charset=utf-8");
    }
  }

  const doneCount = sessionResults.length;
  const totalCount = sessionCards.length;
  const correctCount = sessionResults.filter(
    (r) => r.rating === "good" || r.rating === "easy",
  ).length;
  const accuracy = doneCount > 0 ? Math.round((correctCount / doneCount) * 100) : 0;

  /**
   * renderDecksView — the top-level decks grid. Extracted as a closure so
   * the same JSX can be used both as the default view (when `mode ===
   * "decks"`) and as the `home` layer underneath the subdecks subpage in
   * NavigationStack. Reading component state directly avoids prop drilling.
   */
  const renderDecksView = () => (
    <div className="h-full overflow-y-auto medos-scroll medos-tabbar-pad">
      <div className="max-w-5xl mx-auto px-4 md:px-6 lg:px-8 py-6 md:py-8">
        {/* Header */}
        <div className="osler-page-header">
          <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
            <Layers className="size-3.5" />
            <span>{t("engine.flashcard")}</span>
          </div>
          <h1 className="osler-page-header__title">
            {t("flash.home.title")}
          </h1>
          <p className="osler-page-header__subtitle">
            {t("flash.home.subtitle")}
          </p>
        </div>

        {/* Stat bar */}
        <div className="grid grid-cols-3 gap-3 mb-6">
          <div className="osler-stat-tile--compact">
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
              <Clock className="size-3.5" />
              {t("flash.home.due")}
            </div>
            <div className="osler-stat-tile__value">{stats.due}</div>
          </div>
          <div className="osler-stat-tile--compact">
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
              <BarChart3 className="size-3.5" />
              {t("flash.home.new")}
            </div>
            <div className="osler-stat-tile__value">{stats.new}</div>
          </div>
          <div className="osler-stat-tile--compact">
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
              <Brain className="size-3.5" />
              {t("flash.home.total")}
            </div>
            <div className="osler-stat-tile__value">{stats.total}</div>
          </div>
        </div>

        <ContentLangFilter />

        {/* Deck grid */}
        {tree.length === 0 ? (
          <div className="osler-empty">
            <div className="osler-empty__icon">
              <Layers className="size-6" />
            </div>
            <h3 className="osler-empty__title">{t("flash.home.empty")}</h3>
            <p className="osler-empty__body">
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
                for (const img of n.images ?? []) own.push(`${ownBase}images/${img}`);
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
                    <span className="text-success font-medium tabular-nums">
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

  /* ── Complete view ──────────────────────────────────────────────── */
  if (mode === "complete" && currentDeck) {
    return (
      <div className="h-full overflow-y-auto medos-scroll">
        <div className="max-w-lg mx-auto px-4 py-12 text-center">
          <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: "spring", stiffness: 200, damping: 20 }}
            className="size-20 rounded-full bg-success/15 border-2 border-success/30 flex items-center justify-center mx-auto mb-6"
          >
            <Brain className="size-9 text-success" />
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
              <div className="text-2xl font-bold text-success">{accuracy}%</div>
              <div className="text-[11px] text-muted-foreground mt-1">{t("flash.session.accuracy")}</div>
            </div>
            <div className="bg-card border border-border rounded-xl p-4">
              <div className="text-2xl font-bold text-warning">
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

        {/* Card area — vertical Reels/TikTok-style snap gallery.
            The gallery fills the ENTIRE flex-1 area so the user can start
            a drag from anywhere — including the empty space above/below
            the card. Each page centers its card visually; the surrounding
            empty space is part of the snap interaction zone. */}
        <div className="flex-1 min-h-0 bg-card">
          <VerticalSnapGallery
            items={currentDeckCards}
            currentIndex={cardIndex}
            onNavigateNext={nextCard}
            onNavigatePrev={prevCard}
            onTap={flipCard}
            disabled={!canSwipe}
            rtl={rtl}
            threshold={70}
            className="w-full h-full"
            cardClassName="w-full h-full"
            renderItem={(card, idx, _interactive) => (
              <div className="w-full h-full flex items-center justify-center p-4 sm:p-8">
                <div className="w-full max-w-2xl aspect-[16/10]">
                  {renderFlashcardFace(card, idx === cardIndex ? flipped : false)}
                </div>
              </div>
            )}
          />
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

    // Wrap the subdecks view in NavigationStack so the user can swipe
    // back to the decks list — same iOS-style gesture as Settings. The
    // home layer (decks grid) is rendered underneath and dims to 65%
    // opacity while the subdecks subpage is on top, exactly like the
    // Settings → sub-section push animation.
    return (
      <NavigationStack
        className="h-full"
        homeClassName="medos-scroll medos-tabbar-pad"
        subpageClassName="medos-scroll medos-tabbar-pad"
        rtl={rtl}
        home={renderDecksView()}
        subpage={
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
        }
        onBack={backToDecks}
      />
    );
  }

  /* ── Decks view (grid) ───────────────────────────────────────────── */
  return (
    <motion.div {...swipeDismissProps} className="h-full">
      {renderDecksView()}
    </motion.div>
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
