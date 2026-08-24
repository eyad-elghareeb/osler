"use client";

import * as React from "react";
import { motion } from "framer-motion";
import {
  BookOpen,
  Layers,
  Stethoscope,
  PlayCircle,
  ArrowRight,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import { useI18n } from "./i18n-provider";
import type { OslerView } from "./app-shell";
import { cn } from "@/lib/utils";
import { flattenTree, getEngineMeta, loadCategoryTree, getCachedCategoryTree } from "@/lib/osler/content";
import type { ContentTreeNode } from "@/lib/osler/types";
import { storage } from "@/lib/osler/storage";
import { fadeUp, staggerContainer, MOTION_TRANSITION } from "@/lib/osler/motion";
import { isEngineEnabled } from "@/lib/osler/config";
import { PageHeader } from "./ui-primitives";

/**
 * Learn — a single hub that groups the four "study" modules that used to live
 * as top-level tabs: Library, Flashcards, OSCE, Videos. The hub renders a
 * simple responsive grid; tapping a card forwards the user to the existing
 * studio component for that module.
 *
 * The four sub-views (library / flashcards / osce / videos) are still first-
 * class `OslerView` values — they just no longer appear in the nav bars. The
 * Learn tab stays highlighted while the user is inside any of them (see
 * `LEARN_SUBVIEWS` in app-shell.tsx and mobile-tab-bar.tsx).
 *
 * Engine plugins: modules whose engine is disabled in `osler.config.json`
 * are filtered out of the grid at render time.
 */

import { useOslerRouter } from "@/lib/osler/navigation";

interface LearnProps {
  /** Navigate to a sub-view (library / flashcards / osce / videos). */
  onNavigate?: (v: OslerView) => void;
}

interface ModuleCardDef {
  id: Extract<OslerView, "library" | "flashcards" | "osce" | "videos">;
  /** Engine plugin id used to check enabled state and pull override metadata. */
  engine: "library" | "flashcard" | "osce" | "video";
  icon: LucideIcon;
  titleKey: string;
  descKey: string;
  /** Tailwind background tint for the icon chip (uses module color). */
  tint: string;
  /** Foreground color for the icon chip. */
  tintFg: string;
  /** Top accent gradient color. */
  accent: string;
}

const ALL_MODULES: ModuleCardDef[] = [
  {
    id: "library",
    engine: "library",
    icon: BookOpen,
    titleKey: "learn.library.title",
    descKey: "learn.library.desc",
    tint: "bg-[oklch(0.65_0.15_280/0.15)]",
    tintFg: "text-[oklch(0.65_0.15_280)]",
    accent: "oklch(0.65 0.15 280)",
  },
  {
    id: "flashcards",
    engine: "flashcard",
    icon: Layers,
    titleKey: "learn.flashcards.title",
    descKey: "learn.flashcards.desc",
    tint: "bg-[oklch(0.7_0.18_145/0.15)]",
    tintFg: "text-[oklch(0.7_0.18_145)]",
    accent: "oklch(0.7 0.18 145)",
  },
  {
    id: "osce",
    engine: "osce",
    icon: Stethoscope,
    titleKey: "learn.osce.title",
    descKey: "learn.osce.desc",
    tint: "bg-[oklch(0.7_0.2_16/0.15)]",
    tintFg: "text-[oklch(0.7_0.2_16)]",
    accent: "oklch(0.7 0.2 16)",
  },
  {
    id: "videos",
    engine: "video",
    icon: PlayCircle,
    titleKey: "learn.videos.title",
    descKey: "learn.videos.desc",
    tint: "bg-[oklch(0.68_0.18_195/0.15)]",
    tintFg: "text-[oklch(0.68_0.18_195)]",
    accent: "oklch(0.68 0.18 195)",
  },
];

export function Learn({ onNavigate: propOnNavigate }: LearnProps = {}) {
  const { t, rtl } = useI18n();
  const { navigate } = useOslerRouter();

  const onNavigate = propOnNavigate || navigate;

  // Filter out modules whose engine plugin is disabled in osler.config.
  const modules = React.useMemo(
    () => ALL_MODULES.filter((m) => isEngineEnabled(m.engine)),
    [],
  );

  // Manifest counts and titles arrive without downloading every pack body.
  const [counts, setCounts] = React.useState<Record<string, number | null>>(() => {
    const sumCounts = (nodes: ContentTreeNode[] | null) =>
      nodes ? flattenTree(nodes).reduce((total, node) => total + (node.itemCount ?? node.questionCount ?? node.files?.length ?? 0), 0) : null;
    return {
      library: sumCounts(getCachedCategoryTree("library")),
      flashcards: sumCounts(getCachedCategoryTree("flashcard")),
      osce: sumCounts(getCachedCategoryTree("osce")),
      videos: sumCounts(getCachedCategoryTree("video")),
    };
  });

  React.useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const [libraryTree, flashcardTree, osceTree, videoTree] = await Promise.all([
          loadCategoryTree("library"),
          loadCategoryTree("flashcard"),
          loadCategoryTree("osce"),
          loadCategoryTree("video"),
        ]);
        if (cancelled) return;

        const sumCounts = (nodes: ContentTreeNode[]) =>
          flattenTree(nodes).reduce(
            (total, node) => total + (node.itemCount ?? node.questionCount ?? node.files?.length ?? 0),
            0,
          );

        setCounts({
          library: sumCounts(libraryTree),
          flashcards: sumCounts(flashcardTree),
          osce: sumCounts(osceTree),
          videos: sumCounts(videoTree),
        });
      } catch {
        // Keep nulls — the UI shows a non-breaking placeholder.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // Surface a "Continue" hint on the module the user touched most recently.
  const [recentModule, setRecentModule] = React.useState<
    ModuleCardDef["id"] | null
  >(null);

  React.useEffect(() => {
    const pickRecent = () => {
      const all = storage.allProgress();
      if (all.length === 0) return;
      // Pick the most-recent pack's engine and map to a module id.
      const sorted = [...all].sort(
        (a, b) => (b.lastAttempt ?? 0) - (a.lastAttempt ?? 0),
      );
      const latestUid = sorted[0]?.uid;
      if (!latestUid) return;
      Promise.all([
        loadCategoryTree("library"),
        loadCategoryTree("flashcard"),
        loadCategoryTree("osce"),
        loadCategoryTree("video"),
      ])
        .then((trees) => {
          const node = trees.flatMap(flattenTree).find((item) => item.uid === latestUid);
          if (!node) return;
          const eng = node.type;
          if (eng === "flashcard") setRecentModule("flashcards");
          else if (eng === "osce") setRecentModule("osce");
          else if (eng === "library") setRecentModule("library");
          else if (eng === "video") setRecentModule("videos");
        })
        .catch(() => {});
    };
    pickRecent();
    const unsubHydrated = storage.onHydrated(pickRecent);
    return () => unsubHydrated();
  }, []);

  return (
    <div className="osler-page">
      <div className="osler-page__inner">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={MOTION_TRANSITION.slow}
        >
          <PageHeader
            eyebrow={t("nav.learn")}
            eyebrowIcon={Sparkles}
            title={t("learn.title")}
            subtitle={t("learn.subtitle")}
          />
        </motion.div>

        {/* Simple 2×2 grid (1 col on mobile, 2 cols on md+) */}
        <motion.div
          variants={staggerContainer}
          initial="hidden"
          animate="visible"
          className="grid grid-cols-1 sm:grid-cols-2 gap-4"
        >
          {modules.map((m) => (
            <ModuleCard
              key={m.id}
              def={m}
              count={counts[m.id]}
              isRecent={recentModule === m.id}
              onOpen={() => onNavigate(m.id)}
              rtl={rtl}
              t={t}
            />
          ))}
        </motion.div>
      </div>
    </div>
  );
}

function ModuleCard({
  def,
  count,
  isRecent,
  onOpen,
  rtl,
  t,
}: {
  def: ModuleCardDef;
  count: number | null;
  isRecent: boolean;
  onOpen: () => void;
  rtl: boolean;
  t: (k: any, p?: any) => string;
}) {
  const Icon = def.icon;
  // Pull override metadata (label/color/icon) from osler.config so the
  // module card reflects the user's customisation. The title still flows
  // through i18n so RTL/Arabic users see a translated label.
  const meta = getEngineMeta(def.engine);
  void meta; // referenced for side-effect of pulling overrides; title uses i18n key.
  return (
    <motion.button
      type="button"
      onClick={onOpen}
      variants={fadeUp}
      whileHover={{ y: -2 }}
      className="group relative text-start bg-card border border-border rounded-xl p-5 md:p-6 overflow-hidden transition-colors hover:border-primary/40"
    >
      <div className="flex items-start gap-4">
        {/* Icon chip */}
        <div
          className={cn(
            "w-12 h-12 rounded-lg flex items-center justify-center shrink-0",
            def.tint,
            def.tintFg,
          )}
        >
          <Icon className="size-6" />
        </div>

        {/* Title + description + meta */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="text-base md:text-lg font-semibold">
              {t(def.titleKey)}
            </h3>
            {isRecent && (
              <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/30">
                {t("learn.continue")}
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground mb-3 line-clamp-2">
            {t(def.descKey)}
          </p>

          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] text-muted-foreground tabular-nums">
              {count === null ? "—" : t(`learn.count.${def.id}`, { n: count })}
            </span>
            <span className="inline-flex items-center gap-1 text-xs font-medium text-primary group-hover:gap-1.5 transition-all">
              {t("learn.open")}
              <ArrowRight
                className={cn("size-3.5", rtl && "rtl-flip-x")}
              />
            </span>
          </div>
        </div>
      </div>
    </motion.button>
  );
}
