"use client";

import React from "react";
import { motion, useReducedMotion } from "framer-motion";
import { ThinkingOrb, type OrbSize, type OrbState } from "thinking-orbs";
import { cn } from "@/lib/utils";
import { MOTION_TRANSITION } from "@/lib/osler/motion";

export interface ThinkingPhase {
  label: string;
  state: OrbState;
}

export function ThinkingStatus({
  phases,
  size = 20,
  interval = 1600,
  className,
  labelClassName,
}: {
  phases: ThinkingPhase[];
  size?: OrbSize;
  interval?: number;
  className?: string;
  labelClassName?: string;
}) {
  const reduce = useReducedMotion();
  const [idx, setIdx] = React.useState(0);
  const active = phases[Math.min(idx, phases.length - 1)] ?? phases[0];

  React.useEffect(() => {
    if (phases.length <= 1) return;
    const id = setInterval(() => setIdx((i) => (i + 1) % phases.length), interval);
    return () => clearInterval(id);
  }, [phases.length, interval]);

  return (
    <span className={cn("inline-flex items-center gap-1.5", className)}>
      <ThinkingOrb state={active.state} size={size} aria-hidden="true" />
      {/* Enter-only label rotation: mode="wait" faded the old label out
          before fading the new one in, leaving a visible text gap every
          interval tick while the orb kept pulsing. The swap is instant and
          only the incoming label fades. */}
      <motion.span
        key={idx}
        initial={reduce ? false : { opacity: 0, y: 3 }}
        animate={{ opacity: 1, y: 0 }}
        transition={MOTION_TRANSITION.quick}
        className={cn("text-muted-foreground", labelClassName)}
      >
        {active.label}
      </motion.span>
    </span>
  );
}
