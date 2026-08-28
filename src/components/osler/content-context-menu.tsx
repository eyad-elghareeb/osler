"use client";

/**
 * ContentContextMenu — app-wide custom right-click menu for the content
 * area, giving users faster access to the actions that matter while
 * studying: Export PDF (when an article is open), Share, and Copy link —
 * plus Copy for the current text selection.
 *
 * Implementation notes:
 *   • Listens for `contextmenu` on document but only claims events that
 *     originate inside <main> (the app content region). Native inputs,
 *     textareas, contenteditable surfaces (e.g. the Milkdown editor) and
 *     elements marked [data-native-context-menu] keep the browser menu.
 *   • "Export PDF" delegates to the article-view registry — see
 *     `article-view-registry.ts` — so it appears only when a reader that
 *     supports it is open.
 */

import * as React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Copy, Link2, Share2, FileDown } from "lucide-react";
import { useI18n } from "./i18n-provider";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import type { StringKey } from "@/lib/osler/i18n";
import { haptic } from "@/lib/osler/native";
import { getArticleViewContext } from "@/lib/osler/article-view-registry";
import { MOTION_TRANSITION } from "@/lib/osler/motion";

/** Keeps the native menu alive for editing surfaces and explicit opt-outs. */
function shouldKeepNativeMenu(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el.closest !== "function") return true;
  return !!el.closest(
    "input, textarea, select, [contenteditable='true'], .ProseMirror, [data-native-context-menu]",
  );
}

export function ContentContextMenu() {
  const { t } = useI18n();
  const { toast } = useToast();
  const [open, setOpen] = React.useState(false);
  const [pos, setPos] = React.useState({ x: 0, y: 0 });
  const [hasSelection, setHasSelection] = React.useState(false);
  const menuRef = React.useRef<HTMLDivElement | null>(null);

  const close = React.useCallback(() => setOpen(false), []);

  // Claim right-clicks inside the content region.
  React.useEffect(() => {
    const onContextMenu = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (e.defaultPrevented || shouldKeepNativeMenu(target)) return;
      if (!target?.closest("main")) return;

      const sel = window.getSelection();
      const selectionText = sel && !sel.isCollapsed ? sel.toString().trim() : "";

      e.preventDefault();
      haptic("selection");
      setHasSelection(!!selectionText);
      // Clamp with an estimated menu size; the frame below refines it.
      const x = Math.min(e.clientX, window.innerWidth - 230);
      const y = Math.min(e.clientY, window.innerHeight - 210);
      setPos({ x: Math.max(8, x), y: Math.max(8, y) });
      setOpen(true);
    };

    document.addEventListener("contextmenu", onContextMenu);
    return () => document.removeEventListener("contextmenu", onContextMenu);
  }, []);

  // Close on click-away, Escape, scroll, or resize.
  React.useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) close();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    const onScrollOrResize = () => close();
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("scroll", onScrollOrResize, true);
    window.addEventListener("resize", onScrollOrResize);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("scroll", onScrollOrResize, true);
      window.removeEventListener("resize", onScrollOrResize);
    };
  }, [open, close]);

  // Refine the clamped position once the real menu size is known.
  React.useEffect(() => {
    if (!open || !menuRef.current) return;
    const rect = menuRef.current.getBoundingClientRect();
    setPos((p) => ({
      x: Math.max(8, Math.min(p.x, window.innerWidth - rect.width - 8)),
      y: Math.max(8, Math.min(p.y, window.innerHeight - rect.height - 8)),
    }));
  }, [open]);

  const runAction = async (action: () => Promise<void> | void, successKey?: StringKey) => {
    close();
    try {
      await action();
      if (successKey) toast({ title: t(successKey) });
    } catch (err) {
      console.error("[osler/context-menu] action failed:", err);
      toast({ title: t("contextMenu.actionFailed"), variant: "destructive" });
    }
  };

  const copySelection = () =>
    runAction(async () => {
      const text = window.getSelection()?.toString() ?? "";
      await navigator.clipboard.writeText(text);
    }, "contextMenu.copied");

  const copyLink = () =>
    runAction(async () => {
      await navigator.clipboard.writeText(window.location.href);
    }, "contextMenu.linkCopied");

  const share = () =>
    runAction(async () => {
      const article = getArticleViewContext();
      const url = window.location.href;
      if (navigator.share) {
        await navigator.share({ title: article?.title ?? document.title, url });
      } else {
        await navigator.clipboard.writeText(url);
        toast({ title: t("contextMenu.linkCopied") });
      }
    });

  const exportPdf = () =>
    runAction(() => {
      getArticleViewContext()?.requestExportPdf?.();
    });

  const article = open ? getArticleViewContext() : null;
  const canShare = typeof navigator !== "undefined" && "share" in navigator;
  const canExportPdf = !!article?.requestExportPdf;

  const items: Array<{
    key: string;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    onSelect: () => void;
    show: boolean;
    disabled?: boolean;
  }> = [
    { key: "copy", label: t("contextMenu.copy"), icon: Copy, onSelect: copySelection, show: hasSelection },
    { key: "copyLink", label: t("contextMenu.copyLink"), icon: Link2, onSelect: copyLink, show: true },
    { key: "share", label: t("contextMenu.share"), icon: Share2, onSelect: share, show: canShare },
    { key: "exportPdf", label: t("contextMenu.exportPdf"), icon: FileDown, onSelect: exportPdf, show: canExportPdf },
  ];
  const visibleItems = items.filter((item) => item.show);

  return (
    <AnimatePresence>
      {open && visibleItems.length > 0 && (
        <motion.div
          ref={menuRef}
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.96 }}
          transition={MOTION_TRANSITION.fast}
          className="fixed z-[90] min-w-[210px] rounded-xl border border-border bg-popover text-popover-foreground shadow-xl p-1.5"
          style={{ left: pos.x, top: pos.y }}
          role="menu"
          aria-label={t("contextMenu.label")}
          onContextMenu={(e) => e.preventDefault()}
        >
          {visibleItems.map((item) => (
            <button
              key={item.key}
              type="button"
              role="menuitem"
              onClick={() => {
                haptic("light");
                void item.onSelect();
              }}
              className={cn(
                "w-full flex items-center gap-2.5 px-3 h-9 rounded-lg text-sm text-start transition-colors",
                "text-foreground hover:bg-primary/10 hover:text-primary",
              )}
            >
              <item.icon className="size-4 text-muted-foreground" />
              <span className="flex-1">{item.label}</span>
            </button>
          ))}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
