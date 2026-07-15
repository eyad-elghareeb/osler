"use client";

import * as React from "react";
import { motion, AnimatePresence } from "framer-motion";
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
} from "lucide-react";
import { loadAllContent, ENGINE_META, flattenTree } from "@/lib/osler/content";
import type {
  AnyContent,
  BankContent,
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
} from "@/lib/osler/storage";
import { listAllArticles } from "@/lib/osler/articles";
import type { Article, ArticleMeta } from "@/lib/osler/articles";
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
import { useQuizSettings } from "@/hooks/use-quiz-settings";
import { setImmersiveMode } from "./immersive-mode";
import { haptic } from "@/lib/osler/native";
import { gradeWithAI, createManualEvaluation } from "@/lib/osler/grading";
import { useI18n } from "./i18n-provider";
import type { StringKey } from "@/lib/osler/i18n";

const LETTERS = ["A", "B", "C", "D", "E", "F", "G", "H"];
const ARABIC_LETTERS = ["أ", "ب", "ج", "د", "ه", "و", "ز", "ح", "ط", "ي"];
// Choice indicators localised to the content language — Arabic content uses
// the Abjad-style sequence أ,ب,ت,… instead of Latin A,B,C,…
const choiceLetter = (idx: number, lang?: string): string =>
  (lang && lang.startsWith("ar") ? ARABIC_LETTERS : LETTERS)[idx] ?? "?";
const HIGHLIGHT_COLORS = HIGHLIGHT_COLOR_KEYS;

interface QBankStudioProps {
  activeItem?: ContentTreeNode | null;
  activeContent?: AnyContent | null;
  onExit: () => void;
  onOpenPack?: (item: ContentTreeNode) => void;
}

type QuizMode = "home" | "quiz" | "results";
type TestMode = "tutor" | "timed";
type HomeTab = "content" | "create" | "previous";

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
  choices: string[];
  correct: number; // -1 for non-MCQ
  explanation: string;
  modelAnswer?: string;
  tags?: string[];
  difficulty?: string;
  rubric?: string[];
  redFlags?: string[];
  differential?: string[];
  children?: SessionQuestionChild[];
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
      let questions = contentToQuestions(content);
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
      // Save to sessions list
      saveSession(completed);
      return completed;
    });
    setMode("results");
  }, []);

  const restartSession = () => {
    if (activeItem && activeContent) {
      storage.clearPack(activeItem.uid);
      highlights.clearAll(activeItem.uid);
      writtenDrafts.clear(activeItem.uid);
      startSession(activeItem, activeContent);
    }
  };

  const exitToHome = () => {
    setMode("home");
    setSession(null);
    setImmersiveMode(false);
    onExit();
  };

  // Request exit confirmation — opens a modal when there is an in-progress
  // session; otherwise just exits immediately.
  const requestExit = () => {
    if (mode === "quiz" && session) {
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
    if (!session || !activeItem) return;
    const selected = session.answers[idx];
    const correct = selected === q.correct;
    storage.recordAnswer(
      activeItem.uid,
      q.id,
      session.engine,
      selected,
      correct,
      !!session.flagged[idx]
    );
    force();
  };

  if (mode === "quiz" && session) {
    return (
      <>
        <QuizView
          session={session}
          activeItem={activeItem!}
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
              storage.recordAnswer(
                activeItem!.uid,
                q.id,
                session.engine,
                idx,
                correct,
                !!session.flagged[session.current]
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
              storage.recordAnswer(
                activeItem!.uid,
                q.id,
                session.engine,
                undefined,
                correct,
                !!session.flagged[session.current]
              );
              force();
            }
          }}
          onWrittenDraftChange={(qid, draft) => {
            setSession((s) => {
              if (!s) return s;
              const drafts = { ...s.writtenDrafts, [qid]: draft };
              writtenDrafts.save(s.itemId, drafts);
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
              storage.recordAnswer(
                activeItem!.uid,
                qid,
                session.engine,
                undefined,
                rating === "easy",
                !!session.flagged[session.current]
              );
            }
            force();
          }}
          onToggleFlag={() => {
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
          onTogglePause={() =>
            setSession((s) => (s ? { ...s, examPaused: !s.examPaused } : s))
          }
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
              return {
                ...s,
                answers: newAnswers,
                revealed: newRevealed,
                ratings: newRatings,
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

  if (mode === "results" && session && activeItem) {
    return (
      <ResultsView
        session={session}
        item={activeItem}
        onGoHome={exitToHome}
        onRestart={restartSession}
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
}: {
  testMode: TestMode;
  onTestModeChange: (m: TestMode) => void;
  onOpenPack?: (item: ContentTreeNode) => void;
  homeTab: HomeTab;
  onHomeTabChange: (t: HomeTab) => void;
  onSetQuestionLimit?: (n: number) => void;
}) {
  const [data, setData] = React.useState<{
    items: PackEntry[];
  } | null>(null);
  const [, force] = React.useReducer((x) => x + 1, 0);
  const { t } = useI18n();
  const [savedSessions, setSavedSessions] = React.useState<SavedSession[]>([]);

  React.useEffect(() => {
    loadAllContent()
      .then((result) => {
        setData({
          items: result.items.filter(
            (entry) =>
              entry.node.type !== "flashcard" &&
              entry.node.type !== "osce" &&
              entry.node.type !== "video"
          ),
        });
      })
      .catch(console.error);
  }, []);

  React.useEffect(() => {
    const update = () => setSavedSessions(sessions.list());
    update();
    return sessions.subscribe(update);
  }, []);

  React.useEffect(() => storage.subscribe(force), []);

  return (
    <div className="flex h-[calc(100vh-3.5rem)] overflow-hidden bg-background">
      <div className="flex-1 min-w-0 overflow-y-auto medos-scroll-y medos-tabbar-pad">
        <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 py-4 sm:py-6 min-w-0">
          {/* Page header */}
          <div className="mb-6">
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">
              QBank Studio
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Browse premade content packs or build a custom test with UWorld-style tools.
            </p>
          </div>

          {/* Tab bar */}
          <div className="border-b border-border mb-6">
            <nav className="-mb-px flex gap-0">
              {[
                { id: "content" as const, label: t("qbank.home.tabContent"), icon: Grid3x3 },
                { id: "create" as const, label: t("qbank.home.createTest"), icon: Plus },
                { id: "previous" as const, label: t("qbank.home.tabPrevious"), icon: History },
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

          {homeTab === "content" && (
            <ContentTab
              data={data}
              onOpenPack={onOpenPack}
            />
          )}
          {homeTab === "create" && (
            <CreateTestTab
              data={data}
              testMode={testMode}
              onTestModeChange={onTestModeChange}
              onOpenPack={onOpenPack}
              onSetQuestionLimit={onSetQuestionLimit}
            />
          )}
          {homeTab === "previous" && (
            <PreviousTestsTab
              sessions={savedSessions}
              onDelete={(id) => sessions.delete(id)}
            />
          )}
        </div>
      </div>
    </div>
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
}: {
  node: ContentTreeNode;
  content: AnyContent;
  index: number;
  onOpenPack?: (item: ContentTreeNode) => void;
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
    return (node.files ?? []).map((f) => `${base}${f}`);
  }, [categoryFolder, node.path, node.files]);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpenPack?.(node)}
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
            <span className="text-emerald-500 font-medium tabular-nums">{accuracy}%</span>
            <span className="text-muted-foreground">{t("dash.accuracy")}</span>
          </div>
          <div className="h-1.5 rounded-full bg-muted/40 overflow-hidden">
            <div
              className="h-full rounded-full bg-emerald-500 transition-all duration-300"
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
}: {
  data: { items: PackEntry[] } | null;
  onOpenPack?: (item: ContentTreeNode) => void;
}) {
  const { t, contentFilter } = useI18n();
  const [searchQuery, setSearchQuery] = React.useState("");
  const [debouncedSearchQuery, setDebouncedSearchQuery] = React.useState("");
  const [selectedEngine, setSelectedEngine] = React.useState<EngineType | null>(null);

  React.useEffect(() => {
    const tid = setTimeout(() => setDebouncedSearchQuery(searchQuery), 200);
    return () => clearTimeout(tid);
  }, [searchQuery]);

  // Group items by engine type (run unconditionally before any early return)
  const grouped = React.useMemo(() => {
    if (!data) return {};
    const map: Record<string, typeof data.items> = {};
    for (const entry of data.items) {
      // Apply content-language filter from settings
      const lang = entry.node.lang ?? entry.content?.meta.lang ?? "en";
      if (contentFilter !== "all" && lang !== contentFilter) continue;
      if (!map[entry.node.type]) map[entry.node.type] = [];
      map[entry.node.type].push(entry);
    }
    return map;
  }, [data, contentFilter]);

  // Filter by search (run unconditionally)
  const filtered = React.useMemo(() => {
    if (!data) return {};
    if (!debouncedSearchQuery.trim()) return grouped;
    const q = debouncedSearchQuery.toLowerCase();
    const result: Record<string, typeof data.items> = {};
    for (const [type, items] of Object.entries(grouped)) {
      const matched = items.filter(
        (entry) =>
          entry.node.title.toLowerCase().includes(q) ||
          entry.content?.meta.description?.toLowerCase().includes(q) ||
          entry.content?.meta.tags?.some((t) => t.toLowerCase().includes(q))
      );
      if (matched.length > 0) result[type] = matched;
    }
    return result;
  }, [grouped, debouncedSearchQuery, data]);

  // Per-engine aggregates for the stat bar / folder cards
  const engineStats = React.useMemo(() => {
    const map: Record<
      string,
      { packs: number; questions: number; attempted: number; correct: number }
    > = {};
    if (!data) return map;
    for (const { node, content } of data.items) {
      if (!content) continue;
      const t = node.type;
      if (!map[t]) map[t] = { packs: 0, questions: 0, attempted: 0, correct: 0 };
      map[t].packs += 1;
      map[t].questions += countQuestions(content);
      const p = storage.packProgress(node.uid);
      map[t].attempted += p.attempted;
      map[t].correct += p.correct;
    }
    return map;
  }, [data]);

  if (!data) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (data.items.length === 0) {
    return (
      <div className="text-center py-16">
        <div className="size-14 rounded-full bg-muted/40 flex items-center justify-center mx-auto mb-4">
          <Grid3x3 className="size-6 text-muted-foreground" />
        </div>
        <h3 className="text-base font-semibold mb-1">{t("qbank.home.empty")}</h3>
        <p className="text-sm text-muted-foreground">
          {t("qbank.home.empty")}
        </p>
      </div>
    );
  }

  // ── PACKS VIEW (engine selected) ───────────────────────────────────────
  if (selectedEngine) {
    const meta = ENGINE_META[selectedEngine];
    const Icon = ENGINE_ICONS[selectedEngine] ?? ListChecks;
    const items = (filtered[selectedEngine] ?? []).filter((x) => x.content);
    const stat = engineStats[selectedEngine] ?? {
      packs: 0,
      questions: 0,
      attempted: 0,
      correct: 0,
    };
    const accuracy =
      stat.attempted > 0 ? Math.round((stat.correct / stat.attempted) * 100) : 0;

    return (
      <div>
        <div className="max-w-5xl mx-auto px-0 sm:px-0 py-2">
          {/* Header */}
          <div className="mb-5">
            <button
              onClick={() => setSelectedEngine(null)}
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors mb-3"
            >
              <ArrowLeft className="size-3.5" />
              {t("common.all")}
            </button>
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
              <Icon className="size-3.5" style={{ color: meta.color }} />
              <span style={{ color: meta.color }}>{t(`engine.${selectedEngine}` as any)}</span>
            </div>
            <h1 className="text-2xl md:text-3xl font-bold tracking-tight mb-1">
              {t(`engine.${selectedEngine}` as any)}
            </h1>
            <p className="text-sm text-muted-foreground">
              {stat.packs} · {t("qbank.home.questions", { n: stat.questions })}
            </p>
          </div>

          {/* Search */}
          <div className="relative mb-3">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t("qbank.home.search")}
              className="w-full h-10 pl-10 pr-4 rounded-xl border border-border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>

          <ContentLangFilter />

          {items.length === 0 ? (
            <div className="text-center py-16">
              <div className="size-14 rounded-full bg-muted/40 flex items-center justify-center mx-auto mb-4">
                <Search className="size-6 text-muted-foreground" />
              </div>
              <h3 className="text-base font-semibold mb-1">{t("qbank.home.empty")}</h3>
              <p className="text-sm text-muted-foreground">{t("qbank.home.search")}</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {items.map(({ node, content }, idx) => (
                <PackCard
                  key={node.uid}
                  node={node}
                  content={content as AnyContent}
                  index={idx}
                  onOpenPack={onOpenPack}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── ENGINES VIEW (folder grid, mirrors the flashcard decks view) ───────
  const engineEntries = Object.entries(filtered) as Array<
    [EngineType, typeof data.items]
  >;

  return (
    <div className="h-full overflow-y-auto medos-scroll">
      <div className="max-w-5xl mx-auto px-0 sm:px-0 py-2">
        {/* Stat bar */}
        <div className="grid grid-cols-3 gap-3 mb-6">
          <div className="bg-card border border-border rounded-xl p-3.5">
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
              <Grid3x3 className="size-3.5" />
              {t("dash.packsStarted")}
            </div>
            <div className="text-xl font-bold">{data.items.length}</div>
          </div>
          <div className="bg-card border border-border rounded-xl p-3.5">
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
              <ListChecks className="size-3.5" />
              {t("dash.attemptedLabel")}
            </div>
            <div className="text-xl font-bold">
              {Object.values(engineStats).reduce((s, e) => s + e.questions, 0)}
            </div>
          </div>
          <div className="bg-card border border-border rounded-xl p-3.5">
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
              <Activity className="size-3.5" />
              {t("dash.accuracy")}
            </div>
            <div className="text-xl font-bold">
              {(() => {
                const totalAttempted = Object.values(engineStats).reduce(
                  (s, e) => s + e.attempted,
                  0
                );
                const totalCorrect = Object.values(engineStats).reduce(
                  (s, e) => s + e.correct,
                  0
                );
                return totalAttempted > 0
                  ? `${Math.round((totalCorrect / totalAttempted) * 100)}%`
                  : "—";
              })()}
            </div>
          </div>
        </div>

        {/* Search */}
        <div className="relative mb-3">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t("qbank.home.search")}
            className="w-full h-10 pl-10 pr-4 rounded-xl border border-border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
        </div>

        {/* Content-language filter pills — drives the `contentFilter` state
            from the i18n provider. Reflects the user's choice from Settings. */}
        <ContentLangFilter />

        {/* Engine folders */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {engineEntries.map(([type, items], idx) => {
            const meta = ENGINE_META[type];
            const Icon = ENGINE_ICONS[type] ?? ListChecks;
            const stat = engineStats[type] ?? {
              packs: 0,
              questions: 0,
              attempted: 0,
              correct: 0,
            };
            const accuracy =
              stat.attempted > 0
                ? Math.round((stat.correct / stat.attempted) * 100)
                : 0;
            return (
              <button
                key={type}
                onClick={() => setSelectedEngine(type)}
                className="medos-fade-in text-start bg-card border border-border rounded-xl p-5 hover:border-primary/40 hover:shadow-md hover:bg-primary/[0.02] transition-colors group flex flex-col gap-3"
                style={{ animationDelay: `${idx * 0.04}s` }}
              >
                <div className="flex items-center gap-3">
                  <div
                    className="size-11 rounded-xl flex items-center justify-center shrink-0"
                    style={{ backgroundColor: `${meta.color}/15`, color: meta.color }}
                  >
                    <Icon className="size-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="font-semibold truncate text-foreground">{t(`engine.${type}` as any)}</h3>
                    <p className="text-xs text-muted-foreground">
                      {items.length} {t("dash.packsStarted").toLowerCase()}
                    </p>
                  </div>
                  <ChevronRight className="size-4 text-muted-foreground/40 group-hover:text-muted-foreground transition-colors shrink-0" />
                </div>
                <p className="text-xs text-muted-foreground/70 line-clamp-2">
                  {t("qbank.home.questions", { n: stat.questions })}
                </p>
                {stat.attempted > 0 ? (
                  <>
                    <div className="flex items-center gap-2 text-[11px]">
                      <span className="text-emerald-500 font-medium tabular-nums">
                        {accuracy}%
                      </span>
                      <span className="text-muted-foreground">{t("dash.accuracy")}</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-muted/40 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-emerald-500 transition-all duration-300"
                        style={{ width: `${accuracy}%` }}
                      />
                    </div>
                  </>
                ) : (
                  <span className="text-[11px] text-muted-foreground/50">{t("qbank.home.start")}</span>
                )}
              </button>
            );
          })}
        </div>

        {engineEntries.length === 0 && (
          <div className="text-center py-16">
            <div className="size-14 rounded-full bg-muted/40 flex items-center justify-center mx-auto mb-4">
              <Search className="size-6 text-muted-foreground" />
            </div>
            <h3 className="text-base font-semibold mb-1">{t("qbank.home.empty")}</h3>
            <p className="text-sm text-muted-foreground">{t("qbank.home.search")}</p>
          </div>
        )}
      </div>
    </div>
  );
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
}: {
  data: { items: PackEntry[] } | null;
  testMode: TestMode;
  onTestModeChange: (m: TestMode) => void;
  onOpenPack?: (item: ContentTreeNode) => void;
  onSetQuestionLimit?: (n: number) => void;
}) {
  const { t } = useI18n();
  const [batchSize, setBatchSize] = React.useState(20);
  const [customBatchInput, setCustomBatchInput] = React.useState("");
  const [selectedEngineTypes, setSelectedEngineTypes] = React.useState<string[]>([]);
  const [selectedTags, setSelectedTags] = React.useState<string[]>([]);
  const [query, setQuery] = React.useState("");
  const [sort, setSort] = React.useState<"default" | "random">("default");

  // Compute available tags from all content packs
  const allTags = React.useMemo(() => {
    if (!data) return [];
    const tagSet = new Set<string>();
    for (const { content } of data.items) {
      content?.meta.tags?.forEach((t) => tagSet.add(t));
    }
    return Array.from(tagSet).sort();
  }, [data]);

  // Filter packs based on selections
  const filteredPacks = React.useMemo(() => {
    if (!data) return [];
    let packs = [...data.items];
    if (selectedEngineTypes.length > 0) {
      packs = packs.filter((p) => selectedEngineTypes.includes(p.node.type));
    }
    if (selectedTags.length > 0) {
      packs = packs.filter((p) =>
        p.content?.meta.tags?.some((t) => selectedTags.includes(t))
      );
    }
    if (query.trim()) {
      const q = query.toLowerCase();
      packs = packs.filter(
        (p) =>
          p.node.title.toLowerCase().includes(q) ||
          p.content?.meta.description?.toLowerCase().includes(q)
      );
    }
    if (sort === "random") {
      packs = [...packs].sort(() => Math.random() - 0.5);
    }
    return packs;
  }, [data, selectedEngineTypes, selectedTags, query, sort]);

  const totalAvailable = filteredPacks.reduce(
    (sum, p) => sum + (p.content ? countQuestions(p.content) : 0),
    0
  );
  const actualBatchSize = customBatchInput.trim()
    ? Math.min(parseInt(customBatchInput) || 0, totalAvailable)
    : Math.min(batchSize, totalAvailable);

  const engineOptions = Object.entries(ENGINE_META).map(([key, meta]) => ({
    id: key,
    label: meta.label,
  }));

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* Builder column */}
      <div className="lg:col-span-2 space-y-5">
        {/* Section 1: Test Mode */}
        <div className="qbank-card">
          <SectionHeader number={1} title="Select Test Mode" subtitle="Choose how you want to take this test." />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-4">
            <ModeCard
              active={testMode === "timed"}
              onClick={() => onTestModeChange("timed")}
              icon={TimerIcon}
              label="Timed"
              description="Simulates actual exam conditions. The test must be completed in the allotted time."
            />
            <ModeCard
              active={testMode === "tutor"}
              onClick={() => onTestModeChange("tutor")}
              icon={Sparkles}
              label="Tutor"
              description="Get immediate feedback and explanations after each question."
            />
          </div>
        </div>

        {/* Section 2: Number of Questions */}
        <div className="qbank-card">
          <SectionHeader number={2} title="Number of Questions" subtitle="Pick a preset or enter a custom value." />
          <div className="mt-4 flex flex-wrap items-center gap-2">
            {[10, 20, 40, 60].map((n) => (
              <button
                key={n}
                onClick={() => {
                  setBatchSize(n);
                  setCustomBatchInput("");
                }}
                className={cn(
                  "px-4 py-2 rounded-xl text-sm font-medium border-2 transition-all",
                  batchSize === n && !customBatchInput
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border bg-card text-foreground hover:border-primary/40 hover:bg-primary/5"
                )}
              >
                {n}
              </button>
            ))}
            <div className="flex items-center gap-2 ml-1">
              <input
                type="number" min={1} max={200}
                value={customBatchInput}
                onChange={(e) => {
                  setCustomBatchInput(e.target.value);
                  const v = parseInt(e.target.value);
                  if (v > 0 && v <= 200) setBatchSize(v);
                }}
                placeholder="Custom"
                className="w-24 h-9 rounded-xl border border-border bg-card text-sm px-3 focus:outline-none focus:ring-2 focus:ring-primary/30 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              />
              <span className="text-xs text-muted-foreground">questions</span>
            </div>
            <div className="ml-auto text-xs text-muted-foreground">
              {totalAvailable} available
            </div>
          </div>
        </div>

        {/* Section 3: Content Selection */}
        <div className="qbank-card">
          <SectionHeader number={3} title="Select Content" subtitle="Filter by engine type and tags to include." />
          <div className="mt-4 space-y-4">
            {/* Search */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search packs by title or description…"
                className="w-full h-10 pl-10 pr-4 rounded-xl border border-border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>

            {/* Engine type checkboxes */}
            <CheckboxColumn
              title="Engine Types (Subjects)"
              items={engineOptions.map((e) => ({
                id: e.id,
                label: e.label,
                count: data?.items.filter((p) => p.node.type === e.id && (selectedTags.length === 0 || p.content?.meta.tags?.some((t) => selectedTags.includes(t)))).length ?? 0,
              }))}
              selected={selectedEngineTypes}
              onChange={setSelectedEngineTypes}
              onClear={() => setSelectedEngineTypes([])}
            />

            {/* Tags */}
            {allTags.length > 0 && (
              <CheckboxColumn
                title={t("qbank.home.tagsTopics")}
                items={allTags.map((t) => ({
                  id: t,
                  label: t,
                  count: data?.items.filter(
                    (p) =>
                      p.content?.meta.tags?.includes(t) &&
                      (selectedEngineTypes.length === 0 || selectedEngineTypes.includes(p.node.type))
                  ).length ?? 0,
                }))}
                selected={selectedTags}
                onChange={setSelectedTags}
                onClear={() => setSelectedTags([])}
              />
            )}
          </div>
        </div>

        {/* Section 4: Ordering */}
        <div className="qbank-card">
          <SectionHeader number={4} title={t("qbank.home.questionOrder")} subtitle="Choose how questions are ordered in your test." />
          <div className="mt-4">
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as "default" | "random")}
              className="w-full sm:w-64 h-9 rounded-xl border border-border bg-card text-sm px-3 focus:outline-none focus:ring-2 focus:ring-primary/30"
            >
              <option value="default">{t("qbank.home.defaultOrder")}</option>
              <option value="random">{t("qbank.home.randomized")}</option>
            </select>
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
                value={actualBatchSize > 0 ? String(actualBatchSize) : "—"}
              />
              <SummaryRow
                label={t("qbank.home.engines")}
                value={selectedEngineTypes.length > 0 ? selectedEngineTypes.length + t("qbank.home.selected") : t("qbank.home.all")}
              />
              <SummaryRow
                label={t("qbank.home.tags")}
                value={selectedTags.length > 0 ? selectedTags.length + t("qbank.home.selected") : t("qbank.home.all")}
              />
              <SummaryRow label={t("qbank.home.packs")} value={String(filteredPacks.length)} />
              <SummaryRow label={t("qbank.home.totalAvailable")} value={String(totalAvailable)} />
            </div>

            <div className="mt-5 pt-4 border-t border-border">
              <Button
                onClick={() => {
                  onSetQuestionLimit?.(actualBatchSize);
                  if (filteredPacks.length > 0 && filteredPacks[0].content) {
                    onOpenPack?.(filteredPacks[0].node);
                  }
                }}
                disabled={filteredPacks.length === 0 || actualBatchSize === 0}
                className="w-full h-11 text-sm font-semibold rounded-xl"
              >
                <Plus className="size-4 mr-2" />
                {t("qbank.home.createTest")}
              </Button>
              <p className="text-[11px] text-muted-foreground text-center mt-2">
                {filteredPacks.length > 0
                  ? `Create a test with ${actualBatchSize} question${actualBatchSize !== 1 ? "s" : ""} from ${filteredPacks[0].node.title}.`
                  : "Adjust filters to find available content."}
              </p>
            </div>
          </div>

          {/* Selected packs preview */}
          {filteredPacks.length > 0 && (
            <div className="qbank-card">
              <h3 className="text-sm font-semibold text-foreground flex items-center gap-2 mb-3">
                <ListChecks className="size-4 text-primary" />
                Matching Packs
              </h3>
              <div className="space-y-2 max-h-64 overflow-y-auto medos-scroll">
                {filteredPacks.slice(0, 20).map(({ node, content }) => (
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
                        {ENGINE_META[node.type].label}
                        {content && ` · ${countQuestions(content)} questions`}
                      </span>
                    </div>
                  </div>
                ))}
                {filteredPacks.length > 20 && (
                  <p className="text-xs text-muted-foreground text-center pt-1">
                    +{filteredPacks.length - 20} more
                  </p>
                )}
              </div>
            </div>
          )}

          <div className="qbank-card">
            <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
              <Lightbulb className="size-4 text-amber-500" />
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
}: {
  sessions: SavedSession[];
  onDelete: (id: string) => void;
}) {
  const { t } = useI18n();
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

  // 1s tick — drives the tutor-mode elapsed clock.
  React.useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // Timed countdown — pause-aware, fully isolated from the parent view.
  React.useEffect(() => {
    if (mode !== "timed" || paused) return;
    const id = setInterval(() => {
      setRemaining((r) => {
        const next = r - 1;
        if (next <= 0) {
          clearInterval(id);
          onExpire();
          return 0;
        }
        return next;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [mode, paused, onExpire]);

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
  activeItem,
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
  activeItem: ContentTreeNode;
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
  const submitted = session.revealed[session.current] || false;
  const selected = session.answers[session.current];
  const isMCQ = q ? q.correct >= 0 : false;
  const isPausedOrLocked = session.examPaused;
  const engineLabel = ENGINE_META[session.engine].label;
  const { t, rtl } = useI18n();

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
        createManualEvaluation(draft.text);
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
    const qSubmitted = session.revealed[qIdx] || false;
    const qSelected = session.answers[qIdx];
    const qIsMCQ = question.correct >= 0;
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
      <div className="h-full overflow-y-auto medos-scroll pr-1 -mr-1 pb-6">
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

        {/* Stem */}
        <div className="relative">
          <div className="uworld-prose" style={stemStyle}>
            <HighlightedContent text={question.stem} highlights={qHighlights} />
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
                    onToggleStrikethrough(idx);
                  }}
                  onTouchStart={() => interactive && startLongPress(idx)}
                  onTouchEnd={cancelLongPress}
                  onTouchMove={cancelLongPress}
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
                  >
                    <HighlightedContent text={choice} highlights={qHighlights} />
                  </div>
                </button>
              );
            })}
          </div>
        ) : null}

        {/* Written engine: textarea + grading (interactive only — too complex for previews) */}
        {interactive && session.engine === "written" && (
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
              {session.engine === "written" ? (
                <WrittenEvaluationPanel
                  draft={qWrittenDraft}
                  question={question}
                  passed={qWrittenPassed}
                  isManual={qWrittenDraft.evaluation?.score === null}
                  onRubricToggle={(idx) => {
                    const cur = qWrittenDraft.rubricChecked;
                    const next = [...cur];
                    while (next.length < (question.rubric?.length ?? 0)) next.push(false);
                    next[idx] = !next[idx];
                    onWrittenDraftChange(question.id, { ...qWrittenDraft, rubricChecked: next });
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
                <ExplanationCard q={question} selected={qSelected} nonMcq={!qIsMCQ} highlights={qHighlights} packUid={activeItem.uid} questionIdx={qIdx} lang={activeItem.lang ?? "en"} />
              )}
            </div>
          </div>
        )}

        {/* Non-MCQ explanation panel — exam mode (not tutor).
            Shown inline in continuous mode for non-MCQ questions. */}
        {interactive && qSubmitted && !qIsMCQ && session.mode !== "tutor" && !useSplitExplanation && (
          <div className="mt-3 border-t border-border/40 bg-muted/20 py-3 sm:py-4 px-4 sm:px-6 lg:px-8 -mr-1 rounded-lg">
            <div className={contentAlignClass}>
              {session.engine === "written" ? (
                <WrittenEvaluationPanel
                  draft={qWrittenDraft}
                  question={question}
                  passed={qWrittenPassed}
                  isManual={qWrittenDraft.evaluation?.score === null}
                  onRubricToggle={(idx) => {
                    const cur = qWrittenDraft.rubricChecked;
                    const next = [...cur];
                    while (next.length < (question.rubric?.length ?? 0)) next.push(false);
                    next[idx] = !next[idx];
                    onWrittenDraftChange(question.id, { ...qWrittenDraft, rubricChecked: next });
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
                />
              ) : (
                <ExplanationCard q={question} selected={undefined} nonMcq highlights={qHighlights} packUid={activeItem.uid} questionIdx={qIdx} lang={activeItem.lang ?? "en"} />
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
    const removeHighlight = (target: EventTarget | null) => {
      const el = target as HTMLElement;
      if (!el) return;
      const span = el.closest("[data-osler-hl-id]") as HTMLElement | null;
      if (span) {
        const id = span.getAttribute("data-osler-hl-id");
        if (id) {
          highlights.remove(activeItem.uid, session.current, id);
          setHlVersion((v) => v + 1);
        }
      }
    };
    const onClick = (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      removeHighlight(e.target);
    };
    const onTouchEnd = (e: TouchEvent) => {
      // Prevent the synthetic click that follows touchend
      e.preventDefault();
      const touch = e.changedTouches[0];
      if (!touch) return;
      const el = document.elementFromPoint(touch.clientX, touch.clientY);
      if (el) {
        e.stopPropagation();
        removeHighlight(el);
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
  }, [q, isMCQ, submitted, selected, onToggleFlag, goPrev, goNext, onSelect, onSubmit, onToggleAiAssistant, onToggleNotes, onToggleQuizSettings, setTool]);

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
  const startLongPress = React.useCallback(
    (idx: number) => {
      if (submitted) return;
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
          <div className="text-sm font-semibold tracking-wide truncate">
            {t("qbank.session.question", { n: session.current + 1, total: session.questions.length })}
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
        <main ref={questionBodyRef} data-swipe="horizontal" className="flex-1 min-w-0 flex flex-col bg-background">
          <AnimatePresence>
            {isPausedOrLocked && (
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
          {submitted && session.mode === "tutor" && useSplitExplanation && (
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
            className={`flex-1 min-h-0 medos-qbank-split ${
              submitted && session.mode === "tutor" && useSplitExplanation
                ? "flex flex-row"
                : "flex flex-col"
            }`}
            dir={rtl ? "rtl" : "ltr"}
            lang={activeItem.lang ?? "en"}
          >
            {q ? (
              <>
                {/* Question column.
                    In BOTH modes the column is a flex column that fills the
                    available height. The gallery fills the column (`flex-1
                    min-h-0`), and each page scrolls its own content
                    internally — the hook's scroll-then-snap logic handles
                    the transition from scrolling within a page to snapping
                    to the next/prev page.

                    In split mode the column is w-[55%] and the explanation
                    sits in the right column (below). In continuous mode the
                    column is full-width and the explanation is rendered
                    INSIDE each page (in renderQuestionContent) so the user
                    can drag from it to scroll/snap. */}
                <div
                  className={`medos-qbank-qcol ${(activeItem.lang ?? "en") === "ar" ? "osler-content-ar" : ""} ${
                    submitted && session.mode === "tutor" && useSplitExplanation
                      ? "w-[55%] border-e border-border"
                      : "flex-1"
                  } flex flex-col min-h-0 ${mobileTutorTab === "answer" ? "hidden md:flex" : ""}`}
                >
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
                </div>

                {/* Right column: explanation / evaluation (split-screen in tutor mode only).
                    In continuous mode the explanation is rendered inside each
                    page by renderQuestionContent — not here. */}
                {submitted && session.mode === "tutor" && useSplitExplanation && (
                  <div
                    className={`medos-qbank-acol w-[45%] overflow-y-auto medos-scroll bg-muted/20 ${mobileTutorTab === "question" ? "hidden md:block" : ""}`}
                  >
                    <div className="px-4 sm:px-6 py-4">
                      {session.engine === "written" ? (
                        <WrittenEvaluationPanel
                          draft={writtenDraft}
                          question={q}
                          passed={writtenPassed}
                          isManual={writtenDraft.evaluation?.score === null}
                          onRubricToggle={(idx) => {
                            const cur = writtenDraft.rubricChecked;
                            const next = [...cur];
                            while (next.length < (q.rubric?.length ?? 0)) next.push(false);
                            next[idx] = !next[idx];
                            onWrittenDraftChange(q.id, { ...writtenDraft, rubricChecked: next });
                          }}
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
                        <ExplanationCard q={q} selected={selected} nonMcq={!isMCQ} highlights={currentHighlights} packUid={activeItem.uid} questionIdx={session.current} lang={activeItem.lang ?? "en"} />
                      )}
                    </div>
                  </div>
                )}
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
            {!submitted && !isMCQ && session.engine !== "written" && (
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

            <Button
              size="sm" onClick={goNext} className="h-9 rounded-lg"
              variant={isLast ? "destructive" : "default"}
            >
              {isLast ? (
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

            {/* Primary action button — fills remaining space */}
            {!submitted && isMCQ ? (
              <Button
                size="sm" onClick={onSubmit} disabled={selected === undefined}
                className="flex-1 h-10 rounded-lg medos-touch-target"
              >
                {t("qbank.session.submitAnswer")}
              </Button>
            ) : !submitted && !isMCQ && session.engine !== "written" ? (
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
  const verdict: "pass" | "fail" | null =
    draft.evaluation?.manualVerdict === "pass"
      ? "pass"
      : draft.evaluation?.manualVerdict === "fail"
        ? "fail"
        : null;
  const isManual = draft.evaluation?.score === null;
  const passed = verdict === "pass" || (verdict === null && draft.evaluation?.passed === true);
  const children = question.children ?? [];

  // ── Input mode (before submit) ───────────────────────────────────────
  const { t } = useI18n();

  if (!submitted && !hasEvaluation) {
    return (
      <div className="mt-6 space-y-4">
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {t("qbank.written.yourResponse")}
            </label>
            <span className="text-xs text-muted-foreground tabular-nums">
              {t("qbank.written.words", { n: wordCount })}
            </span>
          </div>
          <textarea
            value={draft.text}
            onChange={(e) => onTextChange(e.target.value)}
            placeholder={t("qbank.written.placeholder")}
            className="osler-written-area"
            style={{ minHeight: 220 }}
          />
        </div>

        {/* Grade buttons */}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onGradeManual}
            disabled={!draft.text.trim()}
            className="px-4 py-2 rounded-lg text-sm font-medium border border-border hover:border-primary/40 transition-colors disabled:opacity-50"
          >
            {t("qbank.written.manualGrade")}
          </button>
          <button
            type="button"
            onClick={onGradeAI}
            disabled={grading || !draft.text.trim()}
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
  onRubricToggle,
  onPassFail,
  onChildPassFail,
}: {
  draft: WrittenDraft;
  question: SessionQuestion;
  passed: boolean;
  isManual: boolean;
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
            const checked = draft.rubricChecked[i] ?? false;
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
              {draft.rubricChecked.filter(Boolean).length}
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
      <div className="p-2 border-t border-sidebar-border">
        <Button variant="ghost" size="sm" onClick={p.onEndTest} className="w-full h-8 text-xs rounded-md text-destructive hover:text-destructive hover:bg-destructive/10">
          End Test
        </Button>
      </div>
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
  onRemoveHighlight,
}: {
  q: SessionQuestion;
  selected: number | undefined;
  nonMcq?: boolean;
  highlights?: HighlightItem[];
  packUid?: string;
  questionIdx?: number;
  lang?: string;
  onRemoveHighlight?: (id: string) => void;
}) {
  const hl = questionHighlights ?? [];

  const { t } = useI18n();
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
          <div className="uworld-prose text-[14px]" style={{ whiteSpace: "pre-wrap" }}>
            <HighlightedContent
              text={q.explanation || t("qbank.explanation.noExplanation")}
              highlights={hl}
            />
          </div>
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
        <div className="uworld-prose text-[14px]" style={{ whiteSpace: "pre-wrap" }}>
          <HighlightedContent
            text={q.explanation || t("qbank.explanation.noExplanation")}
            highlights={hl}
          />
        </div>
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
    if (session.engine === "flashcard") return session.ratings[q.id] === "easy";
    if (session.engine === "written" || session.engine === "osce") {
      const rubric = session.rubricState[q.id] ?? [];
      return (
        q.rubric &&
        q.rubric.length > 0 &&
        rubric.filter(Boolean).length / q.rubric.length >= 0.6
      );
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

  return (
    <div className="h-[calc(100vh-3.5rem)] overflow-y-auto medos-scroll">
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
                : session.engine === "flashcard"
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
                  className="flex items-center gap-3 p-3 rounded-md border border-border bg-card"
                >
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
              );
            })}
          </div>
        </div>
      </div>
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
  switch (content.type) {
    case "quiz":
      return content.questions.length;
    case "bank":
      return content.passages.reduce((a, p) => a + p.questions.length, 0);
    case "flashcard":
      return content.cards.length;
    case "written":
      return content.prompts.length;
    case "osce":
      return content.stations.length;
    default:
      return 0;
  }
}

function contentToQuestions(content: AnyContent): SessionQuestion[] {
  const out: SessionQuestion[] = [];
  if (content.type === "quiz") {
    (content as QuizContent).questions.forEach((q) => {
      out.push({
        id: q.id,
        stem: q.question,
        choices: q.options,
        correct: q.correct,
        explanation: q.explanation,
        tags: q.tags,
        difficulty: q.difficulty ? `${q.difficulty}/5` : undefined,
      });
    });
  } else if (content.type === "bank") {
    (content as BankContent).passages.forEach((p) => {
      p.questions.forEach((q) => {
        out.push({
          id: q.id,
          stem: `${p.content}\n\n${q.question}`,
          choices: q.options,
          correct: q.correct,
          explanation: q.explanation,
          tags: q.tags,
          difficulty: q.difficulty ? `${q.difficulty}/5` : undefined,
        });
      });
    });
  } else if (content.type === "flashcard") {
    (content as FlashcardContent).cards.forEach((c) => {
      out.push({
        id: c.id,
        stem: c.front,
        choices: [],
        correct: -1,
        explanation: c.back,
        tags: c.tags,
      });
    });
  } else if (content.type === "written") {
    (content as WrittenContent).prompts.forEach((p) => {
      const children = p.children?.map((c) => ({
        id: c.id,
        label: c.label,
        question: c.question,
        modelAnswer: c.modelAnswer,
        rubric: c.rubric,
        explanation: c.explanation,
      }));
      out.push({
        id: p.id,
        stem: p.prompt,
        choices: [],
        correct: -1,
        modelAnswer: p.modelAnswer,
        explanation: p.explanation ?? (
          p.rubric.length > 0
            ? `Self-grading rubric:\n${p.rubric.map((r, i) => `${i + 1}. ${r}`).join("\n")}`
            : ""
        ),
        rubric: p.rubric,
        tags: p.tags,
        children,
      });
    });
  } else if (content.type === "osce") {
    (content as OsceContent).stations.forEach((s) => {
      const rubricArr = s.rubric?.mustAsk || [];
      out.push({
        id: s.id,
        stem: s.task || s.title,
        choices: [],
        correct: -1,
        explanation:
          rubricArr.length > 0
            ? `Performance rubric:\n${rubricArr.map((r: string, i: number) => `${i + 1}. ${r}`).join("\n")}`
            : "",
        rubric: rubricArr,
        redFlags: s.hiddenProfile?.redFlags || [],
        differential: s.hiddenProfile?.keySymptoms || [],
        tags: ["osce"],
      });
    });
  }
  return out;
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
  };
  sessions.save(saved);
}

