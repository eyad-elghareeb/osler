"use client";

import * as React from "react";
import { motion, AnimatePresence, useMotionValue, animate } from "framer-motion";
import {
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ClipboardCheck,
  Flag,
  Check,
  X,
  Clock,
  Pause,
  Play,
  GraduationCap,
  RotateCcw,
  Home,
  Plus,
  ListChecks,
  Loader2,
  Timer,
  Timer as TimerIcon,
  Sparkles,
  FileText,
  Calculator as CalcIcon,
  FlaskConical,
  BookOpen,
  NotebookPen,
  Sliders,
  Trash2,
  Eye,
  CheckCircle2,
  Circle,
  PenTool,
  Activity,
  User,
  AlertTriangle,
  Stethoscope,
  ListCollapse,
  History,
  Keyboard,
  Folder,
  Grid3x3,
  Layers,
  Video as VideoIcon,
  Search,
  SlidersHorizontal,
  ArrowLeft,
  ArrowUpDown,
  Camera,
  RefreshCw,
  Download,
  PackageOpen,
} from "lucide-react";
import { loadAllContent, loadContentByUid, ENGINE_META, flattenTree } from "@/lib/osler/content";
import { toast } from "@/hooks/use-toast";
import {
  contentToQuestions as poolContentToQuestions,
  countQuestions as poolCountQuestions,
  buildQuestionPool,
  filterPoolByTags,
  filterPoolByProgress,
  pickQuestions,
  poolFamilyForEngine,
  sharedPoolFamily,
  canPoolTogether,
  type PoolQuestion,
  type OnlyMode,
  type OrderMode,
} from "@/lib/osler/qbank-pool";
import type {
  AnyContent,
  BankContent,
  ContentImage,
  EngineType,
  FlashcardContent,
  ContentTreeNode,
  OsceContent,
  QuizContent,
  WrittenContent,
} from "@/lib/osler/types";
import {
  storage,
  sessions,
  highlights,
  writtenDrafts,
  quizSettings as quizSettingsStore,
  type SavedSession,
  type HighlightItem,
  type WrittenDraft,
  type WrittenEvaluation,
  type QuizSettings,
  type QuestionRecord,
} from "@/lib/osler/storage";
import { listAllArticles } from "@/lib/osler/articles";
import type { Article, ArticleMeta } from "@/lib/osler/articles";
import { renderRichText, resolveContentAsset } from "@/lib/osler/richtext";
import {
  HIGHLIGHT_COLOR_KEYS,
  HIGHLIGHT_PALETTE,
  ERASER_TOOL,
} from "@/lib/osler/highlight-palette";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { LabValuesSidebar } from "./lab-values";
import { CalculatorModal } from "./calculator";
import { FloatingArticleModal } from "./article-modal";
import { AiAssistant } from "./ai-assistant";
import { HighlightedContent } from "./highlighted-content";
import { HighlighterToolbar } from "./highlighter-toolbar";
import { QuizSettingsPanel } from "./quiz-settings-panel";
import { NotesPanel } from "./notes-panel";
import { ContentCacheButton } from "./content-cache-button";
import { useShortcutBindings, useShortcutListener } from "@/hooks/use-shortcuts";
import { defaultBindings } from "@/lib/osler/shortcuts";
import { useIsMobile } from "@/hooks/use-mobile";
import { VerticalSnapGallery } from "./vertical-snap-gallery";
import { useLightbox } from "./lightbox-provider";
import { useSwipeTabs } from "@/hooks/use-swipe-tabs";
import { useQuizSettings } from "@/hooks/use-quiz-settings";
import { setImmersiveMode } from "./immersive-mode";
import { haptic } from "@/lib/osler/native";
import { gradeWithAI, createManualEvaluation, transcribePhoto } from "@/lib/osler/grading";
import { useI18n } from "./i18n-provider";
import { NavigationStack } from "./navigation-stack";
import { PageHeader } from "./ui-primitives";
import { FolderTreeNav } from "./folder-tree-nav";
import type { StringKey } from "@/lib/osler/i18n";
import { loadUiLang } from "@/lib/osler/i18n";
import { generateResultsPdf, generateDashboardPdf, generateQuizCompilationPdf, downloadPdf, type FullQuestion, type PdfExportConfig } from "@/lib/osler/pdf";
import { PdfExportDialog, type PdfExportOptions } from "./pdf-export-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";

const LETTERS = ["A", "B", "C", "D", "E", "F", "G", "H"];
const ARABIC_LETTERS = ["أ", "ب", "ج", "د", "ه", "و", "ز", "ح", "ط", "ي"];
// Choice indicators localised to the content language — Arabic content uses
// the Abjad-style sequence أ,ب,ت,… instead of Latin A,B,C,…
const choiceLetter = (idx: number, lang?: string): string =>
  (lang && lang.startsWith("ar") ? ARABIC_LETTERS : LETTERS)[idx] ?? "?";
const HIGHLIGHT_COLORS = HIGHLIGHT_COLOR_KEYS;

/** Resolve the content-relative base (category + folder) for a question. */
function questionAssetBase(q: SessionQuestion, item?: ContentTreeNode): {
  category: string;
  path: string;
} {
  if (q.sourceCategory && q.sourcePath) {
    return { category: q.sourceCategory, path: q.sourcePath };
  }
  if (!item) return { category: "qbank", path: "" };
  const category =
    item.type === "flashcard"
      ? "flashcard"
      : item.type === "osce"
        ? "osce"
        : item.type === "library"
          ? "library"
          : "qbank";
  return { category, path: item.path };
}

/** Render markdown + inline images for a piece of question text. */
function renderQuestionText(text: string, q: SessionQuestion, item?: ContentTreeNode): string {
  const base = questionAssetBase(q, item);
  return renderRichText(text, base.category, base.path);
}

/** Normalize a ContentImage field (single or array) to an array. */
function imageListOf(field?: ContentImage | ContentImage[]): ContentImage[] {
  if (!field) return [];
  return Array.isArray(field) ? field : [field];
}

/** A content image that opens the lightbox when tapped/clicked. Used for stem,
 * choice and explanation images so they work even inside the swipe gallery,
 * where pointer capture can swallow the synthetic click. */
function ContentImageFigure({
  img,
  category,
  path,
  className,
}: {
  img: ContentImage;
  category: string;
  path: string;
  className: string;
}) {
  const { openLightbox } = useLightbox();
  const src = resolveContentAsset(img.src, category, path);
  return (
    <figure key={img.src} className="m-0">
      <img
        src={src}
        alt={img.alt ?? ""}
        onClick={(e) => {
          e.stopPropagation();
          openLightbox(src, img.alt ?? "");
        }}
        className={cn(className, "cursor-zoom-in")}
      />
      {img.caption && (
        <figcaption className="text-center text-xs text-muted-foreground mt-1.5">
          {img.caption}
        </figcaption>
      )}
    </figure>
  );
}

interface QBankStudioProps {
  activeItem?: ContentTreeNode | null;
  activeContent?: AnyContent | null;
  onExit: () => void;
  onOpenPack?: (item: ContentTreeNode) => void;
}

type QuizMode = "home" | "quiz" | "results" | "review";
type TestMode = "tutor" | "timed";
type HomeTab = "content" | "create" | "previous" | "tracker";

interface SessionData {
  itemId: string;
  itemTitle: string;
  engine: EngineType;
  mode: TestMode;
  questions: SessionQuestion[];
  answers: Record<number, number>;
  revealed: Record<number, boolean>;
  flagged: Record<number, boolean>;
  current: number;
  startedAt: number;
  completedAt?: number;
  examTimeRemaining: number;
  examPaused: boolean;
  sessionId: string;
  // Written drafts: questionId → { text, rubricChecked, submitted }
  writtenDrafts: Record<string, WrittenDraft>;
  // OSCE/Flashcard rubric state: questionId → boolean[]
  rubricState: Record<string, boolean[]>;
  // Flashcard ratings: questionId → "easy" | "hard" | "unknown"
  ratings: Record<string, "easy" | "hard" | "unknown">;
  // Strikethroughs: questionIdx → number[] (choice indices)
  strikethroughs: Record<number, number[]>;
  /**
   * Tag filters that were active when this session was built (mirrored onto
   * SavedSession for review/retake). Undefined for legacy single-pack sessions.
   */
  tagsFilter?: string[];
  /**
   * Progress-mode filter that was active when this session was built
   * ("all" | "wrong" | "flagged"). Mirrored onto SavedSession.
   */
  onlyMode?: OnlyMode;
  /**
   * When true, answering a question correctly during this session marks
   * its stored progress record as `dismissed=true` so it disappears from
   * the Tracker's default wrong/flagged view. Driven by the Tracker's
   * "Remove once answered correctly" toggle.
   */
  dismissAfterCorrect?: boolean;
  /**
   * True when this session is a read-only review of a previously-saved
   * session. In review mode, no further `recordAnswer` calls are made —
   * the view just shows what was answered/revealed at save time.
   */
  isReview?: boolean;
}

interface SessionQuestionChild {
  id: string;
  label?: string;
  question?: string;
  modelAnswer?: string;
  rubric?: string;
  explanation?: string;
}

interface SessionQuestion {
  id: string;
  stem: string;
  /** Optional image(s) shown above the stem. */
  images?: ContentImage | ContentImage[];
  /** Optional image(s) shown above a specific choice, keyed by 0-based index. */
  choiceImages?: (ContentImage | ContentImage[] | undefined)[];
  choices: string[];
  correct: number; // -1 for non-MCQ
  explanation: string;
  /** Optional image(s) shown below the explanation. */
  explanationImages?: ContentImage | ContentImage[];
  modelAnswer?: string;
  tags?: string[];
  difficulty?: string;
  rubric?: string[];
  redFlags?: string[];
  differential?: string[];
  children?: SessionQuestionChild[];
  /**
   * Originating pack uid for this question (set when building a multi-pack
   * pool so answers can be recorded against the *real* source pack, not the
   * synthetic session id). Legacy single-pack sessions fall back to
   * `session.itemId`.
   */
  sourceUid?: string;
  /** Title of the originating pack (for review/retake UI). */
  sourceTitle?: string;
  /** Content-relative folder path of the originating pack (asset resolution). */
  sourcePath?: string;
  /** Category folder of the originating pack (asset resolution). */
  sourceCategory?: string;
}

export function QBankStudio({
  activeItem,
  activeContent,
  onExit,
  onOpenPack,
}: QBankStudioProps) {
  const [mode, setMode] = React.useState<QuizMode>("home");
  const [session, setSession] = React.useState<SessionData | null>(null);
  const [testMode, setTestMode] = React.useState<TestMode>("tutor");
  const [homeTab, setHomeTab] = React.useState<HomeTab>("content");
  const [, force] = React.useReducer((x) => x + 1, 0);
  const pendingQuestionLimitRef = React.useRef(0);
  const { t } = useI18n();
  const { openLightbox } = useLightbox();

  // ── Auto-persist active session to IndexedDB ─────────────────────
  // Prevents data loss on hard refresh (Ctrl+Shift+R, Cmd+Shift+R, etc.)
  // Three layers of protection (modeled after MU61S8 reference):
  //   1. Debounced save (500ms) on every session state change
  //   2. Periodic interval save (5s) as a safety net
  //   3. beforeunload handler for immediate save on tab close / refresh
  const autoSaveTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const sessionRef = React.useRef(session);
  sessionRef.current = session;

  // Debounced save on state change
  React.useEffect(() => {
    if (!session || session.isReview || session.completedAt) {
      sessions.clearActive();
      return;
    }
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    autoSaveTimerRef.current = setTimeout(() => {
      sessions.saveActive(session);
    }, 500);
    return () => {
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    };
  }, [session]);

  // Periodic backup save every 5 seconds
  React.useEffect(() => {
    const id = setInterval(() => {
      const s = sessionRef.current;
      if (s && !s.isReview && !s.completedAt) {
        sessions.saveActive(s);
      }
    }, 5000);
    return () => clearInterval(id);
  }, []);

  // Force-save on tab close / browser refresh
  React.useEffect(() => {
    const handleBeforeUnload = () => {
      const s = sessionRef.current;
      if (s && !s.isReview && !s.completedAt) {
        sessions.saveActive(s);
      }
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, []);

  // Save when tab goes hidden (app switch, tab switch, screen lock)
  React.useEffect(() => {
    const handleVisibility = () => {
      if (document.hidden) {
        const s = sessionRef.current;
        if (s && !s.isReview && !s.completedAt) {
          sessions.saveActive(s);
        }
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, []);

  // ── Restore active session from IndexedDB on mount ─────────────────
  // Only restores when no pack is selected via URL (activeItem is null),
  // so the startSession effect for URL packs is never overridden.
  const restoreBlockedRef = React.useRef(false);
  React.useEffect(() => {
    if (mode !== "home" || session || activeItem) {
      restoreBlockedRef.current = true;
      return;
    }
    const restore = () => {
      if (restoreBlockedRef.current) return;
      const saved = sessions.getActive() as SessionData | null;
      if (
        saved &&
        saved.sessionId &&
        !saved.completedAt &&
        !saved.isReview &&
        Array.isArray(saved.questions) &&
        saved.questions.length > 0 &&
        // Staleness check: discard if older than 7 days
        Date.now() - (saved.startedAt ?? 0) < 7 * 24 * 60 * 60 * 1000
      ) {
        restoreBlockedRef.current = true;
        setSession(saved);
        setMode("quiz");
        setTestMode(saved.mode);
      } else if (saved) {
        sessions.clearActive();
      }
    };
    restore();
    const unsub = storage.onHydrated(restore);
    return unsub;
  }, []);

  // Cross-tab plumbing (P0-4): a pack picked from Content tab gets handed to
  // Create Test as `initialSourceUid`. The custom-session callback is
  // implemented here so Create Test / Tracker / Previous Tests can all
  // spin up a session from a built question pool without going through the
  // `activeItem`/`activeContent` effect.
  const [pendingCreateTestSourceUid, setPendingCreateTestSourceUid] =
    React.useState<string | null>(null);

  const handlePickForCreateTest = React.useCallback(
    (node: ContentTreeNode) => {
      setPendingCreateTestSourceUid(node.uid);
      setHomeTab("create");
    },
    [],
  );

  const startCustomSession = React.useCallback(
    (pool: PoolQuestion[], meta: { title: string; engine: EngineType; mode?: TestMode; dismissAfterCorrect?: boolean; tagsFilter?: string[]; onlyMode?: OnlyMode; isReview?: boolean; savedDrafts?: Record<string, WrittenDraft>; savedRubricState?: Record<string, boolean[]>; savedAnswers?: Record<number, number>; savedRevealed?: Record<number, boolean>; savedFlagged?: Record<number, boolean>; savedRatings?: Record<string, "easy" | "hard" | "unknown">; savedCurrent?: number }) => {
      if (pool.length === 0) return;
      const sessionId = `custom-${Date.now()}`;
      const totalTime = pool.length * 60;
      setImmersiveMode(true);
      setSession({
        itemId: sessionId,
        itemTitle: meta.title,
        engine: meta.engine,
        mode: meta.mode ?? testMode,
        questions: pool as SessionQuestion[],
        answers: meta.savedAnswers ?? {},
        revealed: meta.savedRevealed ?? {},
        flagged: meta.savedFlagged ?? {},
        current: meta.savedCurrent ?? 0,
        startedAt: Date.now(),
        examTimeRemaining: totalTime,
        examPaused: false,
        sessionId,
        writtenDrafts: meta.savedDrafts ?? {},
        rubricState: meta.savedRubricState ?? {},
        ratings: meta.savedRatings ?? {},
        strikethroughs: {},
        tagsFilter: meta.tagsFilter,
        onlyMode: meta.onlyMode,
        dismissAfterCorrect: meta.dismissAfterCorrect,
        isReview: meta.isReview,
      });
      setMode(meta.isReview ? "review" : "quiz");
    },
    [testMode],
  );

  // Tools state (calculator, lab values, article modal, AI, quiz settings, notes)
  const [calculatorOpen, setCalculatorOpen] = React.useState(false);
  const [labValuesOpen, setLabValuesOpen] = React.useState(false);
  const [articleModalId, setArticleModalId] = React.useState<string | null>(null);
  const [aiAssistantOpen, setAiAssistantOpen] = React.useState(false);
  const [quizSettingsOpen, setQuizSettingsOpen] = React.useState(false);
  const [notesOpen, setNotesOpen] = React.useState(false);
  const [exitConfirmOpen, setExitConfirmOpen] = React.useState(false);
  const [navOpenMobile, setNavOpenMobile] = React.useState(false);
  const [articleList, setArticleList] = React.useState<ArticleMeta[]>([]);

  React.useEffect(() => {
    (async () => {
      try {
        const all = await listAllArticles();
        setArticleList(all);
      } catch {}
    })();
  }, []);

  const startSession = React.useCallback(
    (item: ContentTreeNode, content: AnyContent, maxQuestions?: number) => {
      let questions = contentToQuestions(content, item.uid, item.title, item);
      if (questions.length === 0) return;
      if (maxQuestions && maxQuestions > 0 && maxQuestions < questions.length) {
        questions = questions.slice(0, maxQuestions);
      }
      const totalTime = questions.length * 60;
      const sessionId = `${item.uid}-${Date.now()}`;

      setImmersiveMode(true);

      // Load existing written drafts
      const drafts = writtenDrafts.get(item.uid);

      setSession({
        itemId: item.uid,
        itemTitle: item.title,
        engine: item.type,
        mode: testMode,
        questions,
        answers: {},
        revealed: {},
        flagged: {},
        current: 0,
        startedAt: Date.now(),
        examTimeRemaining: totalTime,
        examPaused: false,
        sessionId,
        writtenDrafts: drafts,
        rubricState: {},
        ratings: {},
        strikethroughs: {},
      });
      setMode("quiz");
    },
    [testMode]
  );

  // Start a session when a content pack is provided
  React.useEffect(() => {
    if (activeItem && activeContent) {
      const limit = pendingQuestionLimitRef.current;
      pendingQuestionLimitRef.current = 0;
      startSession(activeItem, activeContent, limit || undefined);
    } else if (!activeItem && mode !== "home") {
      setMode("home");
      setSession(null);
    }
  }, [activeItem?.uid, activeContent?.meta.uid, startSession]);

  const endSession = React.useCallback(() => {
    setSession((s) => {
      if (!s) return s;
      const completed = { ...s, completedAt: Date.now() };
      // P3-1: don't persist review sessions — they're read-only replays.
      if (!s.isReview) {
        saveSession(completed);
        if (!s.itemId.startsWith("custom-")) {
          writtenDrafts.clear(s.itemId);
        }
      }
      return completed;
    });
    sessions.clearActive();
    // P3-1: review sessions skip the results view and exit straight to home
    // (no score to show — answers were already known at save time).
    if (session?.isReview) {
      exitToHome();
      return;
    }
    setMode("results");
  }, [session?.isReview]);

  const restartSession = () => {
    if (activeItem && activeContent) {
      storage.clearPack(activeItem.uid);
      highlights.clearAll(activeItem.uid);
      writtenDrafts.clear(activeItem.uid);
      startSession(activeItem, activeContent);
    }
  };

  const exitToHome = () => {
    sessions.clearActive();
    setMode("home");
    setSession(null);
    setImmersiveMode(false);
    onExit();
  };

  // Request exit confirmation — opens a modal when there is an in-progress
  // session; otherwise just exits immediately. Review sessions skip confirmation.
  const requestExit = () => {
    if (mode === "review" || (mode === "quiz" && session?.isReview)) {
      exitToHome();
    } else if (mode === "quiz" && session) {
      setExitConfirmOpen(true);
    } else {
      exitToHome();
    }
  };

  // Live remaining time for timed mode is owned by the isolated <QBankTimer>
  // component below, so per-second ticks re-render only that small subtree
  // instead of the whole QuizView (which would disturb the highlighter).

  // Record answers to storage when revealed
  const recordAnswer = (idx: number, q: SessionQuestion) => {
    if (!session) return;
    // P3-1: read-only review mode — no progress writes.
    if (session.isReview) return;
    // P2-5: route progress through the question's real sourceUid, not the
    // synthetic session id. Fall back to activeItem.uid (single-pack path)
    // and finally session.itemId (legacy compat).
    const uid = q.sourceUid ?? activeItem?.uid ?? session.itemId;
    if (!uid) return;
    const selected = session.answers[idx];
    const correct = selected === q.correct;
    // P5-6: dismiss-after-correct semantics — if the session was started
    // with dismissAfterCorrect=true and the answer is correct, mark the
    // record as dismissed (Tracker will hide it from the default view).
    const shouldDismiss = !!session.dismissAfterCorrect && correct;
    // Per-question engine detection for mixed sessions.
    const qEngine = q.correct >= 0 ? "quiz" : (q.rubric?.length ? "written" : session.engine);
    storage.recordAnswer(
      uid,
      q.id,
      qEngine,
      selected,
      correct,
      !!session.flagged[idx],
      shouldDismiss,
    );
    force();
  };

  if ((mode === "quiz" || mode === "review") && session) {
    return (
      <>
        <QuizView
          session={session}
          activeItem={activeItem ?? undefined}
          calculatorOpen={calculatorOpen}
          labValuesOpen={labValuesOpen}
          aiAssistantOpen={aiAssistantOpen}
          quizSettingsOpen={quizSettingsOpen}
          notesOpen={notesOpen}
          navOpenMobile={navOpenMobile}
          articleList={articleList}
          onToggleCalculator={() => setCalculatorOpen((o) => !o)}
          onToggleLabValues={() => setLabValuesOpen((o) => !o)}
          onToggleAiAssistant={() => setAiAssistantOpen((o) => !o)}
          onToggleQuizSettings={() => setQuizSettingsOpen((o) => !o)}
          onToggleNotes={() => setNotesOpen((o) => !o)}
          onToggleNavMobile={() => setNavOpenMobile((o) => !o)}
          onOpenArticle={(id) => setArticleModalId(id)}
          onExitRequest={requestExit}
          onSelect={(idx) => {
            if (session.isReview) return;
            if (session.revealed[session.current]) return;
            const q = session.questions[session.current];
            const isMCQ = !!q && q.correct >= 0;
            const settings = quizSettingsStore.getSync();
            const willAutoSubmit =
              settings.autoSubmit && session.mode === "tutor" && isMCQ;

            setSession((s) => {
              if (!s) return s;
              const next = { ...s, answers: { ...s.answers, [s.current]: idx } };
              if (willAutoSubmit && !next.revealed[s.current]) {
                next.revealed = { ...next.revealed, [s.current]: true };
              }
              return next;
            });

            if (willAutoSubmit && q && isMCQ) {
              // Record progress for the auto-submitted answer.
              const correct = idx === q.correct;
              // P2-5: route through sourceUid if present (merged/custom sessions).
              const uid = q.sourceUid ?? activeItem?.uid ?? session.itemId;
              const shouldDismiss = !!session.dismissAfterCorrect && correct;
              storage.recordAnswer(
                uid,
                q.id,
                session.engine,
                idx,
                correct,
                !!session.flagged[session.current],
                shouldDismiss,
              );
              force();
            }
          }}
          onToggleStrikethrough={(idx) => {
            setSession((s) => {
              if (!s) return s;
              const cur = s.strikethroughs[s.current] ?? [];
              const next = cur.includes(idx)
                ? cur.filter((i) => i !== idx)
                : [...cur, idx];
              return {
                ...s,
                strikethroughs: { ...s.strikethroughs, [s.current]: next },
              };
            });
          }}
          onSubmit={() => {
            const q = session.questions[session.current];
            setSession((s) =>
              s
                ? { ...s, revealed: { ...s.revealed, [s.current]: true } }
                : s
            );
            if (q && q.correct >= 0) {
              recordAnswer(session.current, q);
            } else if (q) {
              // Non-MCQ: record based on rubric/written
              const rubricState = session.rubricState[q.id] ?? [];
              const rubricScore = rubricState.filter(Boolean).length;
              const correct =
                q.rubric && q.rubric.length > 0
                  ? rubricScore / q.rubric.length >= 0.6
                  : true;
              const uid = q.sourceUid ?? activeItem?.uid ?? session.itemId;
              const shouldDismiss = !!session.dismissAfterCorrect && correct;
              const qEngine = q.rubric?.length ? "written" : session.engine;
              storage.recordAnswer(
                uid,
                q.id,
                qEngine,
                undefined,
                correct,
                !!session.flagged[session.current],
                shouldDismiss,
              );
              force();
            }
          }}
          onWrittenDraftChange={(qid, draft) => {
            setSession((s) => {
              if (!s) return s;
              const drafts = { ...s.writtenDrafts, [qid]: draft };
              // Only persist to IndexedDB for single-pack sessions (restorable
              // via writtenDrafts.get). Custom sessions don't have an IndexedDB
              // restore path — their drafts are passed via SavedSession.writtenDrafts.
              if (!s.itemId.startsWith("custom-")) {
                writtenDrafts.save(s.itemId, drafts);
              }
              // Auto-reveal when evaluation is set (shows the right 45% column)
              const next: SessionData = { ...s, writtenDrafts: drafts };
              if (draft.evaluation && !next.revealed[next.current]) {
                next.revealed = { ...next.revealed, [next.current]: true };
              }
              return next;
            });
          }}
          onRubricToggle={(qid, idx) => {
            setSession((s) => {
              if (!s) return s;
              const cur = s.rubricState[qid] ?? [];
              const q = s.questions.find((q) => q.id === qid);
              const maxLen = q?.rubric?.length ?? 0;
              const next = [...cur];
              while (next.length < maxLen) next.push(false);
              next[idx] = !next[idx];
              return {
                ...s,
                rubricState: { ...s.rubricState, [qid]: next },
              };
            });
          }}
          onRate={(qid, rating) => {
            setSession((s) => {
              if (!s) return s;
              return {
                ...s,
                ratings: { ...s.ratings, [qid]: rating },
              };
            });
            // Record answer for flashcard
            const q = session.questions.find((q) => q.id === qid);
            if (q) {
              const correct = rating === "easy";
              const uid = q.sourceUid ?? activeItem?.uid ?? session.itemId;
              const shouldDismiss = !!session.dismissAfterCorrect && correct;
              storage.recordAnswer(
                uid,
                qid,
                session.engine,
                undefined,
                correct,
                !!session.flagged[session.current],
                shouldDismiss,
              );
            }
            force();
          }}
          onToggleFlag={() => {
            if (session.isReview) return;
            setSession((s) =>
              s
                ? {
                    ...s,
                    flagged: {
                      ...s.flagged,
                      [s.current]: !s.flagged[s.current],
                    },
                  }
                : s
            );
          }}
          onTogglePause={() => {
            if (session.isReview) return;
            setSession((s) => (s ? { ...s, examPaused: !s.examPaused } : s));
          }}
          onTimeUp={endSession}
          onPrev={() =>
            setSession((s) =>
              s ? { ...s, current: Math.max(0, s.current - 1) } : s
            )
          }
          onNext={() => {
            if (session.current >= session.questions.length - 1) {
              endSession();
            } else {
              setSession((s) => (s ? { ...s, current: s.current + 1 } : s));
            }
          }}
          onJumpTo={(i) =>
            setSession((s) => (s ? { ...s, current: i } : s))
          }
          onRetry={() => {
            setSession((s) => {
              if (!s) return s;
              const q = s.questions[s.current];
              const newAnswers = { ...s.answers };
              delete newAnswers[s.current];
              const newRevealed = { ...s.revealed };
              delete newRevealed[s.current];
              const newRatings = { ...s.ratings };
              delete newRatings[q.id];
              const newDrafts = { ...s.writtenDrafts };
              delete newDrafts[q.id];
              return {
                ...s,
                answers: newAnswers,
                revealed: newRevealed,
                ratings: newRatings,
                writtenDrafts: newDrafts,
              };
            });
          }}
          onGoHome={requestExit}
          onFinish={endSession}
        />
        {/* Floating tools */}
        <AnimatePresence>
          {calculatorOpen && (
            <CalculatorModal onClose={() => setCalculatorOpen(false)} />
          )}
        </AnimatePresence>
        <AnimatePresence>
          {labValuesOpen && (
            <LabValuesSidebar
              open={labValuesOpen}
              onClose={() => setLabValuesOpen(false)}
            />
          )}
        </AnimatePresence>
        <FloatingArticleModal
          articleId={articleModalId}
          onClose={() => setArticleModalId(null)}
        />
        <AiAssistant
          open={aiAssistantOpen}
          onClose={() => setAiAssistantOpen(false)}
          questionContext={
            session.questions[session.current]
              ? {
                  stem: session.questions[session.current].stem,
                  choices: session.questions[session.current].choices,
                  correct: session.questions[session.current].correct,
                  engine: session.engine,
                  submitted: session.revealed[session.current] || false,
                }
              : undefined
          }
        />
        <QuizSettingsPanel
          open={quizSettingsOpen}
          onClose={() => setQuizSettingsOpen(false)}
          tone="header"
        />
        <NotesPanel
          open={notesOpen}
          onClose={() => setNotesOpen(false)}
          packUid={activeItem?.uid}
          packTitle={activeItem?.title}
          currentQuestionIdx={session.current}
        />
        <AlertDialog open={exitConfirmOpen} onOpenChange={setExitConfirmOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t("qbank.exit.title")}</AlertDialogTitle>
              <AlertDialogDescription>
                {t("qbank.exit.body")}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t("qbank.exit.stay")}</AlertDialogCancel>
              <AlertDialogAction asChild>
                <Button variant="destructive" onClick={exitToHome}>
                  {t("qbank.exit.confirm")}
                </Button>
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </>
    );
  }

  if (mode === "results" && session) {
    const isCustom = session.itemId.startsWith("custom-");
    const resultsItem = activeItem ?? {
      uid: session.itemId,
      title: session.itemTitle,
      type: session.engine,
      path: "",
      items: [],
    } as ContentTreeNode;
    return (
      <ResultsView
        session={session}
        item={resultsItem}
        onGoHome={exitToHome}
        onRestart={isCustom ? () => {
          // For custom sessions, go back to home since we can't easily rebuild
          exitToHome();
        } : restartSession}
      />
    );
  }

  return (
    <HomeView
      testMode={testMode}
      onTestModeChange={setTestMode}
      onOpenPack={onOpenPack}
      homeTab={homeTab}
      onHomeTabChange={setHomeTab}
      onSetQuestionLimit={(n) => { pendingQuestionLimitRef.current = n; }}
      pendingCreateTestSourceUid={pendingCreateTestSourceUid}
      onPickForCreateTest={handlePickForCreateTest}
      onClearPendingCreateTestSource={() => setPendingCreateTestSourceUid(null)}
      onStartCustomSession={startCustomSession}
    />
  );
}

/* ─────────────────────────────────────────────────────────────────────────
 * HOME VIEW
 * ───────────────────────────────────────────────────────────────────────── */
/* ── Replace old ManifestItem usage with ContentTreeNode ─────── */
type PackEntry = { node: ContentTreeNode; content: AnyContent | null };

function HomeView({
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
      savedCurrent?: number;
    }
  ) => void;
}) {
  const [data, setData] = React.useState<{
    items: PackEntry[];
    trees: Record<string, ContentTreeNode[]>;
  } | null>(null);
  const [, force] = React.useReducer((x) => x + 1, 0);
  const { t } = useI18n();
  const [savedSessions, setSavedSessions] = React.useState<SavedSession[]>([]);
  const [exportDialogOpen, setExportDialogOpen] = React.useState(false);
  const [contextMenuNode, setContextMenuNode] = React.useState<ContentTreeNode | null>(null);
  const [contextMenuPos, setContextMenuPos] = React.useState<{ x: number; y: number } | null>(null);

  const handleContextMenu = React.useCallback((e: React.MouseEvent, node: ContentTreeNode) => {
    e.preventDefault();
    setContextMenuNode(node);
    setContextMenuPos({ x: e.clientX, y: e.clientY });
    setExportDialogOpen(true);
  }, []);

  React.useEffect(() => {
    loadAllContent()
      .then((result) => {
        setData({
          items: result.items.filter(
            (entry) =>
              entry.node.type === "quiz" ||
              entry.node.type === "bank" ||
              entry.node.type === "written"
          ),
          trees: result.trees,
        });
      })
      .catch(console.error);
  }, []);

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
        {/* Page header */}
        <div className="px-4 md:px-6 lg:px-8 w-full max-w-7xl mx-auto pt-6 md:pt-8 pb-4">
          <PageHeader
            eyebrowIcon={ClipboardCheck}
            title={t("qbank.home.title")}
            subtitle={t("qbank.home.subtitle")}
          />
        </div>
        {/* Tab bar — fixed below header */}
        <div className="shrink-0 border-b border-border px-4 md:px-6 lg:px-8 w-full max-w-7xl mx-auto">
          <nav className="-mb-px flex gap-0 justify-center">
            {[
              { id: "content" as const, label: t("qbank.home.tabContent"), icon: Grid3x3 },
              { id: "create" as const, label: t("qbank.home.tabCreate"), icon: Plus },
              { id: "previous" as const, label: t("qbank.home.tabPrevious"), icon: History },
              { id: "tracker" as const, label: t("qbank.home.tabTracker"), icon: Activity },
            ].map((t) => {
              const Icon = t.icon;
              const active = homeTab === t.id;
              return (
                <button
                  key={t.id}
                  onClick={() => onHomeTabChange(t.id)}
                  className={cn(
                    "relative flex items-center gap-2 px-5 py-3 text-sm font-medium transition-colors",
                    active
                      ? "border-b-2 border-primary text-primary"
                      : "border-b-2 border-transparent text-muted-foreground hover:text-foreground"
                  )}
                >
                  <Icon className="size-4" />
                  {t.label}
                </button>
              );
            })}
          </nav>
        </div>

        {/* Content zone — flex-1 min-h-0. Scrolling happens inside each
            tab's own content (NavigationStack home/subpage layers for the
            Content tab; overflow-y-auto wrappers for Create/Previous). */}
        <div className="flex-1 min-h-0 max-w-7xl mx-auto w-full px-4 md:px-6 lg:px-8 py-4 sm:py-6">
          {homeTab === "content" && (
            <ContentTab
              data={data}
              onOpenPack={onOpenPack}
              onPickForCreateTest={onPickForCreateTest}
              onContextMenu={handleContextMenu}
            />
          )}
          {homeTab === "create" && (
            <div className="osler-page">
              <CreateTestTab
                data={data}
                testMode={testMode}
                onTestModeChange={onTestModeChange}
                onOpenPack={onOpenPack}
                onSetQuestionLimit={onSetQuestionLimit}
                initialSourceUid={pendingCreateTestSourceUid}
                onConsumeInitialSource={onClearPendingCreateTestSource}
                onStartCustomSession={onStartCustomSession}
              />
            </div>
          )}
          {homeTab === "previous" && (
            <div className="osler-page">
              <PreviousTestsTab
                sessions={savedSessions}
                onDelete={(id) => sessions.delete(id)}
                onStartCustomSession={onStartCustomSession}
              />
            </div>
          )}
          {homeTab === "tracker" && (
            <div className="osler-page">
              <TrackerTab
                data={data}
                onStartCustomSession={onStartCustomSession}
              />
            </div>
          )}
        </div>
      </div>

      {/* Right-click export dialog for content packs */}
      {exportDialogOpen && contextMenuNode && (
        <PackExportDialog
          open={exportDialogOpen}
          onOpenChange={setExportDialogOpen}
          node={contextMenuNode}
          items={data?.items ?? []}
        />
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
 * PACK EXPORT DIALOG — Export selected pack(s) as a compiled PDF booklet
 * ───────────────────────────────────────────────────────────────────────── */
function PackExportDialog({
  open,
  onOpenChange,
  node,
  items,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  node: ContentTreeNode;
  items: PackEntry[];
}) {
  const { t } = useI18n();
  const [styleMode, setStyleMode] = React.useState<"standard" | "compact" | "mcqnotes">("standard");
  const [answersMode, setAnswersMode] = React.useState<PdfExportOptions["answersMode"]>("endbook");
  const [showExplanations, setShowExplanations] = React.useState(true);
  const [twoCol, setTwoCol] = React.useState(false);
  const [fontSize, setFontSize] = React.useState<"small" | "medium" | "large">("medium");
  const [fontType, setFontType] = React.useState<"serif" | "sans">("serif");
  const [includeCover, setIncludeCover] = React.useState(true);
  const [exporting, setExporting] = React.useState(false);
  const [selectedUids, setSelectedUids] = React.useState<Set<string>>(new Set());

  // Collect all leaf (pack) nodes under the context-menu target.
  const collectLeafPacks = React.useCallback((n: ContentTreeNode): ContentTreeNode[] => {
    if (n.items.length === 0) return [n];
    return n.items.flatMap(collectLeafPacks);
  }, []);

  const leafPacks = React.useMemo(() => collectLeafPacks(node), [node, collectLeafPacks]);

  // Pre-select all leaf packs on mount.
  React.useEffect(() => {
    if (open) setSelectedUids(new Set(leafPacks.map((p) => p.uid)));
  }, [open, leafPacks]);

  const togglePack = (uid: string) => {
    setSelectedUids((prev) => {
      const next = new Set(prev);
      if (next.has(uid)) next.delete(uid);
      else next.add(uid);
      return next;
    });
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      const selected = leafPacks.filter((p) => selectedUids.has(p.uid));
      const chapters = selected
        .map((p) => {
          const entry = items.find((i) => i.node.uid === p.uid);
          if (!entry?.content) return null;
          const questions = toQuestions(entry.content);
          return {
            title: p.title,
            description: entry.content.meta.description ?? "",
            questions: questions.map((q) => ({
              stem: q.stem,
              choices: q.choices ?? [],
              correct: q.correct ?? 0,
              explanation: q.explanation ?? "",
              difficulty: (q as any).difficulty,
              tags: (q as any).tags,
            })),
          };
        })
        .filter(Boolean) as PdfExportConfig["chapters"];

      if (chapters.length === 0) {
        toast({ title: t("pdf.context.noPacks"), variant: "destructive" });
        setExporting(false);
        return;
      }

      const cfg: PdfExportConfig = {
        page: { pageSize: "a4", orientation: "portrait" },
        cover: { title: node.title ?? "QBank Export", subtitle: `${chapters.length} pack(s) · ${chapters.reduce((a, c) => a + c.questions.length, 0)} questions` },
        includeCover,
        styleMode,
        answersMode,
        showExplanations,
        twoCol,
        fontSize,
        fontType,
        lang: loadUiLang(),
        chapters,
      };
      const doc = generateQuizCompilationPdf(cfg);
      downloadPdf(doc, (node.title ?? "").replace(/[^a-zA-Z0-9\s\-_]/g, "").trim() || "export");
      toast({ title: t("pdf.pdfReady"), description: t("pdf.pdfReadyDesc") });
    } catch (e) {
      toast({ title: t("pdf.context.exportFailed"), description: String(e), variant: "destructive" });
    } finally {
      setExporting(false);
      onOpenChange(false);
    }
  };

  function toQuestions(content: AnyContent): Array<{ stem: string; choices?: string[]; correct?: number; explanation?: string }> {
    const c = content as any;
    if (c.questions) {
      return c.questions.map((q: any) => ({
        stem: q.question ?? q.stem ?? "",
        choices: q.options ?? q.choices ?? [],
        correct: q.correct ?? 0,
        explanation: q.explanation ?? "",
        difficulty: q.difficulty,
        tags: q.tags,
      }));
    }
    if (c.passages) {
      return c.passages.flatMap((p: any) =>
        (p.questions ?? []).map((q: any) => ({
          stem: `${p.title ? p.title + " — " : ""}${q.question ?? q.stem ?? ""}`,
          choices: q.options ?? q.choices ?? [],
          correct: q.correct ?? 0,
          explanation: q.explanation ?? "",
          difficulty: q.difficulty,
          tags: q.tags,
        }))
      );
    }
    if (c.prompts) {
      return c.prompts.map((q: any) => ({
        stem: q.question ?? q.stem ?? "",
        choices: q.options ?? q.choices ?? [],
        correct: q.correct ?? 0,
        explanation: q.explanation ?? "",
        difficulty: q.difficulty,
        tags: q.tags,
      }));
    }
    return [];
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Download className="size-5 text-primary" />
            {t("pdf.context.title", { title: node.title })}
          </DialogTitle>
          <DialogDescription>
            {t("pdf.context.desc")}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Pack selection */}
          <div className="space-y-1.5">
            <Label className="text-xs">{t("pdf.context.packs", { n: leafPacks.length })}</Label>
            <div className="border border-border rounded-lg max-h-48 overflow-y-auto medos-scroll divide-y divide-border">
              {leafPacks.map((p) => {
                const entry = items.find((i) => i.node.uid === p.uid);
                const qCount = entry?.content ? toQuestions(entry.content).length : 0;
                return (
                  <label
                    key={p.uid}
                    className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-muted/40 transition-colors"
                  >
                    <Checkbox
                      checked={selectedUids.has(p.uid)}
                      onCheckedChange={() => togglePack(p.uid)}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{p.title}</div>
                      <div className="text-xs text-muted-foreground">{t("pdf.context.questions", { n: qCount })}</div>
                    </div>
                  </label>
                );
              })}
            </div>
          </div>

          {/* Style mode */}
          <div className="space-y-1.5">
            <Label className="text-xs">{t("pdf.styleMode")}</Label>
            <div className="flex gap-1.5 flex-wrap">
              {(["standard", "compact", "mcqnotes"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => { haptic("selection"); setStyleMode(m); }}
                  className={cn(
                    "px-3 h-7 rounded-full text-xs font-medium transition-colors",
                    styleMode === m ? "bg-primary text-primary-foreground" : "bg-muted/60 text-muted-foreground hover:text-foreground"
                  )}
                >
                  {t(`pdf.style.${m}` as "pdf.style.standard")}
                </button>
              ))}
            </div>
          </div>

          {/* Answers mode */}
          <div className="space-y-1.5">
            <Label className="text-xs">{t("pdf.answersMode")}</Label>
            <div className="flex gap-1.5 flex-wrap">
              {(["inline", "endchapter", "endbook", "none"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => { haptic("selection"); setAnswersMode(m); }}
                  className={cn(
                    "px-3 h-7 rounded-full text-xs font-medium transition-colors capitalize",
                    answersMode === m ? "bg-primary text-primary-foreground" : "bg-muted/60 text-muted-foreground hover:text-foreground"
                  )}
                >
                  {t(`pdf.answer.${m}` as "pdf.answer.inline")}
                </button>
              ))}
            </div>
          </div>

          {/* Toggles */}
          <div className="flex items-center justify-between">
            <Label className="text-xs">{t("pdf.showExplanations")}</Label>
            <button
              type="button"
              onClick={() => { haptic("selection"); setShowExplanations(!showExplanations); }}
              className={cn(
                "w-10 h-5.5 rounded-full transition-colors relative",
                showExplanations ? "bg-primary" : "bg-muted"
              )}
            >
              <span className={cn("absolute top-0.5 size-4.5 rounded-full bg-white transition-transform", showExplanations ? "left-5" : "left-0.5")} />
            </button>
          </div>

          <div className="flex items-center justify-between">
            <Label className="text-xs">{t("pdf.includeCover")}</Label>
            <button
              type="button"
              onClick={() => { haptic("selection"); setIncludeCover(!includeCover); }}
              className={cn(
                "w-10 h-5.5 rounded-full transition-colors relative",
                includeCover ? "bg-primary" : "bg-muted"
              )}
            >
              <span className={cn("absolute top-0.5 size-4.5 rounded-full bg-white transition-transform", includeCover ? "left-5" : "left-0.5")} />
            </button>
          </div>

          <div className="flex items-center justify-between">
            <Label className="text-xs">{t("pdf.twoColumn")}</Label>
            <button
              type="button"
              onClick={() => { haptic("selection"); setTwoCol(!twoCol); }}
              className={cn(
                "w-10 h-5.5 rounded-full transition-colors relative",
                twoCol ? "bg-primary" : "bg-muted"
              )}
            >
              <span className={cn("absolute top-0.5 size-4.5 rounded-full bg-white transition-transform", twoCol ? "left-5" : "left-0.5")} />
            </button>
          </div>

          {/* Font size */}
          <div className="space-y-1.5">
            <Label className="text-xs">{t("pdf.fontSize")}</Label>
            <div className="flex gap-1.5">
              {(["small", "medium", "large"] as const).map((sz) => (
                <button
                  key={sz}
                  type="button"
                  onClick={() => { haptic("selection"); setFontSize(sz); }}
                  className={cn(
                    "px-2.5 h-6 rounded-md text-xs font-medium transition-colors capitalize",
                    fontSize === sz ? "bg-primary text-primary-foreground" : "bg-muted/60 text-muted-foreground"
                  )}
                >
                  {t(`pdf.fontSize.${sz}` as "pdf.fontSize.small")}
                </button>
              ))}
            </div>
          </div>

          {/* Font type */}
          <div className="space-y-1.5">
            <Label className="text-xs">{t("pdf.fontType")}</Label>
            <div className="flex gap-1.5">
              {(["serif", "sans"] as const).map((ft) => (
                <button
                  key={ft}
                  type="button"
                  onClick={() => { haptic("selection"); setFontType(ft); }}
                  className={cn(
                    "px-2.5 h-6 rounded-md text-xs font-medium transition-colors capitalize",
                    fontType === ft ? "bg-primary text-primary-foreground" : "bg-muted/60 text-muted-foreground"
                  )}
                >
                  {t(`pdf.fontType.${ft}` as "pdf.fontType.serif")}
                </button>
              ))}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} className="rounded-xl">
            {t("common.cancel")}
          </Button>
          <Button onClick={handleExport} disabled={exporting || selectedUids.size === 0} className="rounded-xl">
            <Download className="size-4 me-1.5" />
            {exporting ? t("pdf.generating") : t("pdf.context.generate")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
 * CONTENT TAB — Grid of premade content packs grouped by engine type
 * ───────────────────────────────────────────────────────────────────────── */
const ENGINE_ICONS: Record<
  EngineType,
  React.ComponentType<{ className?: string; style?: React.CSSProperties }>
> = {
  quiz: ClipboardCheck,
  bank: BookOpen,
  flashcard: Layers,
  written: PenTool,
  osce: Activity,
  library: BookOpen,
  video: VideoIcon,
};

function PackCard({
  node,
  content,
  index,
  onOpenPack,
  onContextMenu,
}: {
  node: ContentTreeNode;
  content: AnyContent;
  index: number;
  onOpenPack?: (item: ContentTreeNode) => void;
  onContextMenu?: (e: React.MouseEvent, item: ContentTreeNode) => void;
}) {
  const { t, rtl } = useI18n();
  const meta = ENGINE_META[node.type as EngineType];
  const Icon = ENGINE_ICONS[node.type as EngineType] ?? ListChecks;
  const count = countQuestions(content);
  const packProgress = storage.packProgress(node.uid);
  const accuracy =
    packProgress.attempted > 0
      ? Math.round((packProgress.correct / packProgress.attempted) * 100)
      : 0;
  const isAr = (content.meta.lang ?? node.lang) === "ar";

  // Build the list of content URLs for this pack (used by the download button).
  // Mirrors the URL pattern in lib/osler/content.ts → loadNodeContent().
  const categoryFolder =
    node.type === "flashcard"
      ? "flashcard"
      : node.type === "osce"
        ? "osce"
        : node.type === "library"
          ? "library"
          : "qbank";
  const packUrls = React.useMemo(() => {
    const base = `/osler-content/${categoryFolder}/${node.path}`;
    const urls = (node.files ?? []).map((f) => `${base}${f}`);
    for (const img of node.images ?? []) urls.push(`${base}images/${img}`);
    return urls;
  }, [categoryFolder, node.path, node.files, node.images]);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpenPack?.(node)}
      onContextMenu={(e) => {
        if (onContextMenu) {
          e.preventDefault();
          onContextMenu(e, node);
        }
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpenPack?.(node);
        }
      }}
      className={cn(
        "medos-fade-in text-start bg-card border border-border rounded-xl p-5 hover:border-primary/40 hover:shadow-md hover:bg-primary/[0.02] transition-colors group flex flex-col gap-3 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
        isAr && "osler-content-ar",
      )}
      dir={isAr ? "rtl" : undefined}
      lang={isAr ? "ar" : undefined}
      style={{ animationDelay: `${index * 0.03}s` }}
    >
      <div className="flex items-center gap-3">
        <div
          className="size-11 rounded-xl flex items-center justify-center shrink-0"
          style={{ backgroundColor: `${meta.color}/15`, color: meta.color }}
        >
          <Icon className="size-5" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold truncate text-foreground">{node.title}</h3>
          <p className="text-xs text-muted-foreground">
            {t("qbank.home.questions", { n: count })}
          </p>
        </div>
        {isAr && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/15 text-primary font-semibold shrink-0">
            {t("lang.badge.ar")}
          </span>
        )}
        {/* Per-pack download button — precache this pack's content for offline use. */}
        <ContentCacheButton packId={node.uid} urls={packUrls} />
        <ChevronRight className={cn("size-4 text-muted-foreground/40 group-hover:text-muted-foreground transition-colors shrink-0", rtl && "rtl-flip-x")} />
      </div>
      <p className="text-xs text-muted-foreground/70 line-clamp-2">
        {content.meta.description}
      </p>
      {packProgress.attempted > 0 ? (
        <>
          <div className="flex items-center gap-2 text-[11px]">
            <span className="text-success font-medium tabular-nums">{accuracy}%</span>
            <span className="text-muted-foreground">{t("dash.accuracy")}</span>
          </div>
          <div className="h-1.5 rounded-full bg-muted/40 overflow-hidden">
            <div
              className="h-full rounded-full bg-success transition-all duration-300"
              style={{ width: `${accuracy}%` }}
            />
          </div>
        </>
      ) : (
        <span className="text-[11px] text-muted-foreground/50">{t("qbank.home.start")}</span>
      )}
    </div>
  );
}

/**
 * Inline content-language filter — mirrors the global setting from the i18n
 * provider, with three pills: All / English / Arabic. Clicking a pill
 * immediately updates the persisted preference so the filter is consistent
 * across Library, QBank, Flashcards, and OSCE.
 */
export function ContentLangFilter() {
  const { t, contentFilter, setContentFilter } = useI18n();
  const pills: Array<{ id: "all" | "en" | "ar"; label: string }> = [
    { id: "all", label: t("settings.language.contentLangAll") },
    { id: "en", label: t("settings.language.enName") },
    { id: "ar", label: t("settings.language.arName") },
  ];
  return (
    <div className="flex items-center gap-2 mb-5 flex-wrap">
      <span className="text-[11px] uppercase tracking-wider text-muted-foreground me-1">
        {t("qbank.home.filterLang")}:
      </span>
      {pills.map((p) => (
        <button
          key={p.id}
          onClick={() => setContentFilter(p.id)}
          className={cn(
            "px-3 py-1 rounded-full text-xs font-medium transition-colors",
            contentFilter === p.id
              ? "bg-primary text-primary-foreground"
              : "bg-muted/60 text-muted-foreground hover:text-foreground",
            p.id === "ar" && contentFilter !== p.id && "osler-content-ar",
          )}
          dir={p.id === "ar" ? "rtl" : undefined}
        >
          {p.label}
        </button>
      ))}
    </div>
  );
}

function ContentTab({
  data,
  onOpenPack,
  onPickForCreateTest,
  onContextMenu,
}: {
  data: { items: PackEntry[]; trees: Record<string, ContentTreeNode[]> } | null;
  onOpenPack?: (item: ContentTreeNode) => void;
  /** P1-2: leaf pack click hands off to Create Test instead of starting a quiz. */
  onPickForCreateTest?: (node: ContentTreeNode) => void;
  onContextMenu?: (e: React.MouseEvent, item: ContentTreeNode) => void;
}) {
  const { t, rtl, contentFilter } = useI18n();
  const [selectedFolderIdx, setSelectedFolderIdx] = React.useState<number | null>(null);
  const [search, setSearch] = React.useState("");

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
   * Recursively collect all leaf uids under a tree node.
   */
  const collectLeafUids = React.useCallback((node: ContentTreeNode): string[] => {
    if (node.items.length === 0) return [node.uid];
    return node.items.flatMap(collectLeafUids);
  }, []);

  /**
   * Per-folder stat rollup — aggregates all leaf packs under a node.
   */
  const folderStats = React.useCallback(
    (node: ContentTreeNode): { packs: number; questions: number; attempted: number; correct: number } => {
      const uids = collectLeafUids(node);
      let packs = 0;
      let questions = 0;
      let attempted = 0;
      let correct = 0;
      for (const uid of uids) {
        const content = contentByUid.get(uid);
        if (!content) continue;
        packs += 1;
        questions += countQuestions(content);
        const p = storage.packProgress(uid);
        attempted += p.attempted;
        correct += p.correct;
      }
      return { packs, questions, attempted, correct };
    },
    [contentByUid, collectLeafUids],
  );

  /**
   * Recursively filter a tree by a title-substring match.
   */
  const filterTree = React.useCallback(
    (nodes: ContentTreeNode[], q: string): ContentTreeNode[] => {
      if (!q) return nodes;
      const needle = q.toLowerCase();
      function walk(list: ContentTreeNode[]): ContentTreeNode[] {
        const out: ContentTreeNode[] = [];
        for (const node of list) {
          const titleMatch = node.title.toLowerCase().includes(needle);
          if (node.items.length === 0) {
            if (titleMatch) out.push(node);
          } else {
            const children = walk(node.items);
            if (titleMatch || children.length > 0) {
              out.push({ ...node, items: children });
            }
          }
        }
        return out;
      }
      return walk(nodes);
    },
    [],
  );

  // Aggregate stats across all content
  const totalStats = React.useMemo(() => {
    let packs = 0;
    let questions = 0;
    let attempted = 0;
    let correct = 0;
    for (const { node, content } of data?.items ?? []) {
      if (!content) continue;
      packs += 1;
      questions += countQuestions(content);
      const p = storage.packProgress(node.uid);
      attempted += p.attempted;
      correct += p.correct;
    }
    return { packs, questions, attempted, correct };
  }, [data]);

  const handleNodeClick = React.useCallback(
    (node: ContentTreeNode) => {
      if (node.items.length > 0) {
        const idx = filteredRootTree.findIndex((n) => n.uid === node.uid);
        if (idx >= 0) setSelectedFolderIdx(idx);
      } else if (node.type === "quiz") {
        // Quiz packs are small — start directly.
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
      <div className="flex items-center justify-center py-16">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (data.items.length === 0) {
    return (
      <div className="osler-empty">
        <div className="osler-empty__icon">
          <Grid3x3 className="size-6" />
        </div>
        <h3 className="osler-empty__title">{t("qbank.home.empty")}</h3>
        <p className="osler-empty__body">
          {t("qbank.home.empty")}
        </p>
      </div>
    );
  }

  const selectedFolder = selectedFolderIdx !== null ? filteredRootTree[selectedFolderIdx] : null;
  const accuracy = totalStats.attempted > 0
    ? Math.round((totalStats.correct / totalStats.attempted) * 100)
    : 0;

  // ── DECKS VIEW (root-level pack/folder grid) ──────────────────────────
  const decksView = (
    <div className="max-w-5xl mx-auto px-4 md:px-6 lg:px-8 py-6 md:py-8">
      {/* Stat bar */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        <div className="osler-stat-tile--compact">
          <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
            <Grid3x3 className="size-3.5" />
            {t("dash.packsStarted")}
          </div>
          <div className="osler-stat-tile__value">{totalStats.packs}</div>
        </div>
        <div className="osler-stat-tile--compact">
          <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
            <ListChecks className="size-3.5" />
            {t("dash.attemptedLabel")}
          </div>
          <div className="osler-stat-tile__value">{totalStats.questions}</div>
        </div>
        <div className="osler-stat-tile--compact">
          <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
            <Activity className="size-3.5" />
            {t("dash.accuracy")}
          </div>
          <div className="osler-stat-tile__value">
            {totalStats.attempted > 0 ? `${accuracy}%` : "—"}
          </div>
        </div>
      </div>

      <ContentLangFilter />

      {/* Pack / folder grid */}
      {filteredRootTree.length === 0 ? (
        <div className="osler-empty">
          <div className="osler-empty__icon">
            <Search className="size-6" />
          </div>
          <h3 className="osler-empty__title">{t("qbank.home.empty")}</h3>
          <p className="osler-empty__body">{t("qbank.home.search")}</p>
        </div>
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
              return (
                <div
                  key={node.uid}
                  role="button"
                  tabIndex={0}
                  onClick={() => setSelectedFolderIdx(idx)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setSelectedFolderIdx(idx);
                    }
                  }}
                  className="medos-fade-in text-start bg-card border border-border rounded-xl p-5 hover:border-primary/40 hover:shadow-md hover:bg-primary/[0.02] transition-colors group cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                  style={{ animationDelay: `${idx * 0.04}s` }}
                >
                  <div className="flex items-center gap-3 mb-3">
                    <div
                      className="size-11 rounded-xl flex items-center justify-center shrink-0"
                      style={{ backgroundColor: `${meta.color}/15`, color: meta.color }}
                    >
                      <Folder className="size-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <h3 className="font-semibold truncate">{node.title}</h3>
                      <p className="text-xs text-muted-foreground">
                        {t("qbank.home.packs", { n: fs.packs })}
                      </p>
                    </div>
                    <ChevronRight className="size-4 text-muted-foreground/40 group-hover:text-muted-foreground transition-colors shrink-0" />
                  </div>
                  <p className="text-xs text-muted-foreground/70 line-clamp-2 mb-3">
                    {t("qbank.home.questions", { n: fs.questions })}
                  </p>
                  {fs.attempted > 0 ? (
                    <>
                      <div className="flex items-center gap-2 text-xs">
                        <span className="text-success font-medium tabular-nums">{acc}%</span>
                        <span className="text-muted-foreground">{t("dash.accuracy")}</span>
                      </div>
                      <div className="mt-2 h-1.5 rounded-full bg-muted/40 overflow-hidden">
                        <div
                          className="h-full rounded-full bg-success transition-all duration-300"
                          style={{ width: `${acc}%` }}
                        />
                      </div>
                    </>
                  ) : (
                    <span className="text-xs text-muted-foreground/50">{t("qbank.home.start")}</span>
                  )}
                </div>
              );
            }

            // Leaf — render as a pack card (same pattern as flashcard leaf)
            return <PackCard key={node.uid} node={node} content={contentByUid.get(node.uid)!} index={idx} onOpenPack={handleNodeClick} onContextMenu={onContextMenu} />;
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

    const childTree = filterTree(selectedFolder.items, search.trim());

    subfolderView = (
      <div className="max-w-5xl mx-auto px-4 md:px-6 lg:px-8 py-6 md:py-8">
        {/* Header with back button */}
        <div className="mb-6">
          <button
            onClick={() => { setSelectedFolderIdx(null); setSearch(""); }}
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

        <ContentLangFilter />

        {/* Search */}
        <div className="relative mb-4">
          <Search className={cn("size-4 text-muted-foreground absolute top-1/2 -translate-y-1/2", rtl ? "right-3" : "left-3")} />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("qbank.home.search")}
            className={cn(
              "w-full h-10 rounded-xl border border-border bg-card text-sm px-9 focus:outline-none focus:ring-2 focus:ring-primary/30",
              rtl ? "pr-9 pl-3 text-right" : "pl-9 pr-3",
            )}
          />
          {search && (
            <button
              onClick={() => setSearch("")}
              className={cn(
                "absolute top-1/2 -translate-y-1/2 size-6 rounded-full hover:bg-muted flex items-center justify-center text-muted-foreground",
                rtl ? "left-2" : "right-2",
              )}
              aria-label="Clear search"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>

        {/* Child items grid */}
        {childTree.length === 0 ? (
          <div className="osler-empty">
            <div className="osler-empty__icon">
              <Search className="size-6" />
            </div>
            <h3 className="osler-empty__title">{t("qbank.home.empty")}</h3>
            <p className="osler-empty__body">{t("qbank.home.search")}</p>
          </div>
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
                return (
                  <div
                    key={child.uid}
                    role="button"
                    tabIndex={0}
                    onClick={() => {
                      // For nested branches: start a merged session with all leaf packs
                      if (onPickForCreateTest) {
                        const leaves = collectLeafUids(child);
                        for (const uid of leaves) {
                          const leafNode = findNodeByUid(qbankTree, uid);
                          if (leafNode) onPickForCreateTest(leafNode);
                        }
                      } else {
                        // Open first leaf
                        const leaves = collectLeafUids(child);
                        const firstLeaf = findNodeByUid(qbankTree, leaves[0]);
                        if (firstLeaf) onOpenPack?.(firstLeaf);
                      }
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") e.preventDefault();
                    }}
                    className="medos-fade-in text-start bg-card border border-border rounded-xl p-5 hover:border-primary/40 hover:shadow-md hover:bg-primary/[0.02] transition-colors group cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                    style={{ animationDelay: `${idx * 0.04}s` }}
                  >
                    <div className="flex items-center gap-3 mb-3">
                      <div
                        className="size-11 rounded-xl flex items-center justify-center shrink-0"
                        style={{ backgroundColor: `${childMeta.color}/15`, color: childMeta.color }}
                      >
                        <Folder className="size-5" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <h3 className="font-semibold truncate">{child.title}</h3>
                        <p className="text-xs text-muted-foreground">
                          {t("qbank.home.packs", { n: cfs.packs })}
                        </p>
                      </div>
                      <ChevronRight className="size-4 text-muted-foreground/40 group-hover:text-muted-foreground transition-colors shrink-0" />
                    </div>
                    <p className="text-xs text-muted-foreground/70 line-clamp-2 mb-3">
                      {t("qbank.home.questions", { n: cfs.questions })}
                    </p>
                    {cfs.attempted > 0 ? (
                      <>
                        <div className="flex items-center gap-2 text-xs">
                          <span className="text-success font-medium tabular-nums">{cacc}%</span>
                          <span className="text-muted-foreground">{t("dash.accuracy")}</span>
                        </div>
                        <div className="mt-2 h-1.5 rounded-full bg-muted/40 overflow-hidden">
                          <div
                            className="h-full rounded-full bg-success transition-all duration-300"
                            style={{ width: `${cacc}%` }}
                          />
                        </div>
                      </>
                    ) : (
                      <span className="text-xs text-muted-foreground/50">{t("qbank.home.start")}</span>
                    )}
                  </div>
                );
              }

              // Leaf child — pack card
              const childContent = contentByUid.get(child.uid);
              if (!childContent) return null;
              return <PackCard key={child.uid} node={child} content={childContent} index={idx} onOpenPack={handleNodeClick} />;
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
      onBack={() => { setSelectedFolderIdx(null); setSearch(""); }}
    />
  );
}

/** Recursively search a tree for a node by uid. */
function findNodeByUid(nodes: ContentTreeNode[], uid: string): ContentTreeNode | null {
  for (const node of nodes) {
    if (node.uid === uid) return node;
    if (node.items.length > 0) {
      const found = findNodeByUid(node.items, uid);
      if (found) return found;
    }
  }
  return null;
}

/* Helper: collect all uids (leaf + branch) under a tree — used to
 * auto-expand every folder when a search is active. */
function collectAllUids(nodes: ContentTreeNode[]): string[] {
  const out: string[] = [];
  function walk(list: ContentTreeNode[]) {
    for (const n of list) {
      out.push(n.uid);
      if (n.items.length > 0) walk(n.items);
    }
  }
  walk(nodes);
  return out;
}

/* ─────────────────────────────────────────────────────────────────────────
 * CREATE TEST TAB — Test builder
 * ───────────────────────────────────────────────────────────────────────── */
function CreateTestTab({
  data,
  testMode,
  onTestModeChange,
  onOpenPack,
  onSetQuestionLimit,
  initialSourceUid,
  onConsumeInitialSource,
  onStartCustomSession,
}: {
  data: { items: PackEntry[]; trees: Record<string, ContentTreeNode[]> } | null;
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
  // Tree search (mirrors the Content tab pattern).
  const [search, setSearch] = React.useState("");
  // Folder navigation for source picker (flashcard-style deck browser).
  const [selectedFolderIdx, setSelectedFolderIdx] = React.useState<number | null>(null);
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
    const needle = search.trim().toLowerCase();

    function walk(list: ContentTreeNode[]): ContentTreeNode[] {
      const out: ContentTreeNode[] = [];
      for (const node of list) {
        if (!qbankEngineTypes.has(node.type)) continue;
        const titleMatch = !needle || node.title.toLowerCase().includes(needle);
        if (node.items.length === 0) {
          if (titleMatch) out.push(node);
        } else {
          const children = walk(node.items);
          if (titleMatch || children.length > 0) {
            out.push({ ...node, items: children });
          }
        }
      }
      return out;
    }
    return walk(qbankTree);
  }, [qbankTree, search]);

  // P2-2: when `initialSourceUid` changes, pre-check that source and scroll
  // it into view. Consume the prop so a remount doesn't re-trigger.
  React.useEffect(() => {
    if (!initialSourceUid) return;
    setSelectedSourceUids((prev) =>
      prev.includes(initialSourceUid) ? prev : [...prev, initialSourceUid],
    );
    // Defer the scroll until after the DOM updates.
    requestAnimationFrame(() => {
      preselectScrollRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    });
    onConsumeInitialSource?.();
  }, [initialSourceUid, onConsumeInitialSource]);

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
  // Clamp the stepper value if it overshoots the new pool size.
  React.useEffect(() => {
    const parsed = parseInt(countInput) || 0;
    if (parsed > totalAvailable && totalAvailable > 0) {
      setCountInput(String(totalAvailable));
    }
  }, [totalAvailable, countInput]);

  // Toggle a leaf source on/off, allowing mcq+written mixing.
  const toggleSource = React.useCallback(
    (uid: string) => {
      const entry = entryByUid.get(uid);
      if (!entry) return;
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
    [entryByUid],
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
      tagsFilter: selectedTags,
      onlyMode,
    });
  };

  if (!data) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* Builder column */}
      <div className="lg:col-span-2 space-y-5">
        {/* Test Mode */}
        <div className="qbank-card">
          <SectionHeader number={1} title={t("qbank.home.testMode")} subtitle={t("qbank.home.timed") + " / " + t("qbank.home.tutor")} />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-4">
            <ModeCard
              active={testMode === "timed"}
              onClick={() => onTestModeChange("timed")}
              icon={TimerIcon}
              label={t("qbank.home.timed")}
              description="Simulates actual exam conditions. The test must be completed in the allotted time."
            />
            <ModeCard
              active={testMode === "tutor"}
              onClick={() => onTestModeChange("tutor")}
              icon={Sparkles}
              label={t("qbank.home.tutor")}
              description="Get immediate feedback and explanations after each question."
            />
          </div>
        </div>

        {/* Source packs — flashcard-style deck browser with folder hierarchy */}
        <div className="qbank-card">
          <SectionHeader number={2} title={t("qbank.create.sources")} subtitle={t("qbank.create.sourceHint")} />
          <div className="mt-4 space-y-3">
            {/* Search box */}
            <div className="relative">
              <Search className={cn("size-4 text-muted-foreground absolute top-1/2 -translate-y-1/2", rtl ? "right-3" : "left-3")} />
              <input
                type="text"
                value={search}
                onChange={(e) => { setSearch(e.target.value); setSelectedFolderIdx(null); }}
                placeholder={t("qbank.home.search")}
                className={cn(
                  "w-full h-9 rounded-xl border border-border bg-card text-sm px-9 focus:outline-none focus:ring-2 focus:ring-primary/30",
                  rtl ? "pr-9 pl-3 text-right" : "pl-9 pr-3",
                )}
              />
            </div>

            {/* Folder hierarchy browser */}
            <div className="rounded-xl border border-border bg-card max-h-80 overflow-y-auto medos-scroll">
              {selectedFolderIdx !== null ? (
                /* Subfolder view — children of the selected folder */
                <div className="p-3">
                  <button
                    onClick={() => { setSelectedFolderIdx(null); setSearch(""); }}
                    className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors mb-3"
                  >
                    <ArrowLeft className={cn("size-3.5", rtl && "rtl-flip-x")} />
                    {t("qbank.home.allPacks")}
                  </button>
                  <div className="grid grid-cols-1 gap-2">
                    {filteredTree[selectedFolderIdx]?.items
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
                          const qCount = entry?.content ? countQuestions(entry.content) : 0;
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
                                style={{ backgroundColor: `${childMeta.color}/15`, color: childMeta.color }}
                              >
                                <ChildIcon className="size-4" />
                              </div>
                              <div className="min-w-0 flex-1">
                                <h4 className="text-sm font-medium truncate">{child.title}</h4>
                                <p className="text-[11px] text-muted-foreground">{qCount} {t("qbank.home.questions", { n: qCount }).split(" ").slice(1).join(" ")}</p>
                              </div>
                              <input
                                type="checkbox"
                                checked={isChecked}
                                onChange={(e) => { e.stopPropagation(); toggleSource(child.uid); }}
                                onClick={(e) => e.stopPropagation()}
                                className="size-4 rounded accent-primary shrink-0"
                              />
                            </button>
                          );
                        }
                        // Nested branch — show as a card that merges all its leaves
                        const entry = entryByUid.get(child.uid);
                        const fs = entry?.content ? countQuestions(entry.content) : 0;
                        return (
                          <div
                            key={child.uid}
                            className="flex items-center gap-3 p-3 rounded-xl border border-border"
                          >
                            <div
                              className="size-9 rounded-lg flex items-center justify-center shrink-0"
                              style={{ backgroundColor: `${childMeta.color}/15`, color: childMeta.color }}
                            >
                              <Folder className="size-4" />
                            </div>
                            <div className="min-w-0 flex-1">
                              <h4 className="text-sm font-medium truncate">{child.title}</h4>
                              <p className="text-[11px] text-muted-foreground">{child.items.length} {t("qbank.home.packs", { n: child.items.length }).split(" ").slice(1).join(" ")}</p>
                            </div>
                          </div>
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
                            onClick={() => setSelectedFolderIdx(idx)}
                            className="flex items-center gap-3 p-3 rounded-xl border border-border hover:border-primary/30 hover:bg-primary/[0.02] transition-colors text-start group"
                          >
                            <div
                              className="size-9 rounded-lg flex items-center justify-center shrink-0"
                              style={{ backgroundColor: `${meta.color}/15`, color: meta.color }}
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
                      const qCount = entry?.content ? countQuestions(entry.content) : 0;
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
                            style={{ backgroundColor: `${meta.color}/15`, color: meta.color }}
                          >
                            <NodeIcon className="size-4" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <h4 className="text-sm font-medium truncate">{node.title}</h4>
                            <p className="text-[11px] text-muted-foreground">{qCount} {t("qbank.home.questions", { n: qCount }).split(" ").slice(1).join(" ")}</p>
                          </div>
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={(e) => { e.stopPropagation(); toggleSource(node.uid); }}
                            onClick={(e) => e.stopPropagation()}
                            className="size-4 rounded accent-primary shrink-0"
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
                      aria-label="Remove"
                    >
                      <X className="size-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Tag filter (P2-3) — question-level tags from selected sources */}
        {availableTags.length > 0 && (
          <div className="qbank-card">
            <SectionHeader number={3} title={t("qbank.create.tagQuestionLevel")} subtitle={t("qbank.home.tagsTopics")} />
            <div className="mt-4 flex flex-wrap gap-2">
              {availableTags.map((tag) => {
                const active = selectedTags.includes(tag);
                return (
                  <button
                    key={tag}
                    onClick={() =>
                      setSelectedTags((prev) =>
                        prev.includes(tag) ? prev.filter((x) => x !== tag) : [...prev, tag],
                      )
                    }
                    className={cn(
                      "px-3 py-1.5 rounded-full text-xs font-medium border transition-colors",
                      active
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border bg-card text-foreground hover:border-primary/40",
                    )}
                  >
                    {tag}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Progress-mode filter (P4-2) */}
        <div className="qbank-card">
          <SectionHeader number={4} title={t("qbank.create.onlyMode")} subtitle={t("qbank.tracker.wrongAndFlagged")} />
          <div className="mt-4 flex flex-wrap gap-2">
            {([
              { id: "all" as const, label: t("qbank.create.onlyAll") },
              { id: "new" as const, label: t("qbank.create.onlyNew") },
              { id: "wrong" as const, label: t("qbank.create.onlyWrong") },
              { id: "flagged" as const, label: t("qbank.create.onlyFlagged") },
            ]).map((opt) => (
              <button
                key={opt.id}
                onClick={() => setOnlyMode(opt.id)}
                className={cn(
                  "px-4 py-2 rounded-xl text-sm font-medium border-2 transition-all",
                  onlyMode === opt.id
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border bg-card text-foreground hover:border-primary/40",
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Count + order (P4-1) */}
        <div className="qbank-card">
          <SectionHeader number={5} title={t("qbank.create.countStepper")} subtitle={t("qbank.home.questionOrder")} />
          <div className="mt-4 flex flex-wrap items-center gap-3">
            {/* Stepper */}
            <div className="flex items-center gap-1">
              <button
                onClick={() => setCountInput(String(Math.max(1, desiredCount - 1)))}
                disabled={desiredCount <= 1}
                className="size-9 rounded-xl border border-border bg-card hover:bg-muted/60 flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed"
                aria-label="Decrement"
              >
                <ChevronDown className="size-4 rotate-90" />
              </button>
              <input
                type="number"
                min={1}
                max={totalAvailable > 0 ? totalAvailable : 1}
                value={countInput}
                onChange={(e) => {
                  const v = parseInt(e.target.value);
                  if (isNaN(v)) setCountInput("");
                  else setCountInput(String(Math.max(1, Math.min(v, totalAvailable || 1))));
                }}
                className="w-20 h-9 rounded-xl border border-border bg-card text-sm text-center font-medium tabular-nums focus:outline-none focus:ring-2 focus:ring-primary/30 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              />
              <button
                onClick={() => setCountInput(String(Math.min(totalAvailable || 1, desiredCount + 1)))}
                disabled={desiredCount >= totalAvailable || totalAvailable === 0}
                className="size-9 rounded-xl border border-border bg-card hover:bg-muted/60 flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed"
                aria-label="Increment"
              >
                <ChevronRight className="size-4" />
              </button>
            </div>
            <span className="text-xs text-muted-foreground">
              {t("qbank.create.availableAfterFilter", { n: totalAvailable })}
            </span>

            {/* Order toggle */}
            <div className="ms-auto flex items-center gap-2">
              <span className="text-xs text-muted-foreground">{t("qbank.home.questionOrder")}:</span>
              <div className="flex rounded-xl border border-border bg-card overflow-hidden">
                <button
                  onClick={() => setOrder("sequential")}
                  className={cn(
                    "px-3 py-1.5 text-xs font-medium transition-colors",
                    order === "sequential" ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {t("qbank.home.defaultOrder")}
                </button>
                <button
                  onClick={() => setOrder("random")}
                  className={cn(
                    "px-3 py-1.5 text-xs font-medium transition-colors",
                    order === "random" ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {t("qbank.home.randomized")}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Right rail — Test Summary */}
      <div className="lg:col-span-1">
        <div className="lg:sticky lg:top-6 space-y-4">
          <div className="qbank-card">
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
                <Plus className={cn("size-4", rtl ? "ml-2" : "mr-2")} />
                {t("qbank.create.startCustom")}
              </Button>
              <p className="text-[11px] text-muted-foreground text-center mt-2">
                {selectedEntries.length > 0
                  ? t("qbank.create.availableAfterFilter", { n: totalAvailable })
                  : t("qbank.home.noItems")}
              </p>
            </div>
          </div>

          {/* Selected packs preview */}
          {selectedEntries.length > 0 && (
            <div className="qbank-card">
              <h3 className="text-sm font-semibold text-foreground flex items-center gap-2 mb-3">
                <ListChecks className="size-4 text-primary" />
                {t("qbank.create.matchingPacks")}
              </h3>
              <div className="space-y-2 max-h-64 overflow-y-auto medos-scroll">
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
                      <span className="text-[10px] text-muted-foreground">
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
            </div>
          )}

          <div className="qbank-card">
            <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
              <Lightbulb className="size-4 text-warning" />
              {t("qbank.home.tip")}
            </h3>
            <p
              className="text-xs text-muted-foreground mt-2 leading-relaxed"
              dangerouslySetInnerHTML={{ __html: t("qbank.home.tipContent") }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
 * CHECKBOX COLUMN — Multi-select with select-all (UWorld-style)
 * ───────────────────────────────────────────────────────────────────────── */
function CheckboxColumn({
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
  const allCheckboxRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (allCheckboxRef.current) {
      allCheckboxRef.current.indeterminate = someSelected;
    }
  }, [someSelected]);

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
        <input
          ref={allCheckboxRef}
          type="checkbox"
          checked={allSelected}
          onChange={toggleAll}
          className="size-3.5 rounded accent-primary"
          title={t("qbank.home.selectAll")}
        />
        <span className="text-xs font-semibold uppercase tracking-wider text-foreground flex-1">{title}</span>
        <span className="text-[10px] text-muted-foreground tabular-nums">
          {selected.length}/{items.length}
        </span>
      </div>
      <div className="max-h-48 overflow-y-auto medos-scroll p-1.5">
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
                <input
                  type="checkbox"
                  checked={isSel}
                  onChange={() => toggleOne(item.id)}
                  className="size-3.5 rounded accent-primary"
                />
                <span className={`text-sm flex-1 truncate ${isSel ? "text-foreground font-medium" : "text-foreground"}`}>
                  {item.label}
                </span>
                <span className="text-[10px] text-muted-foreground tabular-nums shrink-0">({item.count})</span>
              </label>
            );
          })
        )}
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
 * MODE CARD — Selectable card for Timed/Tutor mode
 * ───────────────────────────────────────────────────────────────────────── */
function ModeCard({
  active,
  onClick,
  icon: Icon,
  label,
  description,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  description: string;
}) {
  return (
    <button
      onClick={onClick}
      className={cn("qbank-mode-card", active && "active")}
    >
      <div className="qbank-mode-card-icon">
        <Icon className="size-5" />
      </div>
      <div className="flex-1">
        <div className="font-semibold text-sm">{label}</div>
        <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
      </div>
    </button>
  );
}

function PreviousTestsTab({
  sessions: sessionList,
  onDelete,
  onStartCustomSession,
}: {
  sessions: SavedSession[];
  onDelete: (id: string) => void;
  /**
   * P3-1/P3-2: review a past session (read-only) or retake just its wrong
   * questions. Both build a pool from the session's questionRefs/sourceUids.
   */
  onStartCustomSession?: (
    pool: PoolQuestion[],
    meta: {
      title: string;
      engine: EngineType;
      mode?: TestMode;
      onlyMode?: OnlyMode;
      isReview?: boolean;
      dismissAfterCorrect?: boolean;
      savedDrafts?: Record<string, WrittenDraft>;
      savedRubricState?: Record<string, boolean[]>;
      savedAnswers?: Record<number, number>;
      savedRevealed?: Record<number, boolean>;
      savedFlagged?: Record<number, boolean>;
      savedRatings?: Record<string, "easy" | "hard" | "unknown">;
      savedCurrent?: number;
    }
  ) => void;
}) {
  const { t } = useI18n();
  const [pdfDialogOpen, setPdfDialogOpen] = React.useState(false);
  const [pdfTargetId, setPdfTargetId] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  /**
   * Build a PoolQuestion[] for a saved session by:
   *   1. loading each distinct sourceUid via loadContentByUid
   *   2. flattening each into PoolQuestion[] via contentToQuestions
   *   3. filtering to just the ids listed in session.questionRefs (in order)
   *
   * If `wrongOnly` is true, further filter to ids whose stored progress
   * record is incorrect (using storage.getRecord).
   *
   * Falls back gracefully for legacy sessions without questionRefs:
   * loads the single packUid via loadContentByUid and uses all questions.
   */
  const buildPoolForSession = React.useCallback(
    async (s: SavedSession, wrongOnly: boolean): Promise<PoolQuestion[]> => {
      const refs = s.questionRefs;
      // Group refs by sourceUid so we load each pack only once.
      const bySource = new Map<string, string[]>();
      if (refs && refs.length > 0) {
        for (const r of refs) {
          const list = bySource.get(r.sourceUid) ?? [];
          list.push(r.id);
          bySource.set(r.sourceUid, list);
        }
      } else {
        // Legacy session — best-effort fallback.
        bySource.set(s.packUid, []);
      }

      const pool: PoolQuestion[] = [];
      for (const [sourceUid, ids] of bySource.entries()) {
        try {
          const content = await loadContentByUid(sourceUid);
          const stamped = poolContentToQuestions(content, sourceUid, content.meta.title);
          if (ids.length === 0) {
            // Legacy fallback — keep all questions.
            pool.push(...stamped);
          } else {
            // Keep only the ids listed in questionRefs, in order.
            const byId = new Map(stamped.map((q) => [q.id, q]));
            for (const id of ids) {
              const q = byId.get(id);
              if (q) pool.push(q);
            }
          }
        } catch (e) {
          console.warn(`Failed to load source ${sourceUid}:`, e);
        }
      }

      if (wrongOnly) {
        return filterPoolByProgress(pool, "wrong");
      }
      return pool;
    },
    [],
  );

  const handleReview = React.useCallback(
    async (s: SavedSession) => {
      if (!onStartCustomSession) return;
      setBusy(s.id);
      setError(null);
      try {
        const pool = await buildPoolForSession(s, false);
        if (pool.length === 0) {
          setError(t("qbank.review.noQuestions"));
          return;
        }
        // Convert answers/revealed/flagged from string-keyed (JSON) to number-keyed
        const savedAnswers: Record<number, number> = {};
        const savedRevealed: Record<number, boolean> = {};
        const savedFlagged: Record<number, boolean> = {};
        for (const [k, v] of Object.entries(s.answers)) savedAnswers[+k] = v;
        for (const [k, v] of Object.entries(s.revealed)) savedRevealed[+k] = v;
        for (const [k, v] of Object.entries(s.flagged)) savedFlagged[+k] = v;
        onStartCustomSession(pool, {
          title: s.packTitle,
          engine: s.engine,
          mode: s.mode,
          isReview: true,
          savedDrafts: s.writtenDrafts,
          savedRubricState: s.rubricState,
          savedAnswers,
          savedRevealed,
          savedFlagged,
          savedRatings: s.ratings,
          savedCurrent: s.current,
        });
      } finally {
        setBusy(null);
      }
    },
    [buildPoolForSession, onStartCustomSession, t],
  );

  const handleRetakeWrong = React.useCallback(
    async (s: SavedSession) => {
      if (!onStartCustomSession) return;
      setBusy(s.id + "-retake");
      setError(null);
      try {
        const pool = await buildPoolForSession(s, true);
        if (pool.length === 0) {
          setError(t("qbank.review.noQuestions"));
          return;
        }
        onStartCustomSession(pool, {
          title: `${s.packTitle} — ${t("qbank.review.retakeWrong")}`,
          engine: s.engine,
          mode: s.mode,
          onlyMode: "wrong",
          savedDrafts: s.writtenDrafts,
          savedRubricState: s.rubricState,
        });
      } finally {
        setBusy(null);
      }
    },
    [buildPoolForSession, onStartCustomSession, t],
  );

  const handleExport = React.useCallback(async (s: SavedSession, opts: PdfExportOptions) => {
    const totalTimeSec = Math.floor(((s.completedAt ?? Date.now()) - s.startedAt) / 1000);
    const avgTimeSec = s.answeredCount ? Math.round(totalTimeSec / s.answeredCount) : 0;
    const pct = s.totalQuestions ? Math.round((s.correctCount / s.totalQuestions) * 100) : 0;
    const pool = await buildPoolForSession(s, false);
    const questions: FullQuestion[] = pool.map((q) => ({
      stem: q.stem,
      choices: q.choices,
      correct: q.correct,
      explanation: q.explanation,
      modelAnswer: q.modelAnswer,
      isWritten: q.correct < 0,
      difficulty: q.difficulty,
      tags: q.tags,
      rubric: q.rubric,
    }));
    const doc = generateResultsPdf({
      packTitle: s.packTitle,
      mode: s.mode,
      score: {
        pct,
        correct: s.correctCount,
        total: s.totalQuestions,
        answered: s.answeredCount,
        incorrect: s.incorrectCount,
        flagged: s.flaggedCount,
        percentile: Math.min(99, Math.max(1, Math.round(pct * 0.9 + 5))),
        totalTime: formatTime(totalTimeSec),
        avgTime: formatTime(avgTimeSec),
      },
      questions,
      userAnswers: s.answers,
      revealed: s.revealed,
      flagged: s.flagged,
      opts,
    });
    downloadPdf(doc, `${s.packTitle} — Results`);
    toast({ title: t("pdf.pdfReady"), description: t("pdf.pdfReadyDesc") });
  }, [buildPoolForSession, t]);

  if (sessionList.length === 0) {
    return (
      <div className="qbank-card text-center py-12">
        <History className="size-10 text-muted-foreground mx-auto mb-3" />
        <h3 className="text-base font-semibold mb-1">{t("qbank.home.noPreviousTests")}</h3>
        <p className="text-sm text-muted-foreground">
          {t("qbank.home.noPreviousTestsDesc")}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {error && (
        <div className="qbank-card text-sm text-destructive bg-destructive/5 px-4 py-3">
          {error}
        </div>
      )}
      {sessionList.map((s) => {
        const total = s.totalQuestions;
        const pct = total ? Math.round((s.correctCount / total) * 100) : 0;
        return (
          <div
            key={s.id}
            className="qbank-card flex items-center gap-4"
          >
            <div
              className={cn(
                "size-12 rounded-xl flex items-center justify-center shrink-0 text-sm font-bold",
                pct >= 70
                  ? "bg-blue-500/15 text-blue-500"
                  : pct >= 50
                  ? "bg-amber-500/15 text-amber-500"
                  : "bg-red-500/15 text-red-500"
              )}
            >
              {pct}%
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                <span className="text-sm font-semibold truncate">{s.packTitle}</span>
                <Badge variant="secondary" className="text-[10px] capitalize">
                  {s.engine}
                </Badge>
                <Badge variant="outline" className="text-[10px] capitalize">
                  {s.mode}
                </Badge>
              </div>
              <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
                <span>{s.correctCount}/{total} correct</span>
                <span>·</span>
                <span>{s.answeredCount} answered</span>
                <span>·</span>
                <span>{s.flaggedCount} flagged</span>
                <span>·</span>
                <span>{new Date(s.startedAt).toLocaleDateString()}</span>
              </div>
            </div>
            {/* P3-1: Review (read-only) */}
            {onStartCustomSession && (
              <button
                onClick={() => handleReview(s)}
                disabled={busy !== null}
                className="size-8 rounded-md hover:bg-primary/10 hover:text-primary flex items-center justify-center shrink-0 transition-colors disabled:opacity-40"
                title={t("qbank.review.openReview")}
              >
                {busy === s.id ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Eye className="size-4" />
                )}
              </button>
            )}
            {/* P3-2: Retake wrong-only */}
            {onStartCustomSession && (
              <button
                onClick={() => handleRetakeWrong(s)}
                disabled={busy !== null || s.incorrectCount === 0}
                className="size-8 rounded-md hover:bg-primary/10 hover:text-primary flex items-center justify-center shrink-0 transition-colors disabled:opacity-40"
                title={t("qbank.review.retakeWrong")}
              >
                {busy === s.id + "-retake" ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <RotateCcw className="size-4" />
                )}
              </button>
            )}
            {/* Export PDF */}
            <button
              onClick={() => {
                setPdfTargetId(s.id);
                setPdfDialogOpen(true);
              }}
              className="size-8 rounded-md hover:text-primary hover:bg-primary/10 flex items-center justify-center shrink-0 transition-colors"
              title={t("pdf.exportResults")}
            >
              <FileText className="size-4" />
            </button>
            <button
              onClick={() => onDelete(s.id)}
              className="size-8 rounded-md hover:bg-destructive/10 hover:text-destructive flex items-center justify-center shrink-0 transition-colors"
              title="Delete session"
            >
              <Trash2 className="size-4" />
            </button>
          </div>
        );
      })}
      {/* PDF export dialog for selected session */}
      <PdfExportDialog
        open={pdfDialogOpen}
        onOpenChange={(open) => { setPdfDialogOpen(open); if (!open) setPdfTargetId(null); }}
        defaultTitle={pdfTargetId ? sessionList.find(s => s.id === pdfTargetId)?.packTitle ?? "Session" : "Session"}
        variant="quiz"
        onExport={(opts) => {
          const s = sessionList.find(s => s.id === pdfTargetId);
          if (s) handleExport(s, opts);
        }}
      />
    </div>
  );
}



/* ─────────────────────────────────────────────────────────────────────────
 * TRACKER TAB — Overall / per-folder insight + wrong & flagged browser
 * ───────────────────────────────────────────────────────────────────────── */
function TrackerTab({
  data,
  onStartCustomSession,
}: {
  data: { items: PackEntry[]; trees: Record<string, ContentTreeNode[]> } | null;
  onStartCustomSession?: (
    pool: PoolQuestion[],
    meta: {
      title: string;
      engine: EngineType;
      mode?: TestMode;
      dismissAfterCorrect?: boolean;
      isReview?: boolean;
      onlyMode?: OnlyMode;
      savedDrafts?: Record<string, WrittenDraft>;
      savedRubricState?: Record<string, boolean[]>;
    }
  ) => void;
}) {
  const { t, rtl } = useI18n();
  const [, force] = React.useReducer((x) => x + 1, 0);
  React.useEffect(() => {
    const unsub = storage.subscribe(force);
    const unsubHydrated = storage.onHydrated(force);
    return () => {
      unsub();
      unsubHydrated();
    };
  }, []);

  // Selection of question records for the "Start review session" action.
  const [selectedKeys, setSelectedKeys] = React.useState<Set<string>>(new Set());
  // "Keep in tracker" vs "Remove once answered correctly".
  const [dismissAfterCorrect, setDismissAfterCorrect] = React.useState(false);
  // Show dismissed records in the wrong & flagged list (P5-6).
  const [showDismissed, setShowDismissed] = React.useState(false);
  // Expanded pack uid → resolves question text lazily on row-expand.
  const [expandedRecords, setExpandedRecords] = React.useState<Set<string>>(new Set());

  // Build a uid → content map for resolving question text on expand.
  const contentByUid = React.useMemo(() => {
    const map = new Map<string, AnyContent>();
    if (!data) return map;
    for (const { node, content } of data.items) {
      if (content) map.set(node.uid, content);
    }
    return map;
  }, [data]);

  // P5-2: overall progress.
  const overall = React.useMemo(() => {
    const all = storage.allProgress();
    let attempted = 0;
    let correct = 0;
    let wrong = 0;
    let flagged = 0;
    for (const p of all) {
      attempted += p.attempted;
      correct += p.correct;
      wrong += p.wrong;
      flagged += p.flagged;
    }
    return { attempted, correct, wrong, flagged, accuracy: attempted > 0 ? Math.round((correct / attempted) * 100) : 0 };
  }, [data, force]);

  // P5-3: per-folder insight. Walk every QBank-owned engine tree, compute
  // aggregated stats per node (recursive — same pattern as ContentTab).
  const collectLeafUids = React.useCallback((node: ContentTreeNode): string[] => {
    if (node.items.length === 0) return [node.uid];
    return node.items.flatMap(collectLeafUids);
  }, []);

  const folderStats = React.useCallback(
    (node: ContentTreeNode) => {
      const uids = collectLeafUids(node);
      let attempted = 0;
      let correct = 0;
      for (const uid of uids) {
        const p = storage.packProgress(uid);
        attempted += p.attempted;
        correct += p.correct;
      }
      return { attempted, correct, accuracy: attempted > 0 ? Math.round((correct / attempted) * 100) : null };
    },
    [collectLeafUids],
  );

  // P5-4: wrong & flagged question records. We compute across ALL QBank-owned
  // pack uids (not just selected ones). Dismissed records are filtered by
  // default; showDismissed reveals them.
  const allQBankUids = React.useMemo(() => {
    if (!data) return [] as string[];
    return data.items
      .filter((e) => e.node.type === "quiz" || e.node.type === "bank" || e.node.type === "written")
      .map((e) => e.node.uid);
  }, [data]);

  const wrongAndFlagged = React.useMemo(() => {
    if (allQBankUids.length === 0) return [] as Array<QuestionRecord & { key: string }>;
    // Use the dedicated helper — much cheaper than scanning memoryCache in userland.
    const raw = storage.wrongOrFlagged(allQBankUids);
    const out: Array<QuestionRecord & { key: string }> = raw.map((r) => ({
      ...r,
      key: `${r.uid}:${r.qid}`,
    }));
    // Sort newest-first.
    out.sort((a, b) => b.timestamp - a.timestamp);
    return out;
  }, [allQBankUids, data]);

  // If showDismissed is on, also pull dismissed records (they're filtered
  // out by wrongOrFlagged). We re-scan storage.recordsForUids and include
  // dismissed ones.
  const dismissedRecords = React.useMemo(() => {
    if (!showDismissed) return [] as Array<QuestionRecord & { key: string }>;
    const all = storage.recordsForUids(allQBankUids);
    return all
      .filter((r) => r.dismissed)
      .map((r) => ({ ...r, key: `${r.uid}:${r.qid}` }))
      .sort((a, b) => b.timestamp - a.timestamp);
  }, [showDismissed, allQBankUids, data]);

  const visibleRecords = showDismissed
    ? [...wrongAndFlagged, ...dismissedRecords]
    : wrongAndFlagged;

  // Resolve a question's text/stem/explanation lazily on row-expand.
  const resolveQuestion = React.useCallback(
    (uid: string, qid: string): PoolQuestion | null => {
      const content = contentByUid.get(uid);
      if (!content) return null;
      const pool = poolContentToQuestions(content, uid, content.meta.title);
      return pool.find((q) => q.id === qid) ?? null;
    },
    [contentByUid],
  );

  // Resolve pack title for a uid.
  const packTitleFor = React.useCallback(
    (uid: string): string => {
      const entry = data?.items.find((e) => e.node.uid === uid);
      return entry?.node.title ?? uid;
    },
    [data],
  );

  // P5-5: build a review pool from selected records.
  const handleStartReview = () => {
    if (!onStartCustomSession) return;
    if (selectedKeys.size === 0) return;
    const pool: PoolQuestion[] = [];
    // Group selected keys by sourceUid to minimize content loads.
    const bySource = new Map<string, string[]>();
    for (const key of selectedKeys) {
      const [uid, qid] = key.split(":");
      const list = bySource.get(uid) ?? [];
      list.push(qid);
      bySource.set(uid, list);
    }
    for (const [uid, qids] of bySource.entries()) {
      const content = contentByUid.get(uid);
      if (!content) continue;
      const stamped = poolContentToQuestions(content, uid, content.meta.title);
      const byId = new Map(stamped.map((q) => [q.id, q]));
      for (const qid of qids) {
        const q = byId.get(qid);
        if (q) pool.push(q);
      }
    }
    if (pool.length === 0) return;
    onStartCustomSession(pool, {
      title: `${pool.length} ${t("qbank.tracker.startReview")}`,
      engine: pool[0]?.sourceUid ? (contentByUid.get(pool[0].sourceUid!)?.type as EngineType) ?? "quiz" : "quiz",
      mode: "tutor",
      dismissAfterCorrect,
    });
    // Clear selection after starting.
    setSelectedKeys(new Set());
  };

  const toggleSelected = (key: string) => {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleAllVisible = () => {
    setSelectedKeys((prev) => {
      if (prev.size === visibleRecords.length) return new Set();
      return new Set(visibleRecords.map((r) => r.key));
    });
  };

  const toggleExpand = (key: string) => {
    setExpandedRecords((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const [trackerPdfOpen, setTrackerPdfOpen] = React.useState(false);

  // Build folder stats list for tracker PDF export
  const folderStatsList = React.useMemo(() => {
    if (!data) return [] as Array<{ title: string; engine: string; attempted: number; correct: number; lastAttempt: number | null }>;
    const qbankTree = data.trees.quiz ?? data.trees.bank ?? data.trees.written ?? [];
    const list: Array<{ title: string; engine: string; attempted: number; correct: number; lastAttempt: number | null }> = [];
    for (const node of qbankTree) {
      const fs = folderStats(node);
      if (fs.attempted > 0) {
        list.push({
          title: node.title,
          engine: node.type,
          attempted: fs.attempted,
          correct: fs.correct,
          lastAttempt: null, // not tracked at folder level
        });
      }
    }
    return list;
  }, [data, folderStats]);

  const handleExportTrackerPdf = React.useCallback((opts: PdfExportOptions) => {
    const doc = generateDashboardPdf({
      username: "Tracker Report",
      stats: {
        packs: folderStatsList.filter((fs) => fs.attempted > 0).length,
        attempted: overall.attempted,
        correct: overall.correct,
        accuracy: overall.accuracy,
      },
      recentPacks: folderStatsList
        .filter((fs) => fs.attempted > 0)
        .map((fs) => ({
          title: fs.title,
          engine: fs.engine ?? "quiz",
          attempted: fs.attempted,
          correct: fs.correct,
          lastAttempt: fs.lastAttempt ?? null,
        })),
      opts,
    });
    downloadPdf(doc, "Tracker Report");
    toast({ title: t("pdf.pdfReady"), description: t("pdf.pdfReadyDesc") });
    setTrackerPdfOpen(false);
  }, [overall, folderStatsList, t]);

  if (!data) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-foreground">{t("qbank.tracker.title")}</h2>
          <p className="text-sm text-muted-foreground mt-1">{t("qbank.tracker.subtitle")}</p>
        </div>
        {overall.attempted > 0 && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setTrackerPdfOpen(true)}
            className="rounded-xl shrink-0"
          >
            <FileText className="size-4 mr-1.5" /> {t("pdf.exportReport")}
          </Button>
        )}
      </div>

      {/* P5-2: Overview */}
      <div>
        <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3">
          {t("qbank.tracker.overview")}
        </h3>
        {overall.attempted === 0 ? (
          <div className="qbank-card text-center py-10 text-sm text-muted-foreground">
            {t("qbank.tracker.noRecords")}
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="qbank-card">
              <div className="text-xs text-muted-foreground">{t("qbank.tracker.attempted")}</div>
              <div className="text-2xl font-bold tabular-nums">{overall.attempted}</div>
            </div>
            <div className="qbank-card">
              <div className="text-xs text-muted-foreground">{t("qbank.tracker.correctLabel")}</div>
              <div className="text-2xl font-bold tabular-nums text-success">{overall.correct}</div>
            </div>
            <div className="qbank-card">
              <div className="text-xs text-muted-foreground">{t("qbank.tracker.wrongLabel")}</div>
              <div className="text-2xl font-bold tabular-nums text-destructive">{overall.wrong}</div>
            </div>
            <div className="qbank-card">
              <div className="text-xs text-muted-foreground">{t("qbank.tracker.accuracy")}</div>
              <div className="text-2xl font-bold tabular-nums">{overall.accuracy}%</div>
            </div>
          </div>
        )}
      </div>

      {/* P5-3: By folder — single qbank tree, folder hierarchy */}
      <div>
        <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3">
          {t("qbank.tracker.byFolder")}
        </h3>
        {(() => {
          const qbankTree = data.trees.quiz ?? data.trees.bank ?? data.trees.written ?? [];
          if (qbankTree.length === 0) {
            return <div className="qbank-card text-center py-10 text-sm text-muted-foreground">{t("qbank.tracker.noRecords")}</div>;
          }
          return (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {qbankTree.map((node) => {
                const fs = folderStats(node);
                if (fs.attempted === 0) return null;
                const acc = fs.accuracy ?? 0;
                const nodeType = node.type as EngineType;
                const meta = ENGINE_META[nodeType];
                const isBranch = node.items.length > 0;
                const NodeIcon = isBranch ? Folder : (ENGINE_ICONS[nodeType] ?? ListChecks);
                return (
                  <div key={node.uid} className="qbank-card">
                    <div className="flex items-center gap-3 mb-2">
                      <div
                        className="size-9 rounded-lg flex items-center justify-center shrink-0"
                        style={{ backgroundColor: `${meta.color}/15`, color: meta.color }}
                      >
                        <NodeIcon className="size-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <h4 className="text-sm font-medium truncate">{node.title}</h4>
                        <p className="text-[11px] text-muted-foreground">
                          {isBranch
                            ? t("qbank.home.packs", { n: node.items.length })
                            : t(`engine.${nodeType}` as any)}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 text-xs">
                      <span className="text-muted-foreground tabular-nums">
                        {fs.attempted} {t("qbank.tracker.attempted").toLowerCase()}
                      </span>
                      <span className={cn("ms-auto font-medium tabular-nums", acc >= 70 ? "text-success" : acc >= 50 ? "text-warning" : "text-destructive")}>
                        {acc}%
                      </span>
                    </div>
                    <div className="mt-2 h-1.5 rounded-full bg-muted/40 overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-300"
                        style={{
                          width: `${acc}%`,
                          backgroundColor: acc >= 70 ? "oklch(0.65 0.17 155)" : acc >= 50 ? "oklch(0.75 0.15 80)" : "oklch(0.6 0.2 25)",
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })()}
      </div>

      {/* P5-4 + P5-5: Wrong & Flagged browser + Start review */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            {t("qbank.tracker.wrongAndFlagged")}
          </h3>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setShowDismissed((s) => !s)}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              {showDismissed ? t("qbank.tracker.hideDismissed") : t("qbank.tracker.showDismissed")}
            </button>
            {visibleRecords.length > 0 && (
              <button
                onClick={toggleAllVisible}
                className="text-xs text-primary hover:underline"
              >
                {selectedKeys.size === visibleRecords.length
                  ? t("qbank.tracker.selectAll")
                  : t("qbank.tracker.selectAll")}
              </button>
            )}
          </div>
        </div>

        {visibleRecords.length === 0 ? (
          <div className="qbank-card text-center py-10 text-sm text-muted-foreground">
            {t("qbank.tracker.noRecords")}
          </div>
        ) : (
          <>
            {/* Review-session toolbar */}
            <div className="qbank-card flex flex-wrap items-center gap-3 mb-3">
              <span className="text-xs text-muted-foreground tabular-nums">
                {t("qbank.tracker.selected", { n: selectedKeys.size })}
              </span>
              <label className="flex items-center gap-2 text-xs cursor-pointer">
                <input
                  type="checkbox"
                  checked={dismissAfterCorrect}
                  onChange={(e) => setDismissAfterCorrect(e.target.checked)}
                  className="size-3.5 rounded accent-primary"
                />
                {t("qbank.tracker.removeOnCorrect")}
              </label>
              <Button
                onClick={handleStartReview}
                disabled={selectedKeys.size === 0 || !onStartCustomSession}
                size="sm"
                className="ms-auto"
              >
                {t("qbank.tracker.startReview")}
              </Button>
            </div>

            {/* Records list */}
            <div className="space-y-2">
              {visibleRecords.map((r) => {
                const isSelected = selectedKeys.has(r.key);
                const isExpanded = expandedRecords.has(r.key);
                const q = isExpanded ? resolveQuestion(r.uid, r.qid) : null;
                const packTitle = packTitleFor(r.uid);
                return (
                  <div key={r.key} className="qbank-card">
                    <div className="flex items-center gap-3">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleSelected(r.key)}
                        className="size-3.5 rounded accent-primary shrink-0"
                      />
                      <button
                        onClick={() => toggleExpand(r.key)}
                        className="flex-1 min-w-0 text-start"
                      >
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-medium truncate">{packTitle}</span>
                          {r.dismissed && (
                            <Badge variant="outline" className="text-[10px]">
                              {t("qbank.tracker.dismissed")}
                            </Badge>
                          )}
                          <Badge
                            variant="outline"
                            className={cn(
                              "text-[10px]",
                              r.correct ? "border-success/30 text-success" : "border-destructive/30 text-destructive",
                            )}
                          >
                            {r.correct ? t("qbank.tracker.correctLabel") : t("qbank.tracker.wrongLabel")}
                          </Badge>
                          {r.flagged && (
                            <Badge variant="outline" className="text-[10px] border-amber-500/30 text-amber-500">
                              <Flag className="size-2.5 mr-1" />
                              {t("qbank.tracker.flaggedLabel")}
                            </Badge>
                          )}
                        </div>
                        <div className="text-[11px] text-muted-foreground mt-0.5">
                          {t("qbank.tracker.lastAttempt")}: {new Date(r.timestamp).toLocaleString()}
                        </div>
                      </button>
                      <ChevronRight
                        className={cn(
                          "size-4 text-muted-foreground transition-transform shrink-0",
                          isExpanded && "rotate-90",
                          rtl && "rtl-flip-x",
                        )}
                      />
                    </div>
                    {isExpanded && q && (
                      <div className="mt-3 pt-3 border-t border-border text-sm space-y-2">
                        <div className="font-medium uworld-prose" dir="auto" dangerouslySetInnerHTML={{ __html: renderQuestionText(q.stem, q) }} />
                        {q.choices.length > 0 && (
                          <div className="space-y-1">
                            {q.choices.map((choice, i) => (
                              <div
                                key={i}
                                dir="auto"
                                className={cn(
                                  "px-2 py-1 rounded text-xs",
                                  i === q.correct && "bg-success/10 text-success font-medium",
                                  i === r.selected && i !== q.correct && "bg-destructive/10 text-destructive line-through",
                                )}
                              >
                                <span className="font-medium me-2">{choiceLetter(i, contentByUid.get(r.uid)?.meta.lang)}</span>
                                {choice}
                              </div>
                            ))}
                          </div>
                        )}
                        {q.explanation && (
                          <div className="text-xs text-muted-foreground bg-muted/40 px-3 py-2 rounded-lg">
                            {q.explanation}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>

      <PdfExportDialog
        open={trackerPdfOpen}
        onOpenChange={setTrackerPdfOpen}
        defaultTitle="Tracker Report"
        variant="dashboard"
        onExport={handleExportTrackerPdf}
      />
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
 * QUIZ VIEW — Full QBank Studio with all tools
 * ───────────────────────────────────────────────────────────────────────── */
// Isolated, self-ticking timer. Owns its own 1s interval so the rest of the
// QuizView (notably the highlighter's DOM/selection) never re-renders per tick.
// Render it with a `key` tied to the session start so a fresh session resets it.
function QBankTimer({
  mode,
  startedAt,
  initialRemaining,
  paused,
  onExpire,
}: {
  mode: TestMode;
  startedAt: number;
  initialRemaining: number;
  paused: boolean;
  onExpire: () => void;
}) {
  const [now, setNow] = React.useState(() => Date.now());
  const [remaining, setRemaining] = React.useState(initialRemaining);
  const onExpireRef = React.useRef(onExpire);
  onExpireRef.current = onExpire;

  // Wall-clock anchor: the absolute timestamp when the timer expires.
  // Pauses push this into the future so no time is lost to sleep/throttle.
  const endTimeRef = React.useRef(Date.now() + initialRemaining * 1000);
  const pauseStartRef = React.useRef<number | null>(null);

  // 1s tick — drives the tutor-mode elapsed clock.
  React.useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // Track pauses — push endTime forward by the paused duration so the
  // user doesn't lose time to background throttling or screen sleep.
  React.useEffect(() => {
    if (mode !== "timed") return;
    if (paused) {
      pauseStartRef.current = Date.now();
    } else if (pauseStartRef.current !== null) {
      endTimeRef.current += Date.now() - pauseStartRef.current;
      pauseStartRef.current = null;
    }
  }, [paused, mode]);

  // Timed countdown — derived from wall clock so throttled intervals
  // after sleep/background still compute the correct remaining time.
  React.useEffect(() => {
    if (mode !== "timed") return;
    const tick = () => {
      const r = Math.max(0, Math.ceil((endTimeRef.current - Date.now()) / 1000));
      setRemaining(r);
      if (r <= 0) onExpireRef.current();
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [mode]);

  const display =
    mode === "timed" ? remaining : Math.floor((now - startedAt) / 1000);
  const danger = mode === "timed" && remaining < 300;

  return (
    <div
      className={cn(
        "flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-sm font-mono tabular-nums",
        danger ? "bg-red-500/100 text-white" : "bg-primary-foreground/15"
      )}
    >
      <Clock className="size-3.5" />
      <span className="font-mono tabular-nums">{formatTime(display)}</span>
    </div>
  );
}

// Self-ticking elapsed-time readout (tutor "time spent"). Isolated so the
// surrounding view doesn't re-render every second.
function ElapsedTime({ startedAt }: { startedAt: number }) {
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  return (
    <span className="font-mono tabular-nums">
      {formatTime(Math.floor((now - startedAt) / 1000))}
    </span>
  );
}

function QuizView({
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
  onToggleNavMobile,
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
  onFinish,
  onTimeUp,
  onExitRequest,
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
  onToggleNavMobile: () => void;
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
  onFinish: () => void;
  onExitRequest: () => void;
}) {
  const q = session.questions[session.current];
  const isLast = session.current >= session.questions.length - 1;
  const readonly = !!session.isReview;
  const submitted = readonly || session.revealed[session.current] || false;
  const selected = session.answers[session.current];
  const isMCQ = q ? q.correct >= 0 : false;
  const qIsWritten = q ? (!q.correct || q.correct < 0) && (!!q.rubric?.length || !!q.modelAnswer) : false;
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
  const [hlVersion, setHlVersion] = React.useState(0);
  // Live quiz settings (font, weight, line height, auto-submit, layout, alignment)
  const { settings: quizSettingsState } = useQuizSettings();
  const [articleSearchOpen, setArticleSearchOpen] = React.useState(false);
  const isMobile = useIsMobile();
  const [mobileTutorTab, setMobileTutorTab] = React.useState<"question" | "answer">("question");
  const [showShortcuts, setShowShortcuts] = React.useState(false);
  const bindings = useShortcutBindings();

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
  // Split mode is only active when: explanationMode is "split" AND the user
  // has submitted the answer AND we're in tutor mode (the only mode that
  // reveals explanations inline).
  const isSplitMode = useSplitExplanation && session.mode === "tutor";

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
  const handleSwipeProgress = React.useCallback((dx: number, dy: number) => {
    if (!mobileTabsActive || carouselWidth === 0) return;
    // Only drive the carousel for clearly horizontal gestures.
    if (Math.abs(dx) <= Math.abs(dy) * 1.2) return;
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
    const qHighlights = highlights.get(activeItem.uid, qIdx);
    const qWrittenDraft = session.writtenDrafts[question.id] ?? {
      text: "",
      rubricChecked: question.rubric ? question.rubric.map(() => false) : [],
      submitted: false,
    };
    const qRating = session.ratings[question.id];
    const qRubricState = session.rubricState[question.id] ?? (question.rubric ? question.rubric.map(() => false) : []);

    // Per-question written verdict (for the inline explanation in continuous mode).
    const qWrittenVerdict: "pass" | "fail" | null =
      qWrittenDraft.evaluation?.manualVerdict === "pass" ? "pass"
      : qWrittenDraft.evaluation?.manualVerdict === "fail" ? "fail"
      : null;
    const qWrittenPassed = qWrittenVerdict === "pass" || (qWrittenVerdict === null && qWrittenDraft.evaluation?.passed === true);

    return (
      <div className="h-full overflow-y-auto medos-scroll pr-1 -mr-1 pb-6" style={{ touchAction: "none" }}>
        {/* Question header */}
        <div className="flex flex-wrap items-center justify-between gap-2 pb-3 mb-4 border-b border-border/40">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Badge variant="outline" className="text-[10px] font-medium rounded-md">{engineLabel}</Badge>
            <span className="opacity-50">·</span>
            <span className="capitalize">{question.difficulty ?? t("qbank.session.standard")}</span>
          </div>
          <div className="text-xs text-muted-foreground">
            {t("qbank.session.questionId", { id: question.id })}
          </div>
        </div>

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
        <div className="relative">
          <div className="uworld-prose" style={stemStyle} dir="auto">
            <HighlightedContent
              html={renderQuestionText(question.stem, question, activeItem)}
              highlights={qHighlights}
            />
          </div>
        </div>

        {/* Choices (MCQ only) */}
        {qIsMCQ ? (
          <div className="mt-6 space-y-2.5">
            <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
              {qSubmitted ? t("qbank.session.readOnly") : t("qbank.session.selectOne")}
            </div>
            {qSubmitted && (
              <div className="mb-3 flex items-center gap-4 text-xs text-muted-foreground bg-muted/30 rounded-lg px-3 py-2 border border-border">
                <div className="flex items-center gap-1.5">
                  {qSelected === question.correct ? (
                    <><Check className="size-3.5 text-blue-500" /><span className="text-blue-500 font-semibold">{t("qbank.session.correct")}</span></>
                  ) : (
                    <><X className="size-3.5 text-red-500" /><span className="text-red-500 font-semibold">{t("qbank.session.incorrect")}</span></>
                  )}
                </div>
                <div className="flex items-center gap-1.5">
                  <Timer className="size-3.5" />
                  <ElapsedTime startedAt={session.startedAt} />
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
                  stateClass = "border-blue-600 bg-blue-500/10";
                  letterBg = "bg-blue-500/100 text-white border-blue-600";
                  letterContent = <Check className="size-4" />;
                } else if (isSelected && !isCorrect) {
                  stateClass = "border-red-500 bg-red-500/10";
                  letterBg = "bg-red-500/100 text-white border-red-500";
                  letterContent = <X className="size-4" />;
                } else {
                  stateClass = "border-border bg-card opacity-60";
                }
              } else if (isSelected) {
                stateClass = "border-primary bg-primary/5";
                letterBg = "bg-primary text-primary-foreground border-primary";
              }

              return (
                <button
                  key={idx}
                  data-choice-idx={idx}
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
                  className={`w-full text-start p-3 sm:p-3.5 rounded-xl border-2 transition-all flex items-start gap-3 ${stateClass} ${
                    qSubmitted ? "cursor-default" : "cursor-pointer"
                  } ${hasStrikethrough ? "opacity-60" : ""} medos-touch-target`}
                >
                  <div className={`size-7 rounded-full border-2 flex items-center justify-center text-sm font-semibold shrink-0 ${letterBg}`}>
                    {letterContent}
                  </div>
                  <div
                    className={`flex-1 min-w-0 uworld-prose ${quizSettingsState.textAffectsChoices ? "" : "text-[14px] leading-relaxed"} pt-0.5 select-text ${hasStrikethrough ? "line-through text-muted-foreground" : ""}`}
                    style={choiceStyle}
                    dir="auto"
                  >
                    <HighlightedContent
                      html={renderQuestionText(choice, question, activeItem)}
                      highlights={qHighlights}
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
                </button>
              );
            })}
          </div>
        ) : null}

        {/* Written engine: textarea + grading (interactive only — too complex for previews) */}
        {interactive && qIsWritten && (
          <WrittenEngineView
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
                    ? "border-red-500 bg-red-500/10 text-red-500"
                    : "border-border hover:border-red-500/40"
                }`}
              >
                <X className="size-4 mx-auto mb-1" />
                {t("flash.session.rateHard")}
              </button>
              <button
                onClick={() => onRate(question.id, "unknown")}
                className={`px-3 py-2 rounded-lg text-sm font-medium border-2 transition-all ${
                  qRating === "unknown"
                    ? "border-amber-500 bg-amber-500/10 text-amber-500"
                    : "border-border hover:border-amber-500/40"
                }`}
              >
                <Eye className="size-4 mx-auto mb-1" />
                {t("qbank.session.review")}
              </button>
              <button
                onClick={() => onRate(question.id, "easy")}
                className={`px-3 py-2 rounded-lg text-sm font-medium border-2 transition-all ${
                  qRating === "easy"
                    ? "border-emerald-500 bg-emerald-500/10 text-emerald-500"
                    : "border-border hover:border-emerald-500/40"
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
            Spacing: mt-3 (tight, not mt-6), border-t border-border/40
            (soft separator), py-3 sm:py-4 (compact on mobile). */}
        {interactive && qSubmitted && !useSplitExplanation && (
          <div className="mt-3 border-t border-border/40 bg-muted/20 py-3 sm:py-4 px-4 sm:px-6 lg:px-8 -mr-1 rounded-lg">
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
          <div className="mt-3 border-t border-border/40 bg-muted/20 py-3 sm:py-4 px-4 sm:px-6 lg:px-8 -mr-1 rounded-lg">
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
      let target = "stem";
      let targetText = q.stem;

      let el: HTMLElement | null = range.startContainer instanceof Text
        ? range.startContainer.parentElement
        : (range.startContainer as HTMLElement);
      while (el) {
        const ci = el.getAttribute("data-choice-idx");
        if (ci !== null) {
          const idx = parseInt(ci, 10);
          target = `choice-${idx}`;
          targetText = q.choices[idx] ?? "";
          break;
        }
        if (el.getAttribute("data-explanation") !== null) {
          target = "explanation";
          targetText = q.explanation;
          break;
        }
        el = el.parentElement;
      }

      const idx = targetText.indexOf(text);
      const ranges = idx >= 0 ? [{ start: idx, end: idx + text.length }] : [];

      const hl: HighlightItem = {
        id: crypto.randomUUID(),
        color: highlightColor,
        text,
        target,
        ranges,
        createdAt: new Date().toISOString(),
      };
      highlights.add(activeItem.uid, session.current, hl);
      setHlVersion((v) => v + 1);
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
          highlights.remove(activeItem.uid, session.current, id);
          setHlVersion((v) => v + 1);
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

  // Keyboard shortcuts
  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      // Navigation-only shortcuts in readonly (review) mode
      if (readonly) {
        if (e.key === "ArrowLeft") { e.preventDefault(); goPrev(); }
        if (e.key === "ArrowRight") { e.preventDefault(); goNext(); }
        if (e.key === "?" && !e.shiftKey) { e.preventDefault(); setShowShortcuts((s) => !s); }
        return;
      }
      if (e.key === "f" || e.key === "F") { e.preventDefault(); onToggleFlag(); }
      if (e.key === "ArrowLeft") { e.preventDefault(); goPrev(); }
      if (e.key === "ArrowRight") { e.preventDefault(); goNext(); }
      if (e.key === "?" && !e.shiftKey) { e.preventDefault(); setShowShortcuts((s) => !s); }
      if (e.key === "a" && !e.shiftKey && !e.ctrlKey && !e.metaKey) { e.preventDefault(); onToggleAiAssistant(); }
      if (e.key === "h" || e.key === "H") { e.preventDefault(); setTool((t) => (t && t !== ERASER_TOOL ? null : color)); }
      if (e.key === "e" || e.key === "E") { e.preventDefault(); setTool((t) => (t === ERASER_TOOL ? null : ERASER_TOOL)); }
      if (e.key === "n" || e.key === "N") { e.preventDefault(); onToggleNotes(); }
      if (e.key === "," && !e.shiftKey && !e.ctrlKey && !e.metaKey) { e.preventDefault(); onToggleQuizSettings(); }
      if (isMCQ && !submitted) {
        const num = parseInt(e.key);
        if (num >= 1 && num <= q.choices.length) {
          e.preventDefault();
          onSelect(num - 1);
        }
      }
      if (e.key === "Enter" && !submitted) {
        if (isMCQ ? selected !== undefined : true) {
          e.preventDefault();
          onSubmit();
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [q, isMCQ, submitted, selected, onToggleFlag, goPrev, goNext, onSelect, onSubmit, onToggleAiAssistant, onToggleNotes, onToggleQuizSettings, setTool, readonly]);

  const currentHighlights = React.useMemo(
    () => highlights.get(activeItem.uid, session.current),
    [activeItem.uid, session.current, hlVersion]
  );
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
      {/* ── Top bar (UWorld navy) ───────────────────────────────────────────
          All icon buttons in this bar use size-7 (matching the graduation cap
          button) for visual consistency. The mobile-only navigator button uses
          size-8 to give a slightly larger touch target on phones (it's the
          only way to access the navigator on mobile). */}
      <header
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
          <span className="capitalize">{session.mode} Mode</span>
        </div>

        <button
          onClick={onToggleNavMobile}
          className="md:hidden size-8 rounded-lg bg-primary-foreground/15 hover:bg-primary-foreground/25 flex items-center justify-center me-1 shrink-0"
          title="Question navigator"
          aria-label="Question navigator"
        >
          <ListChecks className="size-4" />
        </button>

        <div className="flex-1 flex items-center justify-center min-w-0">
          <div className="flex items-center gap-2">
            <div className="text-sm font-semibold tracking-wide truncate">
              {t("qbank.session.question", { n: session.current + 1, total: session.questions.length })}
            </div>
            {readonly && (
              <span className="hidden sm:inline-flex text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full bg-primary-foreground/15 text-primary-foreground/80">
                {t("qbank.review.title")}
              </span>
            )}
          </div>
        </div>

        {/* Quiz settings button — opens full settings panel */}
        <button
          onClick={onToggleQuizSettings}
          className={`size-7 rounded-lg flex items-center justify-center transition-colors shrink-0 ${
            quizSettingsOpen
              ? "bg-primary-foreground/30 ring-1 ring-inset ring-primary-foreground/40"
              : "bg-primary-foreground/15 hover:bg-primary-foreground/25"
          }`}
          title="Quiz settings"
          aria-label="Quiz settings"
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
              initialRemaining={session.examTimeRemaining}
              paused={session.examPaused}
              onExpire={onTimeUp}
            />
            <button
              onClick={onTogglePause}
              className="size-7 rounded-lg bg-primary-foreground/15 hover:bg-primary-foreground/25 flex items-center justify-center transition-colors shrink-0"
              title={isPausedOrLocked ? "Resume" : "Pause"}
              aria-label={isPausedOrLocked ? "Resume" : "Pause"}
            >
              {isPausedOrLocked ? <Play className="size-3.5" /> : <Pause className="size-3.5" />}
            </button>
          </div>
        )}

        {!readonly && (
          <>
            {/* Unified highlighter: colors + eraser tool */}
            <HighlighterToolbar
              tone="header"
              control={{
                tool,
                color,
                count: currentHighlights.length,
                onToolChange: setTool,
                onColorChange: setColor,
                onClearAll: () => {
                  highlights.clearAll(activeItem.uid);
                  setHlVersion((v) => v + 1);
                },
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
              title="Notes"
              aria-label="Notes"
              aria-pressed={notesOpen}
            >
              <NotebookPen className="size-3.5" />
            </button>
          </>
        )}
      </header>

      {/* ── Body: Question panel ─────────────────────────────────────────── */}
      <div className="flex flex-1 min-h-0 relative">

        {/* Floating navigator overlay (desktop + mobile) */}
        <AnimatePresence>
          {navOpenMobile && (
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="absolute inset-0 z-30 flex items-start justify-center pt-16 bg-background/60 backdrop-blur-[2px]"
            >
              <motion.div
                initial={{ scale: 0.95, opacity: 0, y: -8 }}
                animate={{ scale: 1, opacity: 1, y: 0 }}
                exit={{ scale: 0.95, opacity: 0, y: -8 }}
                transition={{ type: "spring", damping: 25, stiffness: 300 }}
                onClick={(e) => e.stopPropagation()}
                className="bg-card border border-border rounded-2xl shadow-2xl w-[90vw] max-w-xl max-h-[70vh] overflow-hidden"
              >
                <div className="px-4 py-3 border-b border-border flex items-center justify-between bg-primary text-primary-foreground">
                  <span className="text-sm font-semibold">Question Navigator</span>
                  <button onClick={onToggleNavMobile} className="size-7 rounded-lg hover:bg-primary-foreground/15 flex items-center justify-center">
                    <X className="size-4" />
                  </button>
                </div>
                <div className="overflow-y-auto medos-scroll p-4">
                  <NavigatorPanel
                    session={session}
                    answeredCount={answeredCount} flaggedCount={flaggedCount}
                    correctCount={correctCount} incorrectCount={incorrectCount}
                    progressPct={progressPct}
                    onJumpTo={(idx) => { onJumpTo(idx); onToggleNavMobile(); }}
                    onEndTest={() => { onFinish(); onToggleNavMobile(); }}
                    readonly={readonly}
                  />
                </div>
                <div className="px-4 py-2.5 border-t border-border flex items-center justify-between text-xs text-muted-foreground">
                  <span>{answeredCount}/{session.questions.length} answered</span>
                  <span>{flaggedCount} flagged</span>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Simple question navigator (left strip) */}
        <div className="hidden md:flex flex-col w-12 shrink-0 border-r border-border bg-sidebar">
          <div className="flex-1 overflow-y-auto medos-scroll p-1 space-y-0.5">
            {session.questions.map((_, i) => {
              const ans = session.answers[i];
              const isCurrent = i === session.current;
              const isFlagged = session.flagged[i];
              const isRevealed = session.revealed[i];
              const isCorrect = ans !== undefined && session.questions[i]?.correct === ans;
              const isIncorrect = ans !== undefined && !isCorrect;
              let bg = "bg-sidebar text-muted-foreground border-transparent";
              if (isCurrent) bg = "ring-2 ring-primary bg-sidebar-accent text-foreground";
              else if (isFlagged) bg = "bg-amber-500/20 text-amber-400 border-amber-500/30";
              else if (isRevealed && isCorrect) bg = "bg-blue-500/20 text-blue-300";
              else if (isRevealed && isIncorrect) bg = "bg-red-500/20 text-red-300";
              else if (ans !== undefined) bg = "bg-primary/25 text-primary";
              return (
                <button
                  key={i}
                  onClick={() => onJumpTo(i)}
                  className={`w-full aspect-square rounded text-[10px] font-semibold border transition-all ${bg}`}
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
                  <div className="size-16 rounded-full bg-amber-500/15 border-2 border-amber-500/30 flex items-center justify-center mx-auto mb-4">
                    <Pause className="size-7 text-amber-400" />
                  </div>
                  <h3 className="text-xl font-semibold text-foreground">Test Paused</h3>
                  <p className="text-sm text-muted-foreground mt-2 mb-6">
                    The timer is stopped. Click Resume to continue your test.
                  </p>
                  <Button onClick={onTogglePause} variant="default" className="rounded-xl">
                    <Play className="size-4 mr-2" /> Resume Test
                  </Button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Mobile tutor-mode tab switcher — shown only on phones in split mode after submit */}
          {submitted && session.mode === "tutor" && useSplitExplanation && !readonly && (
            <div className="md:hidden flex border-b border-border bg-muted/30 safe-pt">
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
            className={`flex-1 min-h-0 medos-qbank-split ${
              submitted && session.mode === "tutor" && useSplitExplanation
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
                    className={`medos-qbank-qcol ${(activeItem.lang ?? "en") === "ar" ? "osler-content-ar" : ""} ${
                      submitted && session.mode === "tutor" && useSplitExplanation
                        ? mobileTabsActive ? "w-full flex-none" : "w-[55%] border-e border-border"
                        : "flex-1"
                    } flex flex-col min-h-0`}
                  >
                    {mobileTabsActive && mobileTutorTab === "answer" ? (
                      <div className="flex-1 min-h-0" />
                    ) : (
                      <div className={`flex-1 min-h-0 flex flex-col px-4 sm:px-6 ${submitted && session.mode === "tutor" && useSplitExplanation ? "py-4" : "lg:px-8 py-6"} ${contentAlignClass}`}>
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
                  {submitted && session.mode === "tutor" && useSplitExplanation && (
                    <div
                      className={`medos-qbank-acol ${
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
                              const eqSubmitted = session.revealed[idx] || false;
                              const eqSelected = session.answers[idx];
                              const eqIsMCQ = eq.correct >= 0;
                              const eqIsWritten = !eqIsMCQ && (!!eq.rubric?.length || !!eq.modelAnswer);
                              const eqHighlights = highlights.get(activeItem.uid, idx);
                              return (
                                <div className="h-full overflow-y-auto medos-scroll p-2 pb-6" style={{ touchAction: "none" }}>
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
                        <div className="flex-1 overflow-y-auto medos-scroll">
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
              <ChevronLeft className="size-4 mr-1" /> {t("common.previous")}
            </Button>

            <div className="flex-1" />

            {!readonly && (
              <>
                <div className="flex items-center gap-1">
                  <Button variant="outline" size="sm" onClick={onToggleCalculator} className={`h-9 px-2.5 rounded-lg ${calculatorOpen ? "border-primary bg-primary/10 text-primary" : ""}`} title={t("qbank.session.calculator")}>
                    <CalcIcon className="size-4" />
                  </Button>
                  <Button variant="outline" size="sm" onClick={onToggleLabValues} className={`h-9 px-2.5 rounded-lg ${labValuesOpen ? "border-primary bg-primary/10 text-primary" : ""}`} title={t("qbank.session.labValues")}>
                    <FlaskConical className="size-4" />
                  </Button>
                  <Button
                    variant="outline" size="sm"
                    onClick={onToggleAiAssistant}
                    className={`h-9 px-2.5 rounded-lg ${aiAssistantOpen ? "border-primary bg-primary/10 text-primary" : ""}`}
                    title={t("qbank.session.aiAssistant")}
                  >
                    <Sparkles className="size-4" />
                  </Button>
                  {!isMobile && (
                    <Popover open={articleSearchOpen} onOpenChange={setArticleSearchOpen}>
                      <PopoverTrigger asChild>
                        <Button variant="outline" size="sm" className="h-9 px-2.5 rounded-lg" title={t("qbank.session.openArticle")}>
                          <BookOpen className="size-4" />
                        </Button>
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
                              className="w-full text-left text-sm px-4 py-2.5 hover:bg-muted transition-colors flex items-center gap-2 border-b border-border/40 last:border-0"
                            >
                              <FileText className="size-3.5 shrink-0 text-muted-foreground" />
                              <span className="truncate">{a.title}</span>
                            </button>
                          ))}
                        </div>
                      </PopoverContent>
                    </Popover>
                  )}
                  <Button
                    variant="outline" size="sm"
                    onClick={() => setShowShortcuts((s) => !s)}
                    className={`h-9 px-2.5 rounded-lg ${showShortcuts ? "border-primary bg-primary/10 text-primary" : ""}`}
                    title={t("qbank.session.keyboardShortcuts")}
                  >
                    <Keyboard className="size-4" />
                  </Button>
                </div>

                <div className="h-5 w-px bg-border mx-1 hidden sm:block" />

                <Button
                  variant="outline" size="sm" onClick={onToggleFlag}
                  className={`h-9 rounded-lg ${session.flagged[session.current] ? "border-amber-400 bg-amber-500/10 text-amber-300 hover:bg-amber-500/15" : ""}`}
                  title={session.flagged[session.current] ? t("qbank.session.unflagQuestion") : t("qbank.session.flagForReview")}
                >
                  <Flag className={`size-4 ${session.flagged[session.current] ? "fill-amber-500 text-amber-500" : ""}`} />
                  <span className="hidden sm:inline ml-1">{session.flagged[session.current] ? t("qbank.session.flagged") : t("qbank.session.flag")}</span>
                </Button>

                <div className="h-5 w-px bg-border mx-1 hidden sm:block" />

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
                    <RotateCcw className="size-4 mr-1" />
                    <span className="hidden sm:inline">{t("qbank.session.retry")}</span>
                  </Button>
                )}
              </>
            )}

            <Button
              size="sm" onClick={goNext} className="h-9 rounded-lg"
              variant={readonly ? "default" : isLast ? "destructive" : "default"}
            >
              {readonly ? (
                <>{isLast ? t("qbank.review.exit") : t("common.next")} <ChevronRight className="size-4 ml-1" /></>
              ) : isLast ? (
                <>{t("qbank.session.endTest")} <ChevronRight className="size-4 ml-1" /></>
              ) : submitted && session.mode === "tutor" ? (
                <>{t("qbank.session.nextQuestion")} <ChevronRight className="size-4 ml-1" /></>
              ) : (
                <>{t("common.next")} <ChevronRight className="size-4 ml-1" /></>
              )}
            </Button>
          </footer>

          {/* Bottom action bar — mobile (compact).
              Extra bottom padding (pb-[env+0.5rem]) ensures the action buttons
              clear the iOS home indicator with breathing room. */}
          <footer className="sm:hidden border-t border-border bg-card px-3 pt-2 pb-[max(env(safe-area-inset-bottom,0px),0.75rem)] flex items-center gap-1.5 shrink-0 medos-tap-none">
            <Button
              variant="outline" size="icon"
              onClick={goPrev} disabled={session.current === 0}
              className="size-10 rounded-lg shrink-0 medos-touch-target"
              title={t("common.previous")}
            >
              <ChevronLeft className="size-4" />
            </Button>

            {!readonly && (
              <>
                <Button
                  variant="outline" size="icon"
                  onClick={onToggleFlag}
                  className={`size-10 rounded-lg shrink-0 medos-touch-target ${session.flagged[session.current] ? "border-amber-400 bg-amber-500/10 text-amber-300" : ""}`}
                  title={session.flagged[session.current] ? t("qbank.session.unflagShort") : t("qbank.session.flag")}
                >
                  <Flag className={`size-4 ${session.flagged[session.current] ? "fill-amber-500 text-amber-500" : ""}`} />
                </Button>

                {/* Tools dropdown for mobile */}
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="outline" size="icon" className="size-10 rounded-lg shrink-0 medos-touch-target" title={t("qbank.session.tools")}>
                        <CalcIcon className="size-4" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent side="top" align="end" className="min-w-44">
                    <div className="py-1">
                      <button onClick={onToggleCalculator} className="w-full text-left text-sm px-3 py-2 hover:bg-muted flex items-center gap-2">
                        <CalcIcon className="size-4" /> {t("qbank.session.calculator")}
                      </button>
                      <button onClick={onToggleLabValues} className="w-full text-left text-sm px-3 py-2 hover:bg-muted flex items-center gap-2">
                        <FlaskConical className="size-4" /> {t("qbank.session.labValues")}
                      </button>
                      <button onClick={onToggleAiAssistant} className="w-full text-left text-sm px-3 py-2 hover:bg-muted flex items-center gap-2">
                        <Sparkles className="size-4" /> {t("qbank.session.aiAssistant")}
                      </button>
                      <button onClick={() => setArticleSearchOpen(true)} className="w-full text-left text-sm px-3 py-2 hover:bg-muted flex items-center gap-2">
                        <BookOpen className="size-4" /> {t("qbank.session.articles")}
                      </button>
                      {submitted && session.mode === "tutor" && (
                        <button onClick={onRetry} className="w-full text-left text-sm px-3 py-2 hover:bg-muted flex items-center gap-2">
                          <RotateCcw className="size-4" /> {t("qbank.session.retry")}
                        </button>
                      )}
                    </div>
                  </PopoverContent>
                </Popover>

                {/* Mobile article search dropdown — anchored above bottom bar */}
                <AnimatePresence>
                  {articleSearchOpen && (
                    <motion.div
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: 8 }}
                      transition={{ duration: 0.15 }}
                      className="sm:hidden fixed bottom-20 right-2 z-50 w-72 max-h-72 overflow-y-auto rounded-xl border border-border bg-card shadow-xl"
                    >
                      <div className="py-1">
                        <div className="px-4 py-2 text-xs font-bold uppercase tracking-wider text-primary border-b border-border">{t("qbank.session.openArticle")}</div>
                        {articleList.map((a) => (
                          <button
                            key={a.file}
                            onClick={() => {
                              onOpenArticle(a.file);
                              setArticleSearchOpen(false);
                            }}
                            className="w-full text-left text-sm px-4 py-2.5 hover:bg-muted transition-colors flex items-center gap-2 border-b border-border/40 last:border-0"
                          >
                            <FileText className="size-3.5 shrink-0 text-muted-foreground" />
                            <span className="truncate">{a.title}</span>
                          </button>
                        ))}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </>
            )}

            {/* Primary action button — fills remaining space */}
            {readonly ? (
              <Button
                size="sm" onClick={goNext}
                variant="default"
                className="flex-1 h-10 rounded-lg medos-touch-target"
              >
                {isLast ? t("qbank.review.exit") : t("common.next")}
                <ChevronRight className="size-4 ml-1" />
              </Button>
            ) : !submitted && isMCQ ? (
              <Button
                size="sm" onClick={onSubmit} disabled={selected === undefined}
                className="flex-1 h-10 rounded-lg medos-touch-target"
              >
                {t("qbank.session.submitAnswer")}
              </Button>
            ) : !submitted && !isMCQ && !qIsWritten ? (
              <Button
                size="sm" onClick={onSubmit}
                className="flex-1 h-10 rounded-lg medos-touch-target"
              >
                {session.engine === "flashcard" ? t("qbank.session.revealAnswer") : t("qbank.session.submit")}
              </Button>
            ) : (
              <Button
                size="sm" onClick={goNext}
                variant={isLast ? "destructive" : "default"}
                className="flex-1 h-10 rounded-lg medos-touch-target"
              >
                {isLast
                  ? t("qbank.session.endTest")
                  : submitted && session.mode === "tutor"
                  ? t("qbank.session.nextQuestion")
                  : t("common.next")}
                <ChevronRight className="size-4 ml-1" />
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
              className="bg-card border border-border rounded-xl shadow-2xl max-w-lg w-full p-5 max-h-[80vh] overflow-y-auto"
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
                  ["← / →", "qbank.session.shortcut.prev"],
                  ["1–8", "qbank.session.shortcut.select"],
                  ["Enter", "qbank.session.shortcut.submit"],
                  ["F", "qbank.session.shortcut.flag"],
                  ["A", "qbank.session.shortcut.ai"],
                  ["H", "qbank.session.shortcut.highlight"],
                  ["E", "qbank.session.shortcut.eraser"],
                  ["N", "qbank.session.shortcut.notes"],
                  [",", "qbank.session.shortcut.settings"],
                  ["?", "qbank.session.shortcut.help"],
                ] as [string, StringKey][]).map(([keys, descKey]) => (
                  <div key={keys} className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">{t(descKey)}</span>
                    <kbd className="px-2 py-0.5 rounded border border-border bg-muted/50 text-xs font-mono tabular-nums">
                      {keys}
                    </kbd>
                  </div>
                ))}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ── Written evaluation display ──────────────────────────────────────── */
function WrittenEvaluationCard({
  evaluation,
  verdict,
  onPassFail,
}: {
  evaluation: WrittenEvaluation;
  verdict: "pass" | "fail" | null;
  onPassFail?: (v: "pass" | "fail") => void;
}) {
  const { t } = useI18n();
  const passed = verdict === "pass" || (verdict === null && evaluation.passed);
  const isManual = evaluation.score === null;
  return (
    <div className="space-y-4">
      {/* Score + verdict */}
      <div className="flex items-center gap-4">
        <div
          className={cn(
            "size-14 rounded-full flex items-center justify-center text-lg font-bold border-[3px] shrink-0",
            passed
              ? "border-emerald-500 bg-emerald-500/10 text-emerald-500"
              : "border-red-500 bg-red-500/10 text-red-500",
          )}
        >
          {evaluation.score !== null ? evaluation.score : "—"}
        </div>
        <div>
          <div className="text-base font-bold">{passed ? t("qbank.written.passed") : t("qbank.written.needsRevision")}</div>
          <div className="text-xs text-muted-foreground">{evaluation.source}</div>
        </div>
      </div>

      {/* Strengths */}
      {evaluation.strengths.length > 0 && (
        <div className="space-y-1.5">
          {evaluation.strengths.map((s, i) => (
            <div key={i} className="flex items-start gap-2 text-sm">
              <Check className="size-4 text-emerald-500 shrink-0 mt-0.5" />
              <span>{s}</span>
            </div>
          ))}
        </div>
      )}

      {/* Gaps */}
      {evaluation.gaps.length > 0 && (
        <div className="space-y-1.5">
          {evaluation.gaps.map((g, i) => (
            <div key={i} className="flex items-start gap-2 text-sm">
              <span className="size-1.5 rounded-full bg-red-400 shrink-0 mt-2" />
              <span className="text-muted-foreground">{g}</span>
            </div>
          ))}
        </div>
      )}

      {/* Feedback */}
      {evaluation.feedback && (
        <div className="text-sm text-foreground bg-muted/30 rounded-lg px-3 py-2.5 leading-relaxed">
          {evaluation.feedback}
        </div>
      )}

      {/* Manual override */}
      {onPassFail && (
        <div className="flex gap-3 pt-3 border-t border-border">
          <button
            type="button"
            onClick={() => onPassFail("pass")}
            className={cn(
              "flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold border-2 transition-all",
              passed
                ? "border-emerald-500 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                : "border-border hover:border-emerald-500/40 hover:bg-emerald-500/5",
            )}
          >
            <Check className="size-4" />
            {t("qbank.written.pass")}
          </button>
          <button
            type="button"
            onClick={() => onPassFail("fail")}
            className={cn(
              "flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold border-2 transition-all",
              !passed
                ? "border-red-500 bg-red-500/10 text-red-500"
                : "border-border hover:border-red-500/40 hover:bg-red-500/5",
            )}
          >
            <X className="size-4" />
            {t("qbank.written.fail")}
          </button>
        </div>
      )}

      {/* Self-grading rubric — only after AI fails / manual grade */}
      {isManual && (
        <div className="pt-3 border-t border-border">
          <p className="text-xs text-muted-foreground mb-2">
            {t("qbank.written.aiUnavailable")}
          </p>
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
 * CAMERA MODAL — capture/upload/crop/compress/transcribe for written answers
 * ───────────────────────────────────────────────────────────────────────── */
function CameraModal({
  open,
  onClose,
  onTranscribed,
}: {
  open: boolean;
  onClose: () => void;
  onTranscribed: (text: string) => void;
}) {
  const { t } = useI18n();
  const videoRef = React.useRef<HTMLVideoElement>(null);
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const cropContainerRef = React.useRef<HTMLDivElement>(null);
  const cropImgRef = React.useRef<HTMLImageElement>(null);

  const [stream, setStream] = React.useState<MediaStream | null>(null);
  const [useFront, setUseFront] = React.useState(false);
  const [phase, setPhase] = React.useState<"viewfinder" | "crop" | "transcribing">("viewfinder");
  const [cropImgSrc, setCropImgSrc] = React.useState<string | null>(null);

  const cropBoxRef = React.useRef<{ left: number; top: number; width: number; height: number } | null>(null);
  const cropDragRef = React.useRef<{ type: string; startX: number; startY: number; startBox: typeof cropBoxRef.current }>({ type: "", startX: 0, startY: 0, startBox: null });
  const cropBoxElRef = React.useRef<HTMLDivElement>(null);
  const transcribeAbortRef = React.useRef<AbortController | null>(null);

  const stopStream = React.useCallback(() => {
    stream?.getTracks().forEach((t) => t.stop());
    setStream(null);
  }, [stream]);

  const openCamera = React.useCallback(async (front: boolean) => {
    if (typeof window === "undefined") return;
    if (!window.isSecureContext && location.hostname !== "localhost" && location.hostname !== "127.0.0.1") {
      toast({ title: t("qbank.written.cameraSecureContext"), variant: "destructive" });
      fileInputRef.current?.click();
      return;
    }
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: front ? "user" : "environment" },
      });
      setStream(s);
      if (videoRef.current) {
        videoRef.current.srcObject = s;
      }
    } catch (err: unknown) {
      const name = err instanceof DOMException ? err.name : "";
      if (name === "NotAllowedError" || name === "PermissionDeniedError") {
        toast({ title: t("qbank.written.cameraPermissionDenied"), variant: "destructive" });
      } else if (name === "NotFoundError") {
        toast({ title: t("qbank.written.noCamera"), variant: "destructive" });
      }
      fileInputRef.current?.click();
    }
  }, [t]);

  React.useEffect(() => {
    if (open) {
      setPhase("viewfinder");
      setCropImgSrc(null);
      cropBoxRef.current = null;
      openCamera(useFront);
      document.body.style.overflow = "hidden";
    } else {
      stopStream();
      document.body.style.overflow = "";
    }
    return () => {
      stream?.getTracks().forEach((t) => t.stop());
      document.body.style.overflow = "";
    };
  }, [open]);

  const capturePhoto = React.useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
    stopStream();
    setCropImgSrc(dataUrl);
    setPhase("crop");
  }, [stopStream]);

  const switchCamera = React.useCallback(() => {
    const next = !useFront;
    setUseFront(next);
    stream?.getTracks().forEach((t) => t.stop());
    openCamera(next);
  }, [useFront, stream, openCamera]);

  const handleFileUpload = React.useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast({ title: "Please select an image file.", variant: "destructive" });
      return;
    }
    const reader = new FileReader();
    reader.onload = (ev) => {
      const result = ev.target?.result;
      if (typeof result === "string") {
        stopStream();
        setCropImgSrc(result);
        setPhase("crop");
      }
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  }, [stopStream]);

  const renderCropBox = React.useCallback(() => {
    const box = cropBoxRef.current;
    const el = cropBoxElRef.current;
    if (!box || !el) return;
    el.style.left = box.left + "px";
    el.style.top = box.top + "px";
    el.style.width = box.width + "px";
    el.style.height = box.height + "px";
  }, []);

  const initCrop = React.useCallback(() => {
    const img = cropImgRef.current;
    const container = cropContainerRef.current;
    if (!img || !container) return;
    const displayW = img.clientWidth || img.naturalWidth;
    const displayH = img.clientHeight || img.naturalHeight;
    if (!displayW || !displayH) return;
    const pad = 0.05;
    const w = Math.round(displayW * (1 - pad * 2));
    const h = Math.round(displayH * (1 - pad * 2));
    cropBoxRef.current = {
      left: Math.round((displayW - w) / 2),
      top: Math.round((displayH - h) / 2),
      width: w,
      height: h,
    };
    renderCropBox();
  }, [renderCropBox]);

  React.useEffect(() => {
    if (phase === "crop" && cropImgRef.current) {
      const img = cropImgRef.current;
      if (img.complete && img.naturalWidth) {
        initCrop();
      } else {
        img.addEventListener("load", initCrop, { once: true });
      }
    }
  }, [phase, cropImgSrc, initCrop]);

  const getPointerPos = React.useCallback((e: React.MouseEvent | React.TouchEvent) => {
    const container = cropContainerRef.current;
    if (!container) return { x: 0, y: 0 };
    const rect = container.getBoundingClientRect();
    const clientX = "touches" in e ? e.touches[0].clientX : e.clientX;
    const clientY = "touches" in e ? e.touches[0].clientY : e.clientY;
    return { x: clientX - rect.left, y: clientY - rect.top };
  }, []);

  const startCropDrag = React.useCallback((e: React.MouseEvent | React.TouchEvent, type: string) => {
    if ("button" in e && e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const pos = getPointerPos(e);
    cropDragRef.current = {
      type,
      startX: pos.x,
      startY: pos.y,
      startBox: cropBoxRef.current ? { ...cropBoxRef.current } : null,
    };

    const onMove = (ev: MouseEvent | TouchEvent) => {
      ev.preventDefault();
      const container = cropContainerRef.current;
      if (!container || !cropDragRef.current.startBox) return;
      const maxW = container.clientWidth;
      const maxH = container.clientHeight;
      const cx = "touches" in ev ? ev.touches[0].clientX : ev.clientX;
      const cy = "touches" in ev ? ev.touches[0].clientY : ev.clientY;
      const rect = container.getBoundingClientRect();
      const px = cx - rect.left;
      const py = cy - rect.top;
      const dx = px - cropDragRef.current.startX;
      const dy = py - cropDragRef.current.startY;
      const b = cropDragRef.current.startBox;
      const min = 40;
      let l = b.left, t = b.top, r = b.left + b.width, bm = b.top + b.height;

      switch (cropDragRef.current.type) {
        case "move": l = b.left + dx; t = b.top + dy; r = l + b.width; bm = t + b.height; break;
        case "se": r = b.left + b.width + dx; bm = b.top + b.height + dy; break;
        case "sw": l = b.left + dx; r = b.left + b.width; bm = b.top + b.height + dy; break;
        case "ne": t = b.top + dy; r = b.left + b.width + dx; bm = b.top + b.height; break;
        case "nw": l = b.left + dx; t = b.top + dy; r = b.left + b.width; bm = b.top + b.height; break;
      }

      l = Math.max(0, Math.min(l, maxW - min));
      t = Math.max(0, Math.min(t, maxH - min));
      r = Math.max(l + min, Math.min(r, maxW));
      bm = Math.max(t + min, Math.min(bm, maxH));

      cropBoxRef.current = { left: l, top: t, width: r - l, height: bm - t };
      renderCropBox();
    };

    const onEnd = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onEnd);
      document.removeEventListener("touchmove", onMove);
      document.removeEventListener("touchend", onEnd);
    };

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onEnd);
    document.addEventListener("touchmove", onMove, { passive: false });
    document.addEventListener("touchend", onEnd);
  }, [getPointerPos, renderCropBox]);

  const compressAndTranscribe = React.useCallback(async (rawDataUrl: string) => {
    const loadImg = (src: string) =>
      new Promise<HTMLImageElement>((resolve, reject) => {
        const im = new Image();
        im.onload = () => resolve(im);
        im.onerror = reject;
        im.src = src;
      });

    const raw = await loadImg(rawDataUrl);
    const MAX = 1600;
    let w = raw.naturalWidth;
    let h = raw.naturalHeight;
    if (w > MAX || h > MAX) {
      const scale = MAX / Math.max(w, h);
      w = Math.round(w * scale);
      h = Math.round(h * scale);
    }
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(raw, 0, 0, w, h);
    const compressed = c.toDataURL("image/jpeg", 0.7);
    const base64 = compressed.replace(/^data:image\/\w+;base64,/, "");

    setPhase("transcribing");

    const abort = new AbortController();
    transcribeAbortRef.current = abort;
    try {
      const text = await transcribePhoto({ photoBase64: base64, mimeType: "image/jpeg", signal: abort.signal });
      onTranscribed(text);
      onClose();
    } catch (err: unknown) {
      if ((err as Error)?.name === "AbortError") return;
      toast({ title: t("qbank.written.transcriptionFailed"), variant: "destructive" });
      setPhase("viewfinder");
      openCamera(useFront);
    } finally {
      transcribeAbortRef.current = null;
    }
  }, [onTranscribed, onClose, t, openCamera, useFront]);

  const applyCrop = React.useCallback(() => {
    if (!cropImgSrc || !cropBoxRef.current) return;
    const img = new Image();
    img.onload = () => {
      const displayEl = cropImgRef.current;
      const displayW = displayEl?.clientWidth || img.naturalWidth;
      const displayH = displayEl?.clientHeight || img.naturalHeight;
      const b = cropBoxRef.current!;
      const sx = (b.left / displayW) * img.naturalWidth;
      const sy = (b.top / displayH) * img.naturalHeight;
      const sw = (b.width / displayW) * img.naturalWidth;
      const sh = (b.height / displayH) * img.naturalHeight;
      const c = document.createElement("canvas");
      c.width = sw;
      c.height = sh;
      const ctx = c.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
      compressAndTranscribe(c.toDataURL("image/jpeg", 0.85));
    };
    img.src = cropImgSrc;
  }, [cropImgSrc, compressAndTranscribe]);

  if (!open) return null;

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFileUpload}
      />
      <div className="osler-camera-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
        <div className="osler-camera-modal">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-base font-semibold">{t("qbank.written.cameraTitle")}</h3>
            <Button variant="ghost" size="iconSm" onClick={onClose}>
              <X className="size-4" />
            </Button>
          </div>

          {phase === "viewfinder" && (
            <>
              <video ref={videoRef} autoPlay playsInline className="osler-camera-video" />
              <canvas ref={canvasRef} className="hidden" />
              <div className="flex justify-center gap-4 mt-4 items-center">
                <Button variant="outline" onClick={() => fileInputRef.current?.click()}>
                  {t("qbank.written.cameraUpload")}
                </Button>
                <Button
                  size="iconLg"
                  onClick={capturePhoto}
                  className="rounded-full bg-primary text-primary-foreground hover:opacity-90"
                >
                  <div className="size-3 rounded-full bg-current" />
                </Button>
                <Button variant="ghost" size="icon" onClick={switchCamera}>
                  <RefreshCw className="size-4" />
                </Button>
              </div>
            </>
          )}

          {phase === "crop" && cropImgSrc && (
            <>
              <div className="osler-crop-container" ref={cropContainerRef}>
                <img ref={cropImgRef} src={cropImgSrc} alt="Crop preview" draggable={false} />
                <div className="osler-crop-overlay">
                  <div
                    ref={cropBoxElRef}
                    className="osler-crop-box"
                    onMouseDown={(e) => startCropDrag(e, "move")}
                    onTouchStart={(e) => startCropDrag(e, "move")}
                  >
                    <div className="osler-crop-handle osler-crop-handle--nw" onMouseDown={(e) => startCropDrag(e, "nw")} onTouchStart={(e) => startCropDrag(e, "nw")} />
                    <div className="osler-crop-handle osler-crop-handle--ne" onMouseDown={(e) => startCropDrag(e, "ne")} onTouchStart={(e) => startCropDrag(e, "ne")} />
                    <div className="osler-crop-handle osler-crop-handle--sw" onMouseDown={(e) => startCropDrag(e, "sw")} onTouchStart={(e) => startCropDrag(e, "sw")} />
                    <div className="osler-crop-handle osler-crop-handle--se" onMouseDown={(e) => startCropDrag(e, "se")} onTouchStart={(e) => startCropDrag(e, "se")} />
                  </div>
                </div>
              </div>
              <p className="text-xs text-muted-foreground text-center mt-2">{t("qbank.written.cropInfo")}</p>
              <div className="flex justify-center gap-3 mt-3">
                <Button variant="outline" onClick={() => { setPhase("viewfinder"); openCamera(useFront); }}>
                  {t("qbank.written.cropRetake")}
                </Button>
                <Button onClick={applyCrop}>
                  {t("qbank.written.cropUse")}
                </Button>
              </div>
            </>
          )}

          {phase === "transcribing" && (
            <div className="flex flex-col items-center gap-4 py-10">
              <Loader2 className="size-8 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground">{t("qbank.written.transcribingPhoto")}</p>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
 * WRITTEN ENGINE VIEW
 * ───────────────────────────────────────────────────────────────────────── */
function WrittenEngineView({
  question,
  draft,
  submitted,
  onTextChange,
  onRubricToggle,
  onGradeAI,
  onGradeManual,
  onPassFail,
  grading,
  onChildTextChange,
  onChildGradeAI,
  onChildGradeManual,
  onChildPassFail,
  childGrading,
}: {
  question: SessionQuestion;
  draft: WrittenDraft;
  submitted: boolean;
  onTextChange: (text: string) => void;
  onRubricToggle: (idx: number) => void;
  onGradeAI?: () => void;
  onGradeManual?: () => void;
  onPassFail?: (v: "pass" | "fail") => void;
  grading?: boolean;
  onChildTextChange?: (childIdx: number, text: string) => void;
  onChildGradeAI?: (childIdx: number) => void;
  onChildGradeManual?: (childIdx: number) => void;
  onChildPassFail?: (childIdx: number, v: "pass" | "fail") => void;
  childGrading?: number | null;
}) {
  const wordCount = draft.text.trim().split(/\s+/).filter(Boolean).length;
  const hasEvaluation = !!draft.evaluation;
  const hasContent = !!draft.text.trim();
  const verdict: "pass" | "fail" | null =
    draft.evaluation?.manualVerdict === "pass"
      ? "pass"
      : draft.evaluation?.manualVerdict === "fail"
        ? "fail"
        : null;
  const isManual = draft.evaluation?.score === null;
  const passed = verdict === "pass" || (verdict === null && draft.evaluation?.passed === true);
  const children = question.children ?? [];

  const [cameraOpen, setCameraOpen] = React.useState(false);
  const [transcribing, setTranscribing] = React.useState(false);

  // ── Input mode (before submit) ───────────────────────────────────────
  const { t } = useI18n();

  if (!submitted && !hasEvaluation) {
    return (
      <div className="mt-6 space-y-4">
        <CameraModal
          open={cameraOpen}
          onClose={() => setCameraOpen(false)}
          onTranscribed={(text) => {
            setTranscribing(false);
            const merged = draft.text.trim()
              ? draft.text.trim() + "\n\n" + text
              : text;
            onTextChange(merged);
          }}
        />

        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {t("qbank.written.yourResponse")}
            </label>
            <span className="text-xs text-muted-foreground tabular-nums">
              {transcribing
                ? t("qbank.written.transcribing")
                : t("qbank.written.words", { n: wordCount })}
            </span>
          </div>

          <textarea
            value={draft.text}
            onChange={(e) => onTextChange(e.target.value)}
            placeholder={t("qbank.written.placeholder")}
            className="osler-written-area"
            style={{ minHeight: 220 }}
          />
          {transcribing && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/30 rounded-lg px-3 py-2 mt-2">
              <Loader2 className="size-3.5 animate-spin" />
              {t("qbank.written.transcribingPhoto")}
            </div>
          )}
        </div>

        {/* Grade buttons */}
        <div className="flex gap-2 flex-wrap">
          <button
            type="button"
            onClick={onGradeManual}
            disabled={!hasContent}
            className="px-4 py-2 rounded-lg text-sm font-medium border border-border hover:border-primary/40 transition-colors disabled:opacity-50"
          >
            {t("qbank.written.manualGrade")}
          </button>
          <button
            type="button"
            onClick={() => setCameraOpen(true)}
            className="px-4 py-2 rounded-lg text-sm font-medium border border-border hover:border-primary/40 transition-colors"
          >
            <span className="flex items-center gap-1.5">
              <Camera className="size-3.5" />
              {t("qbank.written.photo")}
            </span>
          </button>
          <button
            type="button"
            onClick={onGradeAI}
            disabled={grading || !hasContent}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-primary text-primary-foreground hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {grading ? (
              <span className="flex items-center gap-2">
                <Loader2 className="size-4 animate-spin" />
                {t("qbank.written.grading")}
              </span>
            ) : (
              t("qbank.written.gradeWithAI")
            )}
          </button>
        </div>

        {grading && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/30 rounded-lg px-3 py-2">
            <Loader2 className="size-3.5 animate-spin" />
            {t("qbank.written.analyzing")}
          </div>
        )}

        {/* Children questions — per-part textareas */}
        {children.length > 0 && (
          <div className="space-y-5 pt-4 border-t border-border">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {t("qbank.written.partQuestions")}
            </h4>
            {children.map((child, ci) => {
              const childAns = draft.childAnswers?.[ci] ?? "";
              return (
                <div key={child.id} className="space-y-2 pl-4 border-l-2 border-muted">
                  <div className="text-xs font-semibold text-muted-foreground">
                    {child.label || t("qbank.written.partLabel", { n: ci + 1 })}
                  </div>
                  {child.question && (
                    <div className="text-sm text-foreground mb-1.5">{child.question}</div>
                  )}
                  <textarea
                    value={childAns}
                    onChange={(e) => onChildTextChange?.(ci, e.target.value)}
                    placeholder={t("qbank.written.answerFor", { label: child.label || `part ${ci + 1}` })}
                    className="osler-written-area"
                    style={{ minHeight: 120 }}
                  />
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => onChildGradeManual?.(ci)}
                      disabled={!childAns.trim()}
                      className="px-3 py-1.5 rounded-md text-xs font-medium border border-border hover:border-primary/40 transition-colors disabled:opacity-50"
                    >
                      {t("qbank.written.manualGrade")}
                    </button>
                    <button
                      type="button"
                      onClick={() => onChildGradeAI?.(ci)}
                      disabled={childGrading === ci || !childAns.trim()}
                      className="px-3 py-1.5 rounded-md text-xs font-medium bg-primary text-primary-foreground hover:opacity-90 transition-opacity disabled:opacity-50"
                    >
                      {childGrading === ci ? (
                        <span className="flex items-center gap-1.5">
                          <Loader2 className="size-3 animate-spin" />
                          {t("qbank.written.grading")}
                        </span>
                      ) : (
                        t("qbank.written.gradeWithAI")
                      )}
                    </button>
                  </div>
                  {draft.childEvaluations?.[ci] && (
                    <div className="mt-2">
                      <WrittenEvaluationCard
                        evaluation={draft.childEvaluations[ci]!}
                        verdict={null}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  // ── Evaluation mode — only comparison content; evaluation card is in parent's right column ──
  return (
    <div className="space-y-5">
      {/* Compare grid */}
      <div className="space-y-4">
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1.5">
            <span className="size-2 rounded-full bg-amber-500" />
            {t("qbank.written.yourResponse")}
          </h4>
          <div className="text-sm whitespace-pre-wrap leading-relaxed text-foreground bg-muted/30 rounded-lg p-4 min-h-[80px] max-h-[400px] overflow-y-auto">
            {draft.text.trim() || (
              <span className="text-muted-foreground italic">{t("qbank.written.noAnswer")}</span>
            )}
          </div>
        </div>
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1.5">
            <span className="size-2 rounded-full bg-primary" />
            {t("qbank.written.modelAnswer")}
          </h4>
          <div className="text-sm whitespace-pre-wrap leading-relaxed text-foreground bg-primary/5 rounded-lg p-4 min-h-[80px] max-h-[400px] overflow-y-auto">
            {question.modelAnswer || (
              <span className="text-muted-foreground italic">{t("qbank.written.noModelAnswer")}</span>
            )}
          </div>
        </div>
      </div>

      {/* "No evaluation yet" prompt (only shown when no draft evaluation exists) */}
      {!draft.evaluation && (
        <div className="rounded-xl border-2 border-border overflow-hidden">
          <div className="bg-card px-5 py-4">
            <div className="flex items-center gap-2 mb-3">
              <Sparkles className="size-4 text-primary" />
              <h3 className="text-sm font-semibold text-foreground">{t("qbank.written.evaluation")}</h3>
            </div>
            <p className="text-sm text-muted-foreground mb-4">
              {t("qbank.written.comparePrompt")}
            </p>
            <div className="flex justify-center gap-3">
              <button
                type="button"
                onClick={onGradeManual}
                className="px-5 py-2.5 rounded-lg text-sm font-medium border border-border hover:border-primary/40 transition-colors"
              >
                {t("qbank.written.manualGrade")}
              </button>
              <button
                type="button"
                onClick={onGradeAI}
                disabled={grading}
                className="px-5 py-2.5 rounded-lg text-sm font-medium bg-primary text-primary-foreground hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                {grading ? (
                  <span className="flex items-center gap-2">
                    <Loader2 className="size-4 animate-spin" />
                    {t("qbank.written.grading")}
                  </span>
                ) : (
                  t("qbank.written.gradeWithAI")
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Written evaluation panel (renders in parent's 45% right column) ─── */
function WrittenEvaluationPanel({
  draft,
  question,
  passed,
  isManual,
  rubricState,
  onRubricToggle,
  onPassFail,
  onChildPassFail,
}: {
  draft: WrittenDraft;
  question: SessionQuestion;
  passed: boolean;
  isManual: boolean;
  rubricState: boolean[];
  onRubricToggle: (idx: number) => void;
  onPassFail?: (v: "pass" | "fail") => void;
  onChildPassFail?: (childIdx: number, v: "pass" | "fail") => void;
}) {
  const { t } = useI18n();
  const children = question.children ?? [];
  if (!draft.evaluation) return null;
  return (
    <div className={`rounded-xl border-2 overflow-hidden ${passed ? "border-emerald-600" : "border-red-500"}`}>
      {/* ── Header bar (like MCQ correct/incorrect header) ────────── */}
      <div className={`px-4 py-3 flex items-center gap-3 ${passed ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" : "bg-red-500/10 text-red-500"}`}>
        <div className={`size-9 rounded-full flex items-center justify-center shrink-0 border-[3px] font-bold text-sm ${passed ? "border-emerald-500 bg-emerald-500/10 text-emerald-500" : "border-red-500 bg-red-500/10 text-red-500"}`}>
          {draft.evaluation.score !== null ? draft.evaluation.score : "—"}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-base font-bold">{passed ? t("qbank.written.passed") : t("qbank.written.needsRevision")}</div>
          <div className="text-xs mt-0.5 opacity-80">{draft.evaluation.source}</div>
        </div>
      </div>

      {/* ── Strengths, gaps, feedback ────────────────────────────── */}
      <div className="bg-card px-5 py-3 space-y-3 border-b border-border/60">
        {draft.evaluation.strengths.length > 0 && (
          <div className="space-y-1">
            {draft.evaluation.strengths.map((s, i) => (
              <div key={i} className="flex items-start gap-2 text-sm">
                <Check className="size-4 text-emerald-500 shrink-0 mt-0.5" />
                <span>{s}</span>
              </div>
            ))}
          </div>
        )}
        {draft.evaluation.gaps.length > 0 && (
          <div className="space-y-1">
            {draft.evaluation.gaps.map((g, i) => (
              <div key={i} className="flex items-start gap-2 text-sm">
                <span className="size-1.5 rounded-full bg-red-400 shrink-0 mt-2" />
                <span className="text-muted-foreground">{g}</span>
              </div>
            ))}
          </div>
        )}
        {draft.evaluation.feedback && (
          <div className="text-sm text-foreground bg-muted/30 rounded-lg px-3 py-2 leading-relaxed">
            {draft.evaluation.feedback}
          </div>
        )}
      </div>

      {/* ── Rubric (manual grading only) ─────────────────────────── */}
      {isManual && question.rubric && question.rubric.length > 0 && (
        <div className="bg-card px-5 py-3 space-y-2 border-b border-border/60">
          <h4 className="text-xs font-semibold flex items-center gap-2">
            <ListChecks className="size-3.5 text-primary" />
            {t("qbank.written.selfGradingRubric")}
          </h4>
          {question.rubric.map((item, i) => {
            const checked = rubricState[i] ?? false;
            return (
              <button
                key={i}
                type="button"
                onClick={() => onRubricToggle(i)}
                className={cn(
                  "w-full flex items-start gap-2.5 px-3 py-2 rounded-md text-left text-sm transition-colors",
                  checked
                    ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                    : "hover:bg-muted",
                )}
              >
                {checked ? (
                  <CheckCircle2 className="size-4 text-emerald-500 shrink-0 mt-0.5" />
                ) : (
                  <Circle className="size-4 text-muted-foreground shrink-0 mt-0.5" />
                )}
                <span>{item}</span>
              </button>
            );
          })}
          <div className="pt-2 border-t border-border text-xs text-muted-foreground">
            {t("qbank.written.selfScore")}:{" "}
            <span className="font-semibold text-foreground">
              {rubricState.filter(Boolean).length}
            </span>{" "}
            / {question.rubric.length}
          </div>
        </div>
      )}

      {/* ── Explanation — main body (like MCQ explanation section) ── */}
      {question.explanation && (
        <div className="bg-card px-5 py-4" data-explanation>
          <div className="flex items-center gap-2 mb-3">
            <Sparkles className="size-4 text-primary" />
            <h3 className="text-sm font-semibold text-foreground">{t("qbank.explanation.title")}</h3>
          </div>
          <div className="uworld-prose text-[14px] whitespace-pre-wrap leading-relaxed text-foreground">
            {question.explanation}
          </div>
        </div>
      )}

      {/* ── Pass/Fail override ───────────────────────────────────── */}
      {onPassFail && (
        <div className="bg-card px-5 py-3 border-t border-border/60 flex gap-3">
          <button
            type="button"
            onClick={() => onPassFail("pass")}
            className={cn(
              "flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold border-2 transition-all",
              passed
                ? "border-emerald-500 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                : "border-border hover:border-emerald-500/40 hover:bg-emerald-500/5",
            )}
          >
            <Check className="size-4" />
            {t("qbank.written.pass")}
          </button>
          <button
            type="button"
            onClick={() => onPassFail("fail")}
            className={cn(
              "flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold border-2 transition-all",
              !passed
                ? "border-red-500 bg-red-500/10 text-red-500"
                : "border-border hover:border-red-500/40 hover:bg-red-500/5",
            )}
          >
            <X className="size-4" />
            {t("qbank.written.fail")}
          </button>
        </div>
      )}

      {/* ── Children evaluations ─────────────────────────────────── */}
      {children.length > 0 && (
        <div className="bg-card px-5 py-3 border-t border-border/60 space-y-4">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {t("qbank.written.partEvaluations")}
          </h4>
          {children.map((child, ci) => {
            const childEval = draft.childEvaluations?.[ci];
            if (!childEval) return null;
            return (
              <div key={child.id} className="space-y-1.5">
                <div className="text-xs font-medium text-muted-foreground">
                  {child.label || t("qbank.written.partLabel", { n: ci + 1 })}
                </div>
                <WrittenEvaluationCard
                  evaluation={childEval}
                  verdict={null}
                  onPassFail={
                    onChildPassFail
                      ? (v) => onChildPassFail(ci, v)
                      : undefined
                  }
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
 * OSCE ENGINE VIEW
 * ───────────────────────────────────────────────────────────────────────── */
function OsceEngineView({
  question,
  rubricState,
  submitted,
  onRubricToggle,
}: {
  question: SessionQuestion;
  rubricState: boolean[];
  submitted: boolean;
  onRubricToggle: (idx: number) => void;
}) {
  return (
    <div className="mt-6 space-y-4">
      {/* Patient scenario */}
      <div className="osler-osce-patient">
        <div className="osler-osce-patient-avatar">
          <User className="size-7" />
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-2">
            <Activity className="size-4 text-primary" />
            <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              Patient Scenario
            </h3>
          </div>
        </div>
      </div>

      {/* Red Flags */}
      {question.redFlags && question.redFlags.length > 0 && (
        <div className="bg-red-500/8 border border-red-500/25 border-l-4 border-l-red-500 rounded-lg p-4">
          <h4 className="flex items-center gap-2 text-sm font-semibold mb-2 text-red-500">
            <AlertTriangle className="size-4" />
            Red Flags
          </h4>
          <ul className="space-y-1">
            {question.redFlags.map((flag, i) => (
              <li key={i} className="text-sm flex items-start gap-2">
                <span className="text-red-500 mt-1">•</span>
                <span className="leading-relaxed">{flag}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Differential Diagnosis */}
      {question.differential && question.differential.length > 0 && (
        <div className="qbank-card">
          <h4 className="flex items-center gap-2 text-sm font-semibold mb-2">
            <Stethoscope className="size-4 text-primary" />
            Differential Diagnosis
          </h4>
          <div className="flex flex-wrap gap-1.5">
            {question.differential.map((d, i) => (
              <span
                key={i}
                className="px-2.5 py-1 rounded-md text-xs bg-muted text-foreground border border-border"
              >
                {d}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Performance Rubric */}
      {question.rubric && question.rubric.length > 0 && (
        <div className="qbank-card">
          <div className="flex items-center justify-between mb-1">
            <h4 className="flex items-center gap-2 text-sm font-semibold">
              <ListChecks className="size-4 text-primary" />
              Performance Rubric
            </h4>
            <span className="text-xs text-muted-foreground">
              Score:{" "}
              <span className="font-semibold text-foreground">
                {rubricState.filter(Boolean).length}
              </span>{" "}
              / {question.rubric.length}
            </span>
          </div>
          <p className="text-xs text-muted-foreground mb-3">
            {submitted
              ? "Review the items you addressed."
              : "Check each item you addressed during this station."}
          </p>
          <div className="space-y-1.5">
            {question.rubric.map((item, i) => {
              const checked = rubricState[i] ?? false;
              return (
                <button
                  key={i}
                  type="button"
                  disabled={submitted}
                  onClick={() => onRubricToggle(i)}
                  className={cn(
                    "w-full flex items-start gap-2.5 px-3 py-2 rounded-md text-left text-sm transition-colors",
                    checked
                      ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                      : "hover:bg-muted",
                    submitted && "cursor-default opacity-70"
                  )}
                >
                  {checked ? (
                    <CheckCircle2 className="size-4 text-emerald-500 shrink-0 mt-0.5" />
                  ) : (
                    <Circle className="size-4 text-muted-foreground shrink-0 mt-0.5" />
                  )}
                  <span>{item}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
 * NAVIGATOR PANEL — Question grid (NBME-style compact)
 * ───────────────────────────────────────────────────────────────────────── */
interface NavigatorPanelProps {
  session: SessionData;
  answeredCount: number;
  flaggedCount: number;
  correctCount: number;
  incorrectCount: number;
  progressPct: number;
  onJumpTo: (idx: number) => void;
  onEndTest: () => void;
  readonly?: boolean;
}

function NavigatorPanel(p: NavigatorPanelProps) {
  const total = p.session.questions.length;
  return (
    <div className="flex flex-col h-full">
      {/* NBME-style compact header */}
      <div className="px-3 py-2.5 border-b border-sidebar-border flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-foreground">Navigator</span>
        <span className="text-[11px] text-muted-foreground tabular-nums">{p.answeredCount}/{total}</span>
      </div>

      {/* Question grid - NBME compact style */}
      <div className="flex-1 overflow-y-auto medos-scroll p-3">
        <div className="grid grid-cols-5 gap-1">
          {p.session.questions.map((_, i) => {
            const ans = p.session.answers[i];
            const isFlagged = p.session.flagged[i];
            const isCurrent = i === p.session.current;
            const isRevealed = p.session.revealed[i];
            const isCorrect = ans !== undefined && p.session.questions[i]?.correct === ans;
            const isIncorrect = ans !== undefined && !isCorrect;

            let cellClass = "bg-sidebar text-muted-foreground border-sidebar-border hover:bg-sidebar-accent";
            if (isRevealed && isCorrect) cellClass = "bg-blue-500/20 text-blue-300 border-blue-500/30 hover:bg-blue-500/30";
            else if (isRevealed && isIncorrect) cellClass = "bg-red-500/20 text-red-300 border-red-500/30 hover:bg-red-500/30";
            else if (ans !== undefined) cellClass = "bg-primary/25 text-primary border-primary/40 hover:bg-primary/35";

            return (
              <button
                key={i}
                onClick={() => p.onJumpTo(i)}
                className={`relative aspect-square rounded-md text-[11px] font-semibold border transition-all ${cellClass} ${
                  isCurrent ? "ring-2 ring-primary ring-offset-1 ring-offset-sidebar" : ""
                }`}
                title={`Q${i + 1}${ans !== undefined ? (isRevealed ? (isCorrect ? " ✓" : " ✗") : " •") : ""}${isFlagged ? " ⚑" : ""}`}
              >
                {i + 1}
                {isFlagged && <span className="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-amber-400 border border-sidebar" />}
              </button>
            );
          })}
        </div>

        {/* Compact inline legend */}
        <div className="mt-4 pt-3 border-t border-sidebar-border flex flex-wrap gap-2.5 text-[10px] text-muted-foreground">
          <span className="flex items-center gap-1"><span className="size-2.5 rounded bg-sidebar border border-sidebar-border" /> Unans</span>
          <span className="flex items-center gap-1"><span className="size-2.5 rounded bg-primary/25 border border-primary/40" /> Ans</span>
          {p.session.mode === "tutor" && (
            <>
              <span className="flex items-center gap-1"><span className="size-2.5 rounded bg-blue-500/20 border border-blue-500/30" /> Corr</span>
              <span className="flex items-center gap-1"><span className="size-2.5 rounded bg-red-500/20 border border-red-500/30" /> Inc</span>
            </>
          )}
          <span className="flex items-center gap-1"><span className="size-2.5 rounded-full bg-amber-400" /> Flag</span>
        </div>
      </div>

      {/* Compact end test button */}
      {!p.readonly && (
        <div className="p-2 border-t border-sidebar-border">
          <Button variant="ghost" size="sm" onClick={p.onEndTest} className="w-full h-8 text-xs rounded-md text-destructive hover:text-destructive hover:bg-destructive/10">
            End Test
          </Button>
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
 * EXPLANATION CARD
 * ───────────────────────────────────────────────────────────────────────── */
function ExplanationCard({
  q,
  selected,
  nonMcq,
  highlights: questionHighlights,
  packUid,
  questionIdx,
  lang,
  item,
  onRemoveHighlight,
}: {
  q: SessionQuestion;
  selected: number | undefined;
  nonMcq?: boolean;
  highlights?: HighlightItem[];
  packUid?: string;
  questionIdx?: number;
  lang?: string;
  item?: ContentTreeNode;
  onRemoveHighlight?: (id: string) => void;
}) {
  const hl = questionHighlights ?? [];

  const { t } = useI18n();
  const base = item ? questionAssetBase(q, item) : { category: "qbank", path: "" };
  if (nonMcq) {
    return (
      <div className="rounded-xl border-2 border-blue-600 overflow-hidden">
        <div className="px-4 py-3 flex items-center gap-3 bg-blue-500/10 text-blue-300">
          <div className="size-9 rounded-full flex items-center justify-center shrink-0 bg-blue-500/100 text-white">
            <Sparkles className="size-5" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-base font-bold">{t("qbank.explanation.answerRevealed")}</div>
            <div className="text-xs mt-0.5">
              {t("qbank.explanation.reviewPrompt")}
            </div>
          </div>
        </div>
        <div className="bg-card px-5 py-4" data-explanation>
          <div className="flex items-center gap-2 mb-3">
            <Lightbulb className="size-4 text-primary" />
            <h3 className="text-sm font-semibold text-foreground">{t("qbank.explanation.title")}</h3>
          </div>
          <div className="uworld-prose text-[14px]" style={{ whiteSpace: "pre-wrap" }} dir="auto">
            <HighlightedContent
              html={renderQuestionText(q.explanation || t("qbank.explanation.noExplanation"), q, item)}
              highlights={hl}
            />
          </div>
          {imageListOf(q.explanationImages).length > 0 && (
            <div className="flex flex-col gap-3 mt-3">
              {imageListOf(q.explanationImages).map((img) => (
                <ContentImageFigure
                  key={img.src}
                  img={img}
                  category={questionAssetBase(q, item).category}
                  path={questionAssetBase(q, item).path}
                  className="rounded-xl border border-border max-h-[320px] w-auto mx-auto"
                />
              ))}
            </div>
          )}
          {q.tags && q.tags.length > 0 && (
            <div className="mt-4 pt-3 border-t border-border flex flex-wrap gap-1.5">
              {q.tags.map((t) => (
                <Badge key={t} variant="outline" className="text-[10px] rounded-md">
                  #{t}
                </Badge>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  const isCorrect = selected === q.correct;
  const correctLetter = choiceLetter(q.correct, lang);
  const selectedLetter = selected !== undefined ? choiceLetter(selected, lang) : "—";

  return (
    <div className={`rounded-xl border-2 overflow-hidden ${isCorrect ? "border-blue-600" : "border-red-500"}`}>
      <div className={`px-4 py-3 flex items-center gap-3 ${isCorrect ? "bg-blue-500/10 text-blue-300" : "bg-red-500/10 text-red-300"}`}>
        <div className={`size-9 rounded-full flex items-center justify-center shrink-0 ${isCorrect ? "bg-blue-500/100 text-white" : "bg-red-500/100 text-white"}`}>
          {isCorrect ? <Check className="size-5" /> : <X className="size-5" />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-base font-bold">{isCorrect ? t("qbank.explanation.correct") : t("qbank.explanation.incorrect")}</div>
          <div className="text-xs mt-0.5">
            {t("qbank.explanation.yourAnswer", { letter: selectedLetter })}
            {!isCorrect && (
              <>
                {"  ·  "}{t("qbank.explanation.correctAnswer", { letter: correctLetter })}
              </>
            )}
          </div>
        </div>
      </div>
      <div className="bg-card px-5 py-4" data-explanation>
        <div className="flex items-center gap-2 mb-3">
          <Lightbulb className="size-4 text-primary" />
          <h3 className="text-sm font-semibold text-foreground">{t("qbank.explanation.title")}</h3>
        </div>
        <div className="uworld-prose text-[14px]" style={{ whiteSpace: "pre-wrap" }} dir="auto">
          <HighlightedContent
            html={renderQuestionText(q.explanation || t("qbank.explanation.noExplanation"), q, item)}
            highlights={hl}
          />
        </div>
        {imageListOf(q.explanationImages).length > 0 && (
          <div className="flex flex-col gap-3 mt-3">
            {imageListOf(q.explanationImages).map((img) => (
              <ContentImageFigure
                key={img.src}
                img={img}
                category={questionAssetBase(q, item).category}
                path={questionAssetBase(q, item).path}
                className="rounded-xl border border-border max-h-[320px] w-auto mx-auto"
              />
            ))}
          </div>
        )}
        {q.tags && q.tags.length > 0 && (
          <div className="mt-4 pt-3 border-t border-border flex flex-wrap gap-1.5">
            <Badge variant="secondary" className="text-[10px] rounded-md capitalize">{q.difficulty ?? "standard"}</Badge>
            {q.tags.map((t) => (
              <Badge key={t} variant="outline" className="text-[10px] rounded-md">
                #{t}
              </Badge>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// Lightbulb icon (not in lucide-react, using Lightbulb from lucide)
function Lightbulb({ className }: { className?: string }) {
  return <Sparkles className={className} />;
}

/* ─────────────────────────────────────────────────────────────────────────
 * RESULTS VIEW
 * ───────────────────────────────────────────────────────────────────────── */
function ResultsView({
  session,
  item,
  onGoHome,
  onRestart,
}: {
  session: SessionData;
  item: ContentTreeNode;
  onGoHome: () => void;
  onRestart: () => void;
}) {
  const { t } = useI18n();
  const [pdfDialogOpen, setPdfDialogOpen] = React.useState(false);
  const total = session.questions.length;
  const answeredCount = Object.keys(session.answers).filter(
    (k) => session.answers[+k] !== undefined
  ).length;
  const correctCount = session.questions.filter(
    (q, i) => session.revealed[i] && session.answers[i] === q.correct
  ).length;
  // For non-MCQ, count rubric/rating-based correct
  const nonMcqCorrect = session.questions.filter((q, i) => {
    if (q.correct >= 0) return false;
    if (!session.revealed[i]) return false;
    if (session.engine === "flashcard" && !q.rubric?.length) return session.ratings[q.id] === "easy";
    // Per-question: if the question has a rubric, use rubric-based scoring
    // (handles mixed sessions where written questions coexist with other types).
    if (q.rubric && q.rubric.length > 0) {
      const rubric = session.rubricState[q.id] ?? [];
      return rubric.filter(Boolean).length / q.rubric.length >= 0.6;
    }
    return false;
  }).length;
  const totalCorrect = correctCount + nonMcqCorrect;
  const incorrectCount = answeredCount - correctCount;
  const flaggedCount = Object.values(session.flagged).filter(Boolean).length;
  const pct = total ? Math.round((totalCorrect / total) * 100) : 0;
  const totalTimeSec = Math.floor(
    ((session.completedAt ?? Date.now()) - session.startedAt) / 1000
  );
  const avgTimeSec = answeredCount ? Math.round(totalTimeSec / answeredCount) : 0;
  const percentile = Math.min(99, Math.max(1, Math.round(pct * 0.9 + 5)));

  const handleExportPdf = async (opts: PdfExportOptions) => {
    const questions = session.questions.map((q) => ({
      stem: q.stem,
      choices: q.choices,
      correct: q.correct,
      explanation: q.explanation,
      modelAnswer: q.modelAnswer,
      isWritten: q.correct < 0,
      difficulty: q.difficulty,
      tags: q.tags,
      rubric: q.rubric,
    }));

    const doc = generateResultsPdf({
      packTitle: item.title,
      mode: session.mode,
      score: {
        pct,
        correct: totalCorrect,
        total,
        answered: answeredCount,
        incorrect: incorrectCount,
        flagged: flaggedCount,
        percentile,
        totalTime: formatTime(totalTimeSec),
        avgTime: formatTime(avgTimeSec),
      },
      questions,
      userAnswers: session.answers,
      revealed: session.revealed,
      flagged: session.flagged,
      opts,
    });
    downloadPdf(doc, `${item.title} — Results`);
    toast({ title: t("pdf.pdfReady"), description: t("pdf.pdfReadyDesc") });
  };

  return (
    <div className="osler-page">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-foreground">Test Results</h1>
            <p className="text-sm text-muted-foreground mt-1">
              {item.title} · {total} questions ·{" "}
              {session.mode === "timed" ? "Timed" : "Tutor"} mode
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setPdfDialogOpen(true)} className="rounded-xl">
              <FileText className="size-4 mr-1.5" /> {t("pdf.exportResults")}
            </Button>
            <Button variant="outline" onClick={onRestart} className="rounded-xl">
              <RotateCcw className="size-4 mr-1.5" /> Restart
            </Button>
            <Button variant="outline" onClick={onGoHome} className="rounded-xl">
              <Home className="size-4 mr-1.5" /> Back to QBank
            </Button>
          </div>
        </div>

        <div className="qbank-card">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-center">
            <div className="text-center lg:border-r lg:border-border lg:pr-6">
              <div className="text-xs uppercase tracking-wider text-muted-foreground mb-1">
                Your Score
              </div>
              <div className="flex items-baseline justify-center gap-1">
                <span
                  className={cn(
                    "text-5xl font-bold tabular-nums",
                    pct >= 70
                      ? "text-blue-500"
                      : pct >= 50
                      ? "text-amber-500"
                      : "text-red-500"
                  )}
                >
                  {pct}%
                </span>
              </div>
              <div className="text-xs text-muted-foreground mt-1">
                {totalCorrect} of {total} correct
              </div>
            </div>

            <div className="text-center lg:border-r lg:border-border lg:pr-6">
              <div className="text-xs uppercase tracking-wider text-muted-foreground mb-1">
                Percentile Rank
              </div>
              <div className="text-5xl font-bold tabular-nums text-primary">
                {percentile}
                <span className="text-2xl font-normal text-muted-foreground">th</span>
              </div>
              <div className="text-xs text-muted-foreground mt-1">
                You scored higher than {percentile}% of users.
              </div>
            </div>

            <div className="space-y-2 text-sm">
              <SummaryRow label="Answered" value={`${answeredCount}/${total}`} />
              <SummaryRow label="Incorrect" value={`${incorrectCount}`} />
              <SummaryRow label="Flagged" value={`${flaggedCount}`} />
              <SummaryRow label="Total Time" value={formatTime(totalTimeSec)} />
              <SummaryRow label="Avg / Question" value={formatTime(avgTimeSec)} />
            </div>
          </div>
        </div>

        <div className="qbank-card">
          <h3 className="text-sm font-semibold mb-3">Score Distribution</h3>
          <div className="flex h-3 rounded-full overflow-hidden bg-muted">
            <div
              className="bg-blue-500"
              style={{ width: `${(totalCorrect / total) * 100}%` }}
            />
            <div
              className="bg-red-500"
              style={{ width: `${(incorrectCount / total) * 100}%` }}
            />
            <div
              className="bg-muted-foreground/30"
              style={{ width: `${((total - answeredCount) / total) * 100}%` }}
            />
          </div>
          <div className="mt-2 flex items-center gap-4 text-xs text-muted-foreground flex-wrap">
            <span className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-full bg-blue-500" /> Correct
            </span>
            <span className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-full bg-red-500" /> Incorrect
            </span>
            <span className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-full bg-muted-foreground/30" /> Unanswered
            </span>
          </div>
        </div>

        <div className="qbank-card">
          <h3 className="text-base font-semibold mb-3 flex items-center gap-2">
            <ListChecks className="size-4 text-primary" /> Question Review
          </h3>
          <div className="space-y-2">
            {session.questions.map((q, i) => {
              const ans = session.answers[i];
              const submittedQ = session.revealed[i];
              const isMCQ = q.correct >= 0;
              const isCorrect = isMCQ
                ? submittedQ && ans === q.correct
                : session.engine === "flashcard" && !q.rubric?.length
                ? session.ratings[q.id] === "easy"
                : submittedQ &&
                  q.rubric &&
                  q.rubric.length > 0 &&
                  (session.rubricState[q.id] ?? []).filter(Boolean).length /
                    q.rubric.length >=
                    0.6;
              return (
                <div
                  key={q.id}
                  className="flex items-center gap-3 p-3 rounded-md border border-border bg-card justify-between"
                >
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <div
                      className={cn(
                        "w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold shrink-0",
                        isCorrect
                          ? "bg-blue-500/15 text-blue-500"
                          : submittedQ
                          ? "bg-red-500/15 text-red-500"
                          : "bg-muted text-muted-foreground"
                      )}
                    >
                      {submittedQ ? (isCorrect ? "✓" : "✗") : i + 1}
                    </div>
                    <p className="text-xs line-clamp-2 flex-1">{q.stem}</p>
                  </div>
                  {isMCQ && submittedQ && (
                    <div className="text-[11px] shrink-0 font-medium ml-2">
                      {isCorrect ? (
                        <span className="text-success">
                          {t("qbank.explanation.correctAnswer", { letter: choiceLetter(q.correct, item.lang) })}
                        </span>
                      ) : (
                        <span className="flex flex-col sm:flex-row gap-1 sm:gap-2">
                          <span className="text-destructive">
                            {t("qbank.explanation.yourAnswer", { letter: ans !== undefined ? choiceLetter(ans, item.lang) : "—" })}
                          </span>
                          <span className="text-success">
                            ({t("qbank.explanation.correctAnswer", { letter: choiceLetter(q.correct, item.lang) })})
                          </span>
                        </span>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <PdfExportDialog
        open={pdfDialogOpen}
        onOpenChange={setPdfDialogOpen}
        defaultTitle={item.title}
        defaultSubtitle={`${session.mode === "timed" ? "Timed" : "Tutor"} Mode`}
        variant="quiz"
        onExport={handleExportPdf}
      />
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
 * Helpers
 * ───────────────────────────────────────────────────────────────────────── */
function SectionHeader({
  number,
  title,
  subtitle,
}: {
  number: number;
  title: string;
  subtitle?: string;
}) {
  return (
    <div className="qbank-card-header">
      <div className="qbank-card-number">{number}</div>
      <div>
        <h3 className="text-base font-semibold text-foreground">{title}</h3>
        {subtitle && (
          <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>
        )}
      </div>
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-semibold tabular-nums">{value}</span>
    </div>
  );
}

function formatTime(sec: number): string {
  if (sec < 0) sec = 0;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0)
    return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

function countQuestions(content: AnyContent): number {
  return poolCountQuestions(content);
}

function contentToQuestions(
  content: AnyContent,
  sourceUid?: string,
  sourceTitle?: string,
  sourceNode?: ContentTreeNode,
): SessionQuestion[] {
  // Delegate to the shared module. Note: sourceUid/sourceTitle are NOT
  // stamped here — single-pack paths still rely on `session.itemId` for
  // progress recording. The multi-pack path (buildQuestionPool) stamps them
  // explicitly when constructing the pool.
  return poolContentToQuestions(content, sourceUid, sourceTitle, sourceNode) as SessionQuestion[];
}

function saveSession(s: SessionData) {
  const total = s.questions.length;
  const answeredCount = Object.keys(s.answers).filter(
    (k) => s.answers[+k] !== undefined
  ).length;
  const mcqCorrect = s.questions.filter(
    (q, i) => s.revealed[i] && s.answers[i] === q.correct
  ).length;
  const nonMcqCorrect = s.questions.filter((q, i) => {
    if (q.correct >= 0) return false;
    if (!s.revealed[i]) return false;
    if (s.engine === "flashcard") return s.ratings[q.id] === "easy";
    if (s.engine === "written" || s.engine === "osce") {
      const rubric = s.rubricState[q.id] ?? [];
      return (
        q.rubric &&
        q.rubric.length > 0 &&
        rubric.filter(Boolean).length / q.rubric.length >= 0.6
      );
    }
    return false;
  }).length;
  const correctCount = mcqCorrect + nonMcqCorrect;
  const incorrectCount = answeredCount - mcqCorrect;
  const flaggedCount = Object.values(s.flagged).filter(Boolean).length;

  // P2-6: persist questionRefs (id+sourceUid parallel to the questions array),
  // the deduped source uids, and the filters that were active when the session
  // was built. Lets Previous Tests / Tracker reopen & retake accurately.
  const questionRefs = s.questions.map((q) => ({
    id: q.id,
    sourceUid: q.sourceUid ?? s.itemId,
  }));
  const sources = Array.from(new Set(questionRefs.map((r) => r.sourceUid)));

  const saved: SavedSession = {
    id: s.sessionId,
    packUid: s.itemId,
    packTitle: s.itemTitle,
    engine: s.engine,
    mode: s.mode,
    totalQuestions: total,
    answeredCount,
    correctCount,
    incorrectCount,
    flaggedCount,
    startedAt: s.startedAt,
    completedAt: s.completedAt,
    answers: s.answers,
    revealed: s.revealed,
    flagged: s.flagged,
    current: s.current,
    examTimeRemaining: s.examTimeRemaining,
    writtenDrafts: s.writtenDrafts,
    rubricState: s.rubricState,
    ratings: s.ratings,
    questionRefs,
    sources,
    tagsFilter: s.tagsFilter,
    onlyMode: s.onlyMode,
  };
  sessions.save(saved);
}

