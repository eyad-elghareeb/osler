"use client";

import * as React from "react";
import { motion } from "framer-motion";
import { Stethoscope } from "lucide-react";
import type { AnyContent, ContentTreeNode, OsceContent, OsceStation } from "@/lib/osler/types";
import { useTypewriter } from "@/hooks/use-typewriter";
import { AiMarkdown } from "@/components/osler/ai-markdown";
import { MOTION_TRANSITION } from "@/lib/osler/motion";
import { ExamResult, Achievement, isPediatric } from "./gemini";
export function nodeFromPack(item: ContentTreeNode, content: AnyContent) {
  return {
    item: { uid: item.uid, type: item.type, title: item.title, path: item.path } as ContentTreeNode,
    content: content as OsceContent,
  };
}

/* ── Achievements Builder ──────────────────────────────────────────── */

export function buildAchievements(result: ExamResult, timeUsedPct: number, turnCount: number): Achievement[] {
  const b: Achievement[] = [];
  if (result.score >= 80) b.push({ icon: "🌟", label: "Outstanding", desc: "Score ≥ 80", color: "gold" });
  else if (result.score >= 50) b.push({ icon: "✅", label: "Passed", desc: "Station passed", color: "green" });
  if (result.missed.length === 0 && result.asked.length > 0)
    b.push({ icon: "🎯", label: "Full Coverage", desc: "All criteria covered", color: "green" });
  if ((result.domains.communication || 0) >= 22)
    b.push({ icon: "💬", label: "Communicator", desc: "Communication ≥ 22/25", color: "blue" });
  if ((result.domains.professionalism || 0) >= 22)
    b.push({ icon: "🎖", label: "Professional", desc: "Professionalism ≥ 22/25", color: "blue" });
  if ((result.domains.clinicalReasoning || 0) >= 22)
    b.push({ icon: "🧠", label: "Clinician", desc: "Clinical reasoning ≥ 22/25", color: "purple" });
  if ((result.domains.infoGathering || 0) >= 22)
    b.push({ icon: "🔍", label: "Thorough", desc: "Info gathering ≥ 22/25", color: "purple" });
  if (timeUsedPct < 65 && result.score >= 50)
    b.push({ icon: "⚡", label: "Efficient", desc: "Completed quickly", color: "gold" });
  if (turnCount >= 15 && result.score >= 50)
    b.push({ icon: "💪", label: "Persistent", desc: "15+ questions asked", color: "blue" });
  return b;
}

/* ── Confetti ──────────────────────────────────────────────────────── */

/**
 * Canvas 2D `fillStyle` can't resolve CSS custom properties on its own, so
 * confetti previously used a hardcoded hex palette that never matched the
 * active theme (Forest Rounds, Crimson ED, Midnight, etc. all looked
 * identical). Reading the resolved `--chart-1..5` + `--primary` values at
 * trigger time keeps this celebratory, single-focal-moment effect on the
 * same semantic tokens as everything else — see the roadmap's "Tokens and
 * themes" contract.
 */
export function getConfettiColors(): string[] {
  const fallback = ["#f0a500", "#38bdf8", "#2ea043", "#8b5cf6", "#da3633", "#ffffff"];
  if (typeof window === "undefined") return fallback;
  const root = getComputedStyle(document.documentElement);
  const tokens = ["--chart-1", "--chart-2", "--chart-3", "--chart-4", "--chart-5", "--primary"]
    .map((name) => root.getPropertyValue(name).trim())
    .filter(Boolean);
  return tokens.length > 0 ? tokens : fallback;
}

export function launchConfetti() {
  if (typeof window === "undefined") return;
  const canvas = document.createElement("canvas");
  canvas.style.cssText =
    "position:fixed;inset:0;pointer-events:none;z-index:9999;width:100%;height:100%";
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  document.body.appendChild(canvas);
  const ctx = canvas.getContext("2d")!;
  const colors = getConfettiColors();
  const particles = Array.from({ length: 120 }, () => ({
    x: Math.random() * canvas.width,
    y: Math.random() * -canvas.height * 0.5,
    w: 6 + Math.random() * 8,
    h: 3 + Math.random() * 5,
    color: colors[Math.floor(Math.random() * colors.length)],
    vx: (Math.random() - 0.5) * 4,
    vy: 2 + Math.random() * 5,
    rot: Math.random() * 360,
    vrot: (Math.random() - 0.5) * 8,
    alpha: 1,
  }));
  let start: number | null = null;
  function frame(ts: number) {
    if (!start) start = ts;
    const elapsed = ts - start;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    particles.forEach((p) => {
      p.y += p.vy;
      p.x += p.vx;
      p.rot += p.vrot;
      if (elapsed > 2200) p.alpha = Math.max(0, p.alpha - 0.03);
      ctx.save();
      ctx.globalAlpha = p.alpha;
      ctx.translate(p.x, p.y);
      ctx.rotate((p.rot * Math.PI) / 180);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    });
    if (elapsed < 3500) requestAnimationFrame(frame);
    else if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
  }
  requestAnimationFrame(frame);
}

/* ── Speaker Info ──────────────────────────────────────────────────── */

export function getSpeakerName(c: OsceStation): string {
  if (c.type === "data-interp") return c.examiner?.name || "Examiner";
  return c.patient?.name || "Patient";
}

export function getSpeakerGender(c: OsceStation): string {
  if (c.type === "data-interp") return "male";
  if (isPediatric(c.patient.age)) return "female";
  return c.patient.gender;
}

/* ── Streaming reply bubble ────────────────────────────────────────── */

/**
 * Paints an in-flight reply with a typewriter reveal. Network deltas can
 * arrive faster than they can be read — a flash-lite model finishes a
 * short answer in a few hundred ms — so arrival alone doesn't read as
 * "being written". The reveal decouples display from arrival. onSettled
 * fires once the full text is visible: the parent defers committing the
 * message (transcript append, session save, TTS) until then so the
 * bubble never jumps from partial to complete.
 */
export function OsceStreamBubble({
  label,
  text,
  onSettled,
}: {
  label: string;
  text: string;
  onSettled?: () => void;
}) {
  const shown = useTypewriter(text, true);
  const settledRef = React.useRef(false);
  React.useEffect(() => {
    if (!settledRef.current && text && shown === text) {
      settledRef.current = true;
      onSettled?.();
    }
  }, [shown, text, onSettled]);
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={MOTION_TRANSITION.quick}
      className="flex flex-col gap-1 max-w-[80%] md:max-w-[640px] self-start"
    >
      <div className="text-[11px] font-semibold uppercase tracking-wider text-primary/70 flex items-center gap-1">
        <Stethoscope className="size-2.5" />
        {label}
      </div>
      <div
        className="px-3.5 py-2.5 rounded-2xl rounded-tl-sm bg-card border border-border text-sm leading-relaxed shadow-e1"
      >
        <AiMarkdown text={shown} writing={shown.length < text.length} />
      </div>
    </motion.div>
  );
}