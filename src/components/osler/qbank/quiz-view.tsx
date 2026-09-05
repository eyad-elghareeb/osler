"use client";

import * as React from "react";
import { motion, AnimatePresence, useMotionValue, animate } from "framer-motion";
import { ChevronLeft, ChevronRight, Flag, Check, X, Clock, Pause, Play, GraduationCap, RotateCcw, ListChecks, Timer, Sparkles, FileText, Calculator as CalcIcon, FlaskConical, BookOpen, NotebookPen, Sliders, Eye, Keyboard, Wrench, LogOut, MessageSquareWarning } from "lucide-react";
import { ENGINE_META } from "@/lib/osler/content";
import { toast } from "@/hooks/use-toast";
import type { ContentTreeNode } from "@/lib/osler/types";
import { sessions, type HighlightItem, type WrittenDraft } from "@/lib/osler/storage";
import type { ArticleMeta } from "@/lib/osler/articles";
import { HIGHLIGHT_COLOR_KEYS, ERASER_TOOL } from "@/lib/osler/highlight-palette";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Sheet, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { HighlightedContent } from "@/components/osler/highlighted-content";
import { HighlighterToolbar } from "@/components/osler/highlighter-toolbar";
import { useShortcutBindings } from "@/hooks/use-shortcuts";
import { isTextInput, describeBinding } from "@/lib/osler/shortcuts";
import { useIsMobile } from "@/hooks/use-mobile";
import { VerticalSnapGallery } from "@/components/osler/vertical-snap-gallery";
import { useSwipeTabs } from "@/hooks/use-swipe-tabs";
import { useQuizSettings } from "@/hooks/use-quiz-settings";
import { haptic } from "@/lib/osler/native";
import { gradeWithAI, createManualEvaluation } from "@/lib/osler/grading";
import { useI18n } from "@/components/osler/i18n-provider";
import { ToolButton, SwipeableSheetContent } from "@/components/osler/ui-primitives";
import { MOTION_TRANSITION } from "@/lib/osler/motion";
import type { StringKey } from "@/lib/osler/i18n";
import { choiceLetter, matchSingleChordBinding, questionAssetBase, renderQuestionText, imageListOf, ContentImageFigure, TestMode, SessionData, SessionQuestion, SessionToolRow, formatTime, formatMs } from "./shared";
import { QuestionNavigatorSheet } from "./navigator-sheet";
import { ExplanationCard } from "./explanation-card";
import { dirForContent } from "@/lib/osler/i18n";
import { PeerChoicePercent } from "./peer-choice-percent";
import type { QuestionChoiceStats } from "@/lib/osler/question-stats";
import { WrittenEngineView, WrittenEvaluationPanel } from "./written-engine";
import { OsceEngineView } from "./osce-engine-view";
import { ReportTicketDialog } from "@/components/osler/report-ticket-dialog";
import { WalkthroughDialog, isWalkthroughCompleted } from "@/components/osler/walkthrough";








































































// Isolated, self-ticking timer. Owns its own 1s interval so the rest of the
// QuizView (notably the highlighter's DOM/selection) never re-renders per tick.
// Render it with a `key` tied to the session start so a fresh session resets it.
function QBankTimer({
  mode,
  startedAt,
  timeEndsAt,
  onExpire,
}: {
  mode: TestMode;
  startedAt: number;
  timeEndsAt?: number;
  onExpire: () => void;
}) {
  const [now, setNow] = React.useState(() => Date.now());
  const [remaining, setRemaining] = React.useState(() =>
    timeEndsAt != null ? Math.max(0, Math.ceil((timeEndsAt - Date.now()) / 1000)) : 0
  );
  const onExpireRef = React.useRef(onExpire);
  onExpireRef.current = onExpire;
  const firedRef = React.useRef(false);

  // 1s tick — drives the tutor-mode elapsed clock.
  React.useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // Timed countdown — derived from the absolute wall-clock expiry stored on
  // the session, so refresh/resume and pause handling stay in the studio.
  React.useEffect(() => {
    if (mode !== "timed" || timeEndsAt == null) return;
    const tick = () => {
      const r = Math.max(0, Math.ceil((timeEndsAt - Date.now()) / 1000));
      setRemaining(r);
      if (r <= 0 && !firedRef.current) {
        firedRef.current = true;
        onExpireRef.current();
      }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [mode, timeEndsAt]);

  const display =
    mode === "timed" ? remaining : Math.floor((now - startedAt) / 1000);
  const danger = mode === "timed" && remaining < 300;

  return (
    <div
      className={cn(
        "flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-sm font-mono tabular-nums",
        danger ? "bg-destructive text-destructive-foreground" : "bg-primary-foreground/15"
      )}
    >
      <Clock className="size-3.5" />
      <span className="font-mono tabular-nums">{formatTime(display)}</span>
    </div>
  );
}

export function QuizView({
  session,
  activeItem: activeItemProp,
  calculatorOpen,
  labValuesOpen,
  aiAssistantOpen,
  quizSettingsOpen,
  notesOpen,
  navOpenMobile,
  articleList,
  onToggleCalculator,
  onToggleLabValues,
  onToggleAiAssistant,
  onToggleQuizSettings,
  onToggleNotes,
  onNewNote,
  onNavMobileChange,
  onOpenArticle,
  onSelect,
  onToggleStrikethrough,
  onSubmit,
  onWrittenDraftChange,
  onRubricToggle,
  onRate,
  onToggleFlag,
  onTogglePause,
  onPrev,
  onNext,
  onJumpTo,
  onRetry,
  onGoHome,
  onSaveAndExit,
  onFinish,
  onTimeUp,
  onExitRequest,
  peerStats,
  onHighlightAdd,
  onHighlightRemove,
  onHighlightClearAll,
}: {
  session: SessionData;
  activeItem?: ContentTreeNode;
  calculatorOpen: boolean;
  labValuesOpen: boolean;
  aiAssistantOpen: boolean;
  quizSettingsOpen: boolean;
  notesOpen: boolean;
  navOpenMobile: boolean;
  articleList: ArticleMeta[];
  onToggleCalculator: () => void;
  onToggleLabValues: () => void;
  onToggleAiAssistant: () => void;
  onToggleQuizSettings: () => void;
  onToggleNotes: () => void;
  onNewNote: () => void;
  onNavMobileChange: (open: boolean) => void;
  onOpenArticle: (id: string) => void;
  onSelect: (idx: number) => void;
  onToggleStrikethrough: (idx: number) => void;
  onSubmit: () => void;
  onWrittenDraftChange: (qid: string, draft: WrittenDraft) => void;
  onRubricToggle: (qid: string, idx: number) => void;
  onRate: (qid: string, rating: "easy" | "hard" | "unknown") => void;
  onToggleFlag: () => void;
  onTogglePause: () => void;
  onTimeUp: () => void;
  onPrev: () => void;
  onNext: () => void;
  onJumpTo: (i: number) => void;
  onRetry: () => void;
  onGoHome: () => void;
  onSaveAndExit: () => void;
  onFinish: () => void;
  onExitRequest: () => void;
  /** Aggregated peer-choice stats keyed `${sourceUid}::${questionId}`.
   *  Optional — absent/empty renders no percentage labels. */
  peerStats?: Record<string, QuestionChoiceStats>;
  /** Session-bound highlight callbacks — all mutations go through these. */
  onHighlightAdd: (questionIdx: number, item: HighlightItem) => void;
  onHighlightRemove: (questionIdx: number, id: string) => void;
  onHighlightClearAll: () => void;
}) {
  const q = session.questions[session.current];
  const isLast = session.current >= session.questions.length - 1;
  const readonly = !!session.isReview;
  const submitted = readonly || session.revealed[session.current] || false;
  const selected = session.answers[session.current];
  const isMCQ = q ? q.correct >= 0 : false;
  const qIsWritten = q ? (q.correct == null || q.correct < 0) && (!!q.rubric?.length || !!q.modelAnswer) : false;
  const isPausedOrLocked = session.examPaused;
  const { t, rtl } = useI18n();
  const hasMCQ = session.questions.some((q) => q.correct >= 0);
  const hasWritten = session.questions.some((q) => q.correct < 0 && q.rubric && q.rubric.length > 0);
  const isMixedQSession = hasMCQ && hasWritten;
  const engineLabel = isMixedQSession ? t("qbank.session.mixed") : ENGINE_META[session.engine].label;

  // P3-1/P2-4: when called from a custom session (no activeItem prop), build
  // a synthetic ContentTreeNode so the rest of QuizView (which assumes
  // activeItem is defined) keeps working. The values mirror what would have
  // been passed for the equivalent single-pack path.
  const activeItem: ContentTreeNode = activeItemProp ?? {
    uid: session.itemId,
    title: session.itemTitle,
    type: session.engine,
    path: "",
    files: [],
    items: [],
  };

  // Highlighter state — a single "tool": null = off, "eraser" = erase, or a color key
  const [tool, setTool] = React.useState<string | null>(null);
  const [color, setColor] = React.useState<string>(HIGHLIGHT_COLOR_KEYS[0]);
  const highlightMode = tool !== null && tool !== ERASER_TOOL;
  const eraserMode = tool === ERASER_TOOL;
  const highlightColor = tool !== null && tool !== ERASER_TOOL ? tool : color;
  // Live quiz settings (font, weight, line height, auto-submit, layout, alignment)
  const { settings: quizSettingsState } = useQuizSettings();
  const [articleSearchOpen, setArticleSearchOpen] = React.useState(false);
  const [toolsOpen, setToolsOpen] = React.useState(false);
  const [reportOpen, setReportOpen] = React.useState(false);
  const [walkthroughOpen, setWalkthroughOpen] = React.useState(false);
  // Tracks settings panels the SESSION TOUR auto-opened, so the panel is
  // put away when the tour ends (panels the user opened themselves stay).
  const tourOpenedSettingsRef = React.useRef(false);

  // Auto-open the session tour the very first time a quiz is launched
  React.useEffect(() => {
    if (!isWalkthroughCompleted("qbank-session")) {
      const timer = setTimeout(() => setWalkthroughOpen(true), 600);
      return () => clearTimeout(timer);
    }
  }, []); // mount-only: check the completed flag once per session mount
  const isMobile = useIsMobile();
  const [mobileTutorTab, setMobileTutorTab] = React.useState<"question" | "answer">("question");
  const [showShortcuts, setShowShortcuts] = React.useState(false);
  const bindings = useShortcutBindings();

  // Auto-attached report context: pack identity, question id, a plain-text
  // stem excerpt for the summary line, and the FULL question (same shape the
  // AI assistant receives) so admins can see exactly what was wrong.
  const reportContext = React.useMemo(() => {
    if (!q) return undefined;
    return {
      packUid: q.sourceUid ?? session.itemId,
      packTitle: q.sourceTitle ?? session.itemTitle,
      qid: q.id,
      questionExcerpt: (q.stem || "").replace(/[#*`_[\]()!>]/g, " ").replace(/\s+/g, " ").trim().slice(0, 140),
      selectedAnswer: selected !== undefined ? q.choices[selected] : undefined,
      question: {
        stem: q.stem || "",
        choices: q.choices?.length ? q.choices : undefined,
        correct: q.correct,
        explanation: q.explanation || undefined,
        selected,
      },
    };
  }, [q, session.itemId, session.itemTitle, selected]);

  // Map settings → CSS
  const fontFamilyCss = React.useMemo(() => {
    switch (quizSettingsState.fontFamily) {
      case "serif": return "Lora, Georgia, serif";
      case "sans": return "Inter, system-ui, -apple-system, sans-serif";
      case "mono": return "ui-monospace, SFMono-Regular, Menlo, monospace";
      case "system":
      default: return "inherit";
    }
  }, [quizSettingsState.fontFamily]);

  // Stem typography. NOTE: `textAlign` is intentionally NOT set here —
  // alignment applies to the question BLOCK (the stem container and the
  // choices container), not to the inline text. The block alignment is
  // applied via `alignClass` below (margin-auto + max-width trick).
  const stemStyle = React.useMemo<React.CSSProperties>(
    () => ({
      fontFamily: fontFamilyCss,
      fontSize: `${quizSettingsState.fontSize}px`,
      fontWeight: quizSettingsState.fontWeight,
      lineHeight: quizSettingsState.lineHeight,
    }),
    [fontFamilyCss, quizSettingsState.fontSize, quizSettingsState.fontWeight, quizSettingsState.lineHeight]
  );

  const choiceStyle = React.useMemo<React.CSSProperties | undefined>(
    () => quizSettingsState.textAffectsChoices
      ? {
          fontFamily: fontFamilyCss,
          fontSize: `${quizSettingsState.fontSize}px`,
          fontWeight: quizSettingsState.fontWeight,
          lineHeight: quizSettingsState.lineHeight,
        }
      : undefined,
    [fontFamilyCss, quizSettingsState.fontSize, quizSettingsState.fontWeight, quizSettingsState.lineHeight, quizSettingsState.textAffectsChoices]
  );

  // Resolve effective explanation layout. Split mode shows the explanation
  // in a separate column (side-by-side on desktop, stacked with tabs on mobile).
  // Continuous mode renders the explanation below the question in a single scroll.
  const useSplitExplanation = quizSettingsState.explanationMode === "split";

  // Whether we're currently rendering in 2-page (split) mode.
  // Split mode is active when: explanationMode is "split" AND the user has
  // submitted the answer, in tutor mode OR when reviewing an old session
  // (readonly — every question is already revealed, so the explanation is
  // always available).
  const isSplitMode = useSplitExplanation && (session.mode === "tutor" || readonly);

  // Block-level alignment for the ENTIRE content area (question + choices).
  // Applied to the outer content wrapper so the block positions relative to
  // the full viewport / column, not a nested max-width sub-container.
  //
  // - left:   content fills available width (with a generous max for readability)
  // - center: content block capped at max-w-3xl, centered with mx-auto
  // - right:  content block capped at max-w-3xl, pushed to the inline-end
  //
  // IMPORTANT: In 2-page (split) mode, alignment is ALWAYS "left" (fill width).
  //   The question column is only ~55% wide; centering or right-aligning within
  //   that narrow column looks broken. The center/right options are honored
  //   only in continuous mode (single full-width scroll).
  //
  // For Arabic (RTL) content the wrapper already has dir="rtl", so logical
  // properties (ms-auto / me-auto) flip correctly: "right" pushes the block
  // to the physical right in both LTR and RTL.
  const contentAlignClass = React.useMemo(() => {
    // Split (2-page) mode: always fill width — ignore user alignment choice
    if (isSplitMode) return "max-w-5xl";
    switch (quizSettingsState.questionAlign) {
      case "center":
        return "mx-auto max-w-3xl";
      case "right":
        // ms-auto in LTR pushes block to the right (inline-end).
        // me-auto in RTL pushes block to the right (inline-start = right in RTL).
        // Both result in the block being physically on the right side.
        return rtl ? "me-auto max-w-3xl" : "ms-auto max-w-3xl";
      case "left":
      default:
        // Left = fill width but cap at a generous max for readability
        return "max-w-5xl";
    }
  }, [quizSettingsState.questionAlign, rtl, isSplitMode]);

  // Written AI grading state
  const [writtenAIGrading, setWrittenAIGrading] = React.useState<string | null>(null);
  const [writtenChildGrading, setWrittenChildGrading] = React.useState<{ qId: string; childIdx: number } | null>(null);
  const writtenAbortRef = React.useRef<AbortController | null>(null);

  const handleWrittenAIGrade = React.useCallback(
    async (q: SessionQuestion, draft: WrittenDraft) => {
      const apiKey = localStorage.getItem("osler_gemini_api_key");
      if (!apiKey) {
        toast({ title: t("qbank.written.noApiKey"), variant: "destructive" });
        return;
      }
      setWrittenAIGrading(q.id);
      const abort = new AbortController();
      writtenAbortRef.current = abort;
      try {
        const evaluation = await gradeWithAI({
          question: q.stem,
          modelAnswer: q.modelAnswer,
          rubric: q.rubric,
          userAnswer: draft.text,
          signal: abort.signal,
        });
        onWrittenDraftChange(q.id, {
          ...draft,
          submitted: true,
          evaluation,
        });
      } catch (err) {
        if ((err as Error)?.name === "AbortError") return;
        const manual = createManualEvaluation(draft.text);
        onWrittenDraftChange(q.id, {
          ...draft,
          submitted: true,
          evaluation: manual,
        });
      } finally {
        setWrittenAIGrading(null);
        writtenAbortRef.current = null;
      }
    },
    [onWrittenDraftChange],
  );

  const handleWrittenChildAIGrade = React.useCallback(
    async (q: SessionQuestion, draft: WrittenDraft, childIdx: number) => {
      const apiKey = localStorage.getItem("osler_gemini_api_key");
      if (!apiKey) return;
      const child = q.children?.[childIdx];
      if (!child) return;
      const childAns = draft.childAnswers?.[childIdx] ?? "";
      if (!childAns.trim()) return;
      setWrittenChildGrading({ qId: q.id, childIdx });
      try {
        const evaluation = await gradeWithAI({
          question: child.question || q.stem,
          modelAnswer: child.modelAnswer || q.modelAnswer,
          userAnswer: childAns,
        });
        const childEvals = [...(draft.childEvaluations ?? [])];
        childEvals[childIdx] = evaluation;
        onWrittenDraftChange(q.id, { ...draft, childEvaluations: childEvals });
      } catch {
        const manual = createManualEvaluation(childAns);
        const childEvals = [...(draft.childEvaluations ?? [])];
        childEvals[childIdx] = manual;
        onWrittenDraftChange(q.id, { ...draft, childEvaluations: childEvals });
      } finally {
        setWrittenChildGrading(null);
      }
    },
    [onWrittenDraftChange],
  );

  // Notes panel state — replaced sticky-note floating cards. Notes are
  // persisted in IndexedDB and shared across the profile page.
  const questionBodyRef = React.useRef<HTMLElement>(null);

  // Vertical snap navigation — handled by the reusable VerticalSnapGallery.
  // Works on touch (drag up/down) and desktop (wheel / trackpad), in both
  // single-page (continuous) and 2-page (split) tutor mode. The gallery
  // shows prev/current/next pages driven by a single motion value for the
  // Instagram-Reels / TikTok feel. Drag works from anywhere on the screen
  // that isn't an interactive control or a scrollable region mid-scroll.
  const canSwipeQuestion = !isPausedOrLocked;

  const goNext = React.useCallback(() => { onNext(); }, [onNext]);
  const goPrev = React.useCallback(() => { onPrev(); }, [onPrev]);

  // Horizontal swipe-to-tab — mobile 2-page (split) mode only. Lets the
  // user swipe sideways between the "Question" and "Explanation" tabs
  // instead of tapping the tab bar. See use-swipe-tabs.ts for why this
  // can't interfere with the vertical swipe-to-next-question gesture above
  // (or with continuous mode, where it's simply disabled — no tabs exist
  // there since the explanation is already inline in the page).
  //
  // On mobile the two panels are rendered as a horizontal carousel: both
  // are full-width, side-by-side, and a framer-motion `swipeX` value
  // translates the wrapper to reveal the active panel. The gesture
  // handler drives `swipeX` during drag for live follow, then springs
  // to the target on release / tab change.
  const mobileTabsActive = isMobile && submitted && isSplitMode;
  const swipeX = useMotionValue(0);
  const [carouselWidth, setCarouselWidth] = React.useState(0);

  // Measure viewport width for the carousel translation target.
  // Using window.innerWidth directly — reliable on mobile and avoids
  // ref timing issues with measuring a parent element.
  React.useEffect(() => {
    if (!mobileTabsActive) { setCarouselWidth(0); return; }
    const measure = () => setCarouselWidth(window.innerWidth);
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [mobileTabsActive]);

  // Animate to the active tab position when tab changes (button tap or swipe commit).
  React.useEffect(() => {
    if (!mobileTabsActive || carouselWidth === 0) return;
    const target = mobileTutorTab === "question" ? 0 : -carouselWidth;
    animate(swipeX, target, { type: "spring", stiffness: 350, damping: 35, mass: 0.8 });
  }, [mobileTutorTab, mobileTabsActive, carouselWidth, swipeX]);

  // Live drag-follow during horizontal swipe gesture.
  const handleSwipeProgress = React.useCallback((dx: number) => {
    if (!mobileTabsActive || carouselWidth === 0) return;
    const base = mobileTutorTab === "question" ? 0 : -carouselWidth;
    let x = base + dx;
    // Rubber-band at edges.
    if (mobileTutorTab === "question" && x > 0) x *= 0.25;
    if (mobileTutorTab === "answer" && x < -carouselWidth) {
      const over = x + carouselWidth;
      x = -carouselWidth + over * 0.25;
    }
    swipeX.set(x);
  }, [mobileTabsActive, mobileTutorTab, carouselWidth, swipeX]);

  // Spring back when the gesture ends without committing.
  const handleSwipeEnd = React.useCallback(() => {
    if (!mobileTabsActive || carouselWidth === 0) return;
    const base = mobileTutorTab === "question" ? 0 : -carouselWidth;
    animate(swipeX, base, { type: "spring", stiffness: 350, damping: 35, mass: 0.8 });
  }, [mobileTabsActive, mobileTutorTab, carouselWidth, swipeX]);

  const { tabSwipeRef } = useSwipeTabs<"question" | "answer">({
    tabs: ["question", "answer"],
    activeTab: mobileTutorTab,
    onTabChange: setMobileTutorTab,
    rtl,
    disabled: !mobileTabsActive || !canSwipeQuestion,
    onSwipeProgress: handleSwipeProgress,
    onSwipeEnd: handleSwipeEnd,
  });

  // ── Question content renderer ────────────────────────────────────────
  // Renders the full question card (header + stem + choices + engine view)
  // for the question at the given index. Used for the current card AND the
  // prev/next preview cards in the iOS-style swipe gallery.
  //
  // When `interactive` is false (preview cards), all interactive elements
  // are rendered with pointer-events disabled so the user can't accidentally
  // tap a choice on a non-current card.
  const renderQuestionContent = (qIdx: number, interactive: boolean) => {
    const question = session.questions[qIdx];
    if (!question) return null;
    const qSubmitted = readonly || session.revealed[qIdx] || false;
    const qSelected = session.answers[qIdx];
    const qIsMCQ = question.correct >= 0;
    // Per-question written detection: non-MCQ with rubric or modelAnswer
    // (handles mixed sessions where both quiz and written coexist).
    const qIsWritten = !qIsMCQ && (!!question.rubric?.length || !!question.modelAnswer);
    const qStrikethroughs = session.strikethroughs[qIdx] ?? [];
    const qHighlights = session.highlights?.[qIdx] ?? [];
    const qWrittenDraft = session.writtenDrafts[question.id] ?? {
      text: "",
      rubricChecked: question.rubric ? question.rubric.map(() => false) : [],
      submitted: false,
    };
    const qRating = session.ratings[question.id];
    const qRubricState = session.rubricState[question.id] ?? (question.rubric ? question.rubric.map(() => false) : []);
    const qTimeMs = session.questionTimes?.[question.id] ?? null;
    // Peer stats are per-question — resolve once, shared across all choice rows.
    const peerStat = qSubmitted
      ? peerStats?.[`${question.sourceUid ?? activeItem.uid}::${question.id}`]
      : undefined;

    // Per-question written verdict (for the inline explanation in continuous mode).
    const qWrittenVerdict: "pass" | "fail" | null =
      qWrittenDraft.evaluation?.manualVerdict === "pass" ? "pass"
      : qWrittenDraft.evaluation?.manualVerdict === "fail" ? "fail"
      : null;
    const qWrittenPassed = qWrittenVerdict === "pass" || (qWrittenVerdict === null && qWrittenDraft.evaluation?.passed === true);

    return (
      <div className="h-full overflow-y-auto osler-scroll pr-1 -mr-1 pb-4" style={{ touchAction: "none" }}>
        {/* Optional subtle difficulty indicator */}
        {question.difficulty && question.difficulty !== "standard" && (
          <div className="mb-2 text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
            {question.difficulty}
          </div>
        )}

        {/* Stem images */}
        {imageListOf(question.images).length > 0 && (
          <div className="flex flex-col gap-3 mb-4">
            {imageListOf(question.images).map((img) => (
              <ContentImageFigure
                key={img.src}
                img={img}
                category={questionAssetBase(question, activeItem).category}
                path={questionAssetBase(question, activeItem).path}
                className="rounded-xl border border-border max-h-[320px] w-auto mx-auto"
              />
            ))}
          </div>
        )}

        {/* Stem */}
        <div className="relative" data-walkthrough="qbank-question-stem">
          <div className="osler-prose" style={stemStyle} dir={dirForContent(activeItem.lang)} lang={activeItem.lang ?? undefined} data-hl-region="stem">
            <HighlightedContent
              html={renderQuestionText(question.stem, question, activeItem)}
              highlights={qHighlights}
              target="stem"
            />
          </div>
        </div>

        {/* Choices (MCQ only) */}
        {qIsMCQ ? (
          <div className="mt-6 space-y-3" data-walkthrough="qbank-options">
            <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
              {qSubmitted ? t("qbank.session.readOnly") : t("qbank.session.selectOne")}
            </div>
            {qSubmitted && (
              <div className="mb-3 flex items-center gap-4 text-xs text-muted-foreground bg-muted/30 rounded-lg px-3 py-2 border border-border">
                <div className="flex items-center gap-1.5">
                  {qSelected === question.correct ? (
                    <><Check className="size-3.5 text-success" /><span className="text-success font-semibold">{t("qbank.session.correct")}</span></>
                  ) : (
                    <><X className="size-3.5 text-destructive" /><span className="text-destructive font-semibold">{t("qbank.session.incorrect")}</span></>
                  )}
                </div>
                <div className="flex items-center gap-1.5">
                  <Timer className="size-3.5" />
                  {qTimeMs != null ? (
                    <span className="font-mono tabular-nums">{formatMs(qTimeMs)}</span>
                  ) : (
                    <span className="font-mono tabular-nums opacity-60">—</span>
                  )}
                  <span className="opacity-60">{t("qbank.session.timeSpent")}</span>
                </div>
              </div>
            )}
            {question.choices.map((choice, idx) => {
              const isSelected = qSelected === idx;
              const isCorrect = idx === question.correct;
              const showResult = qSubmitted;
              const hasStrikethrough = qStrikethroughs.includes(idx);
              let stateClass = "border-border bg-card hover:border-primary/50 hover:bg-primary/5";
              let letterBg = "border-border bg-background text-muted-foreground";
              let letterContent: React.ReactNode = choiceLetter(idx, activeItem.lang ?? "en");

              if (showResult) {
                if (isCorrect) {
                  stateClass = "border-success bg-success/10";
                  letterBg = "bg-success text-success-foreground border-success";
                  letterContent = <Check className="size-4" />;
                } else if (isSelected && !isCorrect) {
                  stateClass = "border-destructive bg-destructive/10";
                  letterBg = "bg-destructive text-destructive-foreground border-destructive";
                  letterContent = <X className="size-4" />;
                } else {
                  stateClass = "border-border bg-card opacity-60";
                }
              } else if (isSelected) {
                stateClass = "border-primary bg-primary/5 ring-2 ring-primary/15";
                letterBg = "bg-primary text-primary-foreground border-primary";
              }

              return (
                <motion.button
                  key={idx}
                  data-choice-idx={idx}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ ...MOTION_TRANSITION.quick, delay: Math.min(idx * 0.04, 0.24) }}
                  whileTap={qSubmitted || !interactive ? undefined : { scale: 0.99 }}
                  disabled={qSubmitted || !interactive}
                  onClick={() => {
                    if (!interactive) return;
                    if (longPressFired.current) {
                      longPressFired.current = false;
                      return;
                    }
                    onSelect(idx);
                  }}
                  onContextMenu={(e) => {
                    if (!interactive) return;
                    e.preventDefault();
                    if (longPressFired.current) {
                      longPressFired.current = false;
                      return;
                    }
                    onToggleStrikethrough(idx);
                  }}
                  onTouchStart={(e) => interactive && startLongPress(idx, e)}
                  onTouchEnd={cancelLongPress}
                  onTouchMove={onChoiceTouchMove}
                  className={`w-full text-start p-3 sm:p-3.5 rounded-xl border-2 transition-colors flex items-start gap-3 ${stateClass} ${
                    qSubmitted ? "cursor-default" : "cursor-pointer"
                  } ${hasStrikethrough ? "opacity-60" : ""} osler-touch-target`}
                >
                  <div className={`size-7 rounded-full border-2 flex items-center justify-center text-sm font-semibold shrink-0 ${letterBg}`}>
                    {letterContent}
                  </div>
                  <div
                    className={`flex-1 min-w-0 osler-prose ${quizSettingsState.textAffectsChoices ? "" : "text-[14px] leading-relaxed"} pt-0.5 select-text ${hasStrikethrough ? "line-through text-muted-foreground" : ""}`}
                    style={choiceStyle}
                    dir={dirForContent(activeItem.lang)}
                    lang={activeItem.lang ?? undefined}
                  >
                    <HighlightedContent
                      html={renderQuestionText(choice, question, activeItem)}
                      highlights={qHighlights}
                      target={`choice-${idx}`}
                    />
                    {imageListOf(question.choiceImages?.[idx]).length > 0 && (
                      <div className="flex flex-col gap-2 mt-2">
                        {imageListOf(question.choiceImages?.[idx]).map((img) => (
                          <ContentImageFigure
                            key={img.src}
                            img={img}
                            category={questionAssetBase(question, activeItem).category}
                            path={questionAssetBase(question, activeItem).path}
                            className="rounded-lg border border-border max-h-[200px] w-auto"
                          />
                        ))}
                      </div>
                    )}
                  </div>
                  {showResult && (
                    <PeerChoicePercent stat={peerStat} idx={idx} optionsCount={question.choices.length} />
                  )}
                </motion.button>
              );
            })}
          </div>
        ) : null}

        {/* Written engine: textarea + grading (interactive only — too complex for previews) */}
        {interactive && qIsWritten && (
          <WrittenEngineView
            contentDir={dirForContent(activeItem.lang)}
            question={question}
            draft={qWrittenDraft}
            submitted={qSubmitted}
            grading={writtenAIGrading === question.id}
            onTextChange={(text) =>
              onWrittenDraftChange(question.id, { ...qWrittenDraft, text })
            }
            onRubricToggle={(idx) => {
              const cur = qWrittenDraft.rubricChecked;
              const next = [...cur];
              while (next.length < (question.rubric?.length ?? 0)) next.push(false);
              next[idx] = !next[idx];
              onWrittenDraftChange(question.id, { ...qWrittenDraft, rubricChecked: next });
            }}
            onGradeAI={() => handleWrittenAIGrade(question, qWrittenDraft)}
            onGradeManual={() => {
              const eval_ = createManualEvaluation(qWrittenDraft.text);
              onWrittenDraftChange(question.id, {
                ...qWrittenDraft,
                submitted: true,
                evaluation: eval_,
              });
            }}
            onPassFail={(v) => {
              const ev = qWrittenDraft.evaluation;
              if (!ev) {
                const manual = createManualEvaluation(qWrittenDraft.text);
                manual.manualVerdict = v;
                manual.passed = v === "pass";
                onWrittenDraftChange(question.id, {
                  ...qWrittenDraft,
                  submitted: true,
                  evaluation: manual,
                });
              } else {
                onWrittenDraftChange(question.id, {
                  ...qWrittenDraft,
                  evaluation: { ...ev, manualVerdict: v, passed: v === "pass" },
                });
              }
            }}
            onChildTextChange={(childIdx, text) => {
              const childAnswers = [...(qWrittenDraft.childAnswers ?? [])];
              while (childAnswers.length <= childIdx) childAnswers.push("");
              childAnswers[childIdx] = text;
              onWrittenDraftChange(question.id, { ...qWrittenDraft, childAnswers });
            }}
            onChildGradeAI={(childIdx) => handleWrittenChildAIGrade(question, qWrittenDraft, childIdx)}
            onChildGradeManual={(childIdx) => {
              const childAns = qWrittenDraft.childAnswers?.[childIdx] ?? "";
              const eval_ = createManualEvaluation(childAns);
              const childEvals = [...(qWrittenDraft.childEvaluations ?? [])];
              childEvals[childIdx] = eval_;
              onWrittenDraftChange(question.id, { ...qWrittenDraft, childEvaluations: childEvals });
            }}
            onChildPassFail={(childIdx, v) => {
              const childEvals = [...(qWrittenDraft.childEvaluations ?? [])];
              const ev = childEvals[childIdx];
              if (ev) {
                childEvals[childIdx] = { ...ev, manualVerdict: v, passed: v === "pass" };
                onWrittenDraftChange(question.id, { ...qWrittenDraft, childEvaluations: childEvals });
              }
            }}
            childGrading={writtenChildGrading?.qId === question.id ? writtenChildGrading.childIdx : null}
          />
        )}

        {/* OSCE engine: red flags + differential + rubric (interactive only) */}
        {interactive && session.engine === "osce" && (
          <OsceEngineView
            contentDir={dirForContent(activeItem.lang)}
            question={question}
            rubricState={qRubricState}
            submitted={qSubmitted}
            onRubricToggle={(idx) => onRubricToggle(question.id, idx)}
          />
        )}

        {/* Flashcard: rating buttons (after reveal, interactive only) */}
        {interactive && session.engine === "flashcard" && qSubmitted && (
          <div className="mt-6">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
              {t("qbank.written.rateCard")}
            </h4>
            <div className="grid grid-cols-3 gap-2">
              <button
                onClick={() => onRate(question.id, "hard")}
                className={`px-3 py-2 rounded-lg text-sm font-medium border-2 transition-all ${
                  qRating === "hard"
                    ? "border-destructive bg-destructive/10 text-destructive"
                    : "border-border hover:border-destructive/40"
                }`}
              >
                <X className="size-4 mx-auto mb-1" />
                {t("flash.session.rateHard")}
              </button>
              <button
                onClick={() => onRate(question.id, "unknown")}
                className={`px-3 py-2 rounded-lg text-sm font-medium border-2 transition-all ${
                  qRating === "unknown"
                    ? "border-warning bg-warning/10 text-warning"
                    : "border-border hover:border-warning/40"
                }`}
              >
                <Eye className="size-4 mx-auto mb-1" />
                {t("qbank.session.review")}
              </button>
              <button
                onClick={() => onRate(question.id, "easy")}
                className={`px-3 py-2 rounded-lg text-sm font-medium border-2 transition-all ${
                  qRating === "easy"
                    ? "border-success bg-success/10 text-success"
                    : "border-border hover:border-success/40"
                }`}
              >
                <Check className="size-4 mx-auto mb-1" />
                {t("flash.session.rateEasy")}
              </button>
            </div>
          </div>
        )}

        {/* ── Inline explanation (continuous mode only) ──────────────
            In continuous mode the explanation lives INSIDE the page so
            the user can drag from it to scroll/snap. In split mode it
            lives in the right column (handled separately below).
            Only rendered for the current (interactive) card to avoid
            spoiling the next question's answer. Uses per-question state
            (qSubmitted, qSelected, qHighlights, qWrittenDraft) so it's
            accurate for any question index.
            Spacing: mt-3 (tight, not mt-6), border-t border-border
            (soft separator), py-3 sm:py-4 (compact on mobile). */}
        {interactive && qSubmitted && !useSplitExplanation && (
          <div className="mt-3 border-t border-border bg-muted/20 py-3 sm:py-4 px-4 sm:px-6 lg:px-8 -mr-1 rounded-lg">
            <div className={contentAlignClass}>
              {qIsWritten ? (
                <WrittenEvaluationPanel
                  draft={qWrittenDraft}
                  question={question}
                  passed={qWrittenPassed}
                  isManual={qWrittenDraft.evaluation?.score === null}
                  rubricState={qRubricState}
                  onRubricToggle={(idx) => onRubricToggle(question.id, idx)}
                  onPassFail={(v) => {
                    const ev = qWrittenDraft.evaluation;
                    if (!ev) {
                      const manual = createManualEvaluation(qWrittenDraft.text);
                      manual.manualVerdict = v;
                      manual.passed = v === "pass";
                      onWrittenDraftChange(question.id, {
                        ...qWrittenDraft,
                        submitted: true,
                        evaluation: manual,
                      });
                    } else {
                      onWrittenDraftChange(question.id, {
                        ...qWrittenDraft,
                        evaluation: { ...ev, manualVerdict: v, passed: v === "pass" },
                      });
                    }
                  }}
                  onChildPassFail={(childIdx, v) => {
                    const childEvals = [...(qWrittenDraft.childEvaluations ?? [])];
                    const ev = childEvals[childIdx];
                    if (ev) {
                      childEvals[childIdx] = { ...ev, manualVerdict: v, passed: v === "pass" };
                      onWrittenDraftChange(question.id, { ...qWrittenDraft, childEvaluations: childEvals });
                    }
                  }}
                />
              ) : (
                <ExplanationCard q={question} selected={qSelected} nonMcq={!qIsMCQ} highlights={qHighlights} packUid={activeItem.uid} questionIdx={qIdx} lang={activeItem.lang ?? "en"} item={activeItem} />
              )}
            </div>
          </div>
        )}

        {/* Non-MCQ explanation panel — exam mode (not tutor).
            Shown inline in continuous mode for non-MCQ questions. */}
        {interactive && qSubmitted && !qIsMCQ && session.mode !== "tutor" && !useSplitExplanation && (
          <div className="mt-3 border-t border-border bg-muted/20 py-3 sm:py-4 px-4 sm:px-6 lg:px-8 -mr-1 rounded-lg">
            <div className={contentAlignClass}>
              {qIsWritten ? (
                <WrittenEvaluationPanel
                  draft={qWrittenDraft}
                  question={question}
                  passed={qWrittenPassed}
                  isManual={qWrittenDraft.evaluation?.score === null}
                  rubricState={qRubricState}
                  onRubricToggle={(idx) => onRubricToggle(question.id, idx)}
                  onPassFail={(v) => {
                    const ev = qWrittenDraft.evaluation;
                    if (!ev) {
                      const manual = createManualEvaluation(qWrittenDraft.text);
                      manual.manualVerdict = v;
                      manual.passed = v === "pass";
                      onWrittenDraftChange(question.id, {
                        ...qWrittenDraft,
                        submitted: true,
                        evaluation: manual,
                      });
                    } else {
                      onWrittenDraftChange(question.id, {
                        ...qWrittenDraft,
                        evaluation: { ...ev, manualVerdict: v, passed: v === "pass" },
                      });
                    }
                  }}
                />
              ) : (
                <ExplanationCard q={question} selected={undefined} nonMcq highlights={qHighlights} packUid={activeItem.uid} questionIdx={qIdx} lang={activeItem.lang ?? "en"} item={activeItem} />
              )}
            </div>
          </div>
        )}
      </div>
    );
  };


  // Reset mobile tutor tab when changing questions
  React.useEffect(() => {
    setMobileTutorTab("question");
  }, [activeItem.uid, session.current]);

  // Highlight mode: auto-apply on stable text selection (mouse + touch).
  //
  // On mouse/pointer devices we wait for `mouseup` so the highlight is not
  // applied mid-drag (while the button is still held). On touch devices we
  // use `selectionchange` with a slightly longer debounce (500ms) so the
  // highlight only applies once the user has finished adjusting the
  // selection — `touchend` fires before iOS Safari finalises the range.
  React.useEffect(() => {
    if (!highlightMode) return;
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;

    const isTouch = () =>
      typeof window !== "undefined" &&
      window.matchMedia("(pointer: coarse)").matches;

    const applySelection = () => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || sel.rangeCount === 0) return;
      const text = sel.toString().trim();
      if (!text) return;

      const range = sel.getRangeAt(0);
      // Identify the region the selection lives in by walking up to the
      // nearest marker — the stem wrapper, a choice button, or the
      // explanation card. Ranges are then measured against that region's
      // *rendered* text (the same text painting matches against), so
      // markdown syntax in the raw source can never shift offsets.
      let target = "stem";
      let el: HTMLElement | null = range.startContainer instanceof Text
        ? range.startContainer.parentElement
        : (range.startContainer as HTMLElement);
      let regionEl: HTMLElement | null = null;
      while (el) {
        if (!regionEl && el.getAttribute?.("data-hl-region") === "stem") regionEl = el;
        const ci = el.getAttribute("data-choice-idx");
        if (ci !== null) {
          const idx = parseInt(ci, 10);
          target = `choice-${idx}`;
          regionEl = el;
          break;
        }
        if (el.getAttribute("data-explanation") !== null) {
          target = "explanation";
          regionEl = el;
          break;
        }
        el = el.parentElement;
      }

      // Absolute offsets inside the region's rendered text.
      const head = document.createRange();
      head.selectNodeContents(regionEl ?? document.body);
      const endRange = range.cloneRange();
      endRange.collapse(false);
      head.setEnd(endRange.startContainer, endRange.startOffset);
      const absEnd = head.toString().length;
      const ranges = [{ start: absEnd - text.length, end: absEnd }];

      const hl: HighlightItem = {
        id: crypto.randomUUID(),
        color: highlightColor,
        text,
        target,
        ranges,
        createdAt: new Date().toISOString(),
      };
      onHighlightAdd(session.current, hl);
      window.getSelection()?.removeAllRanges();
    };

    const onMouseUp = () => {
      if (isTouch()) return;
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(applySelection, 0);
    };

    const onSelectionChange = () => {
      if (!isTouch()) return;
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(applySelection, 500);
    };

    document.addEventListener("mouseup", onMouseUp);
    document.addEventListener("selectionchange", onSelectionChange);
    return () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      document.removeEventListener("mouseup", onMouseUp);
      document.removeEventListener("selectionchange", onSelectionChange);
    };
  }, [highlightMode, highlightColor, activeItem.uid, session.current, q]);

  // Eraser mode: click/tap a highlight span to remove it.
  // We listen to both `click` (mouse) and `touchend` (touch devices) so
  // erasing works on phones/tablets. A small delay on touchend prevents the
  // subsequent synthetic click event from double-firing.
  React.useEffect(() => {
    if (!eraserMode) return;
    const removeHighlight = (target: EventTarget | null): boolean => {
      const el = target as HTMLElement;
      if (!el) return false;
      const span = el.closest("[data-osler-hl-id]") as HTMLElement | null;
      if (span) {
        const id = span.getAttribute("data-osler-hl-id");
        if (id) {
          onHighlightRemove(session.current, id);
          return true;
        }
      }
      return false;
    };
    const onClick = (e: MouseEvent) => {
      const removed = removeHighlight(e.target);
      if (removed) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    const onTouchEnd = (e: TouchEvent) => {
      const touch = e.changedTouches[0];
      if (!touch) return;
      const el = document.elementFromPoint(touch.clientX, touch.clientY);
      // Prevent the synthetic click that follows touchend
      if (el && removeHighlight(el)) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    document.addEventListener("click", onClick, true);
    document.addEventListener("touchend", onTouchEnd, true);
    return () => {
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("touchend", onTouchEnd, true);
    };
  }, [eraserMode, activeItem.uid, session.current]);

  // Eraser affordance: ring highlights while the eraser tool is active
  React.useEffect(() => {
    document.body.classList.toggle("osler-hl-eraser", eraserMode);
    return () => document.body.classList.remove("osler-hl-eraser");
  }, [eraserMode]);

  const addStickyNote = React.useCallback(() => {
    // Legacy sticky-note hotkey is repurposed: it now toggles the notes
    // panel so the user can write a markdown note for the current question.
    onToggleNotes();
  }, [onToggleNotes]);

  // Keyboard shortcuts — resolved against the user's configured bindings so
  // everything shown in Settings → Keyboard is honored (and rebindable).
  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (isTextInput(e.target)) return;
      const actionId = matchSingleChordBinding(e, bindings, "qbank");
      // Navigation + help are the only shortcuts in readonly (review) mode.
      if (readonly) {
        if (actionId === "qbank.prev") { e.preventDefault(); goPrev(); }
        else if (actionId === "qbank.next") { e.preventDefault(); goNext(); }
        else if (actionId === "qbank.shortcutsHelp") { e.preventDefault(); setShowShortcuts((s) => !s); }
        return;
      }
      // Plain Enter always submits — the standard form convention, even if the
      // configured submit binding is a modifier chord.
      if (e.key === "Enter" && !e.ctrlKey && !e.metaKey && !e.altKey && !submitted) {
        if (isMCQ ? selected !== undefined : true) {
          e.preventDefault();
          onSubmit();
        }
        return;
      }
      switch (actionId) {
        case "qbank.prev": e.preventDefault(); goPrev(); break;
        case "qbank.next": e.preventDefault(); goNext(); break;
        case "qbank.flag": e.preventDefault(); onToggleFlag(); break;
        case "qbank.submit":
          if (!submitted && (isMCQ ? selected !== undefined : true)) {
            e.preventDefault();
            onSubmit();
          }
          break;
        case "qbank.aiAssistant": e.preventDefault(); onToggleAiAssistant(); break;
        case "qbank.highlight": e.preventDefault(); setTool((t) => (t && t !== ERASER_TOOL ? null : color)); break;
        case "qbank.eraser": e.preventDefault(); setTool((t) => (t === ERASER_TOOL ? null : ERASER_TOOL)); break;
        case "qbank.notes": e.preventDefault(); onToggleNotes(); break;
        case "qbank.notesNew": e.preventDefault(); onNewNote(); break;
        case "qbank.quizSettings": e.preventDefault(); onToggleQuizSettings(); break;
        case "qbank.shortcutsHelp": e.preventDefault(); setShowShortcuts((s) => !s); break;
        case "qbank.answer1": case "qbank.answer2": case "qbank.answer3":
        case "qbank.answer4": case "qbank.answer5": {
          if (isMCQ && !submitted) {
            const idx = parseInt(actionId.slice(-1), 10) - 1;
            if (idx < q.choices.length) { e.preventDefault(); onSelect(idx); }
          }
          break;
        }
        default: return;
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [q, isMCQ, submitted, selected, onToggleFlag, goPrev, goNext, onSelect, onSubmit, onToggleAiAssistant, onToggleNotes, onNewNote, onToggleQuizSettings, setTool, readonly, bindings]);

  const currentHighlights = session.highlights?.[session.current] ?? [];
  const strikethroughs = session.strikethroughs[session.current] ?? [];

  // Long-press (touch) to strike through an option — mirrors the desktop
  // right-click context-menu behaviour. A ref flag prevents the synthetic
  // click that follows a long-press from also selecting the option.
  const longPressTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressFired = React.useRef(false);
  const longPressStart = React.useRef({ x: 0, y: 0 });
  const startLongPress = React.useCallback(
    (idx: number, e: React.TouchEvent) => {
      if (submitted) return;
      const touch = e.touches[0];
      longPressStart.current = { x: touch.clientX, y: touch.clientY };
      longPressFired.current = false;
      longPressTimer.current = setTimeout(() => {
        longPressFired.current = true;
        onToggleStrikethrough(idx);
      }, 500);
    },
    [submitted, onToggleStrikethrough]
  );
  const cancelLongPress = React.useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }, []);
  const onChoiceTouchMove = (e: React.TouchEvent) => {
    const touch = e.touches[0];
    const dx = touch.clientX - longPressStart.current.x;
    const dy = touch.clientY - longPressStart.current.y;
    if (dx * dx + dy * dy > 100) cancelLongPress();
  };
  React.useEffect(() => cancelLongPress, [cancelLongPress]);

  if (!q) return null;



  // Written draft
  const writtenDraft = session.writtenDrafts[q.id] ?? {
    text: "",
    rubricChecked: q.rubric ? q.rubric.map(() => false) : [],
    submitted: false,
  };
  const writtenVerdict: "pass" | "fail" | null =
    writtenDraft.evaluation?.manualVerdict === "pass"
      ? "pass"
      : writtenDraft.evaluation?.manualVerdict === "fail"
        ? "fail"
        : null;
  const writtenPassed = writtenVerdict === "pass" || (writtenVerdict === null && writtenDraft.evaluation?.passed === true);
  const rubricState = session.rubricState[q.id] ?? (q.rubric ? q.rubric.map(() => false) : []);
  const rating = session.ratings[q.id];

  const answeredCount = Object.keys(session.answers).filter(
    (k) => session.answers[+k] !== undefined
  ).length;
  const flaggedCount = Object.values(session.flagged).filter(Boolean).length;
  const correctCount = session.questions.filter(
    (qq, i) => session.revealed[i] && session.answers[i] === qq.correct
  ).length;
  const incorrectCount = answeredCount - correctCount;
  const progressPct = session.questions.length
    ? Math.round((answeredCount / session.questions.length) * 100)
    : 0;

  return (
    <div className="fixed inset-0 z-50 bg-background flex flex-col safe-screen">
      {/* ── Top bar (exam-mode navy) ────────────────────────────────────────
          All icon buttons in this bar use size-7 (matching the graduation cap
          button) for visual consistency. The mobile-only navigator button uses
          size-8 to give a slightly larger touch target on phones (it's the
          only way to access the navigator on mobile). */}
      <header
        data-walkthrough="qbank-session-bar"
        className="h-12 flex items-center pl-3 sm:pl-4 pr-1 sm:pr-2 gap-1.5 sm:gap-2 shrink-0 border-b border-primary-foreground/10 safe-pt"
        style={{ backgroundColor: "var(--primary)", color: "var(--primary-foreground)" }}
      >
        <button onClick={onExitRequest} className="flex items-center gap-2 hover:opacity-80 transition-opacity shrink-0" title={t("qbank.session.backToHub")}>
          <div className="size-7 rounded-lg bg-primary-foreground/15 flex items-center justify-center">
            <GraduationCap className="size-4" />
          </div>
          <span className="hidden sm:inline text-sm font-semibold tracking-tight">{t("nav.qbank")}</span>
        </button>

        <div className="h-5 w-px bg-primary-foreground/20 hidden sm:block" />

        <div className="hidden sm:flex items-center gap-2 text-xs opacity-90">
          <span className="font-medium">{activeItem.title}</span>
          <span className="opacity-50">·</span>
          <span>{session.mode === "timed" ? t("qbank.session.timedMode") : t("qbank.session.tutorMode")}</span>
        </div>

        <button
          onClick={() => { haptic("selection"); onNavMobileChange(!navOpenMobile); }}
          data-walkthrough="qbank-nav-mobile"
          className={`md:hidden size-8 rounded-lg flex items-center justify-center me-1 shrink-0 transition-colors ${
            navOpenMobile
              ? "bg-primary-foreground/30 ring-1 ring-inset ring-primary-foreground/40"
              : "bg-primary-foreground/15 hover:bg-primary-foreground/25"
          }`}
          title={t("qbank.home.questionNavigator")}
          aria-label={t("qbank.home.questionNavigator")}
          aria-pressed={navOpenMobile}
        >
          <ListChecks className="size-4" />
        </button>

        <div
          className="flex-1 min-w-0 overflow-hidden flex items-center justify-center"
          role="status"
          aria-live="polite"
          aria-label={t("qbank.session.question", { n: session.current + 1, total: session.questions.length })}
        >
          <div className="min-w-0 flex items-center gap-2">
            <span className="hidden sm:block text-sm font-semibold tracking-wide truncate">
              {t("qbank.session.question", { n: session.current + 1, total: session.questions.length })}
            </span>
            <span className="sm:hidden text-xs font-semibold tabular-nums whitespace-nowrap" aria-hidden="true">
              {session.current + 1}/{session.questions.length}
            </span>
            {readonly && (
              <span className="hidden sm:inline-flex text-[11px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full bg-primary-foreground/15 text-primary-foreground/80">
                {t("qbank.review.title")}
              </span>
            )}
          </div>
        </div>

        {/* Quiz settings button — opens full settings panel */}
        <button
          data-walkthrough="qbank-settings"
          onClick={onToggleQuizSettings}
          className={`size-7 rounded-lg flex items-center justify-center transition-colors shrink-0 ${
            readonly ? "me-1.5 sm:me-2" : ""
          } ${
            quizSettingsOpen
              ? "bg-primary-foreground/30 ring-1 ring-inset ring-primary-foreground/40"
              : "bg-primary-foreground/15 hover:bg-primary-foreground/25"
          }`}
          title={t("qbank.settings.title")}
          aria-label={t("qbank.settings.title")}
          aria-pressed={quizSettingsOpen}
        >
          <Sliders className="size-3.5" />
        </button>

        {!readonly && (
          <div className="flex items-center gap-1">
            <QBankTimer
              key={session.startedAt}
              mode={session.mode}
              startedAt={session.startedAt}
              timeEndsAt={session.timeEndsAt}
              onExpire={onTimeUp}
            />
            <button
              onClick={onTogglePause}
              className="size-7 rounded-lg bg-primary-foreground/15 hover:bg-primary-foreground/25 flex items-center justify-center transition-colors shrink-0"
              title={isPausedOrLocked ? t("qbank.session.resume") : t("qbank.session.pause")}
              aria-label={isPausedOrLocked ? t("qbank.session.resume") : t("qbank.session.pause")}
            >
              {isPausedOrLocked ? <Play className="size-3.5" /> : <Pause className="size-3.5" />}
            </button>
          </div>
        )}

        {!readonly && (
          <div className="flex items-center gap-1.5 sm:gap-2" data-walkthrough="qbank-annotate">
            {/* Unified highlighter: colors + eraser tool */}
            <HighlighterToolbar
              tone="header"
              control={{
                tool,
                color,
                count: currentHighlights.length,
                onToolChange: setTool,
                onColorChange: setColor,
                onClearAll: onHighlightClearAll,
              }}
            />

            {/* Notes button — opens notes sidebar (replaces sticky notes) */}
            <button
              onClick={onToggleNotes}
              className={`size-7 rounded-lg flex items-center justify-center transition-colors shrink-0 ${
                notesOpen
                  ? "bg-primary-foreground/30 ring-1 ring-inset ring-primary-foreground/40"
                  : "bg-primary-foreground/15 hover:bg-primary-foreground/25"
              }`}
              title={t("qbank.notes.title")}
              aria-label={t("qbank.notes.title")}
              aria-pressed={notesOpen}
            >
              <NotebookPen className="size-3.5" />
            </button>
          </div>
        )}
      </header>

      {/* ── Body: Question panel ─────────────────────────────────────────── */}
      <div className="flex flex-1 min-h-0 relative">

        {/* Question navigator — mobile bottom sheet (shadcn, no backdrop
            blur). Slides up natively, respects safe areas, and gives the
            whole palette to the fingers. Desktop keeps the left strip. */}
        <QuestionNavigatorSheet
          open={navOpenMobile}
          onOpenChange={onNavMobileChange}
          session={session}
          answeredCount={answeredCount}
          flaggedCount={flaggedCount}
          correctCount={correctCount}
          incorrectCount={incorrectCount}
          progressPct={progressPct}
          onJumpTo={onJumpTo}
          onEndTest={onFinish}
          readonly={readonly}
        />

        {/* Simple question navigator (left strip) */}
        <div className="hidden md:flex flex-col w-12 shrink-0 border-r border-border bg-sidebar" data-walkthrough="qbank-nav-strip">
          <div className="flex-1 overflow-y-auto osler-scroll p-1 space-y-0.5">
            {session.questions.map((_, i) => {
              const ans = session.answers[i];
              const isCurrent = i === session.current;
              const isFlagged = session.flagged[i];
              const isRevealed = session.revealed[i];
              const isCorrect = ans !== undefined && session.questions[i]?.correct === ans;
              const isIncorrect = ans !== undefined && !isCorrect;
              let bg = "bg-sidebar text-muted-foreground border-transparent";
              if (isCurrent) bg = "ring-2 ring-primary bg-sidebar-accent text-foreground";
              else if (isFlagged) bg = "bg-warning/15 text-warning border-warning/30";
              else if (isRevealed && isCorrect) bg = "bg-success/15 text-success border-success/30";
              else if (isRevealed && isIncorrect) bg = "bg-destructive/15 text-destructive border-destructive/30";
              else if (ans !== undefined) bg = "bg-primary/15 text-primary border-primary/30";
              return (
                <button
                  key={i}
                  onClick={() => onJumpTo(i)}
                  className={`w-full aspect-square rounded-md text-[11px] font-semibold border transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${bg}`}
                  title={`Q${i + 1}`}
                >
                  {i + 1}
                </button>
              );
            })}
          </div>
        </div>

        {/* Center — Question panel */}
        <main ref={questionBodyRef} className="flex-1 min-w-0 flex flex-col bg-background">
          <AnimatePresence>
            {isPausedOrLocked && !readonly && (
              <motion.div
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                className="absolute inset-0 z-30 bg-background/95 flex items-center justify-center"
              >
                <div className="text-center max-w-md">
                  <div className="size-16 rounded-full bg-warning/15 border-2 border-warning/30 flex items-center justify-center mx-auto mb-4">
                    <Pause className="size-7 text-warning" />
                  </div>
                  <h3 className="text-xl font-semibold text-foreground">{t("qbank.home.testPaused")}</h3>
                  <p className="text-sm text-muted-foreground mt-2 mb-6">
                    {t("qbank.home.testPausedDesc")}
                  </p>
                  <div className="flex flex-col sm:flex-row gap-2 sm:justify-center">
                    <Button onClick={onTogglePause} variant="default" className="rounded-xl">
                      <Play className="size-4 me-2" /> {t("qbank.home.resumeTest")}
                    </Button>
                    <Button onClick={onSaveAndExit} variant="outline" className="rounded-xl">
                      <LogOut className="size-4 me-2" /> {t("qbank.home.saveAndExit")}
                    </Button>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Mobile tab switcher — shown only on phones in split mode after submit */}
          {submitted && isSplitMode && (
            <div className="md:hidden flex border-b border-border bg-muted/30">
              <button
                onClick={() => setMobileTutorTab("question")}
                className={`flex-1 py-2.5 text-xs font-medium transition-colors ${
                  mobileTutorTab === "question" ? "text-primary border-b-2 border-primary" : "text-muted-foreground"
                }`}
              >
                {t("qbank.session.questionTab")}
              </button>
              <button
                onClick={() => setMobileTutorTab("answer")}
                className={`flex-1 py-2.5 text-xs font-medium transition-colors ${
                  mobileTutorTab === "answer" ? "text-primary border-b-2 border-primary" : "text-muted-foreground"
                }`}
              >
                {t("qbank.session.explanation")}
              </button>
            </div>
          )}

          <div
            ref={tabSwipeRef}
            className={`flex-1 min-h-0 osler-qbank-split ${
              submitted && isSplitMode
                ? isMobile ? "overflow-hidden" : "flex flex-row"
                : "flex flex-col"
            }`}
            dir={rtl ? "rtl" : "ltr"}
            lang={activeItem.lang ?? "en"}
          >
            {q ? (
              <>
                {/* Carousel wrapper — on mobile in split mode this is a
                    horizontal motion.div driven by swipeX; on desktop it's
                    contents (transparent to layout). */}
                <motion.div
                  style={mobileTabsActive ? { x: swipeX } : undefined}
                  className={mobileTabsActive ? "flex h-full" : "contents"}
                >
                  {/* Question column.
                      On mobile in split mode: full-width inside the carousel.
                      On desktop in split mode: 55% side-by-side.
                      In continuous mode: full-width, single column. */}
                  <div
                    className={`osler-qbank-qcol ${(activeItem.lang ?? "en") === "ar" ? "osler-content-ar" : ""} ${
                      submitted && isSplitMode
                        ? mobileTabsActive ? "w-full flex-none" : "w-[55%] border-e border-border"
                        : "flex-1"
                    } flex flex-col min-h-0`}
                  >
                    {mobileTabsActive && mobileTutorTab === "answer" ? (
                      <div className="flex-1 min-h-0" />
                    ) : (
                      <div className={`flex-1 min-h-0 flex flex-col px-4 sm:px-6 ${submitted && isSplitMode ? "py-4" : "lg:px-8 py-6"} ${contentAlignClass}`}>
                        <VerticalSnapGallery
                          items={session.questions}
                          currentIndex={session.current}
                          onNavigateNext={goNext}
                          onNavigatePrev={goPrev}
                          disabled={!canSwipeQuestion}
                          rtl={rtl}
                          threshold={90}
                          className="flex-1 min-h-0 w-full"
                          cardClassName="w-full h-full"
                          renderItem={(_item, idx, interactive) =>
                            renderQuestionContent(idx, interactive)
                          }
                        />
                      </div>
                    )}
                  </div>

                  {/* Right column: explanation / evaluation (split-screen in tutor mode only).
                      In continuous mode the explanation is rendered inside each
                      page by renderQuestionContent — not here.

                      On mobile in split mode this column is full-width and
                      contains a VerticalSnapGallery so the user can swipe
                      vertically to see the next/prev question's explanation.
                      On desktop it's a plain scrollable 45%-wide column. */}
                  {submitted && isSplitMode && (
                    <div
                      className={`osler-qbank-acol ${
                        mobileTabsActive ? "w-full flex-none" : "w-[45%]"
                      } flex flex-col min-h-0 bg-muted/20`}
                    >
                      {mobileTabsActive && mobileTutorTab === "question" ? (
                        <div className="flex-1 min-h-0" />
                      ) : mobileTabsActive ? (
                        <div className="flex-1 min-h-0 flex flex-col">
                          <VerticalSnapGallery
                            items={session.questions}
                            currentIndex={session.current}
                            onNavigateNext={goNext}
                            onNavigatePrev={goPrev}
                            disabled={!canSwipeQuestion}
                            rtl={rtl}
                            threshold={90}
                            className="flex-1 min-h-0 w-full"
                            cardClassName="w-full h-full"
                            renderItem={(_item, idx) => {
                              const eq = session.questions[idx];
                              if (!eq) return null;
                              const eqSubmitted = readonly || session.revealed[idx] || false;
                              const eqSelected = session.answers[idx];
                              const eqIsMCQ = eq.correct >= 0;
                              const eqIsWritten = !eqIsMCQ && (!!eq.rubric?.length || !!eq.modelAnswer);
                              const eqHighlights = session.highlights?.[idx] ?? [];
                              return (
                                <div className="h-full overflow-y-auto osler-scroll p-2 pb-6" style={{ touchAction: "none" }}>
                                   {eqIsWritten ? (
                                      <WrittenEvaluationPanel
                                        draft={session.writtenDrafts[eq.id] ?? { text: "", rubricChecked: eq.rubric ? eq.rubric.map(() => false) : [], submitted: false }}
                                        question={eq}
                                        passed={false}
                                        isManual
                                        rubricState={session.rubricState[eq.id] ?? (eq.rubric ? eq.rubric.map(() => false) : [])}
                                        onRubricToggle={() => {}}
                                        onPassFail={() => {}}
                                        onChildPassFail={() => {}}
                                      />
                                    ) : eqSubmitted ? (
                                      <ExplanationCard q={eq} selected={eqSelected} nonMcq={!eqIsMCQ} highlights={eqHighlights} packUid={activeItem.uid} questionIdx={idx} lang={activeItem.lang ?? "en"} item={activeItem} />
                                    ) : (
                                      <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
                                        {t("qbank.session.selectOne")}
                                      </div>
                                    )}
                                </div>
                              );
                            }}
                          />
                        </div>
                      ) : (
                        <div className="flex-1 overflow-y-auto osler-scroll">
                          <div className="px-4 sm:px-6 py-4">
                            {qIsWritten ? (
                              <WrittenEvaluationPanel
                                draft={writtenDraft}
                                question={q}
                                passed={writtenPassed}
                                isManual={writtenDraft.evaluation?.score === null}
                                rubricState={rubricState}
                                onRubricToggle={(idx) => onRubricToggle(q.id, idx)}
                                onPassFail={(v) => {
                                  const ev = writtenDraft.evaluation;
                                  if (!ev) {
                                    const manual = createManualEvaluation(writtenDraft.text);
                                    manual.manualVerdict = v;
                                    manual.passed = v === "pass";
                                    onWrittenDraftChange(q.id, {
                                      ...writtenDraft,
                                      submitted: true,
                                      evaluation: manual,
                                    });
                                  } else {
                                    onWrittenDraftChange(q.id, {
                                      ...writtenDraft,
                                      evaluation: { ...ev, manualVerdict: v, passed: v === "pass" },
                                    });
                                  }
                                }}
                                onChildPassFail={(childIdx, v) => {
                                  const childEvals = [...(writtenDraft.childEvaluations ?? [])];
                                  const ev = childEvals[childIdx];
                                  if (ev) {
                                    childEvals[childIdx] = { ...ev, manualVerdict: v, passed: v === "pass" };
                                    onWrittenDraftChange(q.id, { ...writtenDraft, childEvaluations: childEvals });
                                  }
                                }}
                              />
                            ) : (
                              <ExplanationCard q={q} selected={selected} nonMcq={!isMCQ} highlights={currentHighlights} packUid={activeItem.uid} questionIdx={session.current} lang={activeItem.lang ?? "en"} item={activeItem} />
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </motion.div>
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center py-20">
                <div className="text-center">
                  <div className="size-10 border-2 border-primary/30 border-t-primary rounded-full animate-spin mx-auto" />
                  <p className="text-sm text-muted-foreground mt-3">{t("qbank.session.loading")}</p>
                </div>
              </div>
            )}
          </div>

          {/* Bottom action bar — desktop */}
          <footer className="hidden sm:flex border-t border-border bg-card px-4 sm:px-6 py-2.5 items-center gap-2 shrink-0">
            <Button variant="outline" size="sm" onClick={goPrev} disabled={session.current === 0} className="h-9 rounded-lg">
              <ChevronLeft className="size-4 me-1" /> {t("common.previous")}
            </Button>

            <div className="flex-1" />

            {!readonly && (
              <>
                <div className="flex items-center gap-1" data-walkthrough="qbank-tools">
                  <ToolButton onClick={onToggleCalculator} icon={CalcIcon} active={calculatorOpen} title={t("qbank.session.calculator")} />
                  <ToolButton onClick={onToggleLabValues} icon={FlaskConical} active={labValuesOpen} title={t("qbank.session.labValues")} />
                  <ToolButton onClick={onToggleAiAssistant} icon={Sparkles} active={aiAssistantOpen} title={t("qbank.session.aiAssistant")} />
                  {!isMobile && (
                    <Popover open={articleSearchOpen} onOpenChange={setArticleSearchOpen}>
                      <PopoverTrigger asChild>
                        <ToolButton onClick={() => setArticleSearchOpen(true)} icon={BookOpen} title={t("qbank.session.openArticle")} />
                      </PopoverTrigger>
                      <PopoverContent align="end" className="w-72 p-0 max-h-64 overflow-y-auto">
                        <div className="py-1">
                          <div className="px-4 py-2 text-xs font-bold uppercase tracking-wider text-primary border-b border-border">{t("qbank.session.openArticle")}</div>
                          {articleList.map((a) => (
                            <button
                              key={a.file}
                              onClick={() => {
                                onOpenArticle(a.file);
                                setArticleSearchOpen(false);
                              }}
                              className="w-full text-left text-sm px-4 py-2.5 hover:bg-muted transition-colors flex items-center gap-2 border-b border-border last:border-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                            >
                              <FileText className="size-3.5 shrink-0 text-muted-foreground" />
                              <span className="truncate">{a.title}</span>
                            </button>
                          ))}
                        </div>
                      </PopoverContent>
                    </Popover>
                  )}
                  <ToolButton onClick={() => setShowShortcuts((s) => !s)} icon={Keyboard} active={showShortcuts} title={t("qbank.session.keyboardShortcuts")} />
                </div>

                <div className="h-5 w-px bg-border mx-1 hidden sm:block" aria-hidden="true" />

                <Button
                  variant="outline" size="sm" onClick={onToggleFlag}
                  data-walkthrough="qbank-flag"
                  className={`h-9 rounded-lg ${session.flagged[session.current] ? "border-warning bg-warning/10 text-warning hover:bg-warning/15" : ""}`}
                  title={session.flagged[session.current] ? t("qbank.session.unflagQuestion") : t("qbank.session.flagForReview")}
                >
                  <Flag className={`size-4 ${session.flagged[session.current] ? "fill-warning text-warning" : ""}`} />
                  <span className="hidden sm:inline ms-1">{session.flagged[session.current] ? t("qbank.session.flagged") : t("qbank.session.flag")}</span>
                </Button>

                <Button
                  variant="outline" size="sm"
                  data-walkthrough="qbank-reporting"
                  onClick={() => { haptic("light"); setReportOpen(true); }}
                  className="h-9 rounded-lg"
                  title={t("support.reportQuestion")}
                >
                  <MessageSquareWarning className="size-4" />
                  <span className="hidden lg:inline ms-1">{t("support.reportShort")}</span>
                </Button>

                <div className="h-5 w-px bg-border mx-1 hidden sm:block" aria-hidden="true" />

                {!submitted && isMCQ && (
                  <Button size="sm" onClick={onSubmit} disabled={selected === undefined} className="h-9 rounded-lg">
                    {t("qbank.session.submitAnswer")}
                  </Button>
                )}
                {!submitted && !isMCQ && !qIsWritten && (
                  <Button size="sm" onClick={onSubmit} className="h-9 rounded-lg">
                    {session.engine === "flashcard" ? t("qbank.session.revealAnswer") : t("qbank.session.submitSelfGrade")}
                  </Button>
                )}
                {submitted && session.mode === "tutor" && (
                  <Button variant="outline" size="sm" onClick={onRetry} className="h-9 rounded-lg" title={t("qbank.session.retryQuestion")}>
                    <RotateCcw className="size-4 me-1" />
                    <span className="hidden sm:inline">{t("qbank.session.retry")}</span>
                  </Button>
                )}
              </>
            )}

            <Button
              size="sm" onClick={goNext} data-walkthrough="qbank-next"
              className="h-9 rounded-lg"
              variant={readonly ? "default" : isLast ? "destructive" : "default"}
            >
              {readonly ? (
                <>{isLast ? t("qbank.review.exit") : t("common.next")} <ChevronRight className="size-4 ms-1" /></>
              ) : isLast ? (
                <>{t("qbank.session.endTest")} <ChevronRight className="size-4 ms-1" /></>
              ) : submitted && session.mode === "tutor" ? (
                <>{t("qbank.session.nextQuestion")} <ChevronRight className="size-4 ms-1" /></>
              ) : (
                <>{t("common.next")} <ChevronRight className="size-4 ms-1" /></>
              )}
            </Button>
          </footer>

          {/* Bottom action bar — mobile (compact).
              Extra bottom padding (pb-[env+0.5rem]) ensures the action buttons
              clear the iOS home indicator with breathing room. */}
          <footer className="sm:hidden border-t border-border bg-card px-3 pt-2 pb-[max(env(safe-area-inset-bottom,0px),0.75rem)] flex items-center gap-1.5 shrink-0 osler-tap-none">
            <Button
              variant="outline" size="icon"
              onClick={goPrev} disabled={session.current === 0}
              className="size-10 rounded-lg shrink-0 osler-touch-target"
              title={t("common.previous")}
            >
              <ChevronLeft className="size-4" />
            </Button>

            {!readonly && (
              <>
                <Button
                  variant="outline" size="icon"
                  onClick={onToggleFlag}
                  data-walkthrough="qbank-flag"
                  className={`size-10 rounded-lg shrink-0 osler-touch-target ${session.flagged[session.current] ? "border-warning bg-warning/10 text-warning" : ""}`}
                  title={session.flagged[session.current] ? t("qbank.session.unflagShort") : t("qbank.session.flag")}
                >
                  <Flag className={`size-4 ${session.flagged[session.current] ? "fill-warning text-warning" : ""}`} />
                </Button>

                <Button
                  variant="outline" size="icon"
                  onClick={() => { haptic("light"); setReportOpen(true); }}
                  data-walkthrough="qbank-reporting"
                  className="size-10 rounded-lg shrink-0 osler-touch-target"
                  title={t("support.reportQuestion")}
                  aria-label={t("support.reportQuestion")}
                >
                  <MessageSquareWarning className="size-4" />
                </Button>

                {/* Tools menu for mobile - bottom sheet with tool shortcuts
                    + inline article picker. A sheet (not a popover) so it
                    slides up natively, respects safe areas, and never clips
                    against the viewport edge. */}
                <Sheet open={toolsOpen} onOpenChange={setToolsOpen}>
                  <SheetTrigger asChild>
                    <Button
                      variant="outline" size="icon"
                      onClick={() => { haptic("selection"); setToolsOpen(true); }}
                      data-walkthrough="qbank-tools"
                      className="size-10 rounded-lg shrink-0 osler-touch-target"
                      title={t("qbank.session.tools")}
                      aria-label={t("qbank.session.tools")}
                    >
                      <Wrench className="size-4" />
                    </Button>
                  </SheetTrigger>
                  <SwipeableSheetContent
                    onClose={() => setToolsOpen(false)}
                    className="px-0 pt-0 pb-[max(env(safe-area-inset-bottom,0px),0.75rem)] data-[state=open]:duration-200 data-[state=closed]:duration-150"
                  >
                    <SheetHeader className="flex-row items-center justify-between gap-2 px-4 pt-2.5 pb-1">
                      <SheetTitle className="flex items-center gap-2 text-sm font-semibold">
                        <span className="size-7 rounded-lg bg-primary/10 border border-primary/20 text-primary flex items-center justify-center shrink-0">
                          <Wrench className="size-4" />
                        </span>
                        {t("qbank.session.tools")}
                      </SheetTitle>
                    </SheetHeader>
                    <div className="px-2">
                      <SessionToolRow
                        icon={CalcIcon}
                        label={t("qbank.session.calculator")}
                        active={calculatorOpen}
                        onClick={() => { haptic("light"); setToolsOpen(false); onToggleCalculator(); }}
                      />
                      <SessionToolRow
                        icon={FlaskConical}
                        label={t("qbank.session.labValues")}
                        active={labValuesOpen}
                        onClick={() => { haptic("light"); setToolsOpen(false); onToggleLabValues(); }}
                      />
                      <SessionToolRow
                        icon={Sparkles}
                        label={t("qbank.session.aiAssistant")}
                        active={aiAssistantOpen}
                        onClick={() => { haptic("light"); setToolsOpen(false); onToggleAiAssistant(); }}
                      />
                      <SessionToolRow
                        icon={NotebookPen}
                        label={t("qbank.notes.title")}
                        active={notesOpen}
                        onClick={() => { haptic("light"); setToolsOpen(false); onToggleNotes(); }}
                      />
                      {submitted && session.mode === "tutor" && (
                        <SessionToolRow
                          icon={RotateCcw}
                          label={t("qbank.session.retry")}
                          onClick={() => { haptic("light"); setToolsOpen(false); onRetry(); }}
                        />
                      )}

                      {/* Articles - inline, scrollable picker */}
                      <div className="mt-1 border-t border-border pt-3 pb-1 px-1">
                        <div className="flex items-center gap-2 px-2 pb-1.5 text-[11px] uppercase tracking-wider text-muted-foreground font-medium">
                          <BookOpen className="size-3.5" />
                          {t("qbank.session.openArticle")}
                        </div>
                        <div className="max-h-48 overflow-y-auto osler-scroll">
                          {articleList.length === 0 ? (
                            <p className="px-2 py-2 text-sm text-muted-foreground">
                              {t("qbank.session.noArticles")}
                            </p>
                          ) : (
                            articleList.map((a) => (
                              <button
                                key={a.file}
                                onClick={() => { haptic("light"); setToolsOpen(false); onOpenArticle(a.file); }}
                                className="w-full text-start px-3 py-2 hover:bg-muted flex items-center gap-2 rounded-lg text-sm text-foreground"
                              >
                                <FileText className="size-4 shrink-0 text-muted-foreground" />
                                <span className="truncate">{a.title}</span>
                              </button>
                            ))
                          )}
                        </div>
                      </div>
                    </div>
                  </SwipeableSheetContent>
                </Sheet>
              </>
            )}

            {/* Primary action button — fills remaining space */}
            {readonly ? (
              <Button
                size="sm" onClick={goNext}
                variant="default"
                data-walkthrough="qbank-next"
                className="flex-1 h-10 rounded-lg osler-touch-target"
              >
                {isLast ? t("qbank.review.exit") : t("common.next")}
                <ChevronRight className="size-4 ms-1" />
              </Button>
            ) : !submitted && isMCQ ? (
              <Button
                size="sm" onClick={onSubmit} disabled={selected === undefined}
                data-walkthrough="qbank-next"
                className="flex-1 h-10 rounded-lg osler-touch-target"
              >
                {t("qbank.session.submitAnswer")}
              </Button>
            ) : !submitted && !isMCQ && !qIsWritten ? (
              <Button
                size="sm" onClick={onSubmit}
                data-walkthrough="qbank-next"
                className="flex-1 h-10 rounded-lg osler-touch-target"
              >
                {session.engine === "flashcard" ? t("qbank.session.revealAnswer") : t("qbank.session.submit")}
              </Button>
            ) : (
              <Button
                size="sm" onClick={goNext}
                variant={isLast ? "destructive" : "default"}
                data-walkthrough="qbank-next"
                className="flex-1 h-10 rounded-lg osler-touch-target"
              >
                {isLast
                  ? t("qbank.session.endTest")
                  : submitted && session.mode === "tutor"
                  ? t("qbank.session.nextQuestion")
                  : t("common.next")}
                <ChevronRight className="size-4 ms-1" />
              </Button>
            )}
          </footer>
        </main>
      </div>

      {/* Keyboard shortcuts help */}
      <AnimatePresence>
        {showShortcuts && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
            onClick={() => setShowShortcuts(false)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-card border border-border rounded-xl shadow-e4 max-w-lg w-full p-5 max-h-[80vh] overflow-y-auto"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold flex items-center gap-2">
                  <Keyboard className="size-4" />
                  {t("qbank.session.keyboardShortcuts")}
                </h3>
                <button
                  onClick={() => setShowShortcuts(false)}
                  className="size-7 rounded-lg hover:bg-muted flex items-center justify-center"
                >
                  <X className="size-4" />
                </button>
              </div>
              <div className="space-y-2.5">
                {([
                  ["qbank.prev", "qbank.next", null, "qbank.session.shortcut.prev"],
                  ["qbank.answer1", "qbank.answer2", "qbank.answer3", "qbank.session.shortcut.select"],
                  ["qbank.answer4", "qbank.answer5", null, "qbank.session.shortcut.select"],
                  ["qbank.submit", null, null, "qbank.session.shortcut.submit"],
                  ["qbank.flag", null, null, "qbank.session.shortcut.flag"],
                  ["qbank.aiAssistant", null, null, "qbank.session.shortcut.ai"],
                  ["qbank.highlight", null, null, "qbank.session.shortcut.highlight"],
                  ["qbank.eraser", null, null, "qbank.session.shortcut.eraser"],
                  ["qbank.notes", null, null, "qbank.session.shortcut.notes"],
                  ["qbank.notesNew", null, null, "qbank.session.shortcut.notesNew"],
                  ["qbank.quizSettings", null, null, "qbank.session.shortcut.settings"],
                  ["qbank.shortcutsHelp", null, null, "qbank.session.shortcut.help"],
                ] as [string, string | null, string | null, StringKey][]).map(
                  ([first, second, third, descKey]) => (
                    <div key={descKey} className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">{t(descKey)}</span>
                      <kbd className="px-2 py-0.5 rounded border border-border bg-muted/50 text-xs font-mono tabular-nums">
                        {first && describeBinding(bindings[first] ?? "")}
                        {second && ` / ${describeBinding(bindings[second] ?? "")}`}
                        {third && ` / ${describeBinding(bindings[third] ?? "")}`}
                      </kbd>
                    </div>
                  ),
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <ReportTicketDialog open={reportOpen} onOpenChange={setReportOpen} source="qbank" context={reportContext} />
      <WalkthroughDialog
        tour="qbank-session"
        open={walkthroughOpen}
        onOpenChange={(nextOpen) => {
          setWalkthroughOpen(nextOpen);
          if (!nextOpen && tourOpenedSettingsRef.current) {
            tourOpenedSettingsRef.current = false;
            if (quizSettingsOpen) onToggleQuizSettings();
          }
        }}
        onAction={(action) => {
          if (action === "open-quiz-settings") {
            if (!quizSettingsOpen) {
              onToggleQuizSettings();
              tourOpenedSettingsRef.current = true;
            }
          } else if (action === "close-quiz-settings") {
            // The panel covers the footer on phones — put it away so the
            // post-settings steps can spotlight their real targets.
            if (quizSettingsOpen) onToggleQuizSettings();
          }
        }}
      />
    </div>
  );
}