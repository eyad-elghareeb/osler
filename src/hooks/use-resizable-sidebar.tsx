"use client";

import * as React from "react";

/**
 * Resizable sidebar hook — manages a persisted pixel width for a right-side
 * docked sidebar. Returns the current width (in px) plus handlers for the
 * drag handle. The width is constrained to [min, max] and persisted to
 * localStorage under the given key.
 *
 * Use this with a sidebar that has:
 *   - `position: fixed; right: 0; top: <headerHeight>px; bottom: 0`
 *   - `width: <width>px` set inline (NOT a Tailwind class — we override at runtime)
 *
 * Drag handle should be a 4-6px wide strip on the LEFT edge of the sidebar
 * (since the sidebar docks to the right). Cursor: `col-resize`.
 */
export function useResizableSidebar({
  storageKey,
  defaultWidth = 384,
  minWidth = 280,
  maxWidth = 720,
  disabled = false,
}: {
  storageKey: string;
  defaultWidth?: number;
  minWidth?: number;
  maxWidth?: number;
  disabled?: boolean;
}): {
  width: number | null; // null = use default (no inline style)
  isResizing: boolean;
  onDragHandleMouseDown: (e: React.MouseEvent) => void;
  onDragHandleTouchStart: (e: React.TouchEvent) => void;
  reset: () => void;
} {
  const [width, setWidth] = React.useState<number | null>(() => {
    if (typeof window === "undefined") return null;
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return null;
      const n = parseInt(raw, 10);
      if (isNaN(n)) return null;
      return Math.max(minWidth, Math.min(maxWidth, n));
    } catch {
      return null;
    }
  });
  const [isResizing, setIsResizing] = React.useState(false);
  const dragStateRef = React.useRef<{ startX: number; startWidth: number } | null>(null);

  const clamp = React.useCallback(
    (w: number) => Math.max(minWidth, Math.min(maxWidth, w)),
    [minWidth, maxWidth],
  );

  const persist = React.useCallback(
    (w: number) => {
      try {
        localStorage.setItem(storageKey, String(w));
      } catch {
        /* ignore quota errors */
      }
    },
    [storageKey],
  );

  // Mouse-based resizing
  const onDragHandleMouseDown = React.useCallback(
    (e: React.MouseEvent) => {
      if (disabled) return;
      e.preventDefault();
      e.stopPropagation();
      const startWidth = width ?? defaultWidth;
      dragStateRef.current = { startX: e.clientX, startWidth };
      setIsResizing(true);

      const onMove = (ev: MouseEvent) => {
        if (!dragStateRef.current) return;
        // Right-docked sidebar: dragging LEFT grows the width.
        const delta = dragStateRef.current.startX - ev.clientX;
        const next = clamp(dragStateRef.current.startWidth + delta);
        setWidth(next);
      };
      const onUp = () => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        dragStateRef.current = null;
        setIsResizing(false);
        setWidth((w) => {
          if (w != null) persist(w);
          return w;
        });
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    [disabled, width, defaultWidth, clamp, persist],
  );

  // Touch-based resizing
  const onDragHandleTouchStart = React.useCallback(
    (e: React.TouchEvent) => {
      if (disabled) return;
      e.preventDefault();
      e.stopPropagation();
      const touch = e.touches[0];
      if (!touch) return;
      const startWidth = width ?? defaultWidth;
      dragStateRef.current = { startX: touch.clientX, startWidth };
      setIsResizing(true);

      const onMove = (ev: TouchEvent) => {
        if (!dragStateRef.current) return;
        const t = ev.touches[0];
        if (!t) return;
        const delta = dragStateRef.current.startX - t.clientX;
        const next = clamp(dragStateRef.current.startWidth + delta);
        setWidth(next);
      };
      const onEnd = () => {
        document.removeEventListener("touchmove", onMove);
        document.removeEventListener("touchend", onEnd);
        document.removeEventListener("touchcancel", onEnd);
        dragStateRef.current = null;
        setIsResizing(false);
        setWidth((w) => {
          if (w != null) persist(w);
          return w;
        });
      };
      document.addEventListener("touchmove", onMove, { passive: false });
      document.addEventListener("touchend", onEnd);
      document.addEventListener("touchcancel", onEnd);
    },
    [disabled, width, defaultWidth, clamp, persist],
  );

  // Disable text selection while dragging — prevents the underlying text from
  // being selected as the cursor sweeps across the page.
  React.useEffect(() => {
    if (!isResizing) return;
    const prevUserSelect = document.body.style.userSelect;
    const prevCursor = document.body.style.cursor;
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";
    return () => {
      document.body.style.userSelect = prevUserSelect;
      document.body.style.cursor = prevCursor;
    };
  }, [isResizing]);

  const reset = React.useCallback(() => {
    setWidth(defaultWidth);
    persist(defaultWidth);
  }, [defaultWidth, persist]);

  return {
    width,
    isResizing,
    onDragHandleMouseDown,
    onDragHandleTouchStart,
    reset,
  };
}

/**
 * Drag handle visual element. Sits on the left edge of a right-docked sidebar.
 * Always rendered (even on mobile, where it's harmless because the panel is
 * fullscreen and the handle sits off-screen).
 */
export function SidebarResizeHandle({
  onMouseDown,
  onTouchStart,
  active,
  ariaLabel = "Drag to resize",
}: {
  onMouseDown: (e: React.MouseEvent) => void;
  onTouchStart: (e: React.TouchEvent) => void;
  active?: boolean;
  ariaLabel?: string;
}) {
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={ariaLabel}
      onMouseDown={onMouseDown}
      onTouchStart={onTouchStart}
      onDoubleClick={(e) => {
        // Double-click does nothing here; reset is handled by the consumer.
        e.stopPropagation();
      }}
      className="absolute left-0 top-0 bottom-0 w-1.5 -translate-x-1/2 cursor-col-resize z-[60] group/handle"
      style={{ touchAction: "none" }}
    >
      {/* Visible hit strip — only shows on hover or while dragging */}
      <div
        className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-1 rounded-full transition-colors"
        style={{
          backgroundColor: active
            ? "var(--primary)"
            : "var(--border)",
          opacity: active ? 0.9 : 0,
        }}
      />
      <div
        className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-1.5 rounded-full group-hover/handle:bg-primary/40 transition-colors"
        style={{ opacity: active ? 0 : 1 }}
      />
    </div>
  );
}
