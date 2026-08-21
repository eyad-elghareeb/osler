"use client";

import * as React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronRight, Folder, FileText } from "lucide-react";
import type { ContentTreeNode } from "@/lib/osler/types";
import { cn } from "@/lib/utils";

interface FolderTreeNavProps {
  /** The tree nodes to render */
  tree: ContentTreeNode[];
  /** Currently selected node uid (highlight) */
  selected?: string | null;
  /** Callback when a leaf node is clicked */
  onSelect?: (node: ContentTreeNode) => void;
  /** Initially expanded node uids */
  defaultExpanded?: string[];
  /** Extra rendering in each item slot */
  renderExtra?: (node: ContentTreeNode) => React.ReactNode;
  /**
   * When true, clicking a branch row also fires onSelect (aggregated view)
   * while the chevron stays expand/collapse-only.
   */
  selectBranches?: boolean;
  /** Additional class name */
  className?: string;
}

export function FolderTreeNav({
  tree,
  selected,
  onSelect,
  defaultExpanded,
  renderExtra,
  selectBranches,
  className,
}: FolderTreeNavProps) {
  return (
    <nav className={cn("space-y-px", className)}>
      {tree.map((node) => (
        <TreeNodeItem
          key={node.uid}
          node={node}
          depth={0}
          selected={selected}
          onSelect={onSelect}
          defaultExpanded={defaultExpanded}
          renderExtra={renderExtra}
          selectBranches={selectBranches}
        />
      ))}
    </nav>
  );
}

function TreeNodeItem({
  node,
  depth,
  selected,
  onSelect,
  defaultExpanded,
  renderExtra,
  selectBranches,
}: {
  node: ContentTreeNode;
  depth: number;
  selected?: string | null;
  onSelect?: (node: ContentTreeNode) => void;
  defaultExpanded?: string[];
  renderExtra?: (node: ContentTreeNode) => React.ReactNode;
  selectBranches?: boolean;
}) {
  const isBranch = node.items.length > 0;
  const [expanded, setExpanded] = React.useState(
    () => defaultExpanded?.includes(node.uid) ?? false
  );

  const toggle = React.useCallback(() => {
    if (isBranch) {
      if (selectBranches) onSelect?.(node);
      setExpanded((e) => !e);
    } else {
      onSelect?.(node);
    }
  }, [isBranch, node, onSelect, selectBranches]);

  const handleKeyDown = React.useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        toggle();
      }
    },
    [toggle]
  );

  return (
    <div>
      <button
        onClick={toggle}
        onKeyDown={handleKeyDown}
        aria-expanded={isBranch ? expanded : undefined}
        className={cn(
          "w-full flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm transition-colors text-left",
          "hover:bg-muted/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30",
          node.uid === selected
            ? "bg-primary/10 text-primary font-medium"
            : "text-foreground",
        )}
        style={{ paddingLeft: `${12 + depth * 16}px` }}
      >
        {isBranch ? (
          <span
            role="button"
            tabIndex={-1}
            onClick={(e) => {
              e.stopPropagation();
              setExpanded((e2) => !e2);
            }}
            className="shrink-0 rounded p-0.5 -m-0.5 hover:bg-muted"
          >
            <ChevronRight
              className={cn(
                "size-3.5 shrink-0 text-muted-foreground transition-transform",
                expanded && "rotate-90",
              )}
            />
          </span>
        ) : (
          <FileText className="size-3.5 shrink-0 text-muted-foreground" />
        )}
        <span className="truncate">{node.title}</span>
        {renderExtra?.(node)}
        {isBranch && !expanded && node.items.length > 0 && (
          <span className="ml-auto text-[11px] text-muted-foreground/50 tabular-nums">
            {node.items.length}
          </span>
        )}
      </button>

      <AnimatePresence>
        {isBranch && expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15, ease: "easeOut" }}
            className="overflow-hidden"
          >
            {node.items.map((child) => (
              <TreeNodeItem
                key={child.uid}
                node={child}
                depth={depth + 1}
                selected={selected}
                onSelect={onSelect}
                defaultExpanded={defaultExpanded}
                renderExtra={renderExtra}
                selectBranches={selectBranches}
              />
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
