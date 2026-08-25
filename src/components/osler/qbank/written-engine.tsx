"use client";

import * as React from "react";
import { animate } from "framer-motion";
import { Check, X, ListChecks, Loader2, Sparkles, CheckCircle2, Circle, Camera, RefreshCw } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { MilkdownEditor } from "@/components/osler/milkdown-editor";
import { MarkdownPreview } from "@/components/osler/admin/editors/markdown-preview";
import { ThinkingOrb } from "thinking-orbs";
import { ThinkingStatus } from "@/components/osler/thinking-status";
import { type WrittenDraft, type WrittenEvaluation } from "@/lib/osler/storage";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { gradeWithAI, transcribePhoto } from "@/lib/osler/grading";
import { useI18n } from "@/components/osler/i18n-provider";
import { SessionQuestion } from "./shared";




































































/* ── Written evaluation display ──────────────────────────────────────── */
export function WrittenEvaluationCard({
  evaluation,
  verdict,
  onPassFail,
}: {
  evaluation: WrittenEvaluation;
  verdict: "pass" | "fail" | null;
  onPassFail?: (v: "pass" | "fail") => void;
}) {
  const { t } = useI18n();
  const passed = verdict === "pass" || (verdict === null && evaluation.passed);
  const isManual = evaluation.score === null;
  return (
    <div className="space-y-4">
      {/* Score + verdict */}
      <div className="flex items-center gap-4">
        <div
          className={cn(
            "size-14 rounded-full flex items-center justify-center text-lg font-bold border-[3px] shrink-0",
            passed
              ? "border-success bg-success/10 text-success"
              : "border-destructive bg-destructive/10 text-destructive",
          )}
        >
          {evaluation.score !== null ? evaluation.score : "—"}
        </div>
        <div>
          <div className="text-base font-bold">{passed ? t("qbank.written.passed") : t("qbank.written.needsRevision")}</div>
          <div className="text-xs text-muted-foreground">{evaluation.source}</div>
        </div>
      </div>

      {/* Strengths */}
      {evaluation.strengths.length > 0 && (
        <div className="space-y-1.5">
          {evaluation.strengths.map((s, i) => (
            <div key={i} className="flex items-start gap-2 text-sm">
              <Check className="size-4 text-success shrink-0 mt-0.5" />
              <span>{s}</span>
            </div>
          ))}
        </div>
      )}

      {/* Gaps */}
      {evaluation.gaps.length > 0 && (
        <div className="space-y-1.5">
          {evaluation.gaps.map((g, i) => (
            <div key={i} className="flex items-start gap-2 text-sm">
              <span className="size-1.5 rounded-full bg-destructive shrink-0 mt-2" />
              <span className="text-muted-foreground">{g}</span>
            </div>
          ))}
        </div>
      )}

      {/* Feedback */}
      {evaluation.feedback && (
        <div className="text-sm text-foreground bg-muted/30 rounded-lg px-3 py-2.5 leading-relaxed">
          {evaluation.feedback}
        </div>
      )}

      {/* Manual override */}
      {onPassFail && (
        <div className="flex gap-3 pt-3 border-t border-border">
          <button
            type="button"
            onClick={() => onPassFail("pass")}
            className={cn(
              "flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold border-2 transition-all",
              passed
                ? "border-success bg-success/10 text-success"
                : "border-border hover:border-success/40 hover:bg-success/5",
            )}
          >
            <Check className="size-4" />
            {t("qbank.written.pass")}
          </button>
          <button
            type="button"
            onClick={() => onPassFail("fail")}
            className={cn(
              "flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold border-2 transition-all",
              !passed
                ? "border-destructive bg-destructive/10 text-destructive"
                : "border-border hover:border-destructive/40 hover:bg-destructive/5",
            )}
          >
            <X className="size-4" />
            {t("qbank.written.fail")}
          </button>
        </div>
      )}

      {/* Self-grading rubric — only after AI fails / manual grade */}
      {isManual && (
        <div className="pt-3 border-t border-border">
          <p className="text-xs text-muted-foreground mb-2">
            {t("qbank.written.aiUnavailable")}
          </p>
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
 * CAMERA MODAL — capture/upload/crop/compress/transcribe for written answers
 * ───────────────────────────────────────────────────────────────────────── */
export function CameraModal({
  open,
  onClose,
  onTranscribed,
}: {
  open: boolean;
  onClose: () => void;
  onTranscribed: (text: string) => void;
}) {
  const { t } = useI18n();
  const videoRef = React.useRef<HTMLVideoElement>(null);
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const cropContainerRef = React.useRef<HTMLDivElement>(null);
  const cropImgRef = React.useRef<HTMLImageElement>(null);

  const [stream, setStream] = React.useState<MediaStream | null>(null);
  const [useFront, setUseFront] = React.useState(false);
  const [phase, setPhase] = React.useState<"viewfinder" | "crop" | "transcribing">("viewfinder");
  const [cropImgSrc, setCropImgSrc] = React.useState<string | null>(null);

  const cropBoxRef = React.useRef<{ left: number; top: number; width: number; height: number } | null>(null);
  const cropDragRef = React.useRef<{ type: string; startX: number; startY: number; startBox: typeof cropBoxRef.current }>({ type: "", startX: 0, startY: 0, startBox: null });
  const cropBoxElRef = React.useRef<HTMLDivElement>(null);
  const transcribeAbortRef = React.useRef<AbortController | null>(null);

  const stopStream = React.useCallback(() => {
    stream?.getTracks().forEach((t) => t.stop());
    setStream(null);
  }, [stream]);

  const openCamera = React.useCallback(async (front: boolean) => {
    if (typeof window === "undefined") return;
    // Detect if running as an installed PWA — standalone PWAs may have
    // camera access even on HTTP origins (Chrome grants them secure-context
    // privileges). Only block on insecure HTTP *non-PWA* contexts.
    const isPwa = window.matchMedia("(display-mode: standalone)").matches
      || (navigator as any).standalone === true
      || document.referrer.includes("android-app://");
    if (!window.isSecureContext && !isPwa && location.hostname !== "localhost" && location.hostname !== "127.0.0.1") {
      toast({ title: t("qbank.written.cameraSecureContext"), variant: "destructive" });
      fileInputRef.current?.click();
      return;
    }
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: front ? "user" : "environment" },
      });
      setStream(s);
      if (videoRef.current) {
        videoRef.current.srcObject = s;
      }
    } catch (err: unknown) {
      const name = err instanceof DOMException ? err.name : "";
      if (name === "NotAllowedError" || name === "PermissionDeniedError") {
        toast({ title: t("qbank.written.cameraPermissionDenied"), variant: "destructive" });
      } else if (name === "NotFoundError") {
        toast({ title: t("qbank.written.noCamera"), variant: "destructive" });
      } else if (!window.isSecureContext && !isPwa) {
        // Generic error on insecure non-PWA context — likely a
        // getUserMedia availability issue.
        toast({ title: t("qbank.written.cameraSecureContext"), variant: "destructive" });
      }
      fileInputRef.current?.click();
    }
  }, [t]);

  React.useEffect(() => {
    if (open) {
      setPhase("viewfinder");
      setCropImgSrc(null);
      cropBoxRef.current = null;
      openCamera(useFront);
      document.body.style.overflow = "hidden";
    } else {
      stopStream();
      document.body.style.overflow = "";
    }
    return () => {
      stream?.getTracks().forEach((t) => t.stop());
      document.body.style.overflow = "";
    };
  }, [open]);

  const capturePhoto = React.useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
    stopStream();
    setCropImgSrc(dataUrl);
    setPhase("crop");
  }, [stopStream]);

  const switchCamera = React.useCallback(() => {
    const next = !useFront;
    setUseFront(next);
    stream?.getTracks().forEach((t) => t.stop());
    openCamera(next);
  }, [useFront, stream, openCamera]);

  const handleFileUpload = React.useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast({ title: "Please select an image file.", variant: "destructive" });
      return;
    }
    const reader = new FileReader();
    reader.onload = (ev) => {
      const result = ev.target?.result;
      if (typeof result === "string") {
        stopStream();
        setCropImgSrc(result);
        setPhase("crop");
      }
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  }, [stopStream]);

  const renderCropBox = React.useCallback(() => {
    const box = cropBoxRef.current;
    const el = cropBoxElRef.current;
    if (!box || !el) return;
    el.style.left = box.left + "px";
    el.style.top = box.top + "px";
    el.style.width = box.width + "px";
    el.style.height = box.height + "px";
  }, []);

  const initCrop = React.useCallback(() => {
    const img = cropImgRef.current;
    const container = cropContainerRef.current;
    if (!img || !container) return;
    const displayW = img.clientWidth || img.naturalWidth;
    const displayH = img.clientHeight || img.naturalHeight;
    if (!displayW || !displayH) return;
    const pad = 0.05;
    const w = Math.round(displayW * (1 - pad * 2));
    const h = Math.round(displayH * (1 - pad * 2));
    cropBoxRef.current = {
      left: Math.round((displayW - w) / 2),
      top: Math.round((displayH - h) / 2),
      width: w,
      height: h,
    };
    renderCropBox();
  }, [renderCropBox]);

  React.useEffect(() => {
    if (phase === "crop" && cropImgRef.current) {
      const img = cropImgRef.current;
      if (img.complete && img.naturalWidth) {
        initCrop();
      } else {
        img.addEventListener("load", initCrop, { once: true });
      }
    }
  }, [phase, cropImgSrc, initCrop]);

  const getPointerPos = React.useCallback((e: React.MouseEvent | React.TouchEvent) => {
    const container = cropContainerRef.current;
    if (!container) return { x: 0, y: 0 };
    const rect = container.getBoundingClientRect();
    const clientX = "touches" in e ? e.touches[0].clientX : e.clientX;
    const clientY = "touches" in e ? e.touches[0].clientY : e.clientY;
    return { x: clientX - rect.left, y: clientY - rect.top };
  }, []);

  const startCropDrag = React.useCallback((e: React.MouseEvent | React.TouchEvent, type: string) => {
    if ("button" in e && e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const pos = getPointerPos(e);
    cropDragRef.current = {
      type,
      startX: pos.x,
      startY: pos.y,
      startBox: cropBoxRef.current ? { ...cropBoxRef.current } : null,
    };

    const onMove = (ev: MouseEvent | TouchEvent) => {
      ev.preventDefault();
      const container = cropContainerRef.current;
      if (!container || !cropDragRef.current.startBox) return;
      const maxW = container.clientWidth;
      const maxH = container.clientHeight;
      const cx = "touches" in ev ? ev.touches[0].clientX : ev.clientX;
      const cy = "touches" in ev ? ev.touches[0].clientY : ev.clientY;
      const rect = container.getBoundingClientRect();
      const px = cx - rect.left;
      const py = cy - rect.top;
      const dx = px - cropDragRef.current.startX;
      const dy = py - cropDragRef.current.startY;
      const b = cropDragRef.current.startBox;
      const min = 40;
      let l = b.left, t = b.top, r = b.left + b.width, bm = b.top + b.height;

      switch (cropDragRef.current.type) {
        case "move": l = b.left + dx; t = b.top + dy; r = l + b.width; bm = t + b.height; break;
        case "se": r = b.left + b.width + dx; bm = b.top + b.height + dy; break;
        case "sw": l = b.left + dx; r = b.left + b.width; bm = b.top + b.height + dy; break;
        case "ne": t = b.top + dy; r = b.left + b.width + dx; bm = b.top + b.height; break;
        case "nw": l = b.left + dx; t = b.top + dy; r = b.left + b.width; bm = b.top + b.height; break;
      }

      l = Math.max(0, Math.min(l, maxW - min));
      t = Math.max(0, Math.min(t, maxH - min));
      r = Math.max(l + min, Math.min(r, maxW));
      bm = Math.max(t + min, Math.min(bm, maxH));

      cropBoxRef.current = { left: l, top: t, width: r - l, height: bm - t };
      renderCropBox();
    };

    const onEnd = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onEnd);
      document.removeEventListener("touchmove", onMove);
      document.removeEventListener("touchend", onEnd);
    };

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onEnd);
    document.addEventListener("touchmove", onMove, { passive: false });
    document.addEventListener("touchend", onEnd);
  }, [getPointerPos, renderCropBox]);

  const compressAndTranscribe = React.useCallback(async (rawDataUrl: string) => {
    const loadImg = (src: string) =>
      new Promise<HTMLImageElement>((resolve, reject) => {
        const im = new Image();
        im.onload = () => resolve(im);
        im.onerror = reject;
        im.src = src;
      });

    const raw = await loadImg(rawDataUrl);
    const MAX = 1600;
    let w = raw.naturalWidth;
    let h = raw.naturalHeight;
    if (w > MAX || h > MAX) {
      const scale = MAX / Math.max(w, h);
      w = Math.round(w * scale);
      h = Math.round(h * scale);
    }
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(raw, 0, 0, w, h);
    const compressed = c.toDataURL("image/jpeg", 0.7);
    const base64 = compressed.replace(/^data:image\/\w+;base64,/, "");

    setPhase("transcribing");

    const abort = new AbortController();
    transcribeAbortRef.current = abort;
    try {
      const text = await transcribePhoto({ photoBase64: base64, mimeType: "image/jpeg", signal: abort.signal });
      onTranscribed(text);
      onClose();
    } catch (err: unknown) {
      if ((err as Error)?.name === "AbortError") return;
      toast({ title: t("qbank.written.transcriptionFailed"), variant: "destructive" });
      setPhase("viewfinder");
      openCamera(useFront);
    } finally {
      transcribeAbortRef.current = null;
    }
  }, [onTranscribed, onClose, t, openCamera, useFront]);

  const applyCrop = React.useCallback(() => {
    if (!cropImgSrc || !cropBoxRef.current) return;
    const img = new Image();
    img.onload = () => {
      const displayEl = cropImgRef.current;
      const displayW = displayEl?.clientWidth || img.naturalWidth;
      const displayH = displayEl?.clientHeight || img.naturalHeight;
      const b = cropBoxRef.current!;
      const sx = (b.left / displayW) * img.naturalWidth;
      const sy = (b.top / displayH) * img.naturalHeight;
      const sw = (b.width / displayW) * img.naturalWidth;
      const sh = (b.height / displayH) * img.naturalHeight;
      const c = document.createElement("canvas");
      c.width = sw;
      c.height = sh;
      const ctx = c.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
      compressAndTranscribe(c.toDataURL("image/jpeg", 0.85));
    };
    img.src = cropImgSrc;
  }, [cropImgSrc, compressAndTranscribe]);

  if (!open) return null;

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFileUpload}
      />
      <div className="osler-camera-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
        <div className="osler-camera-modal">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-base font-semibold">{t("qbank.written.cameraTitle")}</h3>
            <Button variant="ghost" size="iconSm" onClick={onClose}>
              <X className="size-4" />
            </Button>
          </div>

          {phase === "viewfinder" && (
            <>
              <video ref={videoRef} autoPlay playsInline className="osler-camera-video" />
              <canvas ref={canvasRef} className="hidden" />
              <div className="flex justify-center gap-4 mt-4 items-center">
                <Button variant="outline" onClick={() => fileInputRef.current?.click()}>
                  {t("qbank.written.cameraUpload")}
                </Button>
                <Button
                  size="iconLg"
                  onClick={capturePhoto}
                  className="rounded-full bg-primary text-primary-foreground hover:opacity-90"
                >
                  <div className="size-3 rounded-full bg-current" />
                </Button>
                <Button variant="ghost" size="icon" onClick={switchCamera}>
                  <RefreshCw className="size-4" />
                </Button>
              </div>
            </>
          )}

          {phase === "crop" && cropImgSrc && (
            <>
              <div className="osler-crop-container" ref={cropContainerRef}>
                <img ref={cropImgRef} src={cropImgSrc} alt="Crop preview" draggable={false} />
                <div className="osler-crop-overlay">
                  <div
                    ref={cropBoxElRef}
                    className="osler-crop-box"
                    onMouseDown={(e) => startCropDrag(e, "move")}
                    onTouchStart={(e) => startCropDrag(e, "move")}
                  >
                    <div className="osler-crop-handle osler-crop-handle--nw" onMouseDown={(e) => startCropDrag(e, "nw")} onTouchStart={(e) => startCropDrag(e, "nw")} />
                    <div className="osler-crop-handle osler-crop-handle--ne" onMouseDown={(e) => startCropDrag(e, "ne")} onTouchStart={(e) => startCropDrag(e, "ne")} />
                    <div className="osler-crop-handle osler-crop-handle--sw" onMouseDown={(e) => startCropDrag(e, "sw")} onTouchStart={(e) => startCropDrag(e, "sw")} />
                    <div className="osler-crop-handle osler-crop-handle--se" onMouseDown={(e) => startCropDrag(e, "se")} onTouchStart={(e) => startCropDrag(e, "se")} />
                  </div>
                </div>
              </div>
              <p className="text-xs text-muted-foreground text-center mt-2">{t("qbank.written.cropInfo")}</p>
              <div className="flex justify-center gap-3 mt-3">
                <Button variant="outline" onClick={() => { setPhase("viewfinder"); openCamera(useFront); }}>
                  {t("qbank.written.cropRetake")}
                </Button>
                <Button onClick={applyCrop}>
                  {t("qbank.written.cropUse")}
                </Button>
              </div>
            </>
          )}

          {phase === "transcribing" && (
            <div className="flex flex-col items-center gap-4 py-10">
              <Loader2 className="size-8 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground">{t("qbank.written.transcribingPhoto")}</p>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
 * WRITTEN ENGINE VIEW
 * ───────────────────────────────────────────────────────────────────────── */
export function WrittenEngineView({
  question,
  draft,
  submitted,
  onTextChange,
  onRubricToggle,
  onGradeAI,
  onGradeManual,
  onPassFail,
  grading,
  onChildTextChange,
  onChildGradeAI,
  onChildGradeManual,
  onChildPassFail,
  childGrading,
}: {
  question: SessionQuestion;
  draft: WrittenDraft;
  submitted: boolean;
  onTextChange: (text: string) => void;
  onRubricToggle: (idx: number) => void;
  onGradeAI?: () => void;
  onGradeManual?: () => void;
  onPassFail?: (v: "pass" | "fail") => void;
  grading?: boolean;
  onChildTextChange?: (childIdx: number, text: string) => void;
  onChildGradeAI?: (childIdx: number) => void;
  onChildGradeManual?: (childIdx: number) => void;
  onChildPassFail?: (childIdx: number, v: "pass" | "fail") => void;
  childGrading?: number | null;
}) {
  const wordCount = draft.text.trim().split(/\s+/).filter(Boolean).length;
  const hasEvaluation = !!draft.evaluation;
  const hasContent = !!draft.text.trim();
  const verdict: "pass" | "fail" | null =
    draft.evaluation?.manualVerdict === "pass"
      ? "pass"
      : draft.evaluation?.manualVerdict === "fail"
        ? "fail"
        : null;
  const isManual = draft.evaluation?.score === null;
  const passed = verdict === "pass" || (verdict === null && draft.evaluation?.passed === true);
  const children = question.children ?? [];

  const [cameraOpen, setCameraOpen] = React.useState(false);
  const [transcribing, setTranscribing] = React.useState(false);

  // ── Input mode (before submit) ───────────────────────────────────────
  const { t } = useI18n();

  if (!submitted && !hasEvaluation) {
    return (
      <div className="mt-6 space-y-4">
        <CameraModal
          open={cameraOpen}
          onClose={() => setCameraOpen(false)}
          onTranscribed={(text) => {
            setTranscribing(false);
            const merged = draft.text.trim()
              ? draft.text.trim() + "\n\n" + text
              : text;
            onTextChange(merged);
          }}
        />

        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {t("qbank.written.yourResponse")}
            </label>
            <span className="text-xs text-muted-foreground tabular-nums">
              {transcribing
                ? t("qbank.written.transcribing")
                : t("qbank.written.words", { n: wordCount })}
            </span>
          </div>

          <MilkdownEditor
            value={draft.text}
            onChange={onTextChange}
            placeholder={t("qbank.written.placeholder")}
            className="osler-written-area"
            // Written answers use a separate "Photo" camera capture mode
            // for handwritten answers — disable image upload in the
            // editor itself to avoid confusion.
            enableImageUpload={false}
          />
          {transcribing && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/30 rounded-lg px-3 py-2 mt-2">
              <Loader2 className="size-3.5 animate-spin" />
              {t("qbank.written.transcribingPhoto")}
            </div>
          )}
        </div>

        {/* Grade buttons */}
        <div className="flex gap-2 flex-wrap">
          <button
            type="button"
            onClick={onGradeManual}
            disabled={!hasContent}
            className="px-4 py-2 rounded-lg text-sm font-medium border border-border hover:border-primary/40 transition-colors disabled:opacity-50"
          >
            {t("qbank.written.manualGrade")}
          </button>
          <button
            type="button"
            onClick={() => setCameraOpen(true)}
            className="px-4 py-2 rounded-lg text-sm font-medium border border-border hover:border-primary/40 transition-colors"
          >
            <span className="flex items-center gap-1.5">
              <Camera className="size-3.5" />
              {t("qbank.written.photo")}
            </span>
          </button>
          <button
            type="button"
            onClick={onGradeAI}
            disabled={grading || !hasContent}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-primary text-primary-foreground hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {grading ? (
              <span className="flex items-center gap-2">
                <ThinkingOrb state="solving" size={20} aria-hidden="true" />
                {t("qbank.written.grading")}
              </span>
            ) : (
              t("qbank.written.gradeWithAI")
            )}
          </button>
        </div>

        {grading && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/30 rounded-lg px-3 py-2">
            <ThinkingStatus
              phases={[
                { label: t("qbank.written.orb.reading"), state: "listening" },
                { label: t("qbank.written.orb.checking"), state: "searching" },
                { label: t("qbank.written.orb.scoring"), state: "solving" },
                { label: t("qbank.written.orb.composing"), state: "composing" },
              ]}
            />
          </div>
        )}

        {/* Children questions — per-part textareas */}
        {children.length > 0 && (
          <div className="space-y-5 pt-4 border-t border-border">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {t("qbank.written.partQuestions")}
            </h4>
            {children.map((child, ci) => {
              const childAns = draft.childAnswers?.[ci] ?? "";
              return (
                <div key={child.id} className="space-y-2 pl-4 border-l-2 border-muted">
                  <div className="text-xs font-semibold text-muted-foreground">
                    {child.label || t("qbank.written.partLabel", { n: ci + 1 })}
                  </div>
                  {child.question && (
                    <div className="text-sm text-foreground mb-1.5">{child.question}</div>
                  )}
                  <MilkdownEditor
                    value={childAns}
                    onChange={(v) => onChildTextChange?.(ci, v)}
                    placeholder={t("qbank.written.answerFor", { label: child.label || `part ${ci + 1}` })}
                    className="osler-written-area"
                    enableImageUpload={false}
                  />
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => onChildGradeManual?.(ci)}
                      disabled={!childAns.trim()}
                      className="px-3 py-1.5 rounded-md text-xs font-medium border border-border hover:border-primary/40 transition-colors disabled:opacity-50"
                    >
                      {t("qbank.written.manualGrade")}
                    </button>
                    <button
                      type="button"
                      onClick={() => onChildGradeAI?.(ci)}
                      disabled={childGrading === ci || !childAns.trim()}
                      className="px-3 py-1.5 rounded-md text-xs font-medium bg-primary text-primary-foreground hover:opacity-90 transition-opacity disabled:opacity-50"
                    >
                      {childGrading === ci ? (
                        <span className="flex items-center gap-1.5">
                          <ThinkingOrb state="solving" size={20} aria-hidden="true" />
                          {t("qbank.written.grading")}
                        </span>
                      ) : (
                        t("qbank.written.gradeWithAI")
                      )}
                    </button>
                  </div>
                  {draft.childEvaluations?.[ci] && (
                    <div className="mt-2">
                      <WrittenEvaluationCard
                        evaluation={draft.childEvaluations[ci]!}
                        verdict={null}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  // ── Evaluation mode — only comparison content; evaluation card is in parent's right column ──
  return (
    <div className="space-y-5">
      {/* Compare grid */}
      <div className="space-y-4">
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1.5">
            <span className="size-2 rounded-full bg-warning" />
            {t("qbank.written.yourResponse")}
          </h4>
          <div className="text-sm leading-relaxed text-foreground bg-muted/30 rounded-lg p-4 min-h-[80px] max-h-[400px] overflow-y-auto">
            {draft.text.trim() ? (
              <MarkdownPreview body={draft.text} />
            ) : (
              <span className="text-muted-foreground italic">{t("qbank.written.noAnswer")}</span>
            )}
          </div>
        </div>
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1.5">
            <span className="size-2 rounded-full bg-primary" />
            {t("qbank.written.modelAnswer")}
          </h4>
          <div className="text-sm leading-relaxed text-foreground bg-primary/5 rounded-lg p-4 min-h-[80px] max-h-[400px] overflow-y-auto">
            {question.modelAnswer ? (
              <MarkdownPreview body={question.modelAnswer} />
            ) : (
              <span className="text-muted-foreground italic">{t("qbank.written.noModelAnswer")}</span>
            )}
          </div>
        </div>
      </div>

      {/* "No evaluation yet" prompt (only shown when no draft evaluation exists) */}
      {!draft.evaluation && (
        <div className="rounded-xl border-2 border-border overflow-hidden">
          <div className="bg-card px-5 py-4">
            <div className="flex items-center gap-2 mb-3">
              <Sparkles className="size-4 text-primary" />
              <h3 className="text-sm font-semibold text-foreground">{t("qbank.written.evaluation")}</h3>
            </div>
            <p className="text-sm text-muted-foreground mb-4">
              {t("qbank.written.comparePrompt")}
            </p>
            <div className="flex justify-center gap-3">
              <button
                type="button"
                onClick={onGradeManual}
                className="px-5 py-2.5 rounded-lg text-sm font-medium border border-border hover:border-primary/40 transition-colors"
              >
                {t("qbank.written.manualGrade")}
              </button>
              <button
                type="button"
                onClick={onGradeAI}
                disabled={grading}
                className="px-5 py-2.5 rounded-lg text-sm font-medium bg-primary text-primary-foreground hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                {grading ? (
                  <span className="flex items-center gap-2">
                    <ThinkingOrb state="solving" size={20} aria-hidden="true" />
                    {t("qbank.written.grading")}
                  </span>
                ) : (
                  t("qbank.written.gradeWithAI")
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Written evaluation panel (renders in parent's 45% right column) ─── */
export function WrittenEvaluationPanel({
  draft,
  question,
  passed,
  isManual,
  rubricState,
  onRubricToggle,
  onPassFail,
  onChildPassFail,
}: {
  draft: WrittenDraft;
  question: SessionQuestion;
  passed: boolean;
  isManual: boolean;
  rubricState: boolean[];
  onRubricToggle: (idx: number) => void;
  onPassFail?: (v: "pass" | "fail") => void;
  onChildPassFail?: (childIdx: number, v: "pass" | "fail") => void;
}) {
  const { t } = useI18n();
  const children = question.children ?? [];
  if (!draft.evaluation) return null;
  return (
    <div className={`rounded-xl border-2 overflow-hidden ${passed ? "border-success" : "border-destructive"}`}>
      {/* ── Header bar (like MCQ correct/incorrect header) ────────── */}
      <div className={`px-4 py-3 flex items-center gap-3 ${passed ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive"}`}>
        <div className={`size-9 rounded-full flex items-center justify-center shrink-0 border-[3px] font-bold text-sm ${passed ? "border-success bg-success/10 text-success" : "border-destructive bg-destructive/10 text-destructive"}`}>
          {draft.evaluation.score !== null ? draft.evaluation.score : "—"}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-base font-bold">{passed ? t("qbank.written.passed") : t("qbank.written.needsRevision")}</div>
          <div className="text-xs mt-0.5 opacity-80">{draft.evaluation.source}</div>
        </div>
      </div>

      {/* ── Strengths, gaps, feedback ────────────────────────────── */}
      <div className="bg-card px-5 py-3 space-y-3 border-b border-border">
        {draft.evaluation.strengths.length > 0 && (
          <div className="space-y-1">
            {draft.evaluation.strengths.map((s, i) => (
              <div key={i} className="flex items-start gap-2 text-sm">
                <Check className="size-4 text-success shrink-0 mt-0.5" />
                <span>{s}</span>
              </div>
            ))}
          </div>
        )}
        {draft.evaluation.gaps.length > 0 && (
          <div className="space-y-1">
            {draft.evaluation.gaps.map((g, i) => (
              <div key={i} className="flex items-start gap-2 text-sm">
                <span className="size-1.5 rounded-full bg-destructive shrink-0 mt-2" />
                <span className="text-muted-foreground">{g}</span>
              </div>
            ))}
          </div>
        )}
        {draft.evaluation.feedback && (
          <div className="text-sm text-foreground bg-muted/30 rounded-lg px-3 py-2 leading-relaxed">
            {draft.evaluation.feedback}
          </div>
        )}
      </div>

      {/* ── Rubric (manual grading only) ─────────────────────────── */}
      {isManual && question.rubric && question.rubric.length > 0 && (
        <div className="bg-card px-5 py-3 space-y-2 border-b border-border">
          <h4 className="text-xs font-semibold flex items-center gap-2">
            <ListChecks className="size-3.5 text-primary" />
            {t("qbank.written.selfGradingRubric")}
          </h4>
          {question.rubric.map((item, i) => {
            const checked = rubricState[i] ?? false;
            return (
              <button
                key={i}
                type="button"
                onClick={() => onRubricToggle(i)}
                className={cn(
                  "w-full flex items-start gap-2.5 px-3 py-2 rounded-md text-left text-sm transition-colors",
                  checked
                    ? "bg-success/10 text-success"
                    : "hover:bg-muted",
                )}
              >
                {checked ? (
                  <CheckCircle2 className="size-4 text-success shrink-0 mt-0.5" />
                ) : (
                  <Circle className="size-4 text-muted-foreground shrink-0 mt-0.5" />
                )}
                <span>{item}</span>
              </button>
            );
          })}
          <div className="pt-2 border-t border-border text-xs text-muted-foreground">
            {t("qbank.written.selfScore")}:{" "}
            <span className="font-semibold text-foreground">
              {rubricState.filter(Boolean).length}
            </span>{" "}
            / {question.rubric.length}
          </div>
        </div>
      )}

      {/* ── Explanation — main body (like MCQ explanation section) ── */}
      {question.explanation && (
        <div className="bg-card px-5 py-4" data-explanation>
          <div className="flex items-center gap-2 mb-3">
            <Sparkles className="size-4 text-primary" />
            <h3 className="text-sm font-semibold text-foreground">{t("qbank.explanation.title")}</h3>
          </div>
          <div className="osler-prose text-[14px] whitespace-pre-wrap leading-relaxed text-foreground">
            {question.explanation}
          </div>
        </div>
      )}

      {/* ── Pass/Fail override ───────────────────────────────────── */}
      {onPassFail && (
        <div className="bg-card px-5 py-3 border-t border-border flex gap-3">
          <button
            type="button"
            onClick={() => onPassFail("pass")}
            className={cn(
              "flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold border-2 transition-all",
              passed
                ? "border-success bg-success/10 text-success"
                : "border-border hover:border-success/40 hover:bg-success/5",
            )}
          >
            <Check className="size-4" />
            {t("qbank.written.pass")}
          </button>
          <button
            type="button"
            onClick={() => onPassFail("fail")}
            className={cn(
              "flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold border-2 transition-all",
              !passed
                ? "border-destructive bg-destructive/10 text-destructive"
                : "border-border hover:border-destructive/40 hover:bg-destructive/5",
            )}
          >
            <X className="size-4" />
            {t("qbank.written.fail")}
          </button>
        </div>
      )}

      {/* ── Children evaluations ─────────────────────────────────── */}
      {children.length > 0 && (
        <div className="bg-card px-5 py-3 border-t border-border space-y-4">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {t("qbank.written.partEvaluations")}
          </h4>
          {children.map((child, ci) => {
            const childEval = draft.childEvaluations?.[ci];
            if (!childEval) return null;
            return (
              <div key={child.id} className="space-y-1.5">
                <div className="text-xs font-medium text-muted-foreground">
                  {child.label || t("qbank.written.partLabel", { n: ci + 1 })}
                </div>
                <WrittenEvaluationCard
                  evaluation={childEval}
                  verdict={null}
                  onPassFail={
                    onChildPassFail
                      ? (v) => onChildPassFail(ci, v)
                      : undefined
                  }
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}