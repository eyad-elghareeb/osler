"use client";

import * as React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { TrendingUp, CalendarCheck, Hourglass, Target, CheckCircle2 } from "lucide-react";
import { streak, dailyGoal, type StreakData, type DailyActivity } from "@/lib/osler/storage";
import { useI18n } from "@/components/osler/i18n-provider";
import { cn } from "@/lib/utils";
import { useChartTooltip } from "@/hooks/use-chart-tooltip";
import { OslerCard } from "./ui-primitives";
import { AnimatedFlame } from "./animated-icons";
import { MOTION_TRANSITION, MOTION_SPRING } from "@/lib/osler/motion";
import { ActivityRings, type ActivityRingData } from "./activity-rings";
import { DailyGoalDialog } from "./daily-goal-dialog";

/* ── Bar chart ────────────────────────────────────────────────────────── */

const CHART_DAYS = 14;
const BAR_GAP = 4;

const ActivityBarChart = React.memo(function ActivityBarChart({ activity, today }: { activity: DailyActivity[]; today: string }) {
  const { t } = useI18n();

  const maxCount = Math.max(...activity.map((d) => d.count), 1);
  const chartW = 280;
  const barRegionH = 70;
  const labelRegionH = 20;
  const chartH = barRegionH + labelRegionH;
  const barW = Math.floor((chartW - BAR_GAP * (CHART_DAYS - 1)) / CHART_DAYS);

  const { wrapRef, svgRef, tipRef, hovered, left, show, hide } = useChartTooltip({
    chartW,
    chartH,
    barW,
    barGap: BAR_GAP,
  });

  return (
    <div className="relative select-none w-full" ref={wrapRef}>
      {/* Tooltip Popup */}
      <AnimatePresence>
        {hovered !== null && activity[hovered] && (
          <motion.div
            key={hovered}
            ref={tipRef}
            initial={{ opacity: 0, y: 4, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 4, scale: 0.95 }}
            transition={MOTION_TRANSITION.fast}
            className="absolute -top-12 z-30 pointer-events-none -translate-x-1/2"
            style={{
              left: `${left}px`,
            }}
          >
            <div className="relative bg-popover border border-border text-popover-foreground rounded-lg px-2.5 py-1.5 text-xs font-medium shadow-e4 whitespace-nowrap flex items-center gap-1.5">
              <span className="text-foreground font-semibold">
                {activity[hovered].date === today
                  ? `${t("dash.streak.today")} (${new Date(activity[hovered].date + "T00:00:00Z").toLocaleDateString(undefined, { weekday: "short" })})`
                  : new Date(activity[hovered].date + "T00:00:00Z").toLocaleDateString(undefined, {
                      weekday: "short",
                      month: "short",
                      day: "numeric",
                    })}
              </span>
              <span className="text-muted-foreground">·</span>
              <span className="text-primary font-bold">
                {t("dash.streak.questions", { n: activity[hovered].count })}
              </span>
              {/* Tooltip arrow down */}
              <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-popover" />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <svg
        ref={svgRef}
        viewBox={`0 0 ${chartW} ${chartH}`}
        className="w-full overflow-visible"
        style={{ height: chartH }}
        aria-label="14-day activity chart"
      >
        <defs>
          <linearGradient id="bar-gradient-active" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--primary)" stopOpacity="0.95" />
            <stop offset="100%" stopColor="var(--primary)" stopOpacity="0.35" />
          </linearGradient>
          <linearGradient id="bar-gradient-today" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--warning)" stopOpacity="1" />
            <stop offset="100%" stopColor="var(--warning)" stopOpacity="0.5" />
          </linearGradient>
          <linearGradient id="bar-gradient-empty" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--muted-foreground)" stopOpacity="0.2" />
            <stop offset="100%" stopColor="var(--muted-foreground)" stopOpacity="0.06" />
          </linearGradient>
        </defs>

        {activity.map((d, i) => {
          const x = i * (barW + BAR_GAP);
          const isToday = d.date === today;
          const isEmpty = d.count === 0;
          const barH = isEmpty
            ? 4
            : Math.max(8, Math.round((d.count / maxCount) * (barRegionH - 8)));
          const y = barRegionH - barH;
          const fill = isToday
            ? "url(#bar-gradient-today)"
            : isEmpty
            ? "url(#bar-gradient-empty)"
            : "url(#bar-gradient-active)";
          const isHovered = hovered === i;
          const date = new Date(d.date + "T00:00:00Z");
          const dow = date.getUTCDay();
          const showLabel = dow === 1 || dow === 3 || dow === 5 || dow === 0 || isToday;

          return (
            <g key={d.date}>
              {/* Bar rect */}
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

              {/* Day label inside SVG for 100% exact alignment under bar */}
              {showLabel && (
                <text
                  x={x + barW / 2}
                  y={barRegionH + 14}
                  textAnchor="middle"
                  fontSize="10"
                  fontWeight={isToday ? "700" : "500"}
                  fill={isToday ? "var(--warning)" : "var(--muted-foreground)"}
                  opacity={isToday ? 1 : 0.7}
                >
                  {isToday ? "●" : date.toLocaleDateString(undefined, { weekday: "narrow" })}
                </text>
              )}

              {/* Invisible hit target */}
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
    </div>
  );
});

/* ── Flame badge ──────────────────────────────────────────────────────── */

function FlameCounter({ count, active }: { count: number; active: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <motion.div
        animate={
          active
            ? { scale: [1, 1.08, 1], rotate: [-3, 3, -3, 0] }
            : { scale: 1, rotate: 0 }
        }
        transition={
          active
            ? { duration: 1.8, repeat: Infinity, repeatDelay: 2.5, ease: "easeInOut" }
            : {}
        }
        className={cn(
          "size-13 rounded-2xl flex items-center justify-center shrink-0 border transition-all duration-300",
          active
            ? "bg-warning/15 border-warning/40 text-warning shadow-[0_0_20px_oklch(var(--warning)/0.25)]"
            : "bg-muted/40 border-border text-muted-foreground/40"
        )}
      >
        <AnimatedFlame active={active} className={cn("size-6", active && "fill-warning/20")} />
      </motion.div>

      <div>
        <motion.div
          key={count}
          initial={{ scale: 0.7, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={MOTION_SPRING.snappy}
          className={cn(
            "text-4xl font-extrabold tabular-nums leading-none tracking-tight",
            active ? "text-foreground" : "text-muted-foreground/40"
          )}
        >
          {count}
        </motion.div>
      </div>
    </div>
  );
}

/* ── StreakCard ────────────────────────────────────────────────────────── */

export const StreakCard = React.memo(function StreakCard() {
  const { t } = useI18n();
  const [data, setData] = React.useState<StreakData>(() => streak.compute());
  const [activity, setActivity] = React.useState<DailyActivity[]>(() =>
    streak.dailyActivity(CHART_DAYS)
  );
  const [goalSettings, setGoalSettings] = React.useState(() => dailyGoal.getSync());
  const [todayCounts, setTodayCounts] = React.useState(() => streak.todayCount());
  const [dialogOpen, setDialogOpen] = React.useState(false);

  React.useEffect(() => {
    const refresh = () => {
      setData(streak.compute());
      setActivity(streak.dailyActivity(CHART_DAYS));
      setTodayCounts(streak.todayCount());
    };
    const unsubStreak = streak.subscribe(refresh);
    const unsubGoal = dailyGoal.subscribe(() => setGoalSettings(dailyGoal.getSync()));
    return () => {
      unsubStreak();
      unsubGoal();
    };
  }, []);

  const today = new Date().toISOString().slice(0, 10);
  const target = Math.max(1, goalSettings.target);
  const percentAchieved = Math.round((todayCounts.total / target) * 100);
  const isAchieved = todayCounts.total >= target;

  const rings: [ActivityRingData, ActivityRingData, ActivityRingData] = React.useMemo(() => {
    return [
      {
        label: t("dash.goal.ringQuestions"),
        current: todayCounts.total,
        target,
        color: "var(--primary)",
        unit: "q",
      },
      {
        label: t("dash.goal.ringCorrect"),
        current: todayCounts.correct,
        target: Math.max(1, todayCounts.total),
        color: "var(--success)",
        unit: "c",
      },
      {
        label: t("dash.goal.ringStreak"),
        current: data.activeToday ? 1 : 0,
        target: 1,
        color: "var(--warning)",
        unit: "d",
      },
    ];
  }, [t, todayCounts, target, data.activeToday]);

  return (
    <OslerCard padding="roomy" className="mb-6 overflow-hidden">
      {/* Top section: Two columns on desktop (Streak + Goal Rings summary) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-center mb-6 pb-6 border-b border-border/70">
        {/* Left column: Flame + Streak Stats */}
        <div className="lg:col-span-5 flex items-start gap-4 flex-wrap text-start">
          <FlameCounter count={data.current} active={data.activeToday || data.current > 0} />
          <div className="flex flex-col justify-center gap-1 pt-0.5">
            <div className="osler-display text-lg font-bold text-foreground leading-tight flex items-center gap-1.5">
              <span>{t("dash.streak.title")}</span>
              {data.activeToday && (
                <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-success bg-success/15 px-2 py-0.5 rounded-full border border-success/30">
                  <CalendarCheck className="size-3" />
                  {t("dash.streak.today")}
                </span>
              )}
            </div>
            <div className="text-xs text-muted-foreground">
              {t("dash.streak.longest", { n: data.longest })}
            </div>
          </div>
        </div>

        {/* Right column: Apple Health style Activity Rings & Goal achievement */}
        <div className="lg:col-span-7 flex items-center justify-between sm:justify-end gap-5 bg-muted/20 rounded-xl p-3.5 sm:p-4 border border-border/50">
          <div className="flex flex-col text-start justify-center gap-1">
            <div className="flex items-center gap-1.5">
              <Target className="size-4 text-primary" />
              <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                {t("dash.goal.title")}
              </span>
              {isAchieved && (
                <span className="inline-flex items-center gap-1 text-[10px] font-bold text-success bg-success/15 px-1.5 py-0.5 rounded-full border border-success/30">
                  <CheckCircle2 className="size-3" />
                  {t("dash.goal.achieved")}
                </span>
              )}
            </div>

            <div className="text-xl sm:text-2xl font-black tabular-nums tracking-tight text-foreground">
              {todayCounts.total}{" "}
              <span className="text-xs sm:text-sm font-semibold text-muted-foreground">
                / {target} {t("dash.goal.questionsLabel", { n: "" }).trim()}
              </span>
            </div>

            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <span className="font-semibold text-primary tabular-nums">
                {t("dash.goal.percentAchieved", { percent: percentAchieved })}
              </span>
              <span>·</span>
              <button
                type="button"
                onClick={() => setDialogOpen(true)}
                className="text-xs font-medium text-muted-foreground hover:text-foreground underline underline-offset-4 transition-colors"
              >
                {t("dash.goal.changeGoal")}
              </button>
            </div>
          </div>

          <ActivityRings
            rings={rings}
            size={96}
            strokeWidth={8}
            gap={3}
            onClick={() => setDialogOpen(true)}
            className="hover:scale-105 transition-transform"
          />
        </div>
      </div>

      {/* 48h restore-window indicator when the streak is at risk */}
      {!data.activeToday && data.current > 0 && data.restoreDeadlineMs != null && (
        <StreakRestoreBanner deadline={data.restoreDeadlineMs} />
      )}

      {/* Activity label + Bar chart */}
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {t("dash.streak.activity")}
        </span>
        <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
          <TrendingUp className="size-3.5 text-primary" />
          <span className="tabular-nums font-semibold">{t("dash.streak.questions", { n: todayCounts.total })}</span>
          <span>{t("dash.streak.today").toLowerCase()}</span>
        </div>
      </div>

      <ActivityBarChart activity={activity} today={today} />

      <DailyGoalDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        currentTarget={goalSettings.target}
      />
    </OslerCard>
  );
});

/* ── 48h restore window ────────────────────────────────────────────────── */

function useNow(intervalMs = 30_000): number {
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

/**
 * Countdown banner for the 48h streak restore window. Shown while the user
 * has an alive streak but hasn't studied today — drains toward empty as the
 * window closes.
 */
export function StreakRestoreBanner({ deadline }: { deadline: number }) {
  const { t } = useI18n();
  const now = useNow();
  const remainingMs = Math.max(0, deadline - now);
  if (remainingMs <= 0) return null;

  const totalMin = Math.ceil(remainingMs / 60_000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  const time = h > 0 ? `${h}h ${m}m` : `${m}m`;
  const fraction = Math.max(0.02, Math.min(1, remainingMs / (48 * 3_600_000)));

  return (
    <motion.div
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={MOTION_TRANSITION.normal}
      className="mb-4 rounded-xl border border-warning/30 bg-warning/10 px-3 py-2.5"
    >
      <div className="flex items-center gap-2 text-xs font-semibold text-warning">
        <Hourglass className="size-3.5 shrink-0" />
        <span>{t("dash.streak.riskTitle")}</span>
        <span className="ms-auto tabular-nums">{t("dash.streak.timeLeft", { time })}</span>
      </div>
      <div className="mt-2 h-1 rounded-full bg-warning/20 overflow-hidden">
        <div
          className="h-full rounded-full bg-warning transition-[width] duration-500"
          style={{ width: `${Math.round(fraction * 100)}%` }}
        />
      </div>
      <p className="mt-1.5 text-[11px] text-warning/80">{t("dash.streak.keepGoing")}</p>
    </motion.div>
  );
}

