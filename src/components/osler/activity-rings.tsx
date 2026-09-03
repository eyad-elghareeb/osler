"use client";

import * as React from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

export interface ActivityRingData {
  /** Label describing the ring (e.g. "Questions", "Correct", "Streak") */
  label: string;
  /** Numerical current value */
  current: number;
  /** Numerical target/max value */
  target: number;
  /** Base stroke color / CSS color or token string, e.g. "var(--primary)" */
  color: string;
  /** Background track color or auto-generated with opacity */
  trackColor?: string;
  /** Formatted display value string */
  displayValue?: string;
  /** Unit suffix e.g. "q", "%", "d" */
  unit?: string;
}

interface ActivityRingsProps {
  rings: [ActivityRingData, ActivityRingData, ActivityRingData];
  size?: number;
  strokeWidth?: number;
  gap?: number;
  className?: string;
  onClick?: () => void;
}

export function ActivityRings({
  rings,
  size = 140,
  strokeWidth = 11,
  gap = 3.5,
  className,
  onClick,
}: ActivityRingsProps) {
  const center = size / 2;

  return (
    <div
      onClick={onClick}
      className={cn(
        "relative select-none shrink-0 flex items-center justify-center",
        onClick && "cursor-pointer group",
        className
      )}
      style={{ width: size, height: size }}
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className="transform -rotate-90 overflow-visible"
        aria-hidden="true"
      >
        <defs>
          <filter id="ring-shadow" x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy="1" stdDeviation="1.5" floodColor="#000" floodOpacity="0.3" />
          </filter>
        </defs>

        {rings.map((ring, idx) => {
          // Radius calculated from outermost (idx 0) to innermost (idx 2)
          const radius = center - strokeWidth / 2 - idx * (strokeWidth + gap);
          if (radius <= 0) return null;

          const circumference = 2 * Math.PI * radius;
          const fraction = ring.target > 0 ? Math.max(0, ring.current / ring.target) : 0;
          // Progress dash offset for the main arc
          const strokeDashoffset = circumference * Math.max(0, 1 - Math.min(1, fraction));
          // If fraction > 1 (goal surpassed), allow extra multi-turn arc with subtle depth
          const overFraction = fraction > 1 ? Math.min(2, fraction) - 1 : 0;
          const overDashoffset = circumference * (1 - overFraction);

          return (
            <g key={ring.label + idx}>
              {/* Background Track */}
              <circle
                cx={center}
                cy={center}
                r={radius}
                fill="none"
                stroke={ring.trackColor || ring.color}
                strokeOpacity={0.16}
                strokeWidth={strokeWidth}
              />

              {/* Main Progress Arc */}
              <motion.circle
                cx={center}
                cy={center}
                r={radius}
                fill="none"
                stroke={ring.color}
                strokeWidth={strokeWidth}
                strokeLinecap="round"
                strokeDasharray={circumference}
                initial={{ strokeDashoffset: circumference }}
                animate={{ strokeDashoffset }}
                transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1], delay: idx * 0.1 }}
              />

              {/* Overachievement Ring Arc (Apple Fitness style overlapping glow) */}
              {overFraction > 0 && (
                <motion.circle
                  cx={center}
                  cy={center}
                  r={radius}
                  fill="none"
                  stroke={ring.color}
                  strokeWidth={strokeWidth}
                  strokeLinecap="round"
                  strokeDasharray={circumference}
                  filter="url(#ring-shadow)"
                  initial={{ strokeDashoffset: circumference }}
                  animate={{ strokeDashoffset: overDashoffset }}
                  transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1], delay: 0.2 + idx * 0.1 }}
                />
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
