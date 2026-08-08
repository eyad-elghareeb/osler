"use client";

import * as React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Flame, TrendingUp, CalendarCheck } from "lucide-react";
import { streak, type StreakData, type DailyActivity } from "@/lib/osler/storage";
import { useI18n } from "@/components/osler/i18n-provider";
import { cn } from "@/lib/utils";
import { haptic } from "@/lib/osler/native";
import { OslerCard } from "./ui-primitives";

/* ── Bar chart ────────────────────────────────────────────────────────── */

const CHART_DAYS = 14;
const BAR_GAP = 3;

function ActivityBarChart({ activity, today }: { activity: DailyActivity[]; today: string }) {
  const [hovered, setHovered] = React.useState<number | null>(null);
  const { t } = useI18n();

  const maxCount = Math.max(...activity.map((d) => d.count), 1);
  const chartW = 280;
  const chartH = 76;
  const barW = Math.floor((chartW - BAR_GAP * (CHART_DAYS - 1)) / CHART_DAYS);

  return (
    <div className="relative select-none w-full">
      <svg
        viewBox={`0 0 ${chartW} ${chartH}`}
        className="w-full overflow-visible"
        style={{ height: chartH }}
        aria-label="14-day activity chart"
      >
        <defs>
          <linearGradient id="bar-gradient-active" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--primary)" stopOpacity="0.9" />
            <stop offset="100%" stopColor="var(--primary)" stopOpacity="0.3" />
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
            : Math.max(8, Math.round((d.count / maxCount) * (chartH - 10)));
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
                className="cursor-pointer"
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
            initial={{ opacity: 0, y: 4, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 4, scale: 0.95 }}
            transition={{ duration: 0.12 }}
            className="absolute -top-11 z-20 pointer-events-none -translate-x-1/2"
            style={{
              left: `${Math.max(10, Math.min(90, ((hovered + 0.5) / CHART_DAYS) * 100))}%`,
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
              <span className="text-primary font-semibold">
                {t("dash.streak.questions", { n: activity[hovered].count })}
              </span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Day labels */}
      <div className="flex mt-1.5" style={{ gap: BAR_GAP }}>
        {activity.map((d) => {
          const date = new Date(d.date + "T00:00:00Z");
          const dow = date.getUTCDay(); // 0=Sun, 1=Mon...
          const showLabel = dow === 1 || dow === 3 || dow === 5 || dow === 0;
          const isToday = d.date === today;
          return (
            <div
              key={d.date}
              className="text-center shrink-0 overflow-hidden"
              style={{ width: barW, fontSize: "10px" }}
            >
              {isToday ? (
                <span className="text-warning font-bold">●</span>
              ) : showLabel ? (
                <span className="text-muted-foreground/70 font-medium">
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
        <Flame className={cn("size-6", active && "fill-warning/20")} />
      </motion.div>

      <div>
        <motion.div
          key={count}
          initial={{ scale: 0.7, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: "spring", stiffness: 300, damping: 20 }}
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
    const unsub = streak.subscribe(refresh);
    return unsub;
  }, []);

  const today = new Date().toISOString().slice(0, 10);

  return (
    <OslerCard padding="roomy" className="mb-6 overflow-hidden">
      {/* Top row: flame + streak count / longest */}
      <div className="flex items-start justify-between gap-4 flex-wrap mb-5">
        <div className="flex items-start gap-4 flex-wrap text-start">
          <FlameCounter count={data.current} active={data.activeToday || data.current > 0} />
          <div className="flex flex-col justify-center gap-1 pt-0.5">
            <div className="text-base font-bold text-foreground leading-tight flex items-center gap-1.5">
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
        <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground self-center">
          <TrendingUp className="size-3.5 text-primary" />
          {t("dash.streak.activity")}
        </div>
      </div>

      {/* Bar chart */}
      <ActivityBarChart activity={activity} today={today} />
    </OslerCard>
  );
}

