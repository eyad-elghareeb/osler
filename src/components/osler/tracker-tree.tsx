"use client";

import * as React from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  BookOpen,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  Flag,
  Folder,
  History,
  ListChecks,
  PenTool,
  X,
} from "lucide-react";
import type { EngineType } from "@/lib/osler/types";
import { ENGINE_META } from "@/lib/osler/content";
import { disclosureVariants, MOTION_TRANSITION } from "@/lib/osler/motion";
import { useI18n } from "./i18n-provider";
import { cn } from "@/lib/utils";

export interface TrackerTreeNode {
  uid: string;
  title: string;
  type: EngineType;
  isPack: boolean;
  wrong: number;
  flagged: number;
  children: TrackerTreeNode[];
  /** Sessions-mode: number of saved sessions under this node. */
  sessions?: number;
  /** Sessions-mode: last session start timestamp under this node (ms). */
  lastSessionAt?: number;
}

const PACK_ICONS: Record<EngineType, React.ComponentType<{ className?: string }>> = {
  quiz: ClipboardCheck,
  bank: BookOpen,
  written: PenTool,
  flashcard: BookOpen,
  osce: ClipboardCheck,
  library: BookOpen,
  video: BookOpen,
};

function CountChip({ count, kind }: { count: number; kind: "wrong" | "flagged" }) {
  if (count <= 0) return null;
  const Icon = kind === "wrong" ? X : Flag;
  return (
    <span
      className={cn(
        "flex items-center gap-1 rounded-full px-1.5 py-0.5 text-xs font-medium tabular-nums",
        kind === "wrong" ? "bg-destructive/10 text-destructive" : "bg-warning/10 text-warning",
      )}
    >
      <Icon className="size-2.5" />
      {count}
    </span>
  );
}

/** Sessions-mode chip: shows a session count badge with the History icon. */
function SessionsChip({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span
      className={cn(
        "flex items-center gap-1 rounded-full px-1.5 py-0.5 text-xs font-medium tabular-nums",
        "bg-primary/10 text-primary",
      )}
    >
      <History className="size-2.5" />
      {count}
    </span>
  );
}

const Caret = React.memo(function Caret({ open, rtl }: { open: boolean; rtl: boolean }) {
  const Icon = rtl ? ChevronLeft : ChevronRight;
  return (
    <motion.div
      initial={false}
      animate={{ rotate: open ? (rtl ? -90 : 90) : 0 }}
      transition={MOTION_TRANSITION.quick}
      className="size-4 shrink-0 text-muted-foreground"
      aria-hidden="true"
    >
      <Icon className="size-4" />
    </motion.div>
  );
});

interface TrackerTreeProps {
  nodes: TrackerTreeNode[];
  label: string;
  defaultExpanded?: string[];
  selectedUid?: string | null;
  onOpenPack?: (node: TrackerTreeNode) => void;
  /**
   * "records" (default) renders wrong/flagged count chips.
   * "sessions" renders session-count chips with a History icon and
   * treats `onOpenPack` as "open the sessions list for this pack".
   */
  mode?: "records" | "sessions";
}

interface Row {
  id: string;
  depth: number;
}

export function TrackerTree({ nodes, label, defaultExpanded, selectedUid, onOpenPack, mode = "records" }: TrackerTreeProps) {
  const { rtl } = useI18n();
  const reduced = useReducedMotion() ?? false;
  const [openIds, setOpenIds] = React.useState<Set<string>>(
    () => new Set(defaultExpanded ?? []),
  );
  const [activeId, setActiveId] = React.useState<string | null>(null);
  const refs = React.useRef(new Map<string, HTMLDivElement>());

  const nodeById = React.useMemo(() => {
    const map = new Map<string, TrackerTreeNode>();
    const walk = (list: TrackerTreeNode[]) => {
      for (const n of list) {
        map.set(n.uid, n);
        walk(n.children);
      }
    };
    walk(nodes);
    return map;
  }, [nodes]);

  const visibleRows = React.useMemo(() => {
    const out: Row[] = [];
    const walk = (list: TrackerTreeNode[], depth: number) => {
      for (const n of list) {
        out.push({ id: n.uid, depth });
        if (!n.isPack && openIds.has(n.uid)) walk(n.children, depth + 1);
      }
    };
    walk(nodes, 0);
    return out;
  }, [nodes, openIds]);

  const currentId = React.useMemo(() => {
    if (activeId && visibleRows.some((r) => r.id === activeId)) return activeId;
    return visibleRows[0]?.id ?? null;
  }, [activeId, visibleRows]);

  const register = React.useCallback((id: string, el: HTMLDivElement | null) => {
    if (el) refs.current.set(id, el);
    else refs.current.delete(id);
  }, []);

  const toggleOpen = React.useCallback((id: string) => {
    setOpenIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleRowClick = React.useCallback(
    (node: TrackerTreeNode) => {
      if (node.isPack) onOpenPack?.(node);
      else toggleOpen(node.uid);
    },
    [onOpenPack, toggleOpen],
  );

  const handleKey = React.useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>, id: string) => {
      const at = visibleRows.findIndex((r) => r.id === id);
      const node = nodeById.get(id);
      const moveFocus = (newId?: string) => {
        if (!newId) return;
        setActiveId(newId);
        refs.current.get(newId)?.focus();
      };
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        if (!node) return;
        if (node.isPack) onOpenPack?.(node);
        else toggleOpen(id);
        return;
      }
      switch (e.key) {
        case "Home":
          e.preventDefault();
          moveFocus(visibleRows[0]?.id);
          break;
        case "End":
          e.preventDefault();
          moveFocus(visibleRows[visibleRows.length - 1]?.id);
          break;
        case "ArrowDown": {
          e.preventDefault();
          const next = visibleRows[at + 1];
          if (next) moveFocus(next.id);
          break;
        }
        case "ArrowUp": {
          e.preventDefault();
          const prev = visibleRows[at - 1];
          if (prev) moveFocus(prev.id);
          break;
        }
        case "ArrowRight": {
          e.preventDefault();
          if (node && !node.isPack) {
            if (!openIds.has(id)) toggleOpen(id);
            else {
              const next = visibleRows[at + 1];
              if (next) moveFocus(next.id);
            }
          }
          break;
        }
        case "ArrowLeft": {
          e.preventDefault();
          if (node && !node.isPack && openIds.has(id)) {
            toggleOpen(id);
            break;
          }
          const depth = visibleRows[at]?.depth ?? 0;
          for (let i = at - 1; i >= 0; i--) {
            if (visibleRows[i].depth < depth) {
              moveFocus(visibleRows[i].id);
              break;
            }
          }
          break;
        }
        case "Escape":
          setActiveId(null);
          e.currentTarget.blur();
          break;
        default: {
          if (e.key.length === 1 && !e.metaKey && !e.ctrlKey) {
            const letter = e.key.toLowerCase();
            if (letter === " ") return;
            for (let step = 1; step <= visibleRows.length; step++) {
              const candidate = visibleRows[(at + step) % visibleRows.length];
              const cnode = nodeById.get(candidate.id);
              if (cnode?.title.toLowerCase().startsWith(letter)) {
                moveFocus(candidate.id);
                break;
              }
            }
          }
        }
      }
    },
    [visibleRows, nodeById, openIds, toggleOpen, onOpenPack],
  );

  const renderNodes = (list: TrackerTreeNode[], depth: number): React.ReactNode =>
    list.map((node) => {
      const isBranch = !node.isPack;
      const isOpen = openIds.has(node.uid);
      const isSelected = selectedUid === node.uid;
      const meta = ENGINE_META[node.type] ?? ENGINE_META.quiz;
      const PackIcon = PACK_ICONS[node.type] ?? ListChecks;

      const row = (
        <div
          role="treeitem"
          aria-expanded={isBranch ? isOpen : undefined}
          aria-level={depth + 1}
          aria-selected={isSelected}
          aria-label={node.title}
          tabIndex={currentId === node.uid ? 0 : -1}
          ref={(el) => register(node.uid, el)}
          onClick={() => handleRowClick(node)}
          onKeyDown={(e) => handleKey(e, node.uid)}
          onFocus={() => setActiveId(node.uid)}
          className={cn(
            "flex w-full cursor-pointer select-none items-center gap-2 rounded-lg px-2 py-2 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary/40",
            isSelected ? "bg-primary/10 font-medium text-primary" : "text-foreground hover:bg-muted/60",
          )}
        >
          {isBranch ? (
            <>
              <Caret open={isOpen} rtl={rtl} />
              <Folder className="size-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate">{node.title}</span>
              <span className="flex shrink-0 items-center gap-1.5">
                {mode === "sessions" ? (
                  <SessionsChip count={node.sessions ?? 0} />
                ) : (
                  <>
                    <CountChip count={node.wrong} kind="wrong" />
                    <CountChip count={node.flagged} kind="flagged" />
                  </>
                )}
              </span>
            </>
          ) : (
            <>
              <span className="w-4 shrink-0" aria-hidden="true" />
              <div
                className="flex size-7 shrink-0 items-center justify-center rounded-lg"
                style={{
                  backgroundColor: `color-mix(in oklch, ${meta.color} 12%, transparent)`,
                  color: meta.color,
                }}
              >
                <PackIcon className="size-3.5" />
              </div>
              <span className="min-w-0 flex-1 truncate">{node.title}</span>
              <span className="flex shrink-0 items-center gap-1.5">
                {mode === "sessions" ? (
                  <SessionsChip count={node.sessions ?? 0} />
                ) : (
                  <>
                    <CountChip count={node.wrong} kind="wrong" />
                    <CountChip count={node.flagged} kind="flagged" />
                  </>
                )}
                {rtl ? (
                  <ChevronLeft className="size-3.5 text-muted-foreground/40" aria-hidden="true" />
                ) : (
                  <ChevronRight className="size-3.5 text-muted-foreground/40" aria-hidden="true" />
                )}
              </span>
            </>
          )}
        </div>
      );

      if (!isBranch) return <div key={node.uid}>{row}</div>;

      return (
        <div key={node.uid}>
          {row}
          <AnimatePresence initial={false}>
            {isOpen && (
              <motion.div
                initial="hidden"
                animate="visible"
                exit="exit"
                variants={disclosureVariants}
                transition={reduced ? { duration: 0 } : undefined}
                className="overflow-hidden"
              >
                <div
                  className={cn(
                    "flex flex-col gap-0.5 py-0.5",
                    depth < 3 && "ms-4 border-s ps-1.5 border-border",
                  )}
                >
                  {renderNodes(node.children, depth + 1)}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      );
    });

  return (
    <div role="tree" aria-label={label} aria-multiselectable="false" className="flex flex-col gap-0.5">
      {renderNodes(nodes, 0)}
    </div>
  );
}
