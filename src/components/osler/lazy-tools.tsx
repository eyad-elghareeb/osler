"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import { AlertCircle, Loader2 } from "lucide-react";
import { resilientImport } from "@/lib/osler/dynamic-import";
import { useI18n } from "@/components/osler/i18n-provider";

/**
 * Lazy-loaded heavy on-demand surfaces. Each of these is conditionally
 * mounted (modal, sheet, dialog) or only needed by one engine, so they get
 * their own chunk and load when first opened instead of shipping with the
 * app shell. Fallbacks render nothing for overlays — the chunk arrives
 * before the open animation completes — or a small spinner for inline
 * editors where blank space would look broken.
 */

const nullFallback = () => null;

/**
 * Guards every dynamic surface against chunk-load failures (offline first
 * open, stale deploy). next/dynamic can't absorb a rejected loader — the
 * throw happens at render time and, with no error boundary above it, used to
 * unmount the whole tree (the white-screen "crash"). Render a short
 * explanation instead; resilientImport has already retried once by then.
 */
class ChunkBoundary extends React.Component<{ children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? <LazySurfaceFallback /> : this.props.children;
  }
}

function LazySurfaceFallback() {
  const { t } = useI18n();
  return (
    <div className="flex flex-col items-center gap-1.5 py-8 text-center">
      <AlertCircle className="size-6 text-warning" />
      <p className="text-sm font-semibold">{t("offline.surface.title")}</p>
      <p className="max-w-xs text-xs text-muted-foreground">{t("offline.surface.body")}</p>
    </div>
  );
}

function withChunkBoundary<P extends object>(Comp: React.ComponentType<P>): React.ComponentType<P> {
  return function LazySurface(props: P) {
    return (
      <ChunkBoundary>
        <Comp {...props} />
      </ChunkBoundary>
    );
  };
}

const spinnerFallback = () => (
  <div className="flex items-center justify-center py-8">
    <Loader2 className="size-5 animate-spin text-muted-foreground" />
  </div>
);

export const AiAssistant = withChunkBoundary(dynamic(
  () => resilientImport(() => import("@/components/osler/ai-assistant").then((m) => ({ default: m.AiAssistant }))),
  { ssr: false, loading: nullFallback },
));

export const CalculatorModal = withChunkBoundary(dynamic(
  () => resilientImport(() => import("@/components/osler/calculator").then((m) => ({ default: m.CalculatorModal }))),
  { ssr: false, loading: nullFallback },
));

export const LabValuesSidebar = withChunkBoundary(dynamic(
  () => resilientImport(() => import("@/components/osler/lab-values").then((m) => ({ default: m.LabValuesSidebar }))),
  { ssr: false, loading: nullFallback },
));

export const NotesPanel = withChunkBoundary(dynamic(
  () => resilientImport(() => import("@/components/osler/notes-panel").then((m) => ({ default: m.NotesPanel }))),
  { ssr: false, loading: nullFallback },
));

export const QuizSettingsPanel = withChunkBoundary(dynamic(
  () => resilientImport(() => import("@/components/osler/quiz-settings-panel").then((m) => ({ default: m.QuizSettingsPanel }))),
  { ssr: false, loading: nullFallback },
));

export const FloatingArticleModal = withChunkBoundary(dynamic(
  () => resilientImport(() => import("@/components/osler/article-modal").then((m) => ({ default: m.FloatingArticleModal }))),
  { ssr: false, loading: nullFallback },
));

export const SessionStartDialog = withChunkBoundary(dynamic(
  () => resilientImport(() => import("@/components/osler/session-start-dialog").then((m) => ({ default: m.SessionStartDialog }))),
  { ssr: false, loading: nullFallback },
));

export const AutoResumeSessionDialog = withChunkBoundary(dynamic(
  () => resilientImport(() => import("@/components/osler/resume-session-dialog").then((m) => ({ default: m.AutoResumeSessionDialog }))),
  { ssr: false, loading: nullFallback },
));

export const PdfExportDialog = withChunkBoundary(dynamic(
  () => resilientImport(() => import("@/components/osler/pdf-export-dialog").then((m) => ({ default: m.PdfExportDialog }))),
  { ssr: false, loading: nullFallback },
));

export const MilkdownEditor = withChunkBoundary(dynamic(
  () => resilientImport(() => import("@/components/osler/milkdown-editor").then((m) => ({ default: m.MilkdownEditor }))),
  { ssr: false, loading: spinnerFallback },
));

export const MarkdownPreview = withChunkBoundary(dynamic(
  () => resilientImport(() => import("@/components/osler/admin/editors/markdown-preview").then((m) => ({ default: m.MarkdownPreview }))),
  { ssr: false, loading: spinnerFallback },
));

/**
 * Pin every student-facing dynamic surface's chunk into the SW static cache.
 *
 * next/dynamic chunks are discovered only at first open — the route-shell
 * warmer can't see them — so a first open while offline resolves nothing and
 * the modal silently never appears (the null loading fallback renders forever).
 * Importing the modules here fetches the same webpack chunks through the
 * SW's CacheFirst /_next/static/ handler, so one online session makes every
 * later offline open instant. Admin-only editors (Milkdown, MarkdownPreview)
 * are deliberately left out to keep the warm payload small. Fire-and-forget:
 * failures (offline gap, deploy race) just mean the next open retries.
 */
export function warmLazySurfaces(): void {
  void Promise.allSettled([
    import("@/components/osler/calculator"),
    import("@/components/osler/lab-values"),
    import("@/components/osler/notes-panel"),
    import("@/components/osler/quiz-settings-panel"),
    import("@/components/osler/session-start-dialog"),
    import("@/components/osler/article-modal"),
    import("@/components/osler/pdf-export-dialog"),
    import("@/components/osler/ai-assistant"),
  ]);
}
