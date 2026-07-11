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
  Settings as SettingsIcon,
  Cog,
  NotebookPen,
  Plus,
  Search,
  Trash2,
  Folder,
  ExternalLink,
  X,
  Pencil,
  Eye,
  Tag,
  Check,
  ArrowLeft,
} from "lucide-react";
import { storage, notes as notesStore, type NoteRecord } from "@/lib/osler/storage";
import { loadAllContent, ENGINE_META } from "@/lib/osler/content";
import type { AnyContent, ContentTreeNode } from "@/lib/osler/types";
import type { OslerView } from "./app-shell";
import { useI18n } from "./i18n-provider";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { NotesPanel } from "./notes-panel";

interface ProfileProps {
  username: string;
  onViewChange?: (v: OslerView) => void;
}

export function Profile({ username, onViewChange }: ProfileProps) {
  const { t } = useI18n();
  const [data, setData] = React.useState<{
    items: Array<{ node: ContentTreeNode; content: AnyContent | null }>;
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
      const item = data?.items.find((x) => x.node.uid === p.uid);
      if (!item) return;
      const eng = item.node.type;
      if (!stats[eng]) stats[eng] = { attempted: 0, correct: 0 };
      stats[eng].attempted += p.attempted;
      stats[eng].correct += p.correct;
    });
    return stats;
  }, [progress, data]);

  return (
    <div className="h-full overflow-y-auto medos-scroll medos-tabbar-pad md:pb-0">
      <div className="max-w-4xl mx-auto px-4 md:px-8 py-8">
        {/* Profile header */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-card border border-border rounded-lg p-4 sm:p-6 mb-6 flex items-center gap-4"
        >
          <div className="w-16 h-16 rounded-full bg-gradient-to-br from-primary/80 to-primary/40 flex items-center justify-center text-2xl font-bold text-primary-foreground">
            {username.slice(0, 2).toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-xl font-semibold truncate">{username}</h1>
            <p className="text-xs text-muted-foreground">{t("nav.localSession")} · {t("login.footer")}</p>
          </div>
          <div className="hidden sm:flex flex-col items-end gap-1">
            <Badge variant="secondary" className="text-[10px]">
              <Flame className="size-3 me-1" />
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
              aria-label={t("nav.settings")}
              title={t("nav.settings")}
            >
              <Cog className="size-4 text-muted-foreground hover:text-foreground transition-colors" />
            </button>
          )}
        </motion.div>

        {/* Stats grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          <StatTile
            label={t("dash.attemptedLabel")}
            value={attemptedTotal}
            icon={Target}
            color="text-primary"
          />
          <StatTile
            label={t("dash.correctLabel")}
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
            label={t("dash.accuracy")}
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
          <div className="bg-card border border-border rounded-lg p-8 text-center text-sm text-muted-foreground mb-6">
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
                  className="bg-card border border-border rounded-lg p-4"
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

        {/* Achievement stubs */}
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3">
          Achievements
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
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

/* ── Profile Notes Section ───────────────────────────────────────────── */

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  return new Date(ts).toLocaleDateString();
}

function ProfileNotesSection({
  onViewChange,
}: {
  onViewChange?: (v: OslerView) => void;
}) {
  const { t } = useI18n();
  const [allNotes, setAllNotes] = React.useState<NoteRecord[]>([]);
  const [search, setSearch] = React.useState("");
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

  const visibleNotes = React.useMemo(() => {
    if (!search.trim()) return allNotes;
    const q = search.trim().toLowerCase();
    return allNotes.filter(
      (n) =>
        n.title.toLowerCase().includes(q) ||
        n.body.toLowerCase().includes(q) ||
        n.tags.some((t) => t.toLowerCase().includes(q)),
    );
  }, [allNotes, search]);

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
      <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-2">
        <NotebookPen className="size-4" />
        {t("qbank.notes.title")}
      </h2>
      <div className="bg-card border border-border rounded-lg p-4 mb-6">
        {/* Toolbar */}
        <div className="flex items-center gap-2 mb-4">
          <div className="flex-1 flex items-center gap-2 h-9 px-3 rounded-lg border border-border bg-background">
            <Search className="size-3.5 text-muted-foreground shrink-0" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("qbank.notes.search")}
              className="flex-1 bg-transparent outline-none text-xs placeholder:text-muted-foreground min-w-0"
            />
            {search && (
              <button
                onClick={() => setSearch("")}
                className="size-5 rounded hover:bg-muted flex items-center justify-center"
              >
                <X className="size-3" />
              </button>
            )}
          </div>
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
            <h3 className="text-sm font-semibold mb-1">
              {search ? t("qbank.notes.empty.searching") : t("qbank.notes.empty.title")}
            </h3>
            <p className="text-xs text-muted-foreground max-w-xs mx-auto mb-4">
              {search
                ? t("qbank.notes.empty.searchingBody")
                : t("qbank.notes.empty.body")}
            </p>
            {!search && (
              <Button onClick={handleCreate} size="sm" variant="outline" className="rounded-lg">
                <Plus className="size-3.5 mr-1" />
                {t("qbank.notes.empty.createFirst")}
              </Button>
            )}
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
                ? timeAgo(Math.max(...allNotes.map((n) => n.updatedAt)))
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
    <div className="group rounded-lg border border-border bg-background hover:border-primary/40 hover:bg-primary/5 transition-colors p-3.5 cursor-pointer">
      <div onClick={onOpen} className="space-y-1.5">
        <div className="flex items-start justify-between gap-2">
          <h4 className="text-sm font-semibold truncate flex-1">
            {note.title || <span className="italic text-muted-foreground">{t("qbank.notes.card.untitled")}</span>}
          </h4>
          <div className="flex items-center gap-0.5 text-[10px] text-muted-foreground shrink-0">
            <Clock className="size-3" />
            <span>{timeAgo(note.updatedAt)}</span>
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
      <div className="flex items-center justify-end gap-1 mt-2 pt-2 border-t border-border/40 opacity-0 group-hover:opacity-100 transition-opacity">
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
