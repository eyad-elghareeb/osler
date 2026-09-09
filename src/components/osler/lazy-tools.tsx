"use client";

import dynamic from "next/dynamic";
import { Loader2 } from "lucide-react";
import { resilientImport } from "@/lib/osler/dynamic-import";

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
  () => resilientImport(() => import("@/components/osler/ai-assistant").then((m) => ({ default: m.AiAssistant }))),
  { ssr: false, loading: nullFallback },
);

export const CalculatorModal = dynamic(
  () => resilientImport(() => import("@/components/osler/calculator").then((m) => ({ default: m.CalculatorModal }))),
  { ssr: false, loading: nullFallback },
);

export const LabValuesSidebar = dynamic(
  () => resilientImport(() => import("@/components/osler/lab-values").then((m) => ({ default: m.LabValuesSidebar }))),
  { ssr: false, loading: nullFallback },
);

export const NotesPanel = dynamic(
  () => resilientImport(() => import("@/components/osler/notes-panel").then((m) => ({ default: m.NotesPanel }))),
  { ssr: false, loading: nullFallback },
);

export const QuizSettingsPanel = dynamic(
  () => resilientImport(() => import("@/components/osler/quiz-settings-panel").then((m) => ({ default: m.QuizSettingsPanel }))),
  { ssr: false, loading: nullFallback },
);

export const FloatingArticleModal = dynamic(
  () => resilientImport(() => import("@/components/osler/article-modal").then((m) => ({ default: m.FloatingArticleModal }))),
  { ssr: false, loading: nullFallback },
);

export const SessionStartDialog = dynamic(
  () => resilientImport(() => import("@/components/osler/session-start-dialog").then((m) => ({ default: m.SessionStartDialog }))),
  { ssr: false, loading: nullFallback },
);

export const PdfExportDialog = dynamic(
  () => resilientImport(() => import("@/components/osler/pdf-export-dialog").then((m) => ({ default: m.PdfExportDialog }))),
  { ssr: false, loading: nullFallback },
);

export const MilkdownEditor = dynamic(
  () => resilientImport(() => import("@/components/osler/milkdown-editor").then((m) => ({ default: m.MilkdownEditor }))),
  { ssr: false, loading: spinnerFallback },
);

export const MarkdownPreview = dynamic(
  () => resilientImport(() => import("@/components/osler/admin/editors/markdown-preview").then((m) => ({ default: m.MarkdownPreview }))),
  { ssr: false, loading: spinnerFallback },
);
