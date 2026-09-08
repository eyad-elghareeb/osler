"use client";

/**
 * Animated icon set — lucide icons with purposeful, always-on motion for
 * moments that deserve a living feel (streak flames, timers). All motion is
 * framer-motion driven so the global MotionConfig (animations toggle +
 * prefers-reduced-motion) disables it in one place.
 */

import { motion } from "framer-motion";
import { Flame } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Flickering flame — a single gentle sway around its base with a faint
 * inner flicker on the same period, like a candle in still air. Both
 * layers share one period so they never beat against each other, and the
 * amplitudes stay small (±2.5°, ≤4% stretch) so the icon reads as alive
 * rather than wobbling.
 */
export function AnimatedFlame({
  className,
  active = true,
}: {
  className?: string;
  active?: boolean;
}) {
  return (
    <motion.span
      className="inline-flex"
      style={{ transformOrigin: "50% 88%" }}
      animate={active ? { rotate: [-2.5, 2.5, -2.5] } : undefined}
      transition={active ? { duration: 2.8, repeat: Infinity, ease: "easeInOut" } : undefined}
    >
      <motion.span
        className="inline-flex"
        style={{ transformOrigin: "50% 88%" }}
        animate={
          active
            ? { scaleY: [1, 1.04, 1], scaleX: [1, 0.99, 1] }
            : undefined
        }
        transition={
          active
            ? { duration: 2.8, repeat: Infinity, ease: "easeInOut" }
            : undefined
        }
      >
        <Flame className={cn(className)} />
      </motion.span>
    </motion.span>
  );
}
