"use client";

import dynamic from "next/dynamic";
import { Loader2 } from "lucide-react";

/**
 * Lazy-loaded heavy on-demand surfaces. Each of these is conditionally
 * mounted (modal, sheet, dialog) or only needed by one engine, so they get
 * their own chunk and load when first opened instead of shipping with the
 * app shell. Fallbacks render nothing for overlays — the chunk arrives
 * before the open animation completes — or a small spinner for inline
 * editors where blank space would look broken.
 */

const nullFallback = () => null;

const spinnerFallback = () => (
  <div className="flex items-center justify-center py-8">
    <Loader2 className="size-5 animate-spin text-muted-foreground" />
  </div>
);

export const AiAssistant = dynamic(
  () => import("@/components/osler/ai-assistant").then((m) => ({ default: m.AiAssistant })),
  { ssr: false, loading: nullFallback },
);

export const CalculatorModal = dynamic(
  () => import("@/components/osler/calculator").then((m) => ({ default: m.CalculatorModal })),
  { ssr: false, loading: nullFallback },
);

export const LabValuesSidebar = dynamic(
  () => import("@/components/osler/lab-values").then((m) => ({ default: m.LabValuesSidebar })),
  { ssr: false, loading: nullFallback },
);

export const NotesPanel = dynamic(
  () => import("@/components/osler/notes-panel").then((m) => ({ default: m.NotesPanel })),
  { ssr: false, loading: nullFallback },
);

export const QuizSettingsPanel = dynamic(
  () => import("@/components/osler/quiz-settings-panel").then((m) => ({ default: m.QuizSettingsPanel })),
  { ssr: false, loading: nullFallback },
);

export const FloatingArticleModal = dynamic(
  () => import("@/components/osler/article-modal").then((m) => ({ default: m.FloatingArticleModal })),
  { ssr: false, loading: nullFallback },
);

export const SessionStartDialog = dynamic(
  () => import("@/components/osler/session-start-dialog").then((m) => ({ default: m.SessionStartDialog })),
  { ssr: false, loading: nullFallback },
);

export const PdfExportDialog = dynamic(
  () => import("@/components/osler/pdf-export-dialog").then((m) => ({ default: m.PdfExportDialog })),
  { ssr: false, loading: nullFallback },
);

export const MilkdownEditor = dynamic(
  () => import("@/components/osler/milkdown-editor").then((m) => ({ default: m.MilkdownEditor })),
  { ssr: false, loading: spinnerFallback },
);

export const MarkdownPreview = dynamic(
  () => import("@/components/osler/admin/editors/markdown-preview").then((m) => ({ default: m.MarkdownPreview })),
  { ssr: false, loading: spinnerFallback },
);
