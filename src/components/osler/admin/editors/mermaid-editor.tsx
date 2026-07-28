"use client";

/**
 * Mermaid modal editor — React port of
 * tauri-admin/frontend/views/mermaid-editor.js.
 *
 * Lazy-loads mermaid from the npm dep (no CDN). Three-column layout:
 *   left   — template / diagram-type picker
 *   center — monospace textarea for source
 *   right  — live-rendered SVG preview (debounced 500ms)
 */

import * as React from "react";
import {
  X,
  Check,
  Loader2,
  AlertTriangle,
  Workflow,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useI18n } from "@/components/osler/i18n-provider";

// ── Diagram templates ──────────────────────────────────────────────────────

interface Template {
  label: string;
  code: string;
}

const TEMPLATE_GROUPS: Array<{ group: string; items: Template[] }> = [
  {
    group: "Flow",
    items: [
      {
        label: "Flowchart",
        code: `flowchart TD
    A([Start]) --> B{Decision?}
    B -- Yes --> C[Process A]
    B -- No  --> D[Process B]
    C --> E([End])
    D --> E`,
      },
      {
        label: "Sequence",
        code: `sequenceDiagram
    participant Patient
    participant Doctor
    Patient->>Doctor: Presents with symptoms
    Doctor->>Doctor: Examines patient
    Doctor-->>Patient: Diagnosis & treatment plan`,
      },
      {
        label: "State",
        code: `stateDiagram-v2
    [*] --> Idle
    Idle --> Running : start
    Running --> Paused : pause
    Paused --> Running : resume
    Running --> [*] : stop`,
      },
    ],
  },
  {
    group: "Structural",
    items: [
      {
        label: "Class",
        code: `classDiagram
    class Patient {
        +String name
        +int age
        +diagnose()
    }
    class Doctor {
        +String specialty
        +treat(Patient p)
    }
    Doctor "1" --> "*" Patient : treats`,
      },
      {
        label: "Entity-Relation",
        code: `erDiagram
    PATIENT ||--o{ VISIT : has
    VISIT }o--|| DOCTOR : "seen by"
    VISIT {
        string date
        string notes
    }`,
      },
    ],
  },
  {
    group: "Planning",
    items: [
      {
        label: "Gantt",
        code: `gantt
    title Project Timeline
    dateFormat YYYY-MM-DD
    section Phase 1
    Research    :a1, 2024-01-01, 14d
    Analysis    :after a1, 7d
    section Phase 2
    Development :2024-01-22, 21d`,
      },
      {
        label: "Timeline",
        code: `timeline
    title Medical History
    2020 : Hypertension diagnosed
         : Started antihypertensives
    2022 : Developed T2DM
    2024 : Cardiac event
         : Stenting performed`,
      },
      {
        label: "Journey",
        code: `journey
    title Patient Journey
    section Presentation
        Symptom onset : 3 : Patient
        GP visit      : 5 : Patient, GP
    section Investigation
        Blood tests   : 4 : GP, Lab
        Imaging       : 4 : Radiologist`,
      },
    ],
  },
  {
    group: "Data",
    items: [
      {
        label: "Pie chart",
        code: `pie title Aetiology of Stroke
    "Ischaemic (thrombotic)"  : 40
    "Ischaemic (embolic)"     : 30
    "Ischaemic (lacunar)"     : 15
    "Haemorrhagic"            : 10
    "Other / unknown"         : 5`,
      },
      {
        label: "Mindmap",
        code: `mindmap
  root((Hypertension))
    Causes
      Primary
      Secondary
        Renal
        Endocrine
    Complications
      Stroke
      MI
      CKD
    Management
      Lifestyle
      Pharmacology`,
      },
    ],
  },
];

const DIAGRAM_LABELS: Record<string, string> = {
  flowchart: "Flowchart",
  graph: "Flowchart",
  sequencediagram: "Sequence",
  statediagram: "State",
  "statediagram-v2": "State",
  classdiagram: "Class",
  erdiagram: "ER Diagram",
  gantt: "Gantt",
  timeline: "Timeline",
  journey: "Journey",
  pie: "Pie Chart",
  mindmap: "Mindmap",
  gitgraph: "Git Graph",
  xychart: "XY Chart",
  quadrantchart: "Quadrant",
  block: "Block",
  sankey: "Sankey",
};

function detectDiagramType(code: string): string {
  const first = (code || "").trim().split("\n")[0].trim().toLowerCase().split(/\s/)[0];
  return DIAGRAM_LABELS[first] ?? "Diagram";
}

function getTheme(): "default" | "dark" {
  if (typeof document === "undefined") return "default";
  return document.documentElement.classList.contains("dark") ? "dark" : "default";
}

// ── Mermaid lazy loader ────────────────────────────────────────────────────

let mermaidPromise: Promise<typeof import("mermaid")> | null = null;

function loadMermaid(): Promise<typeof import("mermaid")> {
  if (!mermaidPromise) {
    mermaidPromise = import("mermaid").then((mod) => {
      const m = mod.default;
      m.initialize({
        startOnLoad: false,
        theme: getTheme(),
        securityLevel: "loose",
        fontFamily: "var(--font-sans, Geist, system-ui, sans-serif)",
      });
      return mod;
    });
  }
  return mermaidPromise;
}

// ── Component ──────────────────────────────────────────────────────────────

export interface MermaidEditorModalProps {
  open: boolean;
  initialCode: string;
  onSave: (code: string) => void;
  onClose: () => void;
}

export function MermaidEditorModal({ open, initialCode, onSave, onClose }: MermaidEditorModalProps) {
  const { t } = useI18n();
  const [code, setCode] = React.useState(initialCode || "graph TD\n  A --> B");
  const [svg, setSvg] = React.useState<string>("");
  const [error, setError] = React.useState<string>("");
  const [loading, setLoading] = React.useState(false);
  const renderIdRef = React.useRef(0);

  // Reset code when modal opens
  React.useEffect(() => {
    if (open) {
      setCode(initialCode || "graph TD\n  A --> B");
      setError("");
      setSvg("");
    }
  }, [open, initialCode]);

  // Keyboard shortcuts (Esc to close, Ctrl+S to save)
  React.useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); onClose(); }
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        onSave(code.trim());
        onClose();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, code, onSave, onClose]);

  // Debounced render
  React.useEffect(() => {
    if (!open) return;
    const id = ++renderIdRef.current;
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const mod = await loadMermaid();
        const m = mod.default;
        m.initialize({
          startOnLoad: false,
          theme: getTheme(),
          securityLevel: "loose",
          fontFamily: "var(--font-sans, Geist, system-ui, sans-serif)",
        });
        const renderId = `mermaid-admin-${id}-${Date.now()}`;
        const { svg: out } = await m.render(renderId, code.trim() || "graph TD\n  A --> B");
        if (id === renderIdRef.current) {
          setSvg(out);
          setError("");
        }
        // Clean up any leftover DOM node mermaid may have created on error
        document.getElementById(renderId)?.remove();
      } catch (err: any) {
        if (id === renderIdRef.current) {
          setError(String(err?.message ?? err ?? "Parse error").replace(/\u001b\[[0-9;]*m/g, "").slice(0, 300));
          setSvg("");
        }
      } finally {
        if (id === renderIdRef.current) setLoading(false);
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [code, open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] bg-background/80 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-7xl h-[90vh] bg-card border border-border rounded-xl shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border bg-muted/30">
          <Workflow className="size-5 text-primary" />
          <span className="font-semibold">{t("admin.mermaid.editDiagram")}</span>
          <span className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/30">
            {detectDiagramType(code)}
          </span>
          <div className="ms-auto">
            <Button variant="ghost" size="iconSm" onClick={onClose} aria-label={t("common.close")}>
              <X className="size-4" />
            </Button>
          </div>
        </div>

        {/* Layout */}
        <div className="flex-1 min-h-0 grid grid-cols-[200px_1fr_1fr] divide-x divide-border">
          {/* Sidebar — templates */}
          <div className="overflow-y-auto medos-scroll-y p-3 bg-muted/10">
            <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
              {t("admin.mermaid.templates")}
            </div>
            {TEMPLATE_GROUPS.map((g) => (
              <div key={g.group} className="mb-3">
                <div className="text-xs font-bold text-foreground/80 mb-1">{g.group}</div>
                <div className="space-y-1">
                  {g.items.map((t) => (
                    <button
                      key={t.label}
                      type="button"
                      onClick={() => setCode(t.code.trim())}
                      className="w-full text-start px-2 py-1.5 rounded text-xs hover:bg-primary/10 hover:text-primary border border-transparent hover:border-primary/30 transition-colors"
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {/* Center — source */}
          <div className="flex flex-col min-h-0">
            <div className="px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground border-b border-border bg-muted/10">
              {t("admin.mermaid.source")}
            </div>
            <textarea
              value={code}
              onChange={(e) => setCode(e.target.value)}
              spellCheck={false}
              placeholder="graph TD\n  A --> B"
              className="flex-1 min-h-0 w-full p-3 font-mono text-sm bg-transparent resize-none focus:outline-none border-0"
            />
            {error && (
              <div className="px-3 py-2 border-t border-destructive/30 bg-destructive/10 text-xs text-destructive flex items-start gap-2">
                <AlertTriangle className="size-3.5 mt-0.5 shrink-0" />
                <span className="break-words">{error}</span>
              </div>
            )}
          </div>

          {/* Right — preview */}
          <div className="flex flex-col min-h-0">
            <div className="px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground border-b border-border bg-muted/10">
              {t("admin.mermaid.preview")}
            </div>
            <div className="flex-1 min-h-0 overflow-auto medos-scroll-y p-4 flex items-center justify-center">
              {loading ? (
                <div className="text-muted-foreground flex items-center gap-2 text-sm">
                  <Loader2 className="size-4 animate-spin" /> {t("admin.mermaid.rendering")}
                </div>
              ) : svg ? (
                <div
                  className="mermaid-preview w-full flex items-center justify-center [&_svg]:max-w-full [&_svg]:h-auto"
                  dangerouslySetInnerHTML={{ __html: svg }}
                />
              ) : (
                <div className="text-muted-foreground text-sm">{t("admin.mermaid.fixSource")}</div>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center gap-3 px-4 py-3 border-t border-border bg-muted/30">
          <span className="text-xs text-muted-foreground">{t("admin.mermaid.shortcuts")}</span>
          <div className="ms-auto flex items-center gap-2">
            <Button variant="ghost" onClick={onClose}>{t("common.cancel")}</Button>
            <Button onClick={() => { onSave(code.trim()); onClose(); }}>
              <Check className="size-4 me-1.5" /> {t("admin.mermaid.saveDiagram")}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Convenience hook for opening the Mermaid modal from any component.
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
