"use client";

import * as React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Flame, TrendingUp } from "lucide-react";
import { streak, type StreakData, type DailyActivity } from "@/lib/osler/storage";
import { useI18n } from "@/components/osler/i18n-provider";
import { cn } from "@/lib/utils";
import { haptic } from "@/lib/osler/native";

/* ── Bar chart ────────────────────────────────────────────────────────── */

const CHART_DAYS = 14;
const BAR_GAP = 3;

function ActivityBarChart({ activity, today }: { activity: DailyActivity[]; today: string }) {
  const [hovered, setHovered] = React.useState<number | null>(null);
  const { t } = useI18n();

  const maxCount = Math.max(...activity.map((d) => d.count), 1);
  const chartW = 280;
  const chartH = 80;
  const barW = Math.floor((chartW - BAR_GAP * (CHART_DAYS - 1)) / CHART_DAYS);

  return (
    <div className="relative select-none">
      <svg
        viewBox={`0 0 ${chartW} ${chartH}`}
        className="w-full overflow-visible"
        style={{ height: chartH }}
        aria-label="14-day activity chart"
      >
        <defs>
          <linearGradient id="bar-gradient-active" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="oklch(var(--primary) / 0.9)" />
            <stop offset="100%" stopColor="oklch(var(--primary) / 0.4)" />
          </linearGradient>
          <linearGradient id="bar-gradient-today" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="oklch(var(--success) / 1)" />
            <stop offset="100%" stopColor="oklch(var(--success) / 0.5)" />
          </linearGradient>
          <linearGradient id="bar-gradient-empty" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="oklch(var(--muted-foreground) / 0.12)" />
            <stop offset="100%" stopColor="oklch(var(--muted-foreground) / 0.06)" />
          </linearGradient>
        </defs>

        {activity.map((d, i) => {
          const x = i * (barW + BAR_GAP);
          const isToday = d.date === today;
          const isEmpty = d.count === 0;
          const barH = isEmpty
            ? 4
            : Math.max(6, Math.round((d.count / maxCount) * (chartH - 8)));
          const y = chartH - barH;
          const fill = isToday
            ? "url(#bar-gradient-today)"
            : isEmpty
            ? "url(#bar-gradient-empty)"
            : "url(#bar-gradient-active)";
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
              {/* invisible hit target */}
              <rect
                x={x}
                y={0}
                width={barW}
                height={chartH}
                fill="transparent"
                onMouseEnter={() => { haptic("selection"); setHovered(i); }}
                onMouseLeave={() => setHovered(null)}
                className="cursor-default"
              />
            </g>
          );
        })}
      </svg>

      {/* Tooltip */}
      <AnimatePresence>
        {hovered !== null && activity[hovered] && (
          <motion.div
            key={hovered}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            transition={{ duration: 0.12 }}
            className="absolute -top-10 z-10 pointer-events-none"
            style={{ left: `${(hovered / CHART_DAYS) * 100}%` }}
          >
            <div className="bg-popover border border-border text-popover-foreground rounded-lg px-2 py-1 text-[11px] font-medium shadow-md whitespace-nowrap">
              {activity[hovered].date === today
                ? t("dash.streak.today")
                : new Date(activity[hovered].date + "T00:00:00Z").toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric",
                  })}
              <span className="mx-1 text-muted-foreground">·</span>
              {t("dash.streak.questions", { n: activity[hovered].count })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Day labels: show Mon/Wed/Fri/Sun to avoid clutter */}
      <div className="flex mt-1" style={{ gap: BAR_GAP }}>
        {activity.map((d, i) => {
          const date = new Date(d.date + "T00:00:00Z");
          const dow = date.getUTCDay(); // 0=Sun, 1=Mon...
          const showLabel = dow === 1 || dow === 3 || dow === 5 || dow === 0;
          const isToday = d.date === today;
          return (
            <div
              key={d.date}
              className="text-center shrink-0 overflow-hidden"
              style={{ width: barW, fontSize: "9px" }}
            >
              {isToday ? (
                <span className="text-success font-semibold">·</span>
              ) : showLabel ? (
                <span className="text-muted-foreground/60">
                  {date.toLocaleDateString(undefined, { weekday: "narrow" })}
                </span>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ── Flame badge ──────────────────────────────────────────────────────── */

function FlameCounter({ count, active }: { count: number; active: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <motion.div
        animate={
          active
            ? { scale: [1, 1.12, 1], rotate: [-4, 4, -4, 0] }
            : { scale: 1, rotate: 0 }
        }
        transition={
          active
            ? { duration: 1.6, repeat: Infinity, repeatDelay: 3, ease: "easeInOut" }
            : {}
        }
        className={cn(
          "size-12 rounded-2xl flex items-center justify-center shrink-0 shadow-sm",
          active
            ? "bg-warning/15 text-warning"
            : "bg-muted text-muted-foreground/40"
        )}
      >
        <Flame className="size-6" />
      </motion.div>

      <div>
        <motion.div
          key={count}
          initial={{ scale: 0.7, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: "spring", stiffness: 300, damping: 20 }}
          className={cn(
            "text-4xl font-bold tabular-nums leading-none",
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

export function StreakCard() {
  const { t } = useI18n();
  const [data, setData] = React.useState<StreakData>(() => streak.compute());
  const [activity, setActivity] = React.useState<DailyActivity[]>(() =>
    streak.dailyActivity(CHART_DAYS)
  );

  React.useEffect(() => {
    const refresh = () => {
      setData(streak.compute());
      setActivity(streak.dailyActivity(CHART_DAYS));
    };
    // Also recompute when IDB hydration completes
    const unsub = streak.subscribe(refresh);
    return unsub;
  }, []);

  const today = new Date().toISOString().slice(0, 10);

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: 0.08 }}
      className="osler-card--roomy mb-6 overflow-hidden"
    >
      {/* Top row: flame + streak count / longest */}
      <div className="flex items-start justify-between gap-4 flex-wrap mb-5">
        <div className="flex items-start gap-4 flex-wrap">
          <FlameCounter count={data.current} active={data.activeToday} />
          <div className="flex flex-col justify-center gap-1 pt-1">
            <div className="text-base font-semibold text-foreground leading-tight">
              {t("dash.streak.title")}
            </div>
            <div className="text-xs text-muted-foreground">
              {t("dash.streak.longest", { n: data.longest })}
            </div>
            {!data.activeToday && data.current > 0 && (
              <motion.div
                initial={{ opacity: 0, x: -4 }}
                animate={{ opacity: 1, x: 0 }}
                className="flex items-center gap-1 text-[11px] text-warning font-medium mt-0.5"
              >
                <Flame className="size-3" />
                {t("dash.streak.keepGoing")}
              </motion.div>
            )}
          </div>
        </div>

        {/* Activity label */}
        <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground self-center">
          <TrendingUp className="size-3.5" />
          {t("dash.streak.activity")}
        </div>
      </div>

      {/* Bar chart */}
      <ActivityBarChart activity={activity} today={today} />
    </motion.div>
  );
}
