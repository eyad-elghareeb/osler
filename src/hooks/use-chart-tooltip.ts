"use client";

import * as React from "react";
import { haptic } from "@/lib/osler/native";

/**
 * useChartTooltip — pixel-exact tooltip positioning for the activity bar
 * charts (dashboard StreakCard + profile consistency section).
 *
 * WHY MEASURED GEOMETRY, NOT PERCENTAGES
 * ───────────────────────────────────────
 * The chart SVGs use a fixed viewBox (e.g. 280×90) but are stretched to
 * `w-full` with a fixed pixel height. SVG's default `preserveAspectRatio`
 * is `xMidYMid meet`, so the bars only occupy a horizontally-centered slab
 * of the rendered width on wide viewports — there is always letterboxing.
 * Any `left: X%` math derived from viewBox coordinates is therefore wrong:
 * it assumes the bars span the full container. This hook instead measures
 * the SVG's actual rendered bounding box on hover and converts the bar's
 * viewBox center into real pixels relative to the wrapper, so the tooltip
 * lands exactly above the hovered bar on every screen size.
 *
 * The tooltip is then clamped (using its measured width) so it never pokes
 * out of the chart on the first/last bars.
 */

export interface ChartTooltipGeometry {
  chartW: number;
  chartH: number;
  barW: number;
  barGap: number;
}

export function useChartTooltip(geometry: ChartTooltipGeometry) {
  const wrapRef = React.useRef<HTMLDivElement>(null);
  const svgRef = React.useRef<SVGSVGElement>(null);
  const tipRef = React.useRef<HTMLDivElement>(null);
  const [hovered, setHovered] = React.useState<number | null>(null);
  const [left, setLeft] = React.useState(0);

  const geometryRef = React.useRef(geometry);
  geometryRef.current = geometry;

  const updatePosition = React.useCallback(() => {
    const wrap = wrapRef.current;
    const svg = svgRef.current;
    const tip = tipRef.current;
    if (!wrap || !svg || !tip || hovered === null) return;

    const { chartW, chartH, barW, barGap } = geometryRef.current;
    const wrapRect = wrap.getBoundingClientRect();
    const svgRect = svg.getBoundingClientRect();

    // Uniform scale + letterbox offsets from SVG's `meet` fit.
    const scale = Math.min(svgRect.width / chartW, svgRect.height / chartH);
    const contentW = chartW * scale;
    const contentLeft = svgRect.left + (svgRect.width - contentW) / 2;

    const centerX = hovered * (barW + barGap) + barW / 2;
    const px = contentLeft + centerX * scale - wrapRect.left;

    const halfTip = tip.offsetWidth / 2;
    setLeft(Math.max(halfTip, Math.min(wrapRect.width - halfTip, px)));
  }, [hovered]);

  React.useLayoutEffect(() => {
    updatePosition();
  }, [hovered, updatePosition]);

  const show = React.useCallback((i: number) => {
    haptic("selection");
    setHovered(i);
  }, []);

  const hide = React.useCallback(() => setHovered(null), []);

  return { wrapRef, svgRef, tipRef, hovered, left, show, hide };
}
