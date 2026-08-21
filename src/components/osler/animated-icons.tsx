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
 * Flickering flame — sways around its base while an inner layer pulses,
 * like real fire. Each layer loops on its own period (both close their
 * keyframe cycle, so the repeat never jumps) and the mismatch between the
 * two periods keeps the combined motion organic.
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
      animate={active ? { rotate: [-4, 4, -4] } : undefined}
      transition={active ? { duration: 1.8, repeat: Infinity, ease: "easeInOut" } : undefined}
    >
      <motion.span
        className="inline-flex"
        style={{ transformOrigin: "50% 88%" }}
        animate={
          active
            ? { scaleY: [1, 1.08, 0.98, 1], scaleX: [1, 0.97, 1.03, 1] }
            : undefined
        }
        transition={
          active
            ? { duration: 2.6, repeat: Infinity, ease: "easeInOut" }
            : undefined
        }
      >
        <Flame className={cn(className)} />
      </motion.span>
    </motion.span>
  );
}
