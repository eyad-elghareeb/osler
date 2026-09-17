"use client";

import { useEffect, useState } from "react";
import {
  BarChart3,
  BookOpen,
  Database,
  ListChecks,
  PenLine,
  Video,
  type LucideIcon,
} from "lucide-react";
import { useI18n } from "@/components/osler/i18n-provider";
import { EmptyState, SectionHeading, StatTile } from "@/components/osler/ui-primitives";
import { Skeleton } from "@/components/ui/skeleton";
import { flattenTree, loadCategoryTree } from "@/lib/osler/content";
import type { ContentTreeNode } from "@/lib/osler/types";

/** Leaf types whose `questionCount` counts MCQs (mixed packs hold MCQs plus written prompts). */
const MCQ_TYPES = new Set(["quiz", "bank", "mixed"]);

interface SiteRow {
  site: string;
  mcq: number;
  written: number;
  articles: number;
  videos: number;
}

interface Inventory {
  rows: SiteRow[];
  mcq: number;
  mcqPacks: number;
  written: number;
  writtenPacks: number;
  articles: number;
  articlePacks: number;
  videos: number;
  videoPacks: number;
}

function normalizeSite(title: string): string {
  return title.trim().toLowerCase();
}

interface CountPair {
  items: number;
  packs: number;
}

type Column = "mcq" | "written" | "articles" | "videos";

/**
 * Roll one category manifest into the per-site rows. `kind` selects which
 * column the leaf counts land in and which count field to read: qbank packs
 * report `questionCount` (passages already expanded to sub-questions) while
 * library/video packs report `itemCount` (articles / videos). Returns
 * per-column item + pack counts so tiles can show both.
 */
function rollup(
  tops: ContentTreeNode[],
  kind: "qbank" | "library" | "video",
  rows: Map<string, SiteRow>,
): Record<Column, CountPair> {
  const out: Record<Column, CountPair> = {
    mcq: { items: 0, packs: 0 },
    written: { items: 0, packs: 0 },
    articles: { items: 0, packs: 0 },
    videos: { items: 0, packs: 0 },
  };
  function add(column: Column, row: SiteRow, n: number): void {
    row[column] += n;
    out[column].items += n;
    out[column].packs += 1;
  }
  for (const top of tops) {
    const key = normalizeSite(top.title);
    let row = rows.get(key);
    if (!row) {
      row = { site: top.title, mcq: 0, written: 0, articles: 0, videos: 0 };
      rows.set(key, row);
    }
    for (const leaf of flattenTree([top])) {
      if (kind === "qbank") {
        const n = leaf.questionCount ?? leaf.itemCount ?? 0;
        if (n === 0) continue;
        if (leaf.type === "written") add("written", row, n);
        else if (MCQ_TYPES.has(leaf.type)) add("mcq", row, n);
      } else if (kind === "library") {
        const n = leaf.itemCount ?? leaf.questionCount ?? 0;
        if (n === 0) continue;
        add("articles", row, n);
      } else {
        const n = leaf.itemCount ?? leaf.questionCount ?? 0;
        if (n === 0) continue;
        add("videos", row, n);
      }
    }
  }
  return out;
}

/**
 * ContentInventory — manifest-derived content counts on the admin dashboard.
 *
 * Reads the qbank / library / videos category manifests (the same source the
 * student hubs paint from — R2 on cloud instances, bundled files otherwise)
 * and reports MCQ counts site-wise plus written / article / video totals.
 * No leaf bodies are fetched: branch rollups alone cannot split MCQ from
 * written, so leaves are classified by their manifest `type`.
 */
export function ContentInventory() {
  const { t } = useI18n();
  const [inventory, setInventory] = useState<Inventory | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.allSettled([
      loadCategoryTree("quiz"),
      loadCategoryTree("library"),
      loadCategoryTree("video"),
    ]).then(([qbank, library, videos]) => {
      if (cancelled) return;
      if (
        qbank.status === "rejected" &&
        library.status === "rejected" &&
        videos.status === "rejected"
      ) {
        setFailed(true);
        return;
      }
      const rows = new Map<string, SiteRow>();
      const empty: Record<Column, CountPair> = {
        mcq: { items: 0, packs: 0 },
        written: { items: 0, packs: 0 },
        articles: { items: 0, packs: 0 },
        videos: { items: 0, packs: 0 },
      };
      const qb = qbank.status === "fulfilled" ? rollup(qbank.value, "qbank", rows) : empty;
      if (library.status === "fulfilled") Object.assign(empty.articles, rollup(library.value, "library", rows).articles);
      if (videos.status === "fulfilled") Object.assign(empty.videos, rollup(videos.value, "video", rows).videos);
      setInventory({
        rows: [...rows.values()]
          .filter((r) => r.mcq + r.written + r.articles + r.videos > 0)
          .sort((a, b) => b.mcq - a.mcq || a.site.localeCompare(b.site)),
        mcq: qb.mcq.items,
        mcqPacks: qb.mcq.packs,
        written: qb.written.items,
        writtenPacks: qb.written.packs,
        articles: empty.articles.items,
        articlePacks: empty.articles.packs,
        videos: empty.videos.items,
        videoPacks: empty.videos.packs,
      });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (failed) {
    return (
      <section aria-label={t("admin.inventory.title")}>
        <SectionHeading icon={BarChart3}>{t("admin.inventory.title")}</SectionHeading>
        <EmptyState
          icon={Database}
          title={t("admin.inventory.empty")}
          description={t("admin.inventory.emptyDesc")}
        />
      </section>
    );
  }

  if (!inventory) {
    return (
      <section aria-label={t("admin.inventory.title")}>
        <SectionHeading icon={BarChart3}>{t("admin.inventory.title")}</SectionHeading>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="osler-stat-tile">
              <div className="flex items-center justify-between mb-2">
                <Skeleton className="h-3 w-20" />
                <Skeleton className="size-4 rounded" />
              </div>
              <Skeleton className="h-7 w-16" />
            </div>
          ))}
        </div>
        <div className="rounded-xl border border-border bg-card p-4 mt-3 space-y-2">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-5 w-full" />
          ))}
        </div>
      </section>
    );
  }

  const tiles: Array<{
    label: string;
    value: number;
    packs: number;
    icon: LucideIcon;
    color: "primary" | "success" | "warning" | "destructive" | "info";
  }> = [
    { label: t("admin.inventory.mcq"), value: inventory.mcq, packs: inventory.mcqPacks, icon: ListChecks, color: "primary" },
    { label: t("admin.inventory.written"), value: inventory.written, packs: inventory.writtenPacks, icon: PenLine, color: "warning", },
    { label: t("admin.inventory.articles"), value: inventory.articles, packs: inventory.articlePacks, icon: BookOpen, color: "success" },
    { label: t("admin.inventory.videos"), value: inventory.videos, packs: inventory.videoPacks, icon: Video, color: "info" },
  ];

  return (
    <section aria-label={t("admin.inventory.title")}>
      <SectionHeading icon={BarChart3} description={t("admin.inventory.subtitle")}>
        {t("admin.inventory.title")}
      </SectionHeading>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {tiles.map((tile) => (
          <StatTile
            key={tile.label}
            compact
            label={tile.label}
            value={tile.value}
            icon={tile.icon}
            color={tile.color}
            footer={
              tile.packs > 0 ? (
                <p className="text-[11px] text-muted-foreground mt-1.5 tabular-nums">
                  {t("admin.inventory.packs", { n: String(tile.packs) })}
                </p>
              ) : undefined
            }
          />
        ))}
      </div>
      <div className="rounded-xl border border-border bg-card p-4 mt-3 overflow-x-auto">
        <table className="osler-table">
          <thead>
            <tr>
              <th scope="col">{t("admin.inventory.site")}</th>
              <th scope="col" className="text-end">{t("admin.inventory.mcq")}</th>
              <th scope="col" className="text-end">{t("admin.inventory.written")}</th>
              <th scope="col" className="text-end">{t("admin.inventory.articles")}</th>
              <th scope="col" className="text-end">{t("admin.inventory.videos")}</th>
            </tr>
          </thead>
          <tbody>
            {inventory.rows.map((row) => (
              <tr key={row.site}>
                <td>{row.site}</td>
                <td className="numeric">{row.mcq > 0 ? row.mcq.toLocaleString() : "—"}</td>
                <td className="numeric">{row.written > 0 ? row.written.toLocaleString() : "—"}</td>
                <td className="numeric">{row.articles > 0 ? row.articles.toLocaleString() : "—"}</td>
                <td className="numeric">{row.videos > 0 ? row.videos.toLocaleString() : "—"}</td>
              </tr>
            ))}
            <tr className="font-semibold">
              <td>{t("admin.inventory.total")}</td>
              <td className="numeric">{inventory.mcq.toLocaleString()}</td>
              <td className="numeric">{inventory.written.toLocaleString()}</td>
              <td className="numeric">{inventory.articles.toLocaleString()}</td>
              <td className="numeric">{inventory.videos.toLocaleString()}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}
