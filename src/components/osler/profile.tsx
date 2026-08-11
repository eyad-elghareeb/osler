"use client";

import * as React from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Activity,
  Award,
  Target,
  Clock,
  TrendingUp,
  Calendar,
  Zap,
  Flame,
  Star,
  ShieldCheck,
  Medal,
  CheckCircle2,
  BookOpen,
  Settings as SettingsIcon,
  Cog,
  NotebookPen,
  Plus,
  Trash2,
  Folder,
  ExternalLink,
  Wifi,
  Cloud,
  User,
} from "lucide-react";
import {
  storage,
  notes as notesStore,
  achievements as achievementsStore,
  sessions,
  flashcardReview,
  streak,
  type NoteRecord,
} from "@/lib/osler/storage";
import {
  ACHIEVEMENTS,
  evaluateAchievements,
  type AchievementIconKey,
  type AchievementRecord,
  type AchievementStats,
} from "@/lib/osler/achievements";
import { loadAllContent, ENGINE_META } from "@/lib/osler/content";
import type { AnyContent, ContentTreeNode } from "@/lib/osler/types";
import type { OslerView } from "./app-shell";
import { useI18n } from "./i18n-provider";
import type { StringKey } from "@/lib/osler/i18n";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { NotesPanel } from "./notes-panel";
import { SyncModal } from "./sync/sync-modal";
import { haptic } from "@/lib/osler/native";
import {
  PageHeader,
  SectionHeading,
  StatTile as SharedStatTile,
  OslerCard,
  type StatTileProps,
} from "./ui-primitives";

import { useOslerRouter } from "@/lib/osler/navigation";
import { useOslerSession } from "@/lib/osler/session-context";
import { useChartTooltip } from "@/hooks/use-chart-tooltip";
import { SparkTrend } from "./analytics-primitives";

interface ProfileProps {
  username?: string;
  onViewChange?: (v: OslerView) => void;
  onOpenSettingsSection?: (section: "account" | "language" | "ai" | "shortcuts" | "downloads" | "sync" | "backup" | "danger") => void;
}

export function Profile({
  username: propUsername,
  onViewChange: propOnViewChange,
  onOpenSettingsSection: propOnOpenSettingsSection,
}: ProfileProps = {}) {
  const { t } = useI18n();
  const session = useOslerSession();
  const { navigate } = useOslerRouter();

  const username = propUsername || session.username || t("profile.user");
  const onViewChange = propOnViewChange || navigate;
  const onOpenSettingsSection = propOnOpenSettingsSection || ((section: any) => navigate("settings", { section }));
  const [syncOpen, setSyncOpen] = React.useState(false);
  const [data, setData] = React.useState<{
    items: Array<{ node: ContentTreeNode; content: AnyContent | null }>;
  } | null>(null);
  const [progress, setProgress] = React.useState(storage.allProgress());
  const [unlockedAchievements, setUnlockedAchievements] = React.useState<Record<string, AchievementRecord>>({});
  const [, force] = React.useReducer((x) => x + 1, 0);

  React.useEffect(() => {
    loadAllContent().then(setData).catch(console.error);
  }, []);

  React.useEffect(() => {
    const update = () => setProgress(storage.allProgress());
    update();
    const unsub = storage.subscribe(update);
    const unsubHydrated = storage.onHydrated(update);
    const unsubAch = achievementsStore.subscribe(() => {
      setUnlockedAchievements(achievementsStore.getAll());
      force();
    });
    const unsubSessions = sessions.subscribe(() => force());
    const unsubFlash = flashcardReview.subscribe(() => force());
    const unsubNotes = notesStore.subscribe(() => force());
    return () => {
      unsub();
      unsubHydrated();
      unsubAch();
      unsubSessions();
      unsubFlash();
      unsubNotes();
    };
  }, []);

  const attemptedTotal = progress.reduce((a, b) => a + b.attempted, 0);
  const correctTotal = progress.reduce((a, b) => a + b.correct, 0);
  const wrongTotal = progress.reduce((a, b) => a + b.wrong, 0);
  const accuracy = attemptedTotal
    ? Math.round((correctTotal / attemptedTotal) * 100)
    : 0;

  // Per-session accuracy, oldest → newest, for the last 10 completed
  // sessions — real data from `sessions.list()`, not a fabricated series.
  // Feeds the accuracy stat tile's `<SparkTrend>`. Needs 2+ completed
  // sessions with attempts to draw a line; `SparkTrend` itself no-ops
  // below that, so no extra guard is needed here.
  const accuracyTrend = React.useMemo(() => {
    return sessions
      .list()
      .filter((s) => !!s.completedAt && s.answeredCount > 0)
      .sort((a, b) => (a.completedAt ?? 0) - (b.completedAt ?? 0))
      .slice(-10)
      .map((s) => Math.round((s.correctCount / s.answeredCount) * 100));
    // `progress` changes whenever storage updates, which is also when a
    // session completes — using it as the recompute trigger avoids a
    // second subscription just for this derived series.
  }, [progress]);

  // Engine breakdown
  const engineStats = React.useMemo(() => {
    const stats: Record<string, { attempted: number; correct: number }> = {};
    progress.forEach((p) => {
      const item = data?.items.find((x) => x.node.uid === p.uid);
      if (!item) return;
      const eng = item.node.type;
      if (!stats[eng]) stats[eng] = { attempted: 0, correct: 0 };
      stats[eng].attempted += p.attempted;
      stats[eng].correct += p.correct;
    });
    return stats;
  }, [progress, data]);

  const sessionsCompleted = sessions.list().filter((s) => !!s.completedAt).length;
  const flashcardsReviewed = Object.values(flashcardReview.getAll()).reduce(
    (sum, r) => sum + (r.reviewCount ?? 0),
    0,
  );
  const notesCount = notesStore.listSync().length;

  const achievementStats: AchievementStats = {
    attempted: attemptedTotal,
    correct: correctTotal,
    accuracy,
    packsStarted: progress.length,
    sessionsCompleted,
    flashcardsReviewed,
    notesCount,
    currentStreak: streak.compute().current,
  };
  const earned = evaluateAchievements(achievementStats);
  const earnedKey = earned.join(",");
  // Persist newly-earned achievements so the unlock record survives refresh
  // and travels through cloud / P2P sync (idempotent — unlock() no-ops when
  // already unlocked, so re-running on re-render is safe).
  React.useEffect(() => {
    if (!earnedKey) return;
    for (const id of earnedKey.split(",")) achievementsStore.unlock(id);
  }, [earnedKey]);
  const unlockedIds = new Set<string>([...Object.keys(unlockedAchievements), ...earned]);

  return (
    <div className="osler-page">
      <div className="osler-page__inner--narrow">
        {/* Profile header */}
        {(() => {
          const cloudSession = session.cloudSession;
          return (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="osler-card--roomy mb-6 flex items-center gap-4"
            >
              <div className="w-16 h-16 rounded-full bg-gradient-to-br from-primary/80 to-primary/40 flex items-center justify-center text-2xl font-bold text-primary-foreground shrink-0 shadow-sm">
                {(cloudSession?.user.displayName || username).slice(0, 2).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <h1 className="text-xl md:text-2xl font-bold tracking-tight truncate">
                    {cloudSession?.user.displayName || username}
                  </h1>
                  {cloudSession && (
                    <Badge variant="outline" className="text-[10px] bg-primary/10 text-primary border-primary/30">
                      <Cloud className="size-3 me-1" />
                      {cloudSession.user.role === "admin"
                        ? t("settings.account.admin")
                        : cloudSession.user.role === "student"
                          ? t("settings.account.student")
                          : t("admin.users.roles.content_admin")}
                    </Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-0.5 truncate">
                  {cloudSession ? (cloudSession.user.email || `@${cloudSession.user.username}`) : t("nav.localSession")} · {t("login.footer")}
                </p>
              </div>
              <div className="hidden sm:flex flex-col items-end gap-1">
                <Badge variant="secondary" className="text-[10px]">
                  <Flame className="size-3 me-1" />
                  {progress.length > 0 ? t("profile.activeLearner") : t("profile.newHere")}
                </Badge>
                <span className="text-[10px] text-muted-foreground">
                  {t("profile.questionsAnswered", { n: attemptedTotal })}
                </span>
              </div>
              {onViewChange && (
                <>
                  <button
                    onClick={() => {
                      if (onOpenSettingsSection) onOpenSettingsSection("account");
                      else onViewChange("settings");
                    }}
                    className="osler-icon-btn shrink-0"
                    aria-label={t("settings.section.account")}
                    title={t("settings.section.account")}
                  >
                    <User className="size-4" />
                  </button>
                  <button
                    onClick={() => setSyncOpen(true)}
                    className="osler-icon-btn shrink-0"
                    aria-label={t("sync.title")}
                    title={t("sync.title")}
                  >
                    <Wifi className="size-4" />
                  </button>
                  <button
                    onClick={() => onViewChange("settings")}
                    className="osler-icon-btn shrink-0"
                    aria-label={t("nav.settings")}
                    title={t("nav.settings")}
                  >
                    <Cog className="size-4" />
                  </button>
                </>
              )}
            </motion.div>
          );
        })()}

        {/* Stats grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          <StatTile
            label={t("dash.attemptedLabel")}
            value={attemptedTotal}
            icon={Target}
            color="primary"
          />
          <StatTile
            label={t("dash.correctLabel")}
            value={correctTotal}
            icon={Award}
            color="success"
          />
          <StatTile
            label={t("profile.wrongLabel")}
            value={wrongTotal}
            icon={TrendingUp}
            color="destructive"
          />
          <StatTile
            label={t("dash.accuracy")}
            value={`${accuracy}%`}
            icon={Zap}
            color="warning"
            trend={
              accuracyTrend.length >= 2 ? (
                <SparkTrend data={accuracyTrend} tone="auto" showDelta />
              ) : undefined
            }
          />
        </div>

        {/* Detailed Streak & Consistency Section */}
        <ProfileStreakSection />

        {/* Engine breakdown */}
        <SectionHeading>{t("profile.performanceByEngine")}</SectionHeading>
        {data === null ? (
          // `engineStats` is derived by cross-referencing `progress` (available
          // synchronously from local storage) against `data.items` (async
          // content metadata). Before `data` resolves, engineStats is
          // incorrectly empty even for a user with real attempts — this
          // skeleton prevents a false "no sessions" flash. See
          // design-library-roadmap.md.
          <div className="space-y-3 mb-6" aria-hidden="true">
            {Array.from({ length: 2 }).map((_, i) => (
              <div key={i} className="osler-card--default">
                <div className="flex items-center justify-between mb-2">
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-4 w-16" />
                </div>
                <Skeleton className="h-2 w-full rounded-full" />
              </div>
            ))}
          </div>
        ) : Object.keys(engineStats).length === 0 ? (
          <div className="osler-card--default text-center text-sm text-muted-foreground mb-6 py-8">
            {t("profile.noSessions")}
          </div>
        ) : (
          <div className="space-y-3 mb-6">
            {Object.entries(engineStats).map(([eng, stat]) => {
              const pct = stat.attempted
                ? Math.round((stat.correct / stat.attempted) * 100)
                : 0;
              return (
                <div
                  key={eng}
                  className="osler-card--default"
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <Activity className="size-4 text-primary" />
                      <span className="text-sm font-medium capitalize">
                        {t(`engine.${eng}` as any)}
                      </span>
                    </div>
                    <span className="text-sm tabular-nums">
                      <span className="font-semibold">{pct}%</span>
                      <span className="text-xs text-muted-foreground ms-2">
                        {stat.correct}/{stat.attempted}
                      </span>
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-muted overflow-hidden">
                    <div
                      className="h-full bg-primary transition-all"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Notes */}
        <ProfileNotesSection onViewChange={onViewChange} />

        {/* Achievements */}
        <SectionHeading
          actions={
            <span className="text-xs text-muted-foreground">
              {unlockedIds.size}/{ACHIEVEMENTS.length} {t("profile.achievements").toLowerCase()}
            </span>
          }
        >
          {t("profile.achievements")}
        </SectionHeading>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
          {ACHIEVEMENTS.map((a) => (
            <Achievement
              key={a.id}
              icon={ACHIEVEMENT_ICONS[a.icon]}
              title={t(a.titleKey)}
              description={t(a.descKey)}
              unlocked={unlockedIds.has(a.id)}
            />
          ))}
        </div>
      </div>

      <SyncModal
        open={syncOpen}
        onClose={() => setSyncOpen(false)}
        onOpenSettings={() => {
          setSyncOpen(false);
          onOpenSettingsSection?.("sync");
        }}
      />
    </div>
  );
}

/* ── Profile Streak & Detailed Consistency Section ───────────────────── */

function ProfileStreakSection() {
  const { t } = useI18n();
  const [horizon, setHorizon] = React.useState<30 | 60>(30);
  const [streakData, setStreakData] = React.useState(() => streak.compute());
  const [activity, setActivity] = React.useState(() => streak.dailyActivity(horizon));

  React.useEffect(() => {
    const update = () => {
      setStreakData(streak.compute());
      setActivity(streak.dailyActivity(horizon));
    };
    update();
    const unsub = streak.subscribe(update);
    return unsub;
  }, [horizon]);

  const activeDaysCount = activity.filter((a) => a.count > 0).length;
  const totalQuestions = activity.reduce((sum, a) => sum + a.count, 0);
  const avgDaily = activeDaysCount ? Math.round(totalQuestions / activeDaysCount) : 0;
  const peakDay = Math.max(...activity.map((a) => a.count), 0);
  const today = new Date().toISOString().slice(0, 10);

  const chartW = 560;
  const chartH = 110;
  const barGap = horizon === 30 ? 4 : 2;
  const barW = Math.max(4, Math.floor((chartW - barGap * (horizon - 1)) / horizon));
  const maxCount = Math.max(peakDay, 1);

  const { wrapRef, svgRef, tipRef, hovered, left, show, hide } = useChartTooltip({
    chartW,
    chartH,
    barW,
    barGap,
  });

  return (
    <div className="mb-6">
      <SectionHeading
        icon={Flame}
        actions={
          <div className="flex items-center gap-1 bg-muted/60 p-0.5 rounded-lg border border-border">
            <button
              type="button"
              onClick={() => { haptic("selection"); setHorizon(30); }}
              className={cn(
                "px-2.5 py-0.5 text-xs font-semibold rounded-md transition-colors cursor-pointer",
                horizon === 30 ? "bg-primary text-primary-foreground shadow-xs" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {t("profile.streak.days30")}
            </button>
            <button
              type="button"
              onClick={() => { haptic("selection"); setHorizon(60); }}
              className={cn(
                "px-2.5 py-0.5 text-xs font-semibold rounded-md transition-colors cursor-pointer",
                horizon === 60 ? "bg-primary text-primary-foreground shadow-xs" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {t("profile.streak.days60")}
            </button>
          </div>
        }
      >
        {t("profile.streak.title")}
      </SectionHeading>

      <OslerCard padding="roomy">
        {/* Top metrics summary bar */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          <div className="bg-card border border-border rounded-xl p-3 text-start">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5 mb-1">
              <Flame className="size-3.5 text-warning" />
              <span>{t("dash.streak.title")}</span>
            </div>
            <div className="text-2xl font-extrabold tabular-nums flex items-baseline gap-1">
              <span>{streakData.current}</span>
              <span className="text-xs font-normal text-muted-foreground">
                / {t("profile.streak.best", { n: streakData.longest })}
              </span>
            </div>
          </div>

          <div className="bg-card border border-border rounded-xl p-3 text-start">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5 mb-1">
              <Calendar className="size-3.5 text-primary" />
              <span>{t("profile.streak.activeRatio")}</span>
            </div>
            <div className="text-2xl font-extrabold tabular-nums flex items-baseline gap-1">
              <span>{activeDaysCount}</span>
              <span className="text-xs font-normal text-muted-foreground">/ {horizon}d ({Math.round((activeDaysCount / horizon) * 100)}%)</span>
            </div>
          </div>

          <div className="bg-card border border-border rounded-xl p-3 text-start">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5 mb-1">
              <Activity className="size-3.5 text-success" />
              <span>{t("profile.streak.avgDaily")}</span>
            </div>
            <div className="text-2xl font-extrabold tabular-nums">
              {avgDaily}
            </div>
          </div>

          <div className="bg-card border border-border rounded-xl p-3 text-start">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5 mb-1">
              <TrendingUp className="size-3.5 text-info" />
              <span>{t("profile.streak.peakDay")}</span>
            </div>
            <div className="text-2xl font-extrabold tabular-nums">
              {peakDay}
            </div>
          </div>
        </div>

        {/* Detailed SVG Graph */}
        <div className="relative select-none w-full" ref={wrapRef}>
          <svg
            ref={svgRef}
            viewBox={`0 0 ${chartW} ${chartH}`}
            className="w-full overflow-visible"
            style={{ height: chartH }}
            aria-label="Study activity timeline graph"
          >
            <defs>
              <linearGradient id="profile-bar-active" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--primary)" stopOpacity="0.95" />
                <stop offset="100%" stopColor="var(--primary)" stopOpacity="0.3" />
              </linearGradient>
              <linearGradient id="profile-bar-today" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--warning)" stopOpacity="1" />
                <stop offset="100%" stopColor="var(--warning)" stopOpacity="0.5" />
              </linearGradient>
              <linearGradient id="profile-bar-empty" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--muted-foreground)" stopOpacity="0.15" />
                <stop offset="100%" stopColor="var(--muted-foreground)" stopOpacity="0.05" />
              </linearGradient>
            </defs>

            {/* Horizontal guideline */}
            <line
              x1={0}
              y1={chartH / 2}
              x2={chartW}
              y2={chartH / 2}
              stroke="var(--border)"
              strokeDasharray="4 4"
              strokeOpacity={0.4}
            />

            {activity.map((d, i) => {
              const x = i * (barW + barGap);
              const isToday = d.date === today;
              const isEmpty = d.count === 0;
              const barH = isEmpty
                ? 4
                : Math.max(10, Math.round((d.count / maxCount) * (chartH - 12)));
              const y = chartH - barH;
              const fill = isToday
                ? "url(#profile-bar-today)"
                : isEmpty
                ? "url(#profile-bar-empty)"
                : "url(#profile-bar-active)";
              const isHovered = hovered === i;

              return (
                <g key={d.date}>
                  <rect
                    x={x}
                    y={y}
                    width={barW}
                    height={barH}
                    rx={Math.min(3, barW / 2)}
                    fill={fill}
                    opacity={isHovered ? 1 : 0.85}
                    style={{ transition: "opacity 0.15s, height 0.3s" }}
                  />
                  <rect
                    x={x}
                    y={0}
                    width={barW}
                    height={chartH}
                    fill="transparent"
                    onMouseEnter={() => show(i)}
                    onMouseLeave={hide}
                    className="cursor-pointer"
                  />
                </g>
              );
            })}
          </svg>

          {/* Interactive Tooltip */}
          <AnimatePresence>
            {hovered !== null && activity[hovered] && (
              <motion.div
                key={hovered}
                ref={tipRef}
                initial={{ opacity: 0, y: 4, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 4, scale: 0.95 }}
                transition={{ duration: 0.12 }}
                className="absolute -top-11 z-20 pointer-events-none -translate-x-1/2"
                style={{
                  left: `${left}px`,
                }}
              >
                <div className="bg-popover border border-border text-popover-foreground rounded-lg px-2.5 py-1 text-[11px] font-medium shadow-lg whitespace-nowrap flex items-center gap-1.5">
                  <span className="text-foreground">
                    {activity[hovered].date === today
                      ? t("dash.streak.today")
                      : new Date(activity[hovered].date + "T00:00:00Z").toLocaleDateString(undefined, {
                          month: "short",
                          day: "numeric",
                        })}
                  </span>
                  <span className="text-muted-foreground">·</span>
                  <span className="text-primary font-bold">
                    {t("dash.streak.questions", { n: activity[hovered].count })}
                  </span>
                  <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-popover" />
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Timeline Date Footer */}
          <div className="flex justify-between items-center text-[10px] text-muted-foreground/70 mt-2 font-medium">
            <span>
              {activity[0]?.date ? new Date(activity[0].date + "T00:00:00Z").toLocaleDateString(undefined, { month: "short", day: "numeric" }) : ""}
            </span>
            <span>
              {activity[Math.floor(activity.length / 2)]?.date ? new Date(activity[Math.floor(activity.length / 2)].date + "T00:00:00Z").toLocaleDateString(undefined, { month: "short", day: "numeric" }) : ""}
            </span>
            <span className="font-semibold text-warning">
              {t("dash.streak.today")}
            </span>
          </div>
        </div>
      </OslerCard>
    </div>
  );
}

function StatTile({
  label,
  value,
  icon: Icon,
  color = "primary",
  trend,
}: {
  label: string;
  value: string | number;
  icon: React.ComponentType<{ className?: string }>;
  color?: StatTileProps["color"];
  trend?: React.ReactNode;
}) {
  return (
    <SharedStatTile
      label={label}
      value={value}
      icon={Icon as any}
      color={color}
      trend={trend}
    />
  );
}

const ACHIEVEMENT_ICONS: Record<
  AchievementIconKey,
  React.ComponentType<{ className?: string }>
> = {
  target: Target,
  award: Award,
  zap: Zap,
  calendar: Calendar,
  trending: TrendingUp,
  flame: Flame,
  star: Star,
  shield: ShieldCheck,
  medal: Medal,
  session: CheckCircle2,
  flashcard: BookOpen,
  notes: NotebookPen,
};

function Achievement({
  icon: Icon,
  title,
  description,
  unlocked,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
  unlocked: boolean;
}) {
  return (
    <div
      className={cn(
        "osler-card--default flex items-center gap-3 transition-all",
        unlocked
          ? "border-primary/40 bg-primary/5"
          : "opacity-60"
      )}
    >
      <div
        className={cn(
          "w-10 h-10 rounded-lg flex items-center justify-center shrink-0",
          unlocked
            ? "bg-primary/15 text-primary"
            : "bg-muted text-muted-foreground"
        )}
      >
        <Icon className="size-5" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold">{title}</div>
        <div className="text-xs text-muted-foreground">{description}</div>
      </div>
    </div>
  );
}

/* ── Profile Notes Section ───────────────────────────────────────────── */

function timeAgo(
  ts: number,
  t: (key: StringKey, params?: Record<string, string | number>) => string,
): string {
  const diff = Date.now() - ts;
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return t("dash.timeAgo.justNow");
  const min = Math.floor(sec / 60);
  if (min < 60) return t("dash.timeAgo.minutes", { n: min });
  const hr = Math.floor(min / 60);
  if (hr < 24) return t("dash.timeAgo.hours", { n: hr });
  const day = Math.floor(hr / 24);
  if (day < 7) return t("dash.timeAgo.days", { n: day });
  return new Date(ts).toLocaleDateString();
}

function ProfileNotesSection({
  onViewChange,
}: {
  onViewChange?: (v: OslerView) => void;
}) {
  const { t } = useI18n();
  const [allNotes, setAllNotes] = React.useState<NoteRecord[]>([]);
  const [panelOpen, setPanelOpen] = React.useState(false);
  const [editingId, setEditingId] = React.useState<string | null>(null);

  const refresh = React.useCallback(async () => {
    const list = await notesStore.list();
    setAllNotes(list);
  }, []);

  React.useEffect(() => {
    refresh();
    const unsub = notesStore.subscribe(() => refresh());
    return unsub;
  }, [refresh]);

  const visibleNotes = React.useMemo(() => allNotes, [allNotes]);

  const handleCreate = async () => {
    const note = await notesStore.create({ title: "", body: "" });
    setEditingId(note.id);
    setPanelOpen(true);
  };

  const handleOpen = (note: NoteRecord) => {
    setEditingId(note.id);
    setPanelOpen(true);
  };

  return (
    <>
      <SectionHeading icon={NotebookPen}>
        {t("qbank.notes.title")}
      </SectionHeading>
      <div className="osler-card--default mb-6">
        {/* Toolbar */}
        <div className="flex items-center gap-2 mb-4">
          <Button
            size="sm"
            onClick={handleCreate}
            className="h-9 rounded-lg shrink-0"
            title={t("qbank.notes.new")}
          >
            <Plus className="size-3.5 mr-1" />
            {t("qbank.notes.new")}
          </Button>
        </div>

        {/* Notes list */}
        {visibleNotes.length === 0 ? (
          <div className="py-10 text-center">
            <div className="size-12 rounded-full bg-primary/10 text-primary flex items-center justify-center mx-auto mb-3">
              <NotebookPen className="size-6" />
            </div>
            <h3 className="text-base font-semibold mb-1">
              {t("qbank.notes.empty.title")}
            </h3>
            <p className="text-sm text-muted-foreground max-w-xs mx-auto mb-4">
              {t("qbank.notes.empty.body")}
            </p>
            <Button onClick={handleCreate} size="sm" variant="outline" className="rounded-lg">
              <Plus className="size-3.5 mr-1" />
              {t("qbank.notes.empty.createFirst")}
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {visibleNotes.map((note) => (
              <ProfileNoteCard
                key={note.id}
                note={note}
                onOpen={() => handleOpen(note)}
                onDelete={async () => {
                  await notesStore.delete(note.id);
                }}
                onOpenInQBank={
                  note.packUid && onViewChange
                    ? () => onViewChange("qbank")
                    : undefined
                }
              />
            ))}
          </div>
        )}

        {/* Stats footer */}
        {allNotes.length > 0 && (
          <div className="mt-4 pt-3 border-t border-border text-[11px] text-muted-foreground flex items-center justify-between">
            <span>{allNotes.length} {t("qbank.notes.title").toLowerCase()}</span>
            <span>
              {allNotes.length > 0
                ? timeAgo(Math.max(...allNotes.map((n) => n.updatedAt)), t)
                : "—"}
            </span>
          </div>
        )}
      </div>

      {/* Full notes panel (sidebar on desktop, fullscreen on mobile) */}
      <AnimatePresence>
        {panelOpen && (
          <NotesPanel
            open={panelOpen}
            onClose={() => {
              setPanelOpen(false);
              setEditingId(null);
            }}
            variant="sidebar"
          />
        )}
      </AnimatePresence>
    </>
  );
}

function ProfileNoteCard({
  note,
  onOpen,
  onDelete,
  onOpenInQBank,
}: {
  note: NoteRecord;
  onOpen: () => void;
  onDelete: () => void;
  onOpenInQBank?: () => void;
}) {
  const { t } = useI18n();
  const preview = React.useMemo(() => {
    const body = note.body || "";
    return body
      .replace(/^#+\s+/gm, "")
      .replace(/\*\*/g, "")
      .replace(/\*/g, "")
      .replace(/`/g, "")
      .replace(/\[(.*?)\]\(.*?\)/g, "$1")
      .replace(/^\s*[-+]\s+/gm, "")
      .replace(/^\s*\d+\.\s+/gm, "")
      .replace(/^\s*>\s+/gm, "")
      .replace(/\n+/g, " ")
      .trim()
      .slice(0, 160);
  }, [note.body]);

  return (
    <div className="group rounded-lg border border-border bg-card hover:border-primary/40 hover:bg-primary/5 transition-colors p-3.5 cursor-pointer">
      <div onClick={onOpen} className="space-y-1.5">
        <div className="flex items-start justify-between gap-2">
          <h4 className="text-sm font-semibold truncate flex-1">
            {note.title || <span className="italic text-muted-foreground">{t("qbank.notes.card.untitled")}</span>}
          </h4>
          <div className="flex items-center gap-0.5 text-[10px] text-muted-foreground shrink-0">
            <Clock className="size-3" />
            <span>{timeAgo(note.updatedAt, t)}</span>
          </div>
        </div>
        {preview && (
          <p className="text-xs text-muted-foreground line-clamp-3 leading-relaxed">
            {preview}
          </p>
        )}
        {note.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 pt-0.5">
            {note.tags.slice(0, 5).map((tag) => (
              <span
                key={tag}
                className="px-1.5 py-0.5 rounded text-[10px] bg-muted text-muted-foreground"
              >
                {tag}
              </span>
            ))}
            {note.tags.length > 5 && (
              <span className="text-[10px] text-muted-foreground">
                +{note.tags.length - 5}
              </span>
            )}
          </div>
        )}
        {note.packTitle && (
          <div className="flex items-center gap-1 text-[10px] text-muted-foreground pt-0.5">
            <Folder className="size-3" />
            <span className="truncate">{note.packTitle}</span>
            {note.questionIdx !== undefined && (
              <>
                <span>·</span>
                <span>Q{note.questionIdx + 1}</span>
              </>
            )}
          </div>
        )}
      </div>
      <div className="flex items-center justify-end gap-1 mt-2 pt-2 border-t border-border opacity-0 group-hover:opacity-100 transition-opacity">
        {onOpenInQBank && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onOpenInQBank();
            }}
            className="px-2 py-0.5 rounded text-[10px] text-muted-foreground hover:text-foreground hover:bg-muted transition-colors flex items-center gap-1"
            title={t("qbank.notes.card.openInQBank")}
          >
            <ExternalLink className="size-3" />
            {t("nav.qbank")}
          </button>
        )}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          className="px-2 py-0.5 rounded text-[10px] text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors flex items-center gap-1"
          title={t("qbank.notes.card.delete")}
        >
          <Trash2 className="size-3" />
          {t("qbank.notes.card.delete")}
        </button>
      </div>
    </div>
  );
}
