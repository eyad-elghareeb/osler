"use client";

import * as React from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  BookOpen,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  Folder,
  History,
  PenTool,
} from "lucide-react";
import type { EngineType } from "@/lib/osler/types";
import { ENGINE_META } from "@/lib/osler/content";
import {
  MOTION_SPRING,
  MOTION_TRANSITION,
  pressFeedback,
} from "@/lib/osler/motion";
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



function NeutralCountChip({ wrong, flagged }: { wrong: number; flagged: number }) {
  const total = wrong + flagged;
  if (total <= 0) return null;
  return (
    <span className="rounded-md bg-muted/60 px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-muted-foreground">
      {wrong > 0 && flagged > 0 ? `${wrong} · ${flagged}` : wrong > 0 ? wrong : flagged}
    </span>
  );
}

/** Sessions-mode chip: shows a session count badge with the History icon. */
function SessionsChip({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span className="flex items-center gap-1 rounded-md bg-muted/60 px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-foreground">
      <History className="size-3" />
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
      transition={MOTION_SPRING.snappy}
      className="size-3.5 shrink-0 text-muted-foreground/70"
      aria-hidden="true"
    >
      <Icon className="size-3.5" />
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

      const row = (
        <motion.div
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
          variants={pressFeedback}
          initial="rest"
          whileTap="press"
          className={cn(
            "group flex w-full cursor-pointer select-none items-center gap-1.5 rounded-md px-2 text-[13px] leading-tight outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary/40",
            "h-7",
            isSelected
              ? "bg-primary/10 font-medium text-primary"
              : "text-foreground hover:bg-muted/40",
            !isSelected && isBranch && "font-medium",
            !isSelected && !isBranch && "text-muted-foreground group-hover:text-foreground",
          )}
        >
          {isBranch ? (
            <>
              <Caret open={isOpen} rtl={rtl} />
              <Folder className="size-3.5 shrink-0 text-muted-foreground/70" />
              <span className="min-w-0 flex-1 truncate">{node.title}</span>
              {!isOpen && (
                <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground/60">
                  {node.children.length > 0 ? `+${node.children.length}` : ""}
                </span>
              )}
              <span className="flex shrink-0 items-center gap-1.5">
                {mode === "sessions" ? (
                  <SessionsChip count={node.sessions ?? 0} />
                ) : (
                  <NeutralCountChip wrong={node.wrong} flagged={node.flagged} />
                )}
              </span>
            </>
          ) : (
            <>
              <span className="w-3.5 shrink-0" aria-hidden="true" />
              <span
                className="size-1.5 shrink-0 rounded-full"
                style={{ backgroundColor: meta.color }}
                aria-hidden="true"
              />
              <span className="min-w-0 flex-1 truncate">{node.title}</span>
              <span className="flex shrink-0 items-center gap-1.5">
                {mode === "sessions" ? (
                  <SessionsChip count={node.sessions ?? 0} />
                ) : (
                  <NeutralCountChip wrong={node.wrong} flagged={node.flagged} />
                )}
                {rtl ? (
                  <ChevronLeft className="size-3 text-muted-foreground/40 rtl-flip-x" aria-hidden="true" />
                ) : (
                  <ChevronRight className="size-3 text-muted-foreground/40 rtl-flip-x" aria-hidden="true" />
                )}
              </span>
            </>
          )}
        </motion.div>
      );

      if (!isBranch) return <div key={node.uid}>{row}</div>;

      return (
        <div key={node.uid} className="relative">
          {row}
          <AnimatePresence initial={false}>
            {isOpen && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={
                  reduced
                    ? { duration: 0 }
                    : { height: MOTION_TRANSITION.quick, opacity: MOTION_TRANSITION.fast }
                }
                className="overflow-hidden"
              >
                <div
                  className={cn(
                    "relative flex py-0.5",
                    depth < 3 && "ms-[14px] border-s border-border/40",
                  )}
                >
                  <div className="flex w-full flex-col gap-px">
                    {renderNodes(node.children, depth + 1)}
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      );
    });

  return (
    <div role="tree" aria-label={label} aria-multiselectable="false" className="flex flex-col gap-px">
      {renderNodes(nodes, 0)}
    </div>
  );
}