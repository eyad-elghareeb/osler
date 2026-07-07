"use client";

import * as React from "react";
import { motion } from "framer-motion";
import {
  Activity,
  Award,
  Target,
  Clock,
  TrendingUp,
  Calendar,
  Zap,
  Flame,
  Settings as SettingsIcon,
  Cog,
} from "lucide-react";
import { storage } from "@/lib/osler/storage";
import { loadAllContent, ENGINE_META } from "@/lib/osler/content";
import type { AnyContent, ManifestItem } from "@/lib/osler/types";
import type { OslerView } from "./app-shell";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

interface ProfileProps {
  username: string;
  onViewChange?: (v: OslerView) => void;
}

export function Profile({ username, onViewChange }: ProfileProps) {
  const [data, setData] = React.useState<{
    items: Array<{ item: ManifestItem; content: AnyContent | null }>;
  } | null>(null);
  const [progress, setProgress] = React.useState(storage.allProgress());
  const [, force] = React.useReducer((x) => x + 1, 0);

  React.useEffect(() => {
    loadAllContent().then(setData).catch(console.error);
  }, []);

  React.useEffect(() => {
    const update = () => setProgress(storage.allProgress());
    update();
    return storage.subscribe(update);
  }, []);

  const attemptedTotal = progress.reduce((a, b) => a + b.attempted, 0);
  const correctTotal = progress.reduce((a, b) => a + b.correct, 0);
  const wrongTotal = progress.reduce((a, b) => a + b.wrong, 0);
  const accuracy = attemptedTotal
    ? Math.round((correctTotal / attemptedTotal) * 100)
    : 0;

  // Engine breakdown
  const engineStats = React.useMemo(() => {
    const stats: Record<string, { attempted: number; correct: number }> = {};
    progress.forEach((p) => {
      const item = data?.items.find((x) => x.item.uid === p.uid);
      if (!item) return;
      const eng = item.item.type;
      if (!stats[eng]) stats[eng] = { attempted: 0, correct: 0 };
      stats[eng].attempted += p.attempted;
      stats[eng].correct += p.correct;
    });
    return stats;
  }, [progress, data]);

  return (
    <div className="h-full overflow-y-auto medos-scroll">
      <div className="max-w-4xl mx-auto px-4 md:px-8 py-8">
        {/* Profile header */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-card border border-border rounded-xl p-6 mb-6 flex items-center gap-4"
        >
          <div className="w-16 h-16 rounded-full bg-gradient-to-br from-primary/80 to-primary/40 flex items-center justify-center text-2xl font-bold text-primary-foreground">
            {username.slice(0, 2).toUpperCase()}
          </div>
          <div className="flex-1">
            <h1 className="text-xl font-semibold">{username}</h1>
            <p className="text-xs text-muted-foreground">Local session · Osler v1</p>
          </div>
          <div className="hidden sm:flex flex-col items-end gap-1">
            <Badge variant="secondary" className="text-[10px]">
              <Flame className="size-3 mr-1" />
              {progress.length > 0 ? "Active learner" : "New here"}
            </Badge>
            <span className="text-[10px] text-muted-foreground">
              {attemptedTotal} questions answered
            </span>
          </div>
          {onViewChange && (
            <button
              onClick={() => onViewChange("settings")}
              className="size-9 rounded-lg hover:bg-muted/60 transition-colors flex items-center justify-center shrink-0"
              aria-label="Settings"
              title="Settings"
            >
              <Cog className="size-4 text-muted-foreground hover:text-foreground transition-colors" />
            </button>
          )}
        </motion.div>

        {/* Stats grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          <StatTile
            label="Attempted"
            value={attemptedTotal}
            icon={Target}
            color="text-primary"
          />
          <StatTile
            label="Correct"
            value={correctTotal}
            icon={Award}
            color="text-emerald-500"
          />
          <StatTile
            label="Wrong"
            value={wrongTotal}
            icon={TrendingUp}
            color="text-red-500"
          />
          <StatTile
            label="Accuracy"
            value={`${accuracy}%`}
            icon={Zap}
            color="text-amber-500"
          />
        </div>

        {/* Engine breakdown */}
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3">
          Performance by Engine
        </h2>
        {Object.keys(engineStats).length === 0 ? (
          <div className="bg-card border border-border rounded-lg p-8 text-center text-sm text-muted-foreground">
            No activity yet. Open a content pack from the Q-Bank Studio to start.
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
                  className="bg-card border border-border rounded-lg p-4"
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <Activity className="size-4 text-primary" />
                      <span className="text-sm font-medium capitalize">
                        {ENGINE_META[eng as keyof typeof ENGINE_META].label}
                      </span>
                    </div>
                    <span className="text-sm tabular-nums">
                      <span className="font-semibold">{pct}%</span>
                      <span className="text-xs text-muted-foreground ml-2">
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

        {/* Achievement stubs */}
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3">
          Achievements
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <Achievement
            icon={Target}
            title="First Steps"
            description="Answer your first question"
            unlocked={attemptedTotal >= 1}
          />
          <Achievement
            icon={Award}
            title="Sharp Shooter"
            description="Get 10 questions correct"
            unlocked={correctTotal >= 10}
          />
          <Achievement
            icon={Zap}
            title="On Fire"
            description="Reach 80% accuracy with 20+ questions"
            unlocked={attemptedTotal >= 20 && accuracy >= 80}
          />
          <Achievement
            icon={Calendar}
            title="Consistent"
            description="Start 3 different content packs"
            unlocked={progress.length >= 3}
          />
          <Achievement
            icon={TrendingUp}
            title="Determined"
            description="Attempt 50 questions"
            unlocked={attemptedTotal >= 50}
          />
          <Achievement
            icon={Flame}
            title="Marathon"
            description="Attempt 100 questions"
            unlocked={attemptedTotal >= 100}
          />
        </div>
      </div>
    </div>
  );
}

function StatTile({
  label,
  value,
  icon: Icon,
  color,
}: {
  label: string;
  value: string | number;
  icon: React.ComponentType<{ className?: string }>;
  color?: string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-card border border-border rounded-lg p-4"
    >
      <div className="flex items-center justify-between mb-2">
        <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          {label}
        </span>
        <Icon className={cn("size-4", color ?? "text-primary")} />
      </div>
      <div className="text-2xl font-bold">{value}</div>
    </motion.div>
  );
}

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
        "bg-card border rounded-lg p-4 flex items-center gap-3 transition-all",
        unlocked
          ? "border-primary/40 bg-primary/5"
          : "border-border opacity-60"
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
