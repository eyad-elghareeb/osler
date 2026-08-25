"use client";

import * as React from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { ChevronLeft, ChevronRight, AlertCircle, BarChart3, Phone, PhoneOff, Minimize2, Captions } from "lucide-react";
import type { OsceDataTable, OsceDataImage, OsceDataPresented } from "@/lib/osler/types";
import { cn } from "@/lib/utils";
import { useI18n } from "@/components/osler/i18n-provider";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ThinkingStatus, type ThinkingPhase } from "@/components/osler/thinking-status";
import { type OrbState } from "thinking-orbs";
import FluidOrb from "@/components/ui/fluid-orb";
import { MOTION_TRANSITION } from "@/lib/osler/motion";
import { dataImageUrl } from "./gemini";
/* ── Data Tables Renderer ─────────────────────────────────────────── */

export function DataTablesRenderer({ tables }: { tables?: OsceDataTable[] }) {
  const [open, setOpen] = React.useState(false);
  const { t } = useI18n();
  if (!tables || !tables.length) return null;
  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        className="w-full px-3 py-2 rounded-lg border border-border bg-card text-xs font-medium flex items-center justify-between hover:border-primary/40 transition-colors"
      >
        {t("osce.dataPresented.labData")} <ChevronRight className={cn("size-3.5 transition-transform", open && "rotate-90")} />
      </button>
      {open && (
        <div className="mt-2 space-y-2">
          {tables.map((t, i) => (
            <div key={i} className="bg-muted/20 border border-border rounded-lg p-3 overflow-x-auto">
              {t.title && (
                <div className="text-[10px] font-bold text-primary uppercase tracking-wider mb-1.5">{t.title}</div>
              )}
              <table className="w-full text-[11px]">
                {t.headers && t.headers.length > 0 && (
                  <thead>
                    <tr>
                      {t.headers.map((h, hi) => (
                        <th key={hi} className="text-left px-2 py-1 font-bold text-muted-foreground border-b border-border text-[9px] uppercase tracking-wider">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                )}
                <tbody>
                  {(t.rows || []).map((r, ri) => (
                    <tr key={ri}>
                      {r.map((c, ci) => (
                        <td key={ci} className={cn("px-2 py-1 border-b border-border/20", ci === r.length - 1 ? "font-medium" : "text-muted-foreground")}>
                          {c}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Data Images Renderer ─────────────────────────────────────────── */

export function DataImagesRenderer({
  images,
  packPath = "",
}: {
  images?: OsceDataImage[];
  packPath?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const [viewerIndex, setViewerIndex] = React.useState<number | null>(null);
  const { t } = useI18n();
  if (!images || !images.length) return null;
  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        className="w-full px-3 py-2 rounded-lg border border-border bg-card text-xs font-medium flex items-center justify-between hover:border-primary/40 transition-colors"
      >
        {t("osce.dataPresented.images")} ({images.length})
        <ChevronRight className={cn("size-3.5 transition-transform", open && "rotate-90")} />
      </button>
      {open && (
        <div className="mt-2 space-y-2">
          {images.map((im, i) => {
            const src = dataImageUrl(im, packPath);
            if (!src) return null;
            return (
              <div key={i} className="bg-muted/20 border border-border rounded-lg overflow-hidden">
                {im.title && (
                  <div className="text-[10px] font-bold text-primary uppercase tracking-wider px-3 pt-3">{im.title}</div>
                )}
                <button
                  className="w-full cursor-pointer text-left"
                  onClick={(e) => { e.stopPropagation(); setViewerIndex(i); }}
                >
                  <img src={src} alt={im.alt || im.caption || ""} className="w-full max-h-80 object-contain" loading="lazy" />
                </button>
                {im.caption && (
                  <div className="text-[10px] text-muted-foreground px-3 pb-3 pt-1">{im.caption}</div>
                )}
              </div>
            );
          })}
        </div>
      )}
      <OsceImageViewer
        images={images}
        packPath={packPath}
        index={viewerIndex}
        onIndexChange={setViewerIndex}
        onClose={() => setViewerIndex(null)}
      />
    </div>
  );
}

/* ── Printed Materials Panel ──────────────────────────────────────── */

export function PrintedMaterialsPanel({
  data,
  packPath = "",
}: {
  data?: OsceDataPresented | null;
  packPath?: string;
}) {
  const { t } = useI18n();
  const [viewerIndex, setViewerIndex] = React.useState<number | null>(null);
  if (!data) return null;
  const images = data.images || [];
  if (!data.scenario && !images.length && !(data.tables || []).length) return null;
  return (
    <div className="space-y-2">
      {data.scenario && (
        <div className="rounded-lg border border-border bg-muted/20 p-3">
          <div className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground mb-1">
            {t("osce.dataPresented.scenario")}
          </div>
          <p className="text-xs leading-relaxed">{data.scenario}</p>
        </div>
      )}
      {images.length > 0 && (
        <div className="rounded-lg border border-border bg-card p-3">
          <div className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground mb-2">
            {t("osce.dataPresented.printedMaterials")}
          </div>
          <div className="grid grid-cols-2 gap-2">
            {images.map((im, i) => {
              const src = dataImageUrl(im, packPath);
              if (!src) return null;
              return (
                <button
                  key={i}
                  onClick={() => setViewerIndex(i)}
                  className="rounded-lg border border-border overflow-hidden bg-background text-left group"
                >
                  <img
                    src={src}
                    alt={im.alt || im.caption || ""}
                    className="w-full aspect-[4/3] object-contain bg-muted/20"
                    loading="lazy"
                  />
                  {im.title && (
                    <div className="text-[9px] font-semibold text-muted-foreground px-2 py-1 truncate group-hover:text-primary transition-colors">
                      {im.title}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
          {images.length > 1 && (
            <p className="text-[9px] text-muted-foreground mt-1.5">{t("osce.dataPresented.enlarge")}</p>
          )}
        </div>
      )}
      {data.tables && data.tables.length > 0 && <DataTablesRenderer tables={data.tables} />}
      <OsceImageViewer
        images={images}
        packPath={packPath}
        index={viewerIndex}
        onIndexChange={setViewerIndex}
        onClose={() => setViewerIndex(null)}
      />
    </div>
  );
}

/* ── Printed Materials Modal ──────────────────────────────────────── */

/**
 * Full printed-materials view in a modal, reachable from the sidebar card
 * (desktop) or the header button (mobile). Ends with a button that takes
 * the student straight into voice mode so they can be quizzed on what
 * they just reviewed without leaving the flow to find the voice toggle.
 */
export function PrintedMaterialsModal({
  open,
  onOpenChange,
  data,
  packPath = "",
  onOpenVoiceMode,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  data?: OsceDataPresented | null;
  packPath?: string;
  onOpenVoiceMode: () => void;
}) {
  const { t } = useI18n();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl p-0 gap-0 max-h-[85vh] flex flex-col">
        <DialogHeader className="px-4 pt-4 pb-2 text-start shrink-0">
          <DialogTitle className="text-sm font-semibold flex items-center gap-1.5">
            <BarChart3 className="size-4 text-primary" />
            {t("osce.dataPresented.printedMaterials")}
          </DialogTitle>
        </DialogHeader>
        <div className="flex-1 min-h-0 overflow-y-auto osler-scroll px-4 pb-3">
          <PrintedMaterialsPanel data={data} packPath={packPath} />
        </div>
        <div className="shrink-0 border-t border-border px-4 py-3 flex items-center justify-between gap-3">
          <p className="text-[11px] text-muted-foreground leading-snug">
            {t("osce.dataPresented.voiceModeHint")}
          </p>
          <Button onClick={onOpenVoiceMode} size="sm" className="gap-1.5 shrink-0">
            <Phone className="size-3.5" />
            {t("osce.dataPresented.openInVoiceMode")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ── OSCE Image Viewer (modal) ────────────────────────────────────── */

export function OsceImageViewer({
  images,
  packPath = "",
  index,
  onIndexChange,
  onClose,
}: {
  images: OsceDataImage[];
  packPath?: string;
  index: number | null;
  onIndexChange: (i: number) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const image = index === null ? null : images[index];
  const src = image ? dataImageUrl(image, packPath) : null;
  const total = images.length;
  if (total === 0) return null;
  const goTo = (i: number) => onIndexChange((i + total) % total);
  return (
    <Dialog open={index !== null} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-3xl p-0 gap-0 max-h-[90vh] flex flex-col">
        <DialogHeader className="px-4 pt-4 pb-0 text-start">
          <DialogTitle className="text-sm font-semibold">
            {t("osce.dataPresented.viewerTitle", {
              title: image?.title || t("osce.dataPresented.images"),
              index: (index ?? 0) + 1,
              total,
            })}
          </DialogTitle>
        </DialogHeader>
        <div className="relative flex-1 min-h-0 flex items-center justify-center p-4">
          {src && (
            <img
              src={src}
              alt={image?.alt || image?.caption || ""}
              className="max-w-full max-h-[60vh] object-contain rounded-lg"
            />
          )}
          {total > 1 && (
            <>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => goTo((index ?? 0) - 1)}
                aria-label={t("osce.dataPresented.prev")}
                className="absolute start-2 top-1/2 -translate-y-1/2"
              >
                <ChevronLeft className="size-5 rtl-flip-x" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => goTo((index ?? 0) + 1)}
                aria-label={t("osce.dataPresented.next")}
                className="absolute end-2 top-1/2 -translate-y-1/2"
              >
                <ChevronRight className="size-5 rtl-flip-x" />
              </Button>
            </>
          )}
        </div>
        {image?.caption && (
          <div className="px-4 pb-4 text-xs text-muted-foreground text-center">{image.caption}</div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/* ── Live Voice Overlay (ChatGPT-style full-screen voice UI) ──────── */

/**
 * A full-screen voice experience modelled on ChatGPT's voice mode.
 *
 * Design intent:
 * - The orb is the single tappable surface. Tap to interrupt while the
 *   professor is speaking; tap to indicate you're done talking while the
 *   system is listening.
 * - Subtitles are off by default. A small captions badge in the top
 *   bar shows the current state and toggles via the settings, but when
 *   transcripts are off only a thin hint line is shown — the focus is on
 *   the audio, not the text.
 * - Three controls: minimise (returns to the text view while keeping
 *   the call alive), toggle captions, end call. No other UI chrome —
 *   the orb fills the screen.
 */
export function LiveVoiceOverlay({
  speakerName,
  speakerRole,
  orbState,
  voicePhase,
  getVoiceLevel,
  thinking,
  thinkingPhases,
  interimText,
  lastModelText,
  partialModelText,
  transcriptsOn,
  onToggleTranscripts,
  onMinimise,
  onEndCall,
  onInterrupt,
  error,
}: {
  speakerName: string;
  speakerRole: string;
  orbState: OrbState;
  voicePhase: "idle" | "listening" | "speaking";
  /** Read every animation frame by the FluidOrb — 0..1, no re-renders. */
  getVoiceLevel: () => number;
  thinking: boolean;
  thinkingPhases: ThinkingPhase[];
  interimText: string;
  lastModelText: string;
  /** In-flight output transcription — grows while the professor speaks. */
  partialModelText: string;
  transcriptsOn: boolean;
  onToggleTranscripts: () => void;
  onMinimise: () => void;
  onEndCall: () => void;
  onInterrupt: () => void;
  error: string | null;
}) {
  const { t } = useI18n();
  const reduce = useReducedMotion();

  const isSpeaking = voicePhase === "speaking";
  const isListening = voicePhase === "listening";

  // Phase copy under the orb
  const phaseLabel = isSpeaking
    ? t("osce.session.voiceOverlay.speaking")
    : isListening
      ? t("osce.session.voiceOverlay.listening")
      : thinking
        ? t("osce.session.voiceOverlay.thinking")
        : t("osce.session.voiceOverlay.tapToTalk");

  // The orb is tapped to: interrupt while speaking, otherwise just
  // visually pulse — Gemini Live's VAD picks up the user's voice
  // automatically, no explicit "tap to talk" needed.
  const handleOrbTap = () => {
    if (isSpeaking) onInterrupt();
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={MOTION_TRANSITION.normal}
      className="fixed inset-0 z-50 flex flex-col bg-gradient-to-b from-background via-background to-card/40 backdrop-blur-xl"
      // The backdrop is a translucent overlay above the conversation UI.
      // Tap-to-dismiss is intentionally NOT enabled on the backdrop —
      // users finish a voice call via the explicit End button.
      role="dialog"
      aria-label={t("osce.session.voiceOverlay.title")}
    >
      {/* Top bar — speaker name + actions */}
      <div className="flex items-center justify-between px-4 py-3 shrink-0">
        <div className="min-w-0 flex items-center gap-2.5">
          <div className="size-9 rounded-full bg-gradient-to-br from-primary/15 to-primary/5 border border-primary/20 flex items-center justify-center text-primary font-semibold text-xs shrink-0">
            {speakerName?.[0] || "P"}
          </div>
          <div className="min-w-0">
            <div className="text-sm font-semibold truncate">{speakerName}</div>
            <div className="text-[10px] text-muted-foreground truncate">{speakerRole}</div>
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {/* Captions toggle */}
          <button
            onClick={onToggleTranscripts}
            className={cn(
              "h-8 px-2.5 rounded-lg border flex items-center gap-1.5 text-[11px] font-medium transition-colors",
              transcriptsOn
                ? "border-primary/30 bg-primary/10 text-primary"
                : "border-border text-muted-foreground hover:text-foreground hover:bg-muted/40"
            )}
            title={transcriptsOn ? t("osce.session.voiceOverlay.transcriptOn") : t("osce.session.voiceOverlay.transcriptOff")}
            aria-label={transcriptsOn ? t("osce.session.voiceOverlay.transcriptOn") : t("osce.session.voiceOverlay.transcriptOff")}
          >
            <Captions className="size-3.5" />
            <span className="hidden sm:inline">{transcriptsOn ? "On" : "Off"}</span>
          </button>
          {/* Minimise */}
          <button
            onClick={onMinimise}
            className="size-8 rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-muted/40 flex items-center justify-center transition-colors"
            title={t("osce.session.voiceOverlay.minimise")}
            aria-label={t("osce.session.voiceOverlay.minimise")}
          >
            <Minimize2 className="size-4" />
          </button>
          {/* End call */}
          <button
            onClick={onEndCall}
            className="h-8 px-3 rounded-lg bg-destructive/10 border border-destructive/30 text-destructive hover:bg-destructive/20 flex items-center gap-1.5 text-[11px] font-semibold transition-colors"
            title={t("osce.session.voiceOverlay.endCall")}
            aria-label={t("osce.session.voiceOverlay.endCall")}
          >
            <PhoneOff className="size-3.5" />
            <span className="hidden sm:inline">{t("osce.session.voiceOverlay.endCall")}</span>
          </button>
        </div>
      </div>

      {/* Center stage — the orb */}
      <div className="flex-1 min-h-0 flex flex-col items-center justify-center gap-6 px-6">
        {/* Live captions area — only meaningful when transcripts are on OR
            the system is mid-utterance and we have interim text. When both
            are off, the area collapses and the orb takes the full vertical
            space. */}
        <AnimatePresence>
          {(transcriptsOn || interimText || lastModelText || partialModelText) && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              className="w-full max-w-2xl space-y-2 min-h-[3rem] flex flex-col justify-center"
            >
              {/* Professor's last full utterance — or the in-flight partial
                  transcription, streamed word-by-word as it is spoken. */}
              {transcriptsOn && (partialModelText || lastModelText) && (
                <div
                  className={cn(
                    "self-start max-w-[85%] px-3.5 py-2 rounded-2xl rounded-tl-sm border text-sm leading-relaxed",
                    partialModelText
                      ? "bg-card/60 border-dashed border-border text-muted-foreground italic"
                      : "bg-card border-border text-foreground/90"
                  )}
                >
                  {partialModelText || lastModelText}
                  {partialModelText && <span className="osler-stream-caret" />}
                </div>
              )}
              {/* User's interim speech */}
              {interimText && (
                <div className="self-end max-w-[85%] px-3.5 py-2 rounded-2xl rounded-tr-sm bg-primary/5 border border-primary/10 text-sm text-muted-foreground italic">
                  {interimText}
                </div>
              )}
              {/* Hint line when transcripts off but we still need to show
                  something to anchor the orb's gaze */}
              {!transcriptsOn && !interimText && (
                <div className="text-center text-[11px] text-muted-foreground/70">
                  {t("osce.session.voiceOverlay.transcriptOff")}
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {/* The orb */}
        <button
          type="button"
          onClick={handleOrbTap}
          className={cn(
            "relative size-44 sm:size-56 rounded-full flex items-center justify-center transition-transform",
            isSpeaking && "active:scale-95"
          )}
          title={isSpeaking ? t("osce.session.voiceOverlay.tapToInterrupt") : phaseLabel}
          aria-label={isSpeaking ? t("osce.session.voiceOverlay.tapToInterrupt") : phaseLabel}
        >
          {/* Pulsing rings when speaking */}
          {isSpeaking && !reduce && (
            <>
              <motion.span
                className="absolute inset-0 rounded-full border-2 border-primary/40"
                animate={{ scale: [1, 1.2, 1], opacity: [0.6, 0, 0.6] }}
                transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
                aria-hidden="true"
              />
              <motion.span
                className="absolute inset-0 rounded-full border border-primary/30"
                animate={{ scale: [1, 1.35, 1], opacity: [0.4, 0, 0.4] }}
                transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut", delay: 0.4 }}
                aria-hidden="true"
              />
            </>
          )}
          {/* Pulsing rings when listening — subtler, slower */}
          {isListening && !reduce && (
            <motion.span
              className="absolute inset-0 rounded-full border-2 border-destructive/40"
              animate={{ scale: [1, 1.15, 1], opacity: [0.5, 0, 0.5] }}
              transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
              aria-hidden="true"
            />
          )}
          {/* Glow halo */}
          <span
            className={cn(
              "absolute inset-0 rounded-full blur-xl",
              isSpeaking ? "bg-primary/20" : isListening ? "bg-destructive/15" : "bg-primary/10"
            )}
            aria-hidden="true"
          />
          {/* The orb itself — the FluidOrb auto-themes from the site's
              --primary color and its fluid drift/turbulence/scale visibly
              react to live mic and playback amplitude via getVoiceLevel. */}
          <FluidOrb
            size={224}
            level={getVoiceLevel}
            style={{ width: "100%", height: "100%" }}
            className="relative z-10"
            aria-hidden="true"
          />
        </button>

        {/* Phase label */}
        <div className="flex flex-col items-center gap-1 text-center">
          <div className="flex items-center gap-1.5">
            <span
              className={cn(
                "size-1.5 rounded-full shrink-0",
                isSpeaking
                  ? "bg-success animate-pulse"
                  : isListening
                    ? "bg-destructive animate-pulse"
                    : thinking
                      ? "bg-warning"
                      : "bg-muted-foreground"
              )}
            />
            <span className="text-sm font-medium text-foreground/90">{phaseLabel}</span>
          </div>
          {thinking && (
            <ThinkingStatus
              phases={thinkingPhases}
              size={64}
              interval={1800}
              labelClassName="text-xs italic text-muted-foreground"
            />
          )}
        </div>
      </div>

      {/* Footer — subtitle hint + secondary action */}
      <div className="px-4 pb-5 pt-2 shrink-0 flex flex-col items-center gap-2">
        <p className="text-[11px] text-muted-foreground/70 text-center max-w-md leading-relaxed">
          {isSpeaking
            ? t("osce.session.voiceOverlay.tapToInterrupt")
            : t("osce.session.voiceOverlay.subtitle")}
        </p>
        {/* Inline error */}
        <AnimatePresence>
          {error && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="max-w-md w-full"
            >
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-destructive/10 border border-destructive/20 text-xs text-destructive">
                <AlertCircle className="size-3.5 shrink-0" />
                <span className="truncate">{error}</span>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}