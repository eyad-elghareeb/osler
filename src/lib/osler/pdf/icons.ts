/**
 * Vector icon strokes — check / cross / pulse mark drawn with hairline
 * vector paths, never Unicode glyphs (core PDF fonts lack them).
 */
import type { jsPDF } from "jspdf";
import type { RGB } from "./tokens";

export function drawCheck(doc: jsPDF, cx: number, cy: number, s: number, color: RGB): void {
  doc.setDrawColor(...color);
  doc.setLineWidth(Math.max(0.35, s * 0.22));
  doc.setLineCap(1);
  doc.line(cx - s * 0.5, cy + s * 0.02, cx - s * 0.12, cy + s * 0.42);
  doc.line(cx - s * 0.12, cy + s * 0.42, cx + s * 0.55, cy - s * 0.42);
  doc.setLineCap(0);
}

export function drawCross(doc: jsPDF, cx: number, cy: number, s: number, color: RGB): void {
  doc.setDrawColor(...color);
  doc.setLineWidth(Math.max(0.35, s * 0.2));
  doc.setLineCap(1);
  doc.line(cx - s * 0.4, cy - s * 0.4, cx + s * 0.4, cy + s * 0.4);
  doc.line(cx - s * 0.4, cy + s * 0.4, cx + s * 0.4, cy - s * 0.4);
  doc.setLineCap(0);
}

/** A small drawn pulse/heartbeat line inside a hairline circle — Osler's mark. */
export function drawPulseMark(doc: jsPDF, cx: number, cy: number, r: number, ring: RGB, line: RGB): void {
  doc.setDrawColor(...ring);
  doc.setLineWidth(Math.max(0.3, r * 0.045));
  doc.circle(cx, cy, r, "S");
  const w = r * 1.05;
  const pts: [number, number][] = [
    [cx - w, cy],
    [cx - w * 0.5, cy],
    [cx - w * 0.24, cy - r * 0.7],
    [cx + w * 0.02, cy + r * 0.7],
    [cx + w * 0.28, cy - r * 0.32],
    [cx + w * 0.5, cy],
    [cx + w, cy],
  ];
  doc.setDrawColor(...line);
  doc.setLineWidth(Math.max(0.35, r * 0.065));
  doc.setLineCap(1);
  doc.setLineJoin(1);
  for (let i = 0; i < pts.length - 1; i++) {
    doc.line(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]);
  }
  doc.setLineCap(0);
  doc.setLineJoin(0);
}

