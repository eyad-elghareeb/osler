"use client";

import * as React from "react";
import { motion } from "framer-motion";
import {
  ArrowRight,
  BookOpen,
  ListChecks,
  Layers,
  Bot,
  BarChart3,
  Clock,
  CheckCircle2,
  Sparkles,
  Activity,
  TrendingUp,
  Award,
  Library as LibraryIcon,
  Flame,
  PlayCircle,
  RotateCcw,
  X,
} from "lucide-react";
import {
  loadCategoryTree,
  flattenTree,
  loadNodeContent,
  getEngineMeta,
} from "@/lib/osler/content";
import { enabledEngines } from "@/lib/osler/config";
import type { AnyContent, ContentTreeNode, EngineType } from "@/lib/osler/types";
import { storage, sessions } from "@/lib/osler/storage";
import { listAllArticles, loadArticleContent } from "@/lib/osler/articles";
import { listAllVideos } from "@/lib/osler/videos";
import type { Article } from "@/lib/osler/articles";
import type { OslerView } from "./app-shell";
import { useI18n } from "./i18n-provider";
import { cn } from "@/lib/utils";
import { fadeUp, staggerContainer, staggerContainerSlow } from "@/lib/osler/motion";
import {
  PageHeader,
  SectionHeading,
  StatTile as SharedStatTile,
  type StatTileProps,
} from "./ui-primitives";
import { toast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
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

import { StreakCard } from "./streak-card";
import { useOslerRouter } from "@/lib/osler/navigation";
import { useOslerSession } from "@/lib/osler/session-context";

interface DashboardProps {
  username?: string;
  onViewChange?: (v: OslerView) => void;
  onOpenPack?: (item: ContentTreeNode, content?: AnyContent) => void;
  onOpenArticle?: (id: string) => void;
}

export function Dashboard({
  username: propUsername,
  onViewChange: propOnViewChange,
  onOpenPack: propOnOpenPack,
  onOpenArticle: propOnOpenArticle,
}: DashboardProps) {
  const { t, rtl } = useI18n();
  const session = useOslerSession();
  const { navigate } = useOslerRouter();

  const username = propUsername || session.username || "User";
  const onViewChange = propOnViewChange || navigate;
  const onOpenArticle = propOnOpenArticle || ((id: string) => navigate("library", { article: id }));
  const onOpenPack = propOnOpenPack || ((node: ContentTreeNode) => {
    if (node.type === "osce") navigate("osce", { uid: node.uid });
    else if (node.type === "flashcard") navigate("flashcards", { uid: node.uid });
    else navigate("qbank", { uid: node.uid });
  });

  // Manifest-only content tree — loaded from category manifests (fast, no
  // pack JSON fetched). Recent packs + continue card need node metadata, so
  // the dashboard no longer waits for every pack's data files to hydrate.
  const [leaves, setLeaves] = React.useState<ContentTreeNode[] | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const types = enabledEngines().filter((t) => t !== "library");
        const folders = [...new Set(types)];
        const trees = await Promise.all(
          folders.map((type) => loadCategoryTree(type).catch(() => [] as ContentTreeNode[]))
        );
        if (cancelled) return;
        setLeaves(trees.flatMap((tree) => flattenTree(tree)));
      } catch {
        if (!cancelled) setLeaves([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const [stats, setStats] = React.useState({ attempted: 0, correct: 0, packs: 0 });

  React.useEffect(() => {
    const update = () => {
      const all = storage.allProgress();
      setStats({
        attempted: all.reduce((a, b) => a + b.attempted, 0),
        correct: all.reduce((a, b) => a + b.correct, 0),
        packs: all.length,
      });
    };
    update();
    const unsub = storage.subscribe(update);
    const unsubHydrated = storage.onHydrated(update);
    return () => {
      unsub();
      unsubHydrated();
    };
  }, []);

  // Active (in-progress) session from IDB — shown as a popup, not auto-resumed
  const [activeSession, setActiveSession] = React.useState<{
    itemTitle: string;
    engine: EngineType;
    current: number;
    total: number;
    startedAt: number;
    mode: string;
  } | null>(null);
  const [resumeDialogOpen, setResumeDialogOpen] = React.useState(false);

  React.useEffect(() => {
    const check = () => {
      const raw = sessions.getActive() as {
        itemTitle?: string;
        engine?: EngineType;
        current?: number;
        questions?: Array<unknown>;
        startedAt?: number;
        completedAt?: number;
        isReview?: boolean;
        mode?: string;
      } | null;
      if (
        raw &&
        !raw.completedAt &&
        !raw.isReview &&
        Array.isArray(raw.questions) &&
        raw.questions.length > 0 &&
        raw.itemTitle &&
        raw.engine &&
        typeof raw.current === "number" &&
        Date.now() - (raw.startedAt ?? 0) < 7 * 24 * 60 * 60 * 1000
      ) {
        setActiveSession({
          itemTitle: raw.itemTitle,
          engine: raw.engine,
          current: raw.current,
          total: raw.questions.length,
          startedAt: raw.startedAt ?? 0,
          mode: raw.mode ?? "tutor",
        });
        setResumeDialogOpen(true);
      } else {
        setActiveSession(null);
        setResumeDialogOpen(false);
      }
    };
    check();
    const unsub = sessions.subscribe(check);
    const unsubH = storage.onHydrated(check);
    return () => { unsub(); unsubH(); };
  }, []);

  const dismissResume = React.useCallback(() => {
    sessions.clearActive();
    setActiveSession(null);
    setResumeDialogOpen(false);
  }, []);

  const recentPacks = React.useMemo(() => {
    if (!leaves) return [];
    return leaves
      .map((node) => ({
        node,
        progress: storage.packProgress(node.uid),
      }))
      .filter((x) => x.progress.attempted > 0)
      .sort(
        (a, b) =>
          (b.progress.lastAttempt ?? 0) - (a.progress.lastAttempt ?? 0)
      )
      .slice(0, 4);
  }, [leaves, stats]);

  const continuePack = recentPacks[0];

  // Lazily load just the continue pack's data so the hero card can show its
  // description without forcing the whole tree's JSON to hydrate.
  const [continueContent, setContinueContent] = React.useState<AnyContent | null>(null);
  React.useEffect(() => {
    let cancelled = false;
    if (!continuePack) {
      setContinueContent(null);
      return;
    }
    loadNodeContent(continuePack.node)
      .then((content) => {
        if (!cancelled) setContinueContent(content);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [continuePack?.node.uid]);
  const accuracy = stats.attempted
    ? Math.round((stats.correct / stats.attempted) * 100)
    : 0;

  const [featuredArticles, setFeaturedArticles] = React.useState<Article[]>([]);
  const [articleCount, setArticleCount] = React.useState(0);
  const [videoCount, setVideoCount] = React.useState(0);

  React.useEffect(() => {
    (async () => {
      try {
        const all = await listAllArticles();
        setArticleCount(all.length);
        // Load full content for featured articles (need html for preview)
        const previews = await Promise.all(
          all.slice(0, 3).map((a) => loadArticleContent(a.file))
        );
        setFeaturedArticles(previews.filter(Boolean) as Article[]);
      } catch {}
    })();
  }, []);

  // Load video count (separate effect — independent of articles)
  React.useEffect(() => {
    (async () => {
      try {
        const videos = await listAllVideos();
        setVideoCount(videos.length);
      } catch {}
    })();
  }, []);

  const timeAgo = (ts: number) => {
    const diff = Date.now() - ts;
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return t("dash.timeAgo.justNow");
    if (mins < 60) return t("dash.timeAgo.minutes", { n: mins });
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return t("dash.timeAgo.hours", { n: hrs });
    return t("dash.timeAgo.days", { n: Math.floor(hrs / 24) });
  };

  const greeting = (() => {
    const h = new Date().getHours();
    if (h < 12) return t("dash.greetingMorning");
    if (h < 18) return t("dash.greetingAfternoon");
    return t("dash.greetingEvening");
  })();

  return (
    <div className="osler-page">
      <div className="osler-page__inner--wide">
        {/* Hero */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
        >
          <PageHeader
            eyebrow={greeting}
            eyebrowIcon={Flame}
            title={t("dash.welcomeBack", { name: username })}
            subtitle={t("dash.intro")}
            actions={undefined}
          />
        </motion.div>

        {/* Resume session dialog */}
        <AlertDialog open={resumeDialogOpen} onOpenChange={setResumeDialogOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle className="flex items-center gap-2">
                <RotateCcw className="size-5 text-primary" />
                {t("dash.resumeSession")}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {activeSession ? (
                  <div className="space-y-3 mt-2">
                    <p className="text-sm text-foreground font-medium">{activeSession.itemTitle}</p>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                      <span>{t("dash.sessionProgress", { n: activeSession.current + 1, total: activeSession.total })}</span>
                      <span>·</span>
                      <span className="capitalize">{activeSession.mode}</span>
                      <span>·</span>
                      <span className="flex items-center gap-1">
                        <Clock className="size-3" />
                        {timeAgo(activeSession.startedAt)}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      {t("dash.resumePrompt")}
                    </p>
                  </div>
                ) : null}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel onClick={dismissResume}>
                <X className="size-3.5 mr-1.5" />
                {t("common.dismiss")}
              </AlertDialogCancel>
              <AlertDialogAction asChild>
                <Button onClick={() => { setResumeDialogOpen(false); onViewChange("qbank"); }}>
                  <RotateCcw className="size-3.5 mr-1.5" />
                  {t("common.resume")}
                </Button>
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Continue card */}
        {continuePack ? (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: 0.05 }}
            className="osler-surface-hero mb-6 p-5 md:p-6"
          >
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div className="flex-1 min-w-0">
                <span className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium flex items-center gap-1.5">
                  <Activity className="size-3" />
                  {t("dash.continueLearning")}
                </span>
                <h2 className="text-lg md:text-xl font-semibold mt-1 mb-1">
                  {continuePack.node.title}
                </h2>
                <p className="text-xs text-muted-foreground mb-3 line-clamp-1">
                  {continueContent?.meta.description}
                </p>
                <div className="flex items-center gap-3 text-xs flex-wrap">
                  <span className="text-muted-foreground">
                    {t("dash.attempted", { n: continuePack.progress.attempted })}
                  </span>
                  <span className="text-success">
                    {t("dash.correct", { n: continuePack.progress.correct })}
                  </span>
                  <span className="text-muted-foreground">·</span>
                  <span className="flex items-center gap-1 text-muted-foreground">
                    <Clock className="size-3" />
                    {continuePack.progress.lastAttempt
                      ? new Date(
                          continuePack.progress.lastAttempt
                        ).toLocaleDateString()
                      : ""}
                  </span>
                </div>
              </div>
              <Button
                size="lg"
                onClick={() => onOpenPack?.(continuePack.node, continueContent ?? undefined)}
                className="shrink-0"
              >
                {t("common.resume")}
                <ArrowRight className={cn("size-4", rtl && "rtl-flip-x")} />
              </Button>
            </div>
          </motion.div>
        ) : null}

        {/* Stat cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          <StatTile
            label={t("dash.packsStarted")}
            value={stats.packs}
            icon={LibraryIcon}
            color="primary"
            onClick={() => onViewChange("qbank")}
          />
          <StatTile
            label={t("dash.attemptedLabel")}
            value={stats.attempted}
            icon={Activity}
            color="primary"
            onClick={() => onViewChange("profile")}
          />
          <StatTile
            label={t("dash.correctLabel")}
            value={stats.correct}
            icon={CheckCircle2}
            color="success"
            onClick={() => onViewChange("profile")}
          />
          <StatTile
            label={t("dash.accuracy")}
            value={`${accuracy}%`}
            icon={Sparkles}
            color="warning"
            onClick={() => onViewChange("profile")}
          />
        </div>

        {/* Streak & Consistency Graph */}
        <StreakCard />

        {/* Quick actions */}
        <SectionHeading>{t("dash.quickActions")}</SectionHeading>
        <motion.div
          variants={staggerContainer}
          initial="hidden"
          animate="visible"
          className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-8"
        >
          <QuickAction
            icon={ListChecks}
            title={t("dash.qa.qbank.title")}
            subtitle={t("dash.qa.qbank.sub")}
            onClick={() => onViewChange("qbank")}
          />
          <QuickAction
            icon={Layers}
            title={t("dash.qa.flashcards.title")}
            subtitle={t("dash.qa.flashcards.sub")}
            onClick={() => onViewChange("flashcards")}
          />
          <QuickAction
            icon={BookOpen}
            title={t("dash.qa.library.title")}
            subtitle={t("dash.qa.library.sub", { n: articleCount || "…" })}
            onClick={() => onViewChange("library")}
          />
          <QuickAction
            icon={PlayCircle}
            title={t("dash.qa.videos.title")}
            subtitle={t("dash.qa.videos.sub", { n: videoCount || "…" })}
            onClick={() => onViewChange("videos")}
          />
          <QuickAction
            icon={BarChart3}
            title={t("dash.qa.profile.title")}
            subtitle={t("dash.qa.profile.sub")}
            onClick={() => onViewChange("profile")}
          />
        </motion.div>

        {/* Featured articles */}
        <SectionHeading
          actions={
            <Button
              variant="link"
              size="sm"
              onClick={() => onViewChange("library")}
              className="text-xs h-auto p-0"
            >
              {t("common.viewAll")}
              <ArrowRight className={cn("size-3", rtl && "rtl-flip-x")} />
            </Button>
          }
        >
          {t("dash.featuredArticles")}
        </SectionHeading>
        <motion.div
          variants={staggerContainer}
          initial="hidden"
          animate="visible"
          className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-8"
        >
          {featuredArticles.map((a) => (
            <motion.button
              key={a.file}
              type="button"
              variants={fadeUp}
              whileHover={{ y: -2 }}
              whileTap={{ scale: 0.99 }}
              onClick={() => onOpenArticle?.(a.file)}
              className="text-start osler-card--default group hover:border-primary/40 hover:shadow-e2 transition-all"
            >
              <div className="flex items-center gap-2 mb-2 text-xs text-muted-foreground">
                <BookOpen className="size-3.5" />
                <span>{a.specialty}</span>
                <span>·</span>
                <span className="flex items-center gap-1">
                  <Clock className="size-3" />
                  {a.readTimeMin} min
                </span>
              </div>
              <h3 className="text-sm font-semibold mb-1 line-clamp-2 group-hover:text-primary transition-colors">
                {a.title}
              </h3>
              <p className="text-xs text-muted-foreground line-clamp-2">
                {/* Strip HTML for preview */}
                {a.html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 120)}
                …
              </p>
            </motion.button>
          ))}
        </motion.div>

        {/* Recent packs */}
        {recentPacks.length > 0 ? (
          <>
            <SectionHeading>{t("dash.recentActivity")}</SectionHeading>
            <motion.div
              variants={staggerContainerSlow}
              initial="hidden"
              animate="visible"
              className="grid grid-cols-1 md:grid-cols-2 gap-3"
            >
              {recentPacks.map(({ node, progress }) => (
                <motion.button
                  key={node.uid}
                  type="button"
                  variants={fadeUp}
                  whileHover={{ y: -2 }}
                  whileTap={{ scale: 0.99 }}
                  onClick={() => onOpenPack?.(node)}
                  className="text-start osler-card--default group hover:border-primary/40 hover:shadow-e2 transition-all"
                >
                  <div className="flex items-start gap-3">
                    <div
                      className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
                      style={{
                        background: `color-mix(in oklch, ${getEngineMeta(node.type).color} 15%, transparent)`,
                        color: getEngineMeta(node.type).color,
                      }}
                    >
                      <Activity className="size-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="text-sm font-semibold truncate">
                        {node.title}
                      </h3>
                      <p className="text-xs text-muted-foreground mb-1.5">
                        {t(`engine.${node.type}` as any)}
                      </p>
                      <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                        <span>{t("dash.attempted", { n: progress.attempted })}</span>
                        <span className="text-success">
                          {t("dash.correct", { n: progress.correct })}
                        </span>
                        {progress.lastAttempt ? (
                          <span className="flex items-center gap-1">
                            <Clock className="size-2.5" />
                            {timeAgo(progress.lastAttempt)}
                          </span>
                        ) : null}
                      </div>
                    </div>
                  </div>
                </motion.button>
              ))}
            </motion.div>
          </>
        ) : null}
      </div>

    </div>
  );
}

function StatTile({
  label,
  value,
  icon: Icon,
  color = "primary",
  onClick,
}: {
  label: string;
  value: string | number;
  icon: React.ComponentType<{ className?: string }>;
  color?: StatTileProps["color"];
  onClick?: () => void;
}) {
  // Local wrapper kept for backwards-compat with the rest of this file —
  // delegates to the shared primitive so visual style stays in sync.
  return (
    <SharedStatTile
      label={label}
      value={value}
      icon={Icon as any}
      color={color}
      onClick={onClick}
    />
  );
}

function QuickAction({
  icon: Icon,
  title,
  subtitle,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  subtitle: string;
  onClick: () => void;
}) {
  const { rtl } = useI18n();
  return (
    <motion.button
      type="button"
      onClick={onClick}
      variants={fadeUp}
      whileHover={{ y: -2 }}
      whileTap={{ scale: 0.99 }}
      className="text-start osler-card--default group flex items-center gap-3 hover:border-primary/40 hover:shadow-e2 transition-all"
    >
      <div className="w-10 h-10 rounded-lg bg-primary-soft text-primary flex items-center justify-center shrink-0 transition-transform duration-200 group-hover:scale-105">
        <Icon className="size-5" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold">{title}</div>
        <div className="text-xs text-muted-foreground">{subtitle}</div>
      </div>
      <ArrowRight
        className={cn(
          "size-4 text-muted-foreground shrink-0 transition-transform duration-200 group-hover:translate-x-0.5",
          rtl && "rtl-flip-x",
        )}
      />
    </motion.button>
  );
}

function timeAgo(ts: number, t: (k: any, p?: any) => string): string {
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60000);
  if (m < 1) return t("dash.timeAgo.justNow");
  if (m < 60) return t("dash.timeAgo.minutes", { n: m });
  const h = Math.floor(m / 60);
  if (h < 24) return t("dash.timeAgo.hours", { n: h });
  const d = Math.floor(h / 24);
  return t("dash.timeAgo.days", { n: d });
}
