"use client";

/**
 * Mermaid visual diagram editor (flow builder) + shared render helper.
 *
 * This is an osler-adapted port of NoteTool's MermaidMakerGUI — a guided,
 * code-free flow builder: a vertical stack of step cards (start / process /
 * decision / milestone / end) with inline label editing, insert-on-hover
 * between cards, decision branches that connect to any other step, three
 * medical templates plus a blank canvas to start from, a guided hint strip,
 * and a live preview with zoom controls. The generated source is always
 * valid (mermaid does the layout), so the UX is deterministic — no freeform
 * canvas, no fragile graph library.
 *
 * Adaptation notes (vs. the NoteTool original):
 *   • Hardcoded palette colors (`text-emerald-400`, `bg-blue-500/10`,
 *     `--color-sb-*` vars) are mapped to osler semantic tokens
 *     (`text-success` / `text-warning` / `text-destructive` / `text-info`,
 *     `bg-card` / `bg-muted` / `border-border`).
 *   • Every user-facing string goes through `t()` (en + ar).
 *   • The builder round-trips existing diagrams: `parseFlowchart` reads a
 *     flowchart source back into steps (preserving shapes, labels, branch
 *     targets, direction and the `%% title:` comment), so editing an existing
 *     diagram is lossless. Non-flowchart diagrams are flagged with a notice.
 *
 * The `%% title:` comment and the flowchart direction survive save→edit→save
 * round-trips. `renderMermaidToSvg` is shared by the inline editor rendering
 * and this modal's live preview.
 */

import * as React from "react";
import {
  Plus,
  Trash2,
  Save,
  Activity,
  HeartPulse,
  Stethoscope,
  Play,
  CircleDot,
  Diamond,
  Square,
  GitMerge,
  CornerDownRight,
  Check,
  X,
  ArrowRight,
  AlertTriangle,
  Loader2,
  ZoomIn,
  ZoomOut,
  ChevronDown,
  Sparkles,
} from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useI18n } from "@/components/osler/i18n-provider";
import { MOTION_TRANSITION, MOTION_SPRING } from "@/lib/osler/motion";

// ── Data model ─────────────────────────────────────────────────────────────

type StepKind = "start" | "process" | "decision" | "end" | "milestone";

interface FlowStep {
  id: string;
  kind: StepKind;
  label: string;
  /** For decisions: the branches coming out. */
  branches: Branch[];
  /** ID of the next step in the main flow (null = end). */
  nextId: string | null;
  /** Original mermaid shape delimiters — preserved for lossless round-trips. */
  shape?: [string, string];
}

interface Branch {
  id: string;
  label: string;
  /** null = not connected yet. */
  targetId: string | null;
}

const SHAPES: Record<StepKind, [string, string]> = {
  start: ["(", ")"],
  process: ["[", "]"],
  decision: ["{", "}"],
  milestone: ["([", "])"],
  end: ["(", ")"],
};

// ── Step kind config ───────────────────────────────────────────────────────

const STEP_KINDS: { value: StepKind; labelKey: string; medicalKey: string; icon: typeof Play; color: string; bg: string }[] = [
  { value: "start", labelKey: "admin.mermaid.stepStart", medicalKey: "admin.mermaid.stepMedStart", icon: Play, color: "text-success", bg: "bg-success/10" },
  { value: "process", labelKey: "admin.mermaid.stepProcess", medicalKey: "admin.mermaid.stepMedProcess", icon: Square, color: "text-primary", bg: "bg-primary/10" },
  { value: "decision", labelKey: "admin.mermaid.stepDecision", medicalKey: "admin.mermaid.stepMedDecision", icon: Diamond, color: "text-warning", bg: "bg-warning/10" },
  { value: "milestone", labelKey: "admin.mermaid.stepMilestone", medicalKey: "admin.mermaid.stepMedMilestone", icon: CircleDot, color: "text-info", bg: "bg-info/10" },
  { value: "end", labelKey: "admin.mermaid.stepEnd", medicalKey: "admin.mermaid.stepMedEnd", icon: Check, color: "text-destructive", bg: "bg-destructive/10" },
];

function kindCardClass(kind: StepKind): string {
  switch (kind) {
    case "decision": return "border-warning/25 bg-warning/5";
    case "start": return "border-success/25 bg-success/5";
    case "end": return "border-destructive/25 bg-destructive/5";
    case "milestone": return "border-info/25 bg-info/5";
    default: return "border-primary/20 bg-primary/5";
  }
}

function kindChipClass(kind: StepKind): string {
  switch (kind) {
    case "decision": return "bg-warning/10 text-warning";
    case "start": return "bg-success/10 text-success";
    case "end": return "bg-destructive/10 text-destructive";
    default: return "bg-primary/10 text-primary";
  }
}

// ── Presets ────────────────────────────────────────────────────────────────

const PRESETS = [
  { id: "pathway", labelKey: "admin.mermaid.presetPathway", titleKey: "admin.mermaid.presetPathwayTitle", descKey: "admin.mermaid.presetPathwayDesc", icon: HeartPulse, color: "text-destructive", bg: "bg-destructive/10" },
  { id: "algorithm", labelKey: "admin.mermaid.presetAlgorithm", titleKey: "admin.mermaid.presetAlgorithmTitle", descKey: "admin.mermaid.presetAlgorithmDesc", icon: Activity, color: "text-warning", bg: "bg-warning/10" },
  { id: "protocol", labelKey: "admin.mermaid.presetProtocol", titleKey: "admin.mermaid.presetProtocolTitle", descKey: "admin.mermaid.presetProtocolDesc", icon: Stethoscope, color: "text-info", bg: "bg-info/10" },
] as const;

// ── Helpers ────────────────────────────────────────────────────────────────

let _idCounter = 0;
function nextId(): string {
  _idCounter++;
  return `S${_idCounter}`;
}
function nextBranchId(): string {
  return `B${Date.now()}${Math.random().toString(36).slice(2, 5)}`;
}

function stripQuotes(s: string): string {
  return s.trim().replace(/^["']|["']$/g, "");
}

function detectShape(text: string): [string, string] | null {
  const t = text.trim();
  if (t.startsWith("([") && t.endsWith("])")) return SHAPES.milestone;
  if (t.startsWith("(") && t.endsWith(")")) return SHAPES.start;
  if (t.startsWith("{") && t.endsWith("}")) return SHAPES.decision;
  if (t.startsWith("[") && t.endsWith("]")) return SHAPES.process;
  return null;
}

function shapeLabel(shapeStr: string, shape: [string, string]): string {
  return stripQuotes(shapeStr.slice(shape[0].length, -shape[1].length));
}

function kindFromShape(shape: [string, string]): StepKind {
  if (shape[0] === "{") return "decision";
  if (shape[0] === "[") return "process";
  if (shape[0] === "([") return "milestone";
  return "start";
}

function parseNodeRef(ref: string): { id: string; shape: [string, string] | null; label: string } | null {
  const t = ref.trim();
  const m = t.match(/^([A-Za-z0-9_\-]+)\s*([({\[].*[)}\]])\s*$/);
  if (m) {
    const shape = detectShape(m[2]);
    if (!shape) return null;
    return { id: m[1], shape, label: shapeLabel(m[2], shape) };
  }
  if (/^[A-Za-z0-9_\-]+$/.test(t)) return { id: t, shape: null, label: t };
  return null;
}

function matchEdge(line: string): { fromRaw: string; toRaw: string; label: string } | null {
  const t = line.trim();
  let m = t.match(/^(.+?)\s*-->\|([^|]*)\|\s*(.+?)\s*$/);
  if (m) return { fromRaw: m[1], toRaw: m[3], label: stripQuotes(m[2]) };
  m = t.match(/^(.+?)\s*--\s*([^-]+?)\s*-->\s*(.+?)\s*$/);
  if (m) return { fromRaw: m[1], toRaw: m[3], label: stripQuotes(m[2]) };
  m = t.match(/^(.+?)\s*(-->|---|-.->|==>|--o|--x)\s*(.+?)\s*$/);
  if (m) return { fromRaw: m[1], toRaw: m[3], label: "" };
  return null;
}

export interface ParsedFlow {
  steps: FlowStep[];
  title: string;
  direction: string;
}

function extractTitle(lines: string[]): string {
  for (const l of lines) {
    const m = l.trim().match(/^%%\s*title:\s*(.*)$/i);
    if (m) return m[1].trim();
  }
  return "";
}

/**
 * Parse a mermaid flowchart source back into builder steps. Returns null when
 * the source isn't a supported flowchart (different diagram type, subgraphs,
 * unsupported node shapes, branching processes, or unrecognized lines).
 */
export function parseFlowchart(code: string): ParsedFlow | null {
  const raw = (code || "").split("\n");
  const title = extractTitle(raw);
  let body = raw.map((l) => l.replace(/\s*%%.*$/, "").trim()).filter((l) => l && !/^(flowchart|graph)\b/i.test(l));
  if (body.length > 0 && body[0] === "---") {
    const end = body.indexOf("---", 1);
    body = end === -1 ? [] : body.slice(end + 1);
  }
  const dirLine = raw.map((l) => l.trim()).find((l) => /^(flowchart|graph)\s+(TD|TB|LR|RL|BT)\b/i.test(l)) || "";
  const dirMatch = dirLine.match(/^(?:flowchart|graph)\s+(TD|TB|LR|RL|BT)\b/i);
  const direction = dirMatch ? dirMatch[1].toUpperCase() : "TD";
  if (body.some((l) => /^(subgraph|end)\b/i.test(l))) return null;

  const nodes = new Map<string, FlowStep>();
  const order: string[] = [];
  const edges: { from: string; to: string; label: string }[] = [];

  const ensureNode = (id: string, shape: [string, string] | null) => {
    if (nodes.has(id)) return;
    const kind = shape ? kindFromShape(shape) : "process";
    nodes.set(id, { id, kind, label: id, branches: [], nextId: null, shape: shape ?? SHAPES.process });
    order.push(id);
  };

  for (const line of body) {
    if (/-->|---|-\.->|==>|--o|--x/.test(line)) {
      const edge = matchEdge(line);
      if (!edge) return null;
      const f = parseNodeRef(edge.fromRaw);
      const tgt = parseNodeRef(edge.toRaw);
      if (!f || !tgt) return null;
      ensureNode(f.id, f.shape);
      ensureNode(tgt.id, tgt.shape);
      if (f.shape) nodes.get(f.id)!.label = f.label;
      if (tgt.shape) nodes.get(tgt.id)!.label = tgt.label;
      edges.push({ from: f.id, to: tgt.id, label: edge.label });
    } else {
      const decl = line.match(/^([A-Za-z0-9_\-]+)\s*(.*?)\s*$/);
      if (!decl) return null;
      const id = decl[1];
      const shape = decl[2] ? detectShape(decl[2]) : null;
      if (decl[2] && !shape) return null;
      ensureNode(id, shape);
      const node = nodes.get(id)!;
      node.shape = shape ?? node.shape;
      node.label = shape ? shapeLabel(decl[2], shape) : id;
    }
  }

  const incoming = new Map<string, number>();
  const outgoing = new Map<string, string[]>();
  for (const e of edges) {
    outgoing.set(e.from, [...(outgoing.get(e.from) ?? []), e.to]);
    incoming.set(e.to, (incoming.get(e.to) ?? 0) + 1);
  }

  for (const n of nodes.values()) {
    if (n.shape && (n.shape[0] === "(" || n.shape[0] === "([")) {
      const isStart = (incoming.get(n.id) ?? 0) === 0;
      const isEnd = (outgoing.get(n.id)?.length ?? 0) === 0;
      if (isStart) n.kind = "start";
      else if (isEnd) n.kind = "end";
      else if (n.shape[0] === "([") n.kind = "milestone";
      else n.kind = "process";
    }
  }

  for (const n of nodes.values()) {
    const outs = outgoing.get(n.id) ?? [];
    if (n.kind === "decision") {
      for (const to of outs) {
        const e = edges.find((x) => x.from === n.id && x.to === to);
        n.branches.push({ id: nextBranchId(), label: e?.label ?? "", targetId: to });
      }
    } else {
      if (outs.length === 0) n.nextId = null;
      else if (outs.length === 1) n.nextId = outs[0];
      else return null;
    }
  }

  const steps = order.filter((id) => nodes.has(id)).map((id) => nodes.get(id)!);
  return { steps, title, direction };
}

/** Serialize builder steps back into a mermaid flowchart source. */
export function stepsToMermaid(steps: FlowStep[], title = "", direction = "TD"): string {
  const lines: string[] = [];
  if (title.trim()) lines.push(`%% title: ${title.trim()}`);
  lines.push(`flowchart ${direction}`);
  const stepMap = new Map(steps.map((s) => [s.id, s]));
  for (const step of steps) {
    const [open, close] = step.shape ?? SHAPES[step.kind];
    lines.push(`    ${step.id}${open}"${step.label}"${close}`);
  }
  for (const step of steps) {
    if (step.kind === "decision") {
      const anyConnected = step.branches.some((b) => b.targetId && stepMap.has(b.targetId));
      if (!anyConnected && step.nextId && stepMap.has(step.nextId)) {
        lines.push(`    ${step.id} --> ${step.nextId}`);
      }
      for (const branch of step.branches) {
        if (branch.targetId && stepMap.has(branch.targetId)) {
          lines.push(`    ${step.id} -->|"${branch.label}"| ${branch.targetId}`);
        }
      }
    } else if (step.nextId && stepMap.has(step.nextId)) {
      lines.push(`    ${step.id} --> ${step.nextId}`);
    }
  }
  return lines.join("\n");
}

// ── Mermaid lazy loader + render helper ────────────────────────────────────

function getTheme(): "default" | "dark" {
  if (typeof document === "undefined") return "default";
  return document.documentElement.classList.contains("dark") ? "dark" : "default";
}

let mermaidPromise: Promise<typeof import("mermaid")> | null = null;

function loadMermaid(): Promise<typeof import("mermaid")> {
  if (!mermaidPromise) {
    mermaidPromise = import("mermaid").then((mod) => {
      const m = mod.default;
      m.initialize({
        startOnLoad: false,
        theme: getTheme(),
        securityLevel: "strict",
        fontFamily: "var(--font-sans, Geist, system-ui, sans-serif)",
      });
      return mod;
    });
  }
  return mermaidPromise;
}

/**
 * Render mermaid source to an SVG string. Shared by the modal preview and the
 * inline editor rendering. Re-initializes mermaid with the current theme
 * before each render so a theme switch is picked up immediately.
 */
export async function renderMermaidToSvg(code: string): Promise<string> {
  const mod = await loadMermaid();
  const m = mod.default;
  m.initialize({
    startOnLoad: false,
    theme: getTheme(),
    securityLevel: "strict",
    fontFamily: "var(--font-sans, Geist, system-ui, sans-serif)",
  });
  const renderId = `mermaid-render-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  try {
    const { svg } = await m.render(renderId, code.trim() || "graph TD\n  A --> B");
    return svg;
  } finally {
    document.getElementById(renderId)?.remove();
  }
}

// ── Inline editable label ──────────────────────────────────────────────────

function InlineEdit({ value, onChange, className, placeholder, labelKey }: {
  value: string;
  onChange: (v: string) => void;
  className?: string;
  placeholder?: string;
  labelKey: string;
}) {
  const { t } = useI18n();
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(value);
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  const commit = () => {
    if (draft.trim()) onChange(draft.trim());
    else setDraft(value);
    setEditing(false);
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") {
            setDraft(value);
            setEditing(false);
            e.stopPropagation();
          }
        }}
        className={cn("bg-transparent border-b border-primary outline-none text-xs", className)}
        placeholder={placeholder}
      />
    );
  }

  return (
    <span
      className={cn("cursor-text hover:border-b hover:border-primary/30", className)}
      onClick={() => {
        setDraft(value);
        setEditing(true);
      }}
      title={t(labelKey as any)}
    >
      {value}
    </span>
  );
}

// ── Step card in the flow ──────────────────────────────────────────────────

function StepCard({
  step,
  allSteps,
  onUpdate,
  onDelete,
  onAddAfter,
  onSetBranchTarget,
  onAddBranch,
  onRemoveBranch,
  onUpdateBranchLabel,
  isLast,
}: {
  step: FlowStep;
  allSteps: FlowStep[];
  onUpdate: (id: string, patch: Partial<FlowStep>) => void;
  onDelete: (id: string) => void;
  onAddAfter: (afterId: string, kind: StepKind, label: string) => void;
  onSetBranchTarget: (stepId: string, branchId: string, targetId: string | null) => void;
  onAddBranch: (stepId: string) => void;
  onRemoveBranch: (stepId: string, branchId: string) => void;
  onUpdateBranchLabel: (stepId: string, branchId: string, label: string) => void;
  isLast: boolean;
}) {
  const { t } = useI18n();
  const [showInsert, setShowInsert] = React.useState(false);
  const [showBranchTarget, setShowBranchTarget] = React.useState<string | null>(null);
  const kindMeta = STEP_KINDS.find((k) => k.value === step.kind)!;
  const Icon = kindMeta.icon;
  const availableTargets = allSteps.filter((s) => s.id !== step.id);

  return (
    <div className="flex flex-col items-center w-full">
      <div className={cn("w-full rounded-xl border p-3.5 transition-all group relative", kindCardClass(step.kind))}>
        <div className="flex items-center gap-2.5">
          <div className={cn("shrink-0 w-7 h-7 rounded-lg flex items-center justify-center", kindMeta.bg)}>
            <Icon className={cn("w-3.5 h-3.5", kindMeta.color)} />
          </div>
          <div className="flex-1 min-w-0">
            <InlineEdit
              value={step.label}
              onChange={(label) => onUpdate(step.id, { label })}
              className={cn("text-xs font-medium truncate block", step.kind === "decision" ? "text-warning" : "text-foreground")}
              placeholder={t("admin.mermaid.stepNamePlaceholder")}
              labelKey="admin.mermaid.clickToEdit"
            />
            <span className="text-[11px] uppercase tracking-wider font-medium text-muted-foreground">
              {t(kindMeta.medicalKey as any)}
            </span>
          </div>
          <button
            type="button"
            onClick={() => onDelete(step.id)}
            className="shrink-0 w-6 h-6 rounded-md flex items-center justify-center opacity-0 group-hover:opacity-100 text-destructive hover:bg-destructive/10 transition-all"
            title={t("admin.mermaid.deleteStep")}
            aria-label={t("admin.mermaid.deleteStep")}
          >
            <Trash2 className="w-3 h-3" />
          </button>
        </div>

        {step.kind === "decision" && (
          <div className="mt-3 space-y-2 ps-2 border-s-2 border-warning/15">
            {step.branches.map((branch) => (
              <div key={branch.id} className="flex items-center gap-2 group/branch">
                <CornerDownRight className="w-3 h-3 text-warning/40 shrink-0" />
                <InlineEdit
                  value={branch.label}
                  onChange={(label) => onUpdateBranchLabel(step.id, branch.id, label)}
                  className="text-[11px] text-warning font-medium"
                  placeholder={t("admin.mermaid.conditionPlaceholder")}
                  labelKey="admin.mermaid.clickToEdit"
                />
                {branch.targetId ? (
                  <span className="text-[11px] px-1.5 py-0.5 rounded bg-primary/10 text-primary border border-primary/20 truncate max-w-[100px]">
                    {allSteps.find((s) => s.id === branch.targetId)?.label || branch.targetId}
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => setShowBranchTarget(showBranchTarget === branch.id ? null : branch.id)}
                    className="text-[11px] px-1.5 py-0.5 rounded border border-dashed border-border text-muted-foreground hover:text-primary hover:border-primary/30 transition-colors flex items-center gap-0.5"
                  >
                    {t("admin.mermaid.connect")}
                    <ArrowRight className="w-2.5 h-2.5 rtl-flip-x" />
                  </button>
                )}
                {branch.targetId && (
                  <button
                    type="button"
                    onClick={() => onSetBranchTarget(step.id, branch.id, null)}
                    className="w-4 h-4 rounded flex items-center justify-center text-muted-foreground hover:text-destructive opacity-0 group-hover/branch:opacity-100 transition-opacity"
                    title={t("admin.mermaid.disconnect")}
                    aria-label={t("admin.mermaid.disconnect")}
                  >
                    <X className="w-2.5 h-2.5" />
                  </button>
                )}
                {step.branches.length > 2 && (
                  <button
                    type="button"
                    onClick={() => onRemoveBranch(step.id, branch.id)}
                    className="w-4 h-4 rounded flex items-center justify-center text-muted-foreground hover:text-destructive opacity-0 group-hover/branch:opacity-100 transition-opacity"
                    title={t("admin.mermaid.removeBranch")}
                    aria-label={t("admin.mermaid.removeBranch")}
                  >
                    <Trash2 className="w-2.5 h-2.5" />
                  </button>
                )}
              </div>
            ))}
            {step.branches.length < 5 && (
              <button
                type="button"
                onClick={() => onAddBranch(step.id)}
                className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-warning transition-colors ps-5"
              >
                <Plus className="w-2.5 h-2.5" /> {t("admin.mermaid.addBranch")}
              </button>
            )}
          </div>
        )}

        {showBranchTarget && (
          <div className="absolute start-0 end-0 top-full mt-1 z-30 rounded-lg border border-border bg-card shadow-e2 max-h-40 overflow-y-auto osler-scroll-y">
            {availableTargets.length === 0 ? (
              <div className="p-3 text-[11px] text-muted-foreground text-center">{t("admin.mermaid.addMoreStepsFirst")}</div>
            ) : (
              availableTargets.map((target) => (
                <button
                  type="button"
                  key={target.id}
                  onClick={() => {
                    onSetBranchTarget(step.id, showBranchTarget, target.id);
                    setShowBranchTarget(null);
                  }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-xs text-foreground hover:bg-primary/10 hover:text-primary transition-colors text-start"
                >
                  <span className={cn("w-4 h-4 rounded flex items-center justify-center text-[11px] shrink-0", kindChipClass(target.kind))}>
                    {target.id.charAt(0)}
                  </span>
                  <span className="truncate">{target.label}</span>
                </button>
              ))
            )}
          </div>
        )}
      </div>

      {!isLast && (
        <div
          className="relative h-8 w-full flex items-center justify-center"
          onMouseEnter={() => setShowInsert(true)}
          onMouseLeave={() => setShowInsert(false)}
        >
          <div
            className={cn(
              "absolute inset-y-0 start-1/2 w-px -translate-x-1/2 rtl-flip-x transition-colors duration-200",
              showInsert ? "bg-primary/40" : "bg-muted-foreground/25",
            )}
          />
          <AnimatePresence>
            {showInsert && (
              <motion.div
                initial={{ opacity: 0, scale: 0.94, y: -4 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.94, y: -4 }}
                transition={MOTION_SPRING.pop}
                className="relative z-20 flex items-center gap-1.5 py-1.5 px-3 rounded-lg bg-card border border-border shadow-e2"
              >
                {STEP_KINDS.filter((k) => k.value !== "start").map((kind) => {
                  const KIcon = kind.icon;
                  return (
                    <button
                      type="button"
                      key={kind.value}
                      onClick={() => onAddAfter(step.id, kind.value, t(kind.medicalKey as any))}
                      className={cn(
                        "flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium border transition-all whitespace-nowrap",
                        kind.bg,
                        kind.color,
                        "border-border hover:brightness-125",
                      )}
                      title={t("admin.mermaid.insertKind", { kind: t(kind.medicalKey as any) })}
                    >
                      <KIcon className="w-2.5 h-2.5" />
                      {t(kind.medicalKey as any)}
                    </button>
                  );
                })}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}

// ── Main GUI component ─────────────────────────────────────────────────────

export interface MermaidEditorModalProps {
  open: boolean;
  initialCode: string;
  onSave: (code: string) => void;
  onClose: () => void;
}

export function MermaidEditorModal({ open, initialCode, onSave, onClose }: MermaidEditorModalProps) {
  const { t, rtl } = useI18n();

  const buildInitial = React.useCallback(() => {
    if (initialCode.trim()) {
      const parsed = parseFlowchart(initialCode);
      if (parsed) {
        return { steps: parsed.steps, title: parsed.title, direction: parsed.direction, unsupported: false };
      }
      return { steps: makeDefaultSteps(t), title: "", direction: "TD", unsupported: true };
    }
    return { steps: makeDefaultSteps(t), title: "", direction: "TD", unsupported: false };
  }, [initialCode, t]);

  const [state, setState] = React.useState(buildInitial);
  const { steps, title, direction, unsupported } = state;

  const isNewDiagram = !initialCode.trim();
  const [pickedTemplate, setPickedTemplate] = React.useState(!isNewDiagram);
  const [showGuide, setShowGuide] = React.useState(true);
  const [zoom, setZoom] = React.useState(1);
  const [showSyntax, setShowSyntax] = React.useState(false);

  React.useEffect(() => {
    if (open) {
      setState(buildInitial());
      setPickedTemplate(!isNewDiagram);
      setShowGuide(true);
      setZoom(1);
      setShowSyntax(false);
    }
  }, [open, buildInitial, isNewDiagram]);

  const [addingStep, setAddingStep] = React.useState(false);
  const [newStepLabel, setNewStepLabel] = React.useState("");
  const [newStepKind, setNewStepKind] = React.useState<StepKind>("process");
  const addInputRef = React.useRef<HTMLInputElement>(null);
  const scrollRef = React.useRef<HTMLDivElement>(null);

  const generatedCode = React.useMemo(() => stepsToMermaid(steps, title, direction), [steps, title, direction]);

  const [preview, setPreview] = React.useState<string>("");
  const [rendering, setRendering] = React.useState(false);
  const previewSeqRef = React.useRef(0);

  React.useEffect(() => {
    if (!open) return;
    const seq = ++previewSeqRef.current;
    setRendering(true);
    const timer = window.setTimeout(() => {
      void renderMermaidToSvg(generatedCode)
        .then((svg) => {
          if (seq === previewSeqRef.current) setPreview(svg);
        })
        .catch(() => {
          if (seq === previewSeqRef.current) setPreview("");
        })
        .finally(() => {
          if (seq === previewSeqRef.current) setRendering(false);
        });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [generatedCode, open]);

  React.useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        handleSave();
      } else if (e.key === "Escape") {
        const target = e.target as HTMLElement | null;
        if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  });

  const setSteps = (updater: (prev: FlowStep[]) => FlowStep[]) => setState((s) => ({ ...s, steps: updater(s.steps) }));

  const updateStep = React.useCallback((id: string, patch: Partial<FlowStep>) => {
    setSteps((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  }, []);

  const deleteStep = React.useCallback((id: string) => {
    setSteps((prev) =>
      prev
        .filter((s) => s.id !== id)
        .map((s) => {
          if (s.nextId === id) return { ...s, nextId: null };
          if (s.kind === "decision") {
            return { ...s, branches: s.branches.map((b) => (b.targetId === id ? { ...b, targetId: null } : b)) };
          }
          return s;
        }),
    );
  }, []);

  const addAfter = React.useCallback((afterId: string, kind: StepKind, label: string) => {
    const newStep: FlowStep = { id: nextId(), kind, label, branches: [], nextId: null, shape: SHAPES[kind] };
    setSteps((prev) => {
      const idx = prev.findIndex((s) => s.id === afterId);
      if (idx === -1) return prev;
      const afterStep = prev[idx];
      newStep.nextId = afterStep.nextId;
      const updated = [...prev];
      updated[idx] = { ...afterStep, nextId: newStep.id };
      updated.splice(idx + 1, 0, newStep);
      return updated;
    });
  }, []);

  const addStepAtEnd = React.useCallback(() => {
    if (!newStepLabel.trim()) return;
    const newStep: FlowStep = { id: nextId(), kind: newStepKind, label: newStepLabel.trim(), branches: [], nextId: null, shape: SHAPES[newStepKind] };
    if (newStepKind === "decision") {
      newStep.branches = [
        { id: nextBranchId(), label: t("admin.mermaid.presYes"), targetId: null },
        { id: nextBranchId(), label: t("admin.mermaid.presNo"), targetId: null },
      ];
    }
    setSteps((prev) => {
      if (prev.length === 0) return [newStep];
      const lastStep = prev[prev.length - 1];
      const updated = [...prev];
      updated[updated.length - 1] = { ...lastStep, nextId: newStep.id };
      updated.push(newStep);
      return updated;
    });
    setNewStepLabel("");
    setAddingStep(false);
    window.setTimeout(() => {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
    }, 100);
  }, [newStepLabel, newStepKind, t]);

  const setBranchTarget = React.useCallback((stepId: string, branchId: string, targetId: string | null) => {
    setSteps((prev) =>
      prev.map((s) => (s.id !== stepId ? s : { ...s, branches: s.branches.map((b) => (b.id === branchId ? { ...b, targetId } : b)) })),
    );
  }, []);

  const addBranchToStep = React.useCallback((stepId: string) => {
    setSteps((prev) =>
      prev.map((s) => (s.id !== stepId || s.kind !== "decision" ? s : { ...s, branches: [...s.branches, { id: nextBranchId(), label: t("admin.mermaid.branchMaybe"), targetId: null }] })),
    );
  }, [t]);

  const removeBranchFromStep = React.useCallback((stepId: string, branchId: string) => {
    setSteps((prev) =>
      prev.map((s) => (s.id !== stepId ? s : { ...s, branches: s.branches.filter((b) => b.id !== branchId) })),
    );
  }, []);

  const updateBranchLabel = React.useCallback((stepId: string, branchId: string, label: string) => {
    setSteps((prev) =>
      prev.map((s) => (s.id !== stepId ? s : { ...s, branches: s.branches.map((b) => (b.id === branchId ? { ...b, label } : b)) })),
    );
  }, []);

  const loadPreset = React.useCallback(
    (presetId: (typeof PRESETS)[number]["id"]) => {
      const meta = PRESETS.find((p) => p.id === presetId)!;
      _idCounter = 0;
      const s = () => nextId();
      const br = (labelKey: string, target: string): Branch => ({ id: nextBranchId(), label: t(labelKey as any), targetId: target });
      const s1 = s(), s2 = s(), s3 = s(), s4 = s(), s5 = s(), s6 = s();
      let next: FlowStep[] = [];
      if (presetId === "pathway") {
        next = [
          { id: s1, kind: "start", label: t("admin.mermaid.presPatientPresentation"), branches: [], nextId: s2, shape: SHAPES.start },
          { id: s2, kind: "decision", label: t("admin.mermaid.presInitialAssessment"), branches: [br("admin.mermaid.presHighRisk", s3), br("admin.mermaid.presLowRisk", s4)], nextId: null, shape: SHAPES.decision },
          { id: s3, kind: "process", label: t("admin.mermaid.presUrgentIntervention"), branches: [], nextId: s5, shape: SHAPES.process },
          { id: s4, kind: "process", label: t("admin.mermaid.presConservativeManagement"), branches: [], nextId: s5, shape: SHAPES.process },
          { id: s5, kind: "end", label: t("admin.mermaid.presDischargePlan"), branches: [], nextId: null, shape: SHAPES.end },
        ];
      } else if (presetId === "algorithm") {
        next = [
          { id: s1, kind: "start", label: t("admin.mermaid.presSignsSymptoms"), branches: [], nextId: s2, shape: SHAPES.start },
          { id: s2, kind: "decision", label: t("admin.mermaid.presLabResults"), branches: [br("admin.mermaid.presAbnormal", s3), br("admin.mermaid.presNormal", s4)], nextId: null, shape: SHAPES.decision },
          { id: s3, kind: "process", label: t("admin.mermaid.presCtMri"), branches: [], nextId: s4, shape: SHAPES.process },
          { id: s4, kind: "end", label: t("admin.mermaid.presEmpiricalTreatment"), branches: [], nextId: null, shape: SHAPES.end },
        ];
      } else {
        next = [
          { id: s1, kind: "start", label: t("admin.mermaid.presStartProtocol"), branches: [], nextId: s2, shape: SHAPES.start },
          { id: s2, kind: "process", label: t("admin.mermaid.presStabilization"), branches: [], nextId: s3, shape: SHAPES.process },
          { id: s3, kind: "process", label: t("admin.mermaid.presMedication"), branches: [], nextId: s4, shape: SHAPES.process },
          { id: s4, kind: "decision", label: t("admin.mermaid.presResponse"), branches: [br("admin.mermaid.presAdequate", s5), br("admin.mermaid.presInadequate", s6)], nextId: null, shape: SHAPES.decision },
          { id: s5, kind: "process", label: t("admin.mermaid.presMaintenance"), branches: [], nextId: null, shape: SHAPES.process },
          { id: s6, kind: "process", label: t("admin.mermaid.presEscalateTherapy"), branches: [], nextId: s3, shape: SHAPES.process },
        ];
      }
      setState((prev) => ({ ...prev, steps: next, title: t(meta.titleKey), unsupported: false }));
      setPickedTemplate(true);
    },
    [t],
  );

  const startBlank = React.useCallback(() => {
    _idCounter = 0;
    setState((prev) => ({ ...prev, steps: makeDefaultSteps(t), title: "", unsupported: false }));
    setPickedTemplate(true);
  }, [t]);

  const handleSave = () => {
    onSave(stepsToMermaid(steps, title, direction));
    onClose();
  };

  if (!open) return null;

  return (
    <div
      dir={rtl ? "rtl" : "ltr"}
      className="fixed inset-0 z-[100] bg-black/50 flex items-center justify-center p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {isNewDiagram && !pickedTemplate ? (
        <MermaidTemplateGallery onPickPreset={loadPreset} onStartBlank={startBlank} onClose={onClose} />
      ) : (
      <div className="w-full max-w-6xl h-[90vh] bg-card border border-border rounded-xl shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-3 shrink-0 border-b border-border bg-muted/30">
          <div className="w-8 h-8 rounded-xl flex items-center justify-center bg-primary/10 shrink-0">
            <GitMerge className="w-4 h-4 text-primary" />
          </div>
          <div className="min-w-0">
            <h3 className="font-semibold text-sm text-foreground">{t("admin.mermaid.flowBuilder")}</h3>
            <span className="text-[11px] uppercase tracking-wider font-medium text-muted-foreground">
              {t("admin.mermaid.flowBuilderSub")}
            </span>
          </div>
          <div className="ms-auto flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={onClose} className="h-8 px-3">
              {t("common.cancel")}
            </Button>
            <Button size="sm" onClick={handleSave} className="gap-2 h-8 px-3">
              <Save className="h-3.5 w-3.5" /> {isNewDiagram ? t("admin.mermaid.insertDiagram") : t("admin.mermaid.saveDiagram")}
            </Button>
            <div className="w-px h-5 mx-1 bg-border" />
            <button
              type="button"
              onClick={onClose}
              className="shrink-0 w-8 h-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
              title={t("common.close")}
              aria-label={t("common.close")}
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="flex flex-1 overflow-hidden">
          {/* Left panel — flow builder */}
          <div className="w-[300px] sm:w-[340px] shrink-0 flex flex-col min-h-0 border-e border-border bg-muted/10">
            {unsupported && (
              <div className="mx-3 mt-3 px-3 py-2 rounded-lg border border-warning/30 bg-warning/10 text-warning text-[11px] flex items-start gap-2">
                <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                <span className="break-words">{t("admin.mermaid.notSupported")}</span>
              </div>
            )}

            {showGuide && (
              <div className="mx-3 mt-3 px-3 py-2 rounded-lg border border-primary/15 bg-primary/5 relative">
                <button
                  type="button"
                  onClick={() => setShowGuide(false)}
                  className="absolute top-1.5 end-1.5 w-5 h-5 rounded flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
                  title={t("common.close")}
                  aria-label={t("common.close")}
                >
                  <X className="w-3 h-3" />
                </button>
                <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider font-semibold text-primary mb-1">
                  <Sparkles className="w-3 h-3 shrink-0" />
                  {t("admin.mermaid.guideTitle")}
                </div>
                <ul className="text-[11px] text-muted-foreground leading-relaxed space-y-0.5">
                  <li>1. {t("admin.mermaid.guideTip1")}</li>
                  <li>2. {t("admin.mermaid.guideTip2")}</li>
                  <li>3. {t("admin.mermaid.guideTip3")}</li>
                </ul>
              </div>
            )}

            <div className="px-4 pt-3 pb-2.5">
              <span className="text-[11px] uppercase tracking-wider font-medium block mb-1.5 text-muted-foreground">
                {t("admin.mermaid.diagramTitle")}
              </span>
              <Input
                value={title}
                onChange={(e) => setState((s) => ({ ...s, title: e.target.value }))}
                placeholder={t("admin.mermaid.titlePlaceholder")}
                className="h-8 text-xs bg-background border-border"
              />
            </div>

            <div className="mx-4 border-t border-border opacity-40" />

            <div className="flex-1 min-h-0 overflow-y-auto osler-scroll-y">
              <div ref={scrollRef} className="px-4 py-3 space-y-1.5">
                {steps.map((step, idx) => (
                  <StepCard
                    key={step.id}
                    step={step}
                    allSteps={steps}
                    onUpdate={updateStep}
                    onDelete={deleteStep}
                    onAddAfter={addAfter}
                    onSetBranchTarget={setBranchTarget}
                    onAddBranch={addBranchToStep}
                    onRemoveBranch={removeBranchFromStep}
                    onUpdateBranchLabel={updateBranchLabel}
                    isLast={idx === steps.length - 1}
                  />
                ))}

                {!addingStep ? (
                  <div className="flex items-center justify-center pt-4">
                    <button
                      type="button"
                      onClick={() => {
                        setAddingStep(true);
                        window.setTimeout(() => addInputRef.current?.focus(), 50);
                      }}
                      className="flex items-center gap-1.5 px-4 py-2 rounded-xl border border-dashed border-border text-[11px] font-medium text-muted-foreground hover:text-primary hover:border-primary/30 transition-colors"
                    >
                      <Plus className="w-3.5 h-3.5" /> {t("admin.mermaid.addNextStep")}
                    </button>
                  </div>
                ) : (
                  <div className="mt-2 p-3 rounded-xl border border-border bg-card">
                    <div className="flex gap-1.5 mb-2.5 flex-wrap">
                      {STEP_KINDS.filter((k) => k.value !== "start").map((kind) => {
                        const KIcon = kind.icon;
                        return (
                          <button
                            type="button"
                            key={kind.value}
                            onClick={() => setNewStepKind(kind.value)}
                            className={cn(
                              "flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium border transition-all",
                              newStepKind === kind.value
                                ? cn(kind.bg, kind.color, "border-border")
                                : "text-muted-foreground border-border hover:text-foreground",
                            )}
                          >
                            <KIcon className="w-2.5 h-2.5" />
                            {t(kind.medicalKey as any)}
                          </button>
                        );
                      })}
                    </div>
                    <div className="flex gap-1.5">
                      <input
                        ref={addInputRef}
                        value={newStepLabel}
                        onChange={(e) => setNewStepLabel(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") addStepAtEnd();
                          if (e.key === "Escape") {
                            setAddingStep(false);
                            setNewStepLabel("");
                          }
                        }}
                        placeholder={t("admin.mermaid.addStepPlaceholder")}
                        className="flex-1 h-8 px-2.5 rounded-lg text-xs border border-border bg-muted/30 outline-none focus:border-primary/40 min-w-0"
                      />
                      <button
                        type="button"
                        onClick={addStepAtEnd}
                        className="shrink-0 w-8 h-8 rounded-lg bg-primary/10 text-primary hover:bg-primary/20 flex items-center justify-center transition-colors"
                        title={t("admin.mermaid.addStep")}
                        aria-label={t("admin.mermaid.addStep")}
                      >
                        <Check className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setAddingStep(false);
                          setNewStepLabel("");
                        }}
                        className="shrink-0 w-8 h-8 rounded-lg hover:bg-destructive/10 text-muted-foreground hover:text-destructive flex items-center justify-center transition-colors"
                        title={t("common.cancel")}
                        aria-label={t("common.cancel")}
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="px-4 py-2 border-t border-border flex items-center justify-between shrink-0 gap-2">
              <span className="text-[11px] text-muted-foreground tabular-nums">
                {steps.length} {t(steps.length === 1 ? "admin.mermaid.stepSingular" : "admin.mermaid.stepPlural")}
              </span>
              <span className="text-[11px] text-muted-foreground hidden sm:block">{t("admin.mermaid.hint")}</span>
            </div>
          </div>

          {/* Right panel — live preview */}
          <div className="flex-1 flex flex-col min-w-0 bg-background">
            <div className="flex items-center justify-end px-3 py-1.5 shrink-0 border-b border-border gap-1">
              <button
                type="button"
                onClick={() => setZoom((z) => Math.max(0.5, +(z - 0.25).toFixed(2)))}
                className="shrink-0 w-7 h-7 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
                title={t("admin.mermaid.zoomOut")}
                aria-label={t("admin.mermaid.zoomOut")}
              >
                <ZoomOut className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setZoom(1)}
                className="shrink-0 min-w-11 h-7 px-1.5 rounded-md flex items-center justify-center text-[11px] font-medium tabular-nums text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
                title={t("admin.mermaid.zoomReset")}
                aria-label={t("admin.mermaid.zoomReset")}
              >
                {Math.round(zoom * 100)}%
              </button>
              <button
                type="button"
                onClick={() => setZoom((z) => Math.min(2.5, +(z + 0.25).toFixed(2)))}
                className="shrink-0 w-7 h-7 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
                title={t("admin.mermaid.zoomIn")}
                aria-label={t("admin.mermaid.zoomIn")}
              >
                <ZoomIn className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="flex-1 p-3 flex flex-col min-h-0">
              <div className="flex-1 rounded-xl overflow-hidden flex flex-col min-h-0 border border-border bg-muted/20">
                <div className="flex-1 min-h-0 overflow-auto osler-scroll-y p-4 flex items-center justify-center">
                  {rendering ? (
                    <div className="text-muted-foreground flex items-center gap-2 text-sm">
                      <Loader2 className="size-4 animate-spin" /> {t("admin.mermaid.rendering")}
                    </div>
                  ) : preview ? (
                    <div
                      className="w-full flex items-center justify-center"
                      style={{ transform: `scale(${zoom})`, transition: "transform 0.15s ease" }}
                      dangerouslySetInnerHTML={{ __html: preview }}
                    />
                  ) : (
                    <div className="text-muted-foreground text-sm">{t("admin.mermaid.fixSource")}</div>
                  )}
                </div>
              </div>
            </div>

            <div className="mx-3 mb-3 rounded-xl shrink-0 overflow-hidden border border-border bg-muted/10">
              <button
                type="button"
                onClick={() => setShowSyntax((s) => !s)}
                className="w-full flex items-center gap-1.5 px-2.5 py-2 text-[11px] uppercase tracking-wider font-semibold text-muted-foreground hover:text-foreground transition-colors"
              >
                <ChevronDown className={cn("w-3 h-3 transition-transform", showSyntax && "rotate-180")} />
                {t("admin.mermaid.generatedSyntax")}
              </button>
              <AnimatePresence initial={false}>
                {showSyntax && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={MOTION_TRANSITION.quick}
                    className="overflow-hidden"
                  >
                    <code className="text-[11px] font-[var(--font-code)] block whitespace-pre overflow-x-auto px-3 pb-2.5 leading-relaxed text-primary">
                      {generatedCode}
                    </code>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </div>
      </div>
      )}
    </div>
  );
}

function makeDefaultSteps(t: (k: any, p?: any) => string): FlowStep[] {
  const s1 = nextId();
  const s2 = nextId();
  return [
    { id: s1, kind: "start", label: t("admin.mermaid.stepStart"), branches: [], nextId: s2, shape: SHAPES.start },
    { id: s2, kind: "process", label: t("admin.mermaid.defaultInitialStep"), branches: [], nextId: null, shape: SHAPES.process },
  ];
}

interface MermaidTemplateGalleryProps {
  onPickPreset: (id: (typeof PRESETS)[number]["id"]) => void;
  onStartBlank: () => void;
  onClose: () => void;
}

function MermaidTemplateGallery({ onPickPreset, onStartBlank, onClose }: MermaidTemplateGalleryProps) {
  const { t, rtl } = useI18n();

  const blankId = "blank";

  const cards = [
    ...PRESETS.map((p) => ({ id: p.id, icon: p.icon, color: p.color, bg: p.bg, name: t(p.labelKey), desc: t((p.descKey ?? "") as any) })),
    {
      id: blankId,
      icon: Plus,
      color: "text-foreground",
      bg: "bg-muted/60",
      name: t("admin.mermaid.blankCanvas"),
      desc: t("admin.mermaid.blankCanvasDesc"),
    },
  ];

  return (
    <div className="w-full max-w-2xl bg-card border border-border rounded-xl shadow-2xl flex flex-col overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-3 shrink-0 border-b border-border bg-muted/30">
        <div className="w-8 h-8 rounded-xl flex items-center justify-center bg-primary/10 shrink-0">
          <GitMerge className="w-4 h-4 text-primary" />
        </div>
        <div className="min-w-0">
          <h3 className="font-semibold text-sm text-foreground">{t("admin.mermaid.startWithTemplate")}</h3>
          <span className="text-[11px] uppercase tracking-wider font-medium text-muted-foreground">
            {t("admin.mermaid.startWithTemplateSub")}
          </span>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="ms-auto shrink-0 w-8 h-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
          title={t("common.close")}
          aria-label={t("common.close")}
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto osler-scroll-y p-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {cards.map((card, idx) => {
            const CIcon = card.icon;
            return (
              <motion.button
                key={card.id}
                type="button"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ ...MOTION_TRANSITION.quick, delay: idx * 0.05 }}
                onClick={() => (card.id === blankId ? onStartBlank() : onPickPreset(card.id as (typeof PRESETS)[number]["id"]))}
                className="group flex flex-col items-start gap-2.5 p-4 rounded-xl border border-border bg-card text-start hover:border-primary/40 hover:shadow-e2 transition-all"
              >
                <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center transition-transform group-hover:scale-105", card.bg)}>
                  <CIcon className={cn("w-5 h-5", card.color)} />
                </div>
                <div>
                  <div className="text-sm font-semibold text-foreground">{card.name}</div>
                  <div className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{card.desc}</div>
                </div>
                <div className="mt-auto flex items-center gap-1 text-[11px] font-medium uppercase tracking-wider text-primary/80 group-hover:text-primary transition-colors">
                  {t("admin.mermaid.useTemplate")}
                  <ArrowRight className="w-3 h-3 rtl-flip-x" />
                </div>
              </motion.button>
            );
          })}
        </div>
      </div>

      <div className="px-4 py-3 shrink-0 border-t border-border flex items-center justify-between gap-2">
        <span className="text-[11px] text-muted-foreground hidden sm:block">{t("admin.mermaid.hint")}</span>
        <Button variant="outline" size="sm" onClick={onClose} className="h-8 px-3 ms-auto">
          {t("common.cancel")}
        </Button>
      </div>
    </div>
  );
}

/**
 * Convenience hook for opening the Mermaid visual builder from any component.
 * Returns `{ open, openModal, closeModal, modal }` — render `modal` somewhere
 * in your tree to actually display the modal.
 */
export function useMermaidModal() {
  const [open, setOpen] = React.useState(false);
  const [code, setCode] = React.useState("");
  const saveRef = React.useRef<((code: string) => void) | null>(null);

  const openModal = React.useCallback((initialCode: string, onSave: (code: string) => void) => {
    setCode(initialCode);
    saveRef.current = onSave;
    setOpen(true);
  }, []);

  const closeModal = React.useCallback(() => setOpen(false), []);

  const modal = (
    <MermaidEditorModal
      open={open}
      initialCode={code}
      onSave={(c) => saveRef.current?.(c)}
      onClose={closeModal}
    />
  );

  return { open, openModal, closeModal, modal };
}