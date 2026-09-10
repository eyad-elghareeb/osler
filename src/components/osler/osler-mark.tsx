import * as React from "react";

interface OslerMarkProps {
  className?: string;
  title?: string;
  /**
   * `color` (default) — the full app icon: navy gradient tile, subtle
   * medical cross, azure ECG pulse. For hero surfaces (login, boot, welcome).
   * `line` — the ECG pulse alone as a `currentColor` stroke, no tile. For
   * in-chrome spots (top bars, nav) so the mark inherits the theme instead
   * of fighting it.
   */
  variant?: "color" | "line";
}

/**
 * Osler brand mark — derived from the app icon (`public/assets/icon.svg`).
 * Gradient IDs are per-instance (React `useId`) so multiple marks on one
 * page never collide.
 */
export function OslerMark({ className, title, variant = "color" }: OslerMarkProps) {
  const uid = React.useId().replace(/[^a-zA-Z0-9]/g, "");
  const bgId = `osler-mark-bg-${uid}`;
  const accentId = `osler-mark-accent-${uid}`;
  if (variant === "line") {
    return (
      <svg
        viewBox="-200 -120 400 240"
        role="img"
        aria-label={title ?? "Osler"}
        className={className}
        fill="none"
        stroke="currentColor"
        strokeWidth="40"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M -160 0 L -90 0 L -50 -80 L -10 80 L 30 -40 L 70 0 L 160 0" />
      </svg>
    );
  }
  return (
    <svg
      viewBox="0 0 512 512"
      role="img"
      aria-label={title ?? "Osler"}
      className={className}
    >
      <defs>
        <linearGradient id={bgId} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#1e3a8a" />
          <stop offset="100%" stopColor="#0f172a" />
        </linearGradient>
        <linearGradient id={accentId} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#60a5fa" />
          <stop offset="100%" stopColor="#3b82f6" />
        </linearGradient>
      </defs>
      <rect x="0" y="0" width="512" height="512" rx="112" ry="112" fill={`url(#${bgId})`} />
      <g transform="translate(256, 256)">
        <path
          d="M -160 0 L -90 0 L -50 -80 L -10 80 L 30 -40 L 70 0 L 160 0"
          stroke={`url(#${accentId})`}
          strokeWidth="24"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
        <g opacity="0.18" fill="#60a5fa">
          <rect x="-30" y="-110" width="60" height="220" rx="14" />
          <rect x="-110" y="-30" width="220" height="60" rx="14" />
        </g>
      </g>
    </svg>
  );
}
