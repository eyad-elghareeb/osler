"use client";

import * as React from "react";
import { ChevronDown, type LucideIcon } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import { haptic } from "@/lib/osler/native";
import { MOTION_TRANSITION } from "@/lib/osler/motion";

interface AnalyticsCollapsibleSectionProps {
  id: string;
  icon?: LucideIcon;
  iconColor?: string;
  title: React.ReactNode;
  description?: React.ReactNode;
  badge?: React.ReactNode;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
  headerActions?: React.ReactNode;
  className?: string;
}

export function AnalyticsCollapsibleSection({
  id,
  icon: Icon,
  iconColor,
  title,
  description,
  badge,
  open,
  onToggle,
  children,
  headerActions,
  className,
}: AnalyticsCollapsibleSectionProps) {
  const handleToggle = React.useCallback(() => {
    haptic("selection");
    onToggle();
  }, [onToggle]);

  return (
    <div
      id={`analytics-section-${id}`}
      className={cn(
        "rounded-xl border border-border bg-card transition-colors shadow-xs overflow-hidden",
        className
      )}
    >
      {/* Header bar */}
      <div
        role="button"
        tabIndex={0}
        aria-expanded={open}
        aria-controls={`analytics-content-${id}`}
        onClick={handleToggle}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            handleToggle();
          }
        }}
        className="w-full flex items-center justify-between gap-3 p-4 select-none cursor-pointer hover:bg-muted/40 transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
      >
        <div className="flex items-center gap-3 min-w-0 flex-1">
          {Icon && (
            <div
              className="size-9 rounded-lg flex items-center justify-center shrink-0 border"
              style={{
                backgroundColor: `color-mix(in oklch, ${iconColor ?? "var(--primary)"} 12%, transparent)`,
                borderColor: `color-mix(in oklch, ${iconColor ?? "var(--primary)"} 30%, transparent)`,
                color: iconColor ?? "var(--primary)",
              }}
            >
              <Icon className="size-4.5" />
            </div>
          )}
          <div className="min-w-0 flex-1 text-left rtl:text-right">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-semibold tracking-tight text-foreground">{title}</h2>
              {badge && <div className="flex items-center gap-1.5">{badge}</div>}
            </div>
            {description && (
              <p className="text-xs text-muted-foreground line-clamp-1 mt-0.5">{description}</p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {headerActions && (
            <div
              onClick={(e) => e.stopPropagation()}
              className="flex items-center gap-2"
            >
              {headerActions}
            </div>
          )}
          <motion.div
            animate={{ rotate: open ? 180 : 0 }}
            transition={MOTION_TRANSITION.base}
            className="text-muted-foreground p-1 rounded-md hover:bg-muted"
          >
            <ChevronDown className="size-4" />
          </motion.div>
        </div>
      </div>

      {/* Animated content body */}
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            id={`analytics-content-${id}`}
            key="content"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
          >
            <div className="border-t border-border/70 p-4 md:p-5 bg-card/50">
              {children}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
