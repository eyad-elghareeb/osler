"use client";

/**
 * ContentContextMenu — app-wide custom right-click / long-press menu for
 * the content area, giving users faster access to the actions that matter
 * while studying: Share, Copy link, and Export PDF (when an article reader
 * that supports it is open) — plus Copy for the current text selection.
 *
 * Deep links: when the event originates inside an element carrying
 * `data-ctx-link` (see `@/lib/osler/deep-link`), "Share" / "Copy link"
 * target that specific content (e.g. `/qbank?uid=…`) instead of the
 * current page, so links open the content directly.
 *
 * Implementation notes:
 *   • Listens for `contextmenu` on document (and synthesizes one from a
 *     500ms touch long-press, which iOS Safari never fires) but only claims
 *     events that originate inside <main>. Native inputs, textareas,
 *     editable surfaces (Milkdown editors) and elements marked
 *     [data-native-context-menu] keep the browser menu.
 *   • "Export PDF" delegates to the article-view registry — see
 *     `article-view-registry.ts` — so it appears only when a reader that
 *     supports it is open.
 *   • The menu renders at z-[100], above every app overlay (dialogs z-50,
 *     article modal z-[60], mermaid viewer z-[80]).
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
import { resolveContentLink, absoluteDeepLink, type ResolvedContentLink } from "@/lib/osler/deep-link";
import { MOTION_TRANSITION } from "@/lib/osler/motion";

/** Keeps the native menu alive for editing surfaces and explicit opt-outs. */
function shouldKeepNativeMenu(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el.closest !== "function") return true;
  return !!el.closest(
    "input, textarea, select, [contenteditable='true'], [data-native-context-menu]",
  );
}

const LONG_PRESS_MS = 500;
const LONG_PRESS_SLOP_PX = 10;

export function ContentContextMenu() {
  const { t } = useI18n();
  const { toast } = useToast();
  const [open, setOpen] = React.useState(false);
  const [pos, setPos] = React.useState({ x: 0, y: 0 });
  const [hasSelection, setHasSelection] = React.useState(false);
  const [contentLink, setContentLink] = React.useState<ResolvedContentLink | null>(null);
  /** Pack/folder uid under the cursor (`data-ctx-export`) — "Export as PDF"
   *  opens the QBank pack export dialog for it via `osler-pack-export-request`. */
  const [exportUid, setExportUid] = React.useState<string | null>(null);
  const menuRef = React.useRef<HTMLDivElement | null>(null);

  const close = React.useCallback(() => setOpen(false), []);

  const openAt = React.useCallback((clientX: number, clientY: number, target: EventTarget | null) => {
    const sel = window.getSelection();
    const selectionText = sel && !sel.isCollapsed ? sel.toString().trim() : "";

    haptic("selection");
    setHasSelection(!!selectionText);
    setContentLink(resolveContentLink(target));
    setExportUid((target as HTMLElement | null)?.closest?.("[data-ctx-export]")?.getAttribute("data-ctx-export") ?? null);
    // Clamp with an estimated menu size; the frame below refines it.
    const x = Math.min(clientX, window.innerWidth - 230);
    const y = Math.min(clientY, window.innerHeight - 210);
    setPos({ x: Math.max(8, x), y: Math.max(8, y) });
    setOpen(true);
  }, []);

  // Claim right-clicks inside the content region.
  React.useEffect(() => {
    const onContextMenu = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (e.defaultPrevented || shouldKeepNativeMenu(target)) return;
      if (!target?.closest("main")) return;

      e.preventDefault();
      openAt(e.clientX, e.clientY, e.target);
    };

    document.addEventListener("contextmenu", onContextMenu);
    return () => document.removeEventListener("contextmenu", onContextMenu);
  }, [openAt]);

  // Touch long-press → same menu (iOS Safari never fires `contextmenu`).
  // The gesture is cancelled by movement (scroll / swipe) or lifting early,
  // and the synthetic click that follows the hold is swallowed so the card
  // underneath doesn't navigate. The swallow self-expires: on Android the
  // native long-press contextmenu means no click follows at all, so the
  // blocker must not eat the user's next deliberate tap.
  React.useEffect(() => {
    let timer: number | null = null;
    let startX = 0;
    let startY = 0;

    const swallowNextClick = () => {
      const block = (e: MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
      };
      document.addEventListener("click", block, { capture: true, once: true });
      window.setTimeout(() => document.removeEventListener("click", block, { capture: true }), 600);
    };

    const clearTimer = () => {
      if (timer !== null) {
        window.clearTimeout(timer);
        timer = null;
      }
    };

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      const target = e.target as HTMLElement | null;
      if (shouldKeepNativeMenu(target) || !target?.closest("main")) return;
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      timer = window.setTimeout(() => {
        timer = null;
        openAt(startX, startY, e.target);
        swallowNextClick();
      }, LONG_PRESS_MS);
    };

    const onTouchMove = (e: TouchEvent) => {
      if (timer === null) return;
      const touch = e.touches[0];
      if (Math.abs(touch.clientX - startX) > LONG_PRESS_SLOP_PX || Math.abs(touch.clientY - startY) > LONG_PRESS_SLOP_PX) {
        clearTimer();
      }
    };

    const onTouchEnd = () => clearTimer();

    document.addEventListener("touchstart", onTouchStart, { passive: true });
    document.addEventListener("touchmove", onTouchMove, { passive: true });
    document.addEventListener("touchend", onTouchEnd);
    document.addEventListener("touchcancel", onTouchEnd);
    return () => {
      clearTimer();
      document.removeEventListener("touchstart", onTouchStart);
      document.removeEventListener("touchmove", onTouchMove);
      document.removeEventListener("touchend", onTouchEnd);
      document.removeEventListener("touchcancel", onTouchEnd);
    };
  }, [openAt]);

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

  const currentLink = () => {
    if (contentLink) return contentLink.href;
    const viewLink = getArticleViewContext()?.link;
    if (viewLink) return absoluteDeepLink(viewLink);
    // Normalize the current URL through absoluteDeepLink so copied links
    // always carry the canonical trailing slash (`/library/?article=…`).
    return absoluteDeepLink(window.location.pathname + window.location.search);
  };
  const currentTitle = () => contentLink?.title ?? getArticleViewContext()?.title ?? document.title;

  const copySelection = () =>
    runAction(async () => {
      const text = window.getSelection()?.toString() ?? "";
      await navigator.clipboard.writeText(text);
    }, "contextMenu.copied");

  const copyLink = () =>
    runAction(async () => {
      await navigator.clipboard.writeText(currentLink());
    }, "contextMenu.linkCopied");

  const share = () =>
    runAction(async () => {
      const url = currentLink();
      const title = currentTitle();
      if (navigator.share) {
        await navigator.share({ title, url });
      } else {
        await navigator.clipboard.writeText(url);
        toast({ title: t("contextMenu.linkCopied") });
      }
    });

  const exportPdf = () =>
    runAction(() => {
      if (exportUid) {
        window.dispatchEvent(new CustomEvent("osler-pack-export-request", { detail: { uid: exportUid } }));
        return;
      }
      getArticleViewContext()?.requestExportPdf?.();
    });

  const article = open ? getArticleViewContext() : null;
  const canShare = typeof navigator !== "undefined" && "share" in navigator;
  const canExportPdf = !!article?.requestExportPdf || !!exportUid;

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
          className="fixed z-[100] min-w-[210px] rounded-xl border border-border bg-popover text-popover-foreground shadow-e4 p-1.5"
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
