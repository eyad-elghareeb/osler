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
} from "lucide-react";
import { loadAllContent, ENGINE_META } from "@/lib/osler/content";
import type { AnyContent, ManifestItem, EngineType } from "@/lib/osler/types";
import { storage } from "@/lib/osler/storage";
import { ARTICLES } from "@/lib/osler/articles";
import type { OslerView } from "./app-shell";
import { cn } from "@/lib/utils";

interface DashboardProps {
  username: string;
  onViewChange: (v: OslerView) => void;
  onOpenPack?: (item: ManifestItem, content: AnyContent) => void;
  onOpenArticle?: (id: string) => void;
}

const ENGINE_COLORS: Record<EngineType, string> = {
  quiz: "oklch(0.62 0.16 250)",
  bank: "oklch(0.58 0.14 245)",
  flashcard: "oklch(0.7 0.18 145)",
  written: "oklch(0.78 0.16 80)",
  osce: "oklch(0.7 0.2 16)",
};

export function Dashboard({
  username,
  onViewChange,
  onOpenPack,
  onOpenArticle,
}: DashboardProps) {
  const [data, setData] = React.useState<{
    items: Array<{ item: ManifestItem; content: AnyContent | null }>;
  } | null>(null);
  const [stats, setStats] = React.useState({ attempted: 0, correct: 0, packs: 0 });

  React.useEffect(() => {
    loadAllContent().then(setData).catch(console.error);
  }, []);

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
    return storage.subscribe(update);
  }, []);

  const recentPacks = React.useMemo(() => {
    if (!data) return [];
    return data.items
      .map(({ item, content }) => ({
        item,
        content,
        progress: storage.packProgress(item.uid),
      }))
      .filter((x) => x.progress.attempted > 0)
      .sort(
        (a, b) =>
          (b.progress.lastAttempt ?? 0) - (a.progress.lastAttempt ?? 0)
      )
      .slice(0, 4);
  }, [data, stats]);

  const continuePack = recentPacks[0];
  const accuracy = stats.attempted
    ? Math.round((stats.correct / stats.attempted) * 100)
    : 0;

  // Featured articles (3 random picks)
  const featuredArticles = React.useMemo(() => {
    return Object.values(ARTICLES).slice(0, 3);
  }, []);

  const greeting = (() => {
    const h = new Date().getHours();
    if (h < 12) return "Good morning";
    if (h < 18) return "Good afternoon";
    return "Good evening";
  })();

  return (
    <div className="h-full overflow-y-auto medos-scroll">
      <div className="max-w-6xl mx-auto px-4 md:px-8 py-8">
        {/* Hero */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="mb-8"
        >
          <p className="text-xs uppercase tracking-wider text-muted-foreground mb-1 flex items-center gap-1.5">
            <Flame className="size-3 text-amber-500" />
            {greeting}
          </p>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight mb-1">
            Welcome back, {username}
          </h1>
          <p className="text-sm text-muted-foreground max-w-2xl">
            Continue where you left off, browse the article library, or build a
            new test in Q-Bank Studio across quizzes, banks, flashcards, written
            prompts, and OSCE stations.
          </p>
        </motion.div>

        {/* Continue card */}
        {continuePack ? (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: 0.05 }}
            className="relative overflow-hidden bg-card border border-border rounded-xl p-5 md:p-6 mb-6"
          >
            <div
              className="absolute top-0 left-0 right-0 h-1"
              style={{
                background: `linear-gradient(90deg, ${ENGINE_COLORS[continuePack.item.type]}, transparent)`,
              }}
            />
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div className="flex-1 min-w-0">
                <span className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium flex items-center gap-1.5">
                  <Activity className="size-3" />
                  Continue learning
                </span>
                <h2 className="text-lg md:text-xl font-semibold mt-1 mb-1">
                  {continuePack.item.title}
                </h2>
                <p className="text-xs text-muted-foreground mb-3 line-clamp-1">
                  {continuePack.content?.meta.description}
                </p>
                <div className="flex items-center gap-3 text-xs flex-wrap">
                  <span className="text-muted-foreground">
                    {continuePack.progress.attempted} attempted
                  </span>
                  <span className="text-emerald-500">
                    {continuePack.progress.correct} correct
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
              <button
                type="button"
                onClick={() =>
                  continuePack.content &&
                  onOpenPack?.(continuePack.item, continuePack.content)
                }
                className="inline-flex items-center gap-1.5 px-4 h-10 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors shrink-0"
              >
                Resume
                <ArrowRight className="size-4" />
              </button>
            </div>
          </motion.div>
        ) : null}

        {/* Stat cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
          <StatTile
            label="Packs Started"
            value={stats.packs}
            icon={LibraryIcon}
            onClick={() => onViewChange("qbank")}
          />
          <StatTile
            label="Attempted"
            value={stats.attempted}
            icon={Activity}
            onClick={() => onViewChange("profile")}
          />
          <StatTile
            label="Correct"
            value={stats.correct}
            icon={CheckCircle2}
            color="text-emerald-500"
            onClick={() => onViewChange("profile")}
          />
          <StatTile
            label="Accuracy"
            value={`${accuracy}%`}
            icon={Sparkles}
            color="text-amber-500"
            onClick={() => onViewChange("profile")}
          />
        </div>

        {/* Quick actions */}
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3">
          Quick Actions
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-8">
          <QuickAction
            icon={ListChecks}
            title="Q-Bank Studio"
            subtitle="Build a test from any pack"
            onClick={() => onViewChange("qbank")}
          />
          <QuickAction
            icon={Layers}
            title="Flashcard Decks"
            subtitle="Spaced-repetition study decks"
            onClick={() => onViewChange("flashcards")}
          />
          <QuickAction
            icon={BookOpen}
            title="Article Library"
            subtitle={`${Object.keys(ARTICLES).length} medical articles`}
            onClick={() => onViewChange("library")}
          />
          <QuickAction
            icon={BarChart3}
            title="View Profile"
            subtitle="See stats and achievements"
            onClick={() => onViewChange("profile")}
          />
        </div>

        {/* Featured articles */}
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Featured Articles
          </h2>
          <button
            type="button"
            onClick={() => onViewChange("library")}
            className="text-xs text-primary hover:underline flex items-center gap-1"
          >
            View all
            <ArrowRight className="size-3" />
          </button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-8">
          {featuredArticles.map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => onOpenArticle?.(a.id)}
              className="text-left bg-card border border-border rounded-lg p-4 hover:border-primary/40 hover:bg-primary/5 transition-colors"
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
              <h3 className="text-sm font-semibold mb-1 line-clamp-2">
                {a.title}
              </h3>
              <p className="text-xs text-muted-foreground line-clamp-2">
                {/* Strip HTML for preview */}
                {a.html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 120)}
                …
              </p>
            </button>
          ))}
        </div>

        {/* Recent packs */}
        {recentPacks.length > 0 ? (
          <>
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3">
              Recent Activity
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {recentPacks.map(({ item, content, progress }) => (
                <button
                  key={item.uid}
                  type="button"
                  onClick={() => content && onOpenPack?.(item, content)}
                  className="text-left bg-card border border-border rounded-lg p-4 hover:border-primary/40 transition-colors"
                >
                  <div className="flex items-start gap-3">
                    <div
                      className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
                      style={{
                        background: `color-mix(in oklch, ${ENGINE_COLORS[item.type]} 15%, transparent)`,
                        color: ENGINE_COLORS[item.type],
                      }}
                    >
                      <Activity className="size-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="text-sm font-semibold truncate">
                        {item.title}
                      </h3>
                      <p className="text-xs text-muted-foreground mb-1.5">
                        {ENGINE_META[item.type].label}
                      </p>
                      <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                        <span>{progress.attempted} attempted</span>
                        <span className="text-emerald-500">
                          {progress.correct} correct
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
                </button>
              ))}
            </div>
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
  color,
  onClick,
}: {
  label: string;
  value: string | number;
  icon: React.ComponentType<{ className?: string }>;
  color?: string;
  onClick?: () => void;
}) {
  return (
    <motion.button
      type="button"
      onClick={onClick}
      whileHover={{ y: -2 }}
      className="text-left bg-card border border-border rounded-lg p-4 transition-colors hover:border-primary/40"
    >
      <div className="flex items-center justify-between mb-2">
        <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          {label}
        </span>
        <Icon className={cn("size-4", color ?? "text-primary")} />
      </div>
      <div className="text-2xl font-bold">{value}</div>
    </motion.button>
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
  return (
    <motion.button
      type="button"
      onClick={onClick}
      whileHover={{ y: -2 }}
      className="text-left bg-card border border-border rounded-lg p-4 flex items-center gap-3 transition-colors hover:border-primary/40"
    >
      <div className="w-10 h-10 rounded-lg bg-primary/15 text-primary flex items-center justify-center shrink-0">
        <Icon className="size-5" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold">{title}</div>
        <div className="text-xs text-muted-foreground">{subtitle}</div>
      </div>
      <ArrowRight className="size-4 text-muted-foreground shrink-0" />
    </motion.button>
  );
}

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}
