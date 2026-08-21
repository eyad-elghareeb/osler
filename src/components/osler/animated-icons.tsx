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
 * Flickering flame — sways around its base and pulses scale like real fire.
 * Renders as a static flame when `active` is false or animations are off.
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
      animate={
        active
          ? { rotate: [-4, 3.5, -2.5, 2.5, 0], scaleY: [1, 1.07, 0.97, 1.05, 1] }
          : undefined
      }
      transition={
        active
          ? { duration: 2.2, repeat: Infinity, ease: "easeInOut" }
          : undefined
      }
    >
      <Flame className={cn(className)} />
    </motion.span>
  );
}
