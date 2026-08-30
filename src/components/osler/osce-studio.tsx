"use client";

import * as React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Send, RotateCcw, Stethoscope, Clock, Check, X, ChevronLeft, ChevronRight, Home, Activity, Lightbulb, RefreshCw, Loader2, AlertCircle, AlignLeft, Tag, BarChart3, ArrowRight, ArrowLeft, Folder, Play, Phone, PhoneOff, Maximize2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { loadCategoryTree, loadContentByUid, flattenTree, collectPackUrls, getCachedCategoryTree } from "@/lib/osler/content";
import { NavigationStack } from "@/components/osler/navigation-stack";
import type { ContentTreeNode, OsceContent, OsceStation } from "@/lib/osler/types";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";
import { setImmersiveMode } from "@/components/osler/immersive-mode";
import { useI18n } from "@/components/osler/i18n-provider";
import { HubSkeleton, EmptyState, ComingSoonState } from "@/components/osler/ui-primitives";
import { Button } from "@/components/ui/button";
import { ContentCacheButton } from "@/components/osler/content-cache-button";
import { useSwipeBackDismiss } from "@/hooks/use-swipe-back-dismiss";
import { ThinkingStatus, type ThinkingPhase } from "@/components/osler/thinking-status";
import { type OrbState } from "thinking-orbs";
import FluidOrb from "@/components/ui/fluid-orb";
import { AiMarkdown } from "@/components/osler/ai-markdown";
import { MOTION_TRANSITION, MOTION_SPRING } from "@/lib/osler/motion";
import { useOslerRouter, routeFor } from "@/lib/osler/navigation";
import { ctxLinkAttrs } from "@/lib/osler/deep-link";
import { MAX_TURNS, WARN_TURNS, EXAM_TIME, STORAGE, MAP_STEPS, formatTime, timerState, diffClass, userTurnCount, sanitizeModelText, isPediatric, normalizeStation, buildPatientSysPrompt, buildDataInterpSysPrompt, ExamResult, getApiKey, hasApiKey, getLiveModel, dataImageUrl, askPatient, askExaminer, scoreInterview, scoreDataInterpExam, TranscriptEntry, OscePhase } from "./osce/gemini";
import { nodeFromPack, buildAchievements, launchConfetti, getSpeakerName, OsceStreamBubble } from "./osce/session-utils";
import { DataTablesRenderer, DataImagesRenderer, PrintedMaterialsModal, LiveVoiceOverlay } from "./osce/renderers";


/* ── Component Props ───────────────────────────────────────────────── */


interface OsceStudioProps {
  uid?: string | null;
  activeItem?: ContentTreeNode | null;
  activeContent?: OsceContent | null;
  onExit?: () => void;
  onOpenPack?: (item: ContentTreeNode) => void;
  /** Called when the user swipes back to navigate to the Learn hub. */
  onNavigateBack?: () => void;
}
export function OsceStudio({
  uid,
  activeItem: activeItemProp,
  activeContent: activeContentProp,
  onExit: propOnExit,
  onOpenPack: propOnOpenPack,
  onNavigateBack: propOnNavigateBack,
}: OsceStudioProps = {}) {
  const { navigate } = useOslerRouter();
  const router = useRouter();
  const onExit = propOnExit || (() => navigate("osce"));
  const onOpenPack = propOnOpenPack || ((item: ContentTreeNode) => navigate("osce", { uid: item.uid }));
  const onNavigateBack = propOnNavigateBack || (() => navigate("learn"));
  const isMobile = useIsMobile();
  const { t, rtl, contentFilter } = useI18n();

  /* ── State ── */
  const [allPacks, setAllPacks] = React.useState<Array<{ node: ContentTreeNode; content: OsceContent | null }>>([]);
  // Seeded from the sync manifest cache so a warm revisit paints the hub
  // instantly instead of flashing the loading spinner.
  const [packsLoading, setPacksLoading] = React.useState(() => getCachedCategoryTree("osce") === null);
  const [stations, setStations] = React.useState<OsceStation[]>([]);
  const [activeIdx, setActiveIdx] = React.useState(0);
  const [phase, setPhase] = React.useState<OscePhase>("select");

  // Hide the global mobile tab bar during an active OSCE scenario
  // (lobby/conversation/debrief), but keep it on the scenario picker.
  React.useEffect(() => {
    setImmersiveMode(phase !== "select");
    return () => setImmersiveMode(false);
  }, [phase]);

  const [transcript, setTranscript] = React.useState<TranscriptEntry[]>([]);
  const [timerRemaining, setTimerRemaining] = React.useState(EXAM_TIME);
  const timerEndTimeRef = React.useRef(Date.now() + EXAM_TIME * 1000);
  const [inputText, setInputText] = React.useState("");
  const [sending, setSending] = React.useState(false);
  const [thinking, setThinking] = React.useState(false);
  // In-flight streamed reply — non-null while tokens are arriving; painted
  // as a live model bubble so the answer "writes itself" instead of
  // spawning in one block after a silent wait.
  const [streamingText, setStreamingText] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<ExamResult | null>(null);
  const [voiceOn, setVoiceOn] = React.useState(false);
  const [voicePhase, setVoicePhase] = React.useState<"idle" | "listening" | "speaking">("idle");
  const [interimText, setInterimText] = React.useState("");
  const [resetModalOpen, setResetModalOpen] = React.useState(false);
  const [renderedCount, setRenderedCount] = React.useState(0);
  // Printed materials now live in the sidebar (desktop) / a header button
  // (mobile) and open in a modal, rather than an inline collapsible strip
  // above the transcript — this keeps the chat zone focused on the
  // conversation. The modal itself offers a shortcut into voice mode.
  const [materialsModalOpen, setMaterialsModalOpen] = React.useState(false);
  // Real-time 0..1 amplitude refs feeding the voice-mode FluidOrb — updated
  // directly from the audio callbacks (mic RMS while listening, playback
  // RMS while speaking) so the orb visibly moves with the conversation
  // without triggering a React re-render on every audio frame.
  const micLevelRef = React.useRef(0);
  const playbackLevelRef = React.useRef(0);
  // Full-screen ChatGPT-style voice overlay. When `voiceOn` is true, this is
  // also true so the conversation becomes a pure-voice experience with a
  // single tappable orb. The user can minimise the overlay to peek at the
  // transcript / case materials without ending the call.
  const [voiceOverlayOpen, setVoiceOverlayOpen] = React.useState(false);
  const [selectedPackUid, setSelectedPackUid] = React.useState<string | null>(null);
  // True while a pack's stations.json is being fetched on demand after the
  // user clicks a card. With manifest-first loading, the lobby paints
  // immediately from the manifest; this spinner only covers the lazy content
  // fetch that happens when the user actually opens a pack.
  const [loadingPack, setLoadingPack] = React.useState(false);

  // ── Folder navigation state (mirrors qbank's ContentTab) ─────────────
  // allTree holds the *unflattened* OSCE tree so the hub can render folder
  // cards for branch nodes (e.g. `cardiology/` containing sub-packs) and
  // drill down into them with NavigationStack. allPacks is still kept as a
  // flat list of leaves so the lazy content cache + selectPack workflow
  // keeps working unchanged.
  const [allTree, setAllTree] = React.useState<ContentTreeNode[]>([]);
  // Stack of currently open folders — last entry is the one being viewed.
  // Empty array → root grid is shown. Pushed on folder click, popped on back.
  const [selectedFolders, setSelectedFolders] = React.useState<ContentTreeNode[]>([]);

  // ── Swipe-back dismiss for the OSCE lobby/conversation/debrief overlays ─
  // Mirrors the Settings NavigationStack pattern: a horizontal drag past
  // the threshold (or a fast flick) triggers `onDismiss`. The hook returns
  // {} when disabled, so spreading it is safe.
  const lobbyDismiss = useSwipeBackDismiss({
    onDismiss: () => setPhase("select"),
    direction: "horizontal",
    rtl,
    disabled: phase !== "lobby",
  });
  const conversationDismiss = useSwipeBackDismiss({
    onDismiss: () => {
      stopTimer();
      setPhase("lobby");
    },
    direction: "horizontal",
    rtl,
    disabled: phase !== "conversation",
  });
  const debriefDismiss = useSwipeBackDismiss({
    onDismiss: () => {
      setResult(null);
      setPhase("conversation");
    },
    direction: "horizontal",
    rtl,
    disabled: phase !== "debrief",
  });

  // Swipe-back to navigate to Learn hub (only when in select phase)
  const learnHubDismiss = useSwipeBackDismiss({
    onDismiss: () => onNavigateBack?.(),
    direction: "horizontal",
    rtl,
    disabled: phase !== "select",
  });

  const abortRef = React.useRef<AbortController | null>(null);
  // Deferred commit for a streamed reply — the streaming bubble calls it
  // once the typewriter reveal has caught up (see OsceStreamBubble).
  const streamSettleRef = React.useRef<(() => void) | null>(null);
  const handleStreamSettled = React.useCallback(() => {
    const settle = streamSettleRef.current;
    streamSettleRef.current = null;
    settle?.();
  }, []);
  const transcriptRef = React.useRef<TranscriptEntry[]>([]);
  const inputRef = React.useRef<HTMLTextAreaElement>(null);
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const timerRef = React.useRef<ReturnType<typeof setInterval> | null>(null);

  // Single sidebar — wider so we can fit the patient card, progress, map,
  // quick prompts, and submit button without feeling cramped. The previous
  // layout split the desktop view into TWO asides (printed-materials column
  // + meta column) which made the chat zone feel narrow and the patient
  // info hard to find at a glance. The single sidebar consolidates all
  // meta into one column; for data-interp cases the printed materials are
  // a card in that same sidebar (desktop) that opens a modal, with a
  // header button standing in for the sidebar on mobile.
  const SIDEBAR_WIDTH = 264;

  const voicePhaseRef = React.useRef(voicePhase);
  React.useEffect(() => {
    voicePhaseRef.current = voicePhase;
  }, [voicePhase]);

  /* Sync transcript ref */
  React.useEffect(() => {
    transcriptRef.current = transcript;
  }, [transcript]);

  /* Paint the OSCE hub from the manifest alone — no background pre-warming.
   *
   * Mirrors the library & qbank studios: every pack card renders from the
   * manifest's stationSummary/description/tags fields, and the heavy
   * stations.json (patient profiles, rubrics, hidden info) is only fetched
   * on demand when the user selects a pack (see `selectPack`).
   *
   * Pre-warming every pack's content was the main reason the OSCE hub felt
   * slow on cold loads: 4+ stations.json fetches per visit, all racing the
   * manifest. With manifest-first rendering, the lobby paints after a single
   * manifest fetch (typically <5 KB).
   *
   * We flatten the tree to leaf nodes only — branch folders (e.g. a
   * `pediatrics/` folder that contains `pediatrics/cardiology/stations.json`
   * but no direct stations.json) have `files: []` and would throw
   * "No JSON data files" if treated as packs. flattenTree() skips asset
   * subdirs (images/, assets/) and returns only nodes with no child items,
   * which is exactly the set of packs that can be loaded by uid.
   */
  const loadOsceData = React.useCallback(() => {
    loadCategoryTree("osce")
      .then((nodes) => {
        setAllTree(nodes);
        const leaves = flattenTree(nodes).filter((node) => node.type === "osce");
        setAllPacks(leaves.map((node) => ({ node, content: null })));
        setPacksLoading(false);
      })
      .catch(() => setPacksLoading(false));
  }, []);

  React.useEffect(() => {
    loadOsceData();
    const handler = () => loadOsceData();
    window.addEventListener("osler-content-invalidated", handler);
    return () => window.removeEventListener("osler-content-invalidated", handler);
  }, [loadOsceData]);

  /* Self-load a pack from the uid segment so the studio stays mounted */
  const [selfPack, setSelfPack] = React.useState<ReturnType<typeof nodeFromPack> | null>(null);
  const [selfPackError, setSelfPackError] = React.useState(false);
  React.useEffect(() => {
    if (!uid || activeItemProp || activeContentProp) {
      setSelfPack(null);
      setSelfPackError(false);
      return;
    }
    let cancelled = false;
    setSelfPackError(false);
    loadContentByUid(uid, "osce")
      .then((loaded) => {
        if (cancelled) return;
        if (loaded.type === "flashcard") {
          router.replace(routeFor("flashcards", { uid }));
          return;
        }
        if (loaded.type !== "osce") {
          router.replace(routeFor("qbank", { uid }));
          return;
        }
        setSelfPack(nodeFromPack({ uid, type: "osce", title: loaded.meta?.title || uid, path: "" } as ContentTreeNode, loaded));
      })
      .catch((err) => {
        if (cancelled) return;
        console.error("Failed to load OSCE pack:", err);
        setSelfPackError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [uid, router]);

  const activeItem = activeItemProp ?? (selfPack?.item ?? null);
  const activeContent = activeContentProp ?? (selfPack?.content ?? null);

  /* If a pack is injected from outside (library/dashboard), go straight to lobby */
  React.useEffect(() => {
    if (activeContent && activeContent.type === "osce") {
      const normalized = activeContent.stations.map((s, i) =>
        normalizeStation(s as unknown as Record<string, unknown>, i)
      );
      setStations(normalized);
      setActiveIdx(0);
      setPhase("lobby");
    }
  }, [activeContent]);

  const activeCase = stations[activeIdx] || null;

  /* Folder path of the active pack (relative, trailing slash) — used to
     resolve `dataPresented.images[].src` against the pack's images/ folder. */
  const activePackPath = activeItem?.path ?? "";

  /* Professor-first auto-open: a data-interp examiner opens the examination
     themselves (greeting + first question) when the student enters with no
     prior messages — the professor asks you, not the other way round. */
  const autoOpenRef = React.useRef(false);
  React.useEffect(() => {
    if (phase !== "conversation" || !activeCase) return;
    if (activeCase.type !== "data-interp" || transcript.length > 0) return;
    if (autoOpenRef.current) return;
    autoOpenRef.current = true;
    (async () => {
      setThinking(true);
      setError(null);
      abortRef.current = new AbortController();
      let streamed = "";
      try {
        const reply = await askExaminer(
          activeCase,
          [],
          abortRef.current.signal,
          activePackPath,
          (full) => {
            streamed = full;
            setThinking(false);
            setStreamingText(full);
          }
        );
        const cleanReply = sanitizeModelText(reply);
        const updated = [{ role: "model" as const, text: cleanReply }];
        streamSettleRef.current = () => {
          setStreamingText(null);
          setTranscript(updated);
          setRenderedCount(1);
          saveSession(updated);
          if (voiceOn) speakText(cleanReply);
        };
        setThinking(false);
        setStreamingText(cleanReply);
      } catch (err: unknown) {
        setThinking(false);
        streamSettleRef.current = null;
        setStreamingText(null);
        if (err instanceof Error && err.name === "AbortError") return;
        setError(err instanceof Error ? err.message : "Failed to get response");
      } finally {
        setSending(false);
      }
    })();
  }, [phase, activeCase, transcript, activePackPath, voiceOn]);

  /* ── Gemini Live Voice System ────────────────────────── */

  const liveSessionRef = React.useRef<WebSocket | null>(null);
  const liveAudioCtxRef = React.useRef<AudioContext | null>(null);
  const liveMicStreamRef = React.useRef<MediaStream | null>(null);
  const liveMicProcessorRef = React.useRef<AudioNode | null>(null);
  // Actual AudioContext rate, discovered on mic start — iOS Safari may
  // silently ignore a requested 16000Hz and open at 48000.
  const liveMicSampleRateRef = React.useRef(16000);
  const livePlayCtxRef = React.useRef<AudioContext | null>(null);
  const livePlayScheduleTimeRef = React.useRef(0);
  const liveInterimTextRef = React.useRef("");
  const liveModelAccumTextRef = React.useRef("");
  // Live-mode output transcription painted as a growing ghost bubble while
  // the professor speaks (only when transcripts are enabled).
  const [modelInterim, setModelInterim] = React.useState("");

  /** Clear the accumulating output-transcription buffer AND its on-screen
      ghost bubble. Every path that resets the accumulator must use this so
      the partial caption never outlives its audio. */
  function resetModelAccum() {
    liveModelAccumTextRef.current = "";
    setModelInterim("");
  }

  /* Commit the professor's (partial) spoken text as a model transcript entry. */
  function finalizeModelText(text: string) {
    if (!text) return;
    const transcriptNow = transcriptRef.current;
    const last = transcriptNow.length && transcriptNow[transcriptNow.length - 1];
    if (last && last.role === "model" && last.text === text) return;
    const updated = [...transcriptNow, { role: "model" as const, text: sanitizeModelText(text) }];
    setTranscript(updated);
    setRenderedCount((prev) => prev + 1);
    resetModelAccum();
    saveSession(updated);
  }

  function getGenderVoice(): string {
    if (!activeCase) return "Charon";
    if (activeCase.type === "data-interp") return "Charon";
    if (isPediatric(activeCase.patient.age)) return "Aoede";
    return activeCase.patient.gender === "female" ? "Aoede" : "Charon";
  }

  function startGeminiLive() {
    stopGeminiLive();
    if (!hasApiKey()) { setError("API key required for Gemini Live mode."); return; }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setError("Microphone not accessible.");
      return;
    }
    setVoicePhase("listening");
    const modelName = getLiveModel();
    const apiKey = getApiKey();
    const wsUrl =
      "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=" +
      apiKey;
    const ws = new WebSocket(wsUrl);
    // Use arraybuffer for predictable binary frame handling — Gemini Live
    // sends JSON text frames, but Blob parsing adds a FileReader microtask
    // hop and is slower under load.
    ws.binaryType = "arraybuffer";
    liveSessionRef.current = ws;

    ws.onopen = () => {
      const sysPrompt =
        activeCase && activeCase.type === "data-interp"
          ? buildDataInterpSysPrompt(activeCase)
          : buildPatientSysPrompt(activeCase!);
      // Transcriptions are opt-in (default off). When disabled, the Live
      // API streams pure audio with no `sc.inputTranscription` /
      // `sc.outputTranscription` events — this matches the ChatGPT-voice
      // UX where the conversation is purely audio and the transcript is a
      // deliberate user choice. Saves Live API quota and latency.
      const wantTranscripts =
        typeof window !== "undefined" &&
        localStorage.getItem(STORAGE.liveTranscripts) === "true";
      const setup: Record<string, unknown> = {
        model: "models/" + modelName,
        generationConfig: {
          responseModalities: ["AUDIO"],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: getGenderVoice() } },
          },
          temperature: 1.0,
        },
        systemInstruction: { parts: [{ text: sysPrompt }] },
      };
      if (wantTranscripts) {
        setup.inputAudioTranscription = {};
        setup.outputAudioTranscription = {};
      }
      ws.send(JSON.stringify({ setup }));
    };

    ws.onmessage = (e: MessageEvent) => {
      const raw = e.data;
      if (raw instanceof Blob) {
        const reader = new FileReader();
        reader.onload = () => handleLiveMessage(reader.result as string);
        reader.readAsText(raw);
        return;
      }
      if (raw instanceof ArrayBuffer) {
        handleLiveMessage(new TextDecoder().decode(raw));
        return;
      }
      handleLiveMessage(raw);
    };

    function handleLiveMessage(jsonStr: string) {
      try {
        const data = JSON.parse(jsonStr);
        if (data.setupComplete) {
          if (transcriptRef.current.length) {
            const firstUserIdx = transcriptRef.current.findIndex((m) => m.role !== "model");
            if (firstUserIdx >= 0) {
              const histTurns = transcriptRef.current.slice(firstUserIdx).map((m) => ({
                role: m.role === "model" ? "model" : "user",
                parts: [{ text: m.text }],
              }));
              ws.send(JSON.stringify({ clientContent: { turns: histTurns, turnComplete: false } }));
            }
          }
          setTimeout(startLiveMic, 300);
          return;
        }
        if (data.error) { console.error("[GeminiLive] Error:", data.error); return; }
        const sc = data.serverContent;
        if (!sc) return;
        if (sc.inputTranscription && sc.inputTranscription.text) {
          const userText = sc.inputTranscription.text.trim();
          setVoicePhase("listening");
          if (!userText) {
            liveInterimTextRef.current = "";
            setInterimText("");
          } else if (sc.inputTranscription.finished) {
            const transcriptNow = transcriptRef.current;
            const last = transcriptNow.length && transcriptNow[transcriptNow.length - 1];
            if (!(last && last.role === "user" && last.text === userText)) {
              const updated = [...transcriptNow, { role: "user" as const, text: userText }];
              setTranscript(updated);
              setRenderedCount((prev) => prev + 1);
              saveSession();
            }
            liveInterimTextRef.current = "";
            setInterimText("");
          } else {
            liveInterimTextRef.current = userText;
            setInterimText(userText);
          }
        }
        if (sc.outputTranscription && sc.outputTranscription.text) {
          const modelText = sc.outputTranscription.text.trim();
          if (modelText && sc.outputTranscription.finished) {
            finalizeModelText(modelText);
          } else if (modelText) {
            setVoicePhase("speaking");
            if (modelText.length > liveModelAccumTextRef.current.length && modelText.startsWith(liveModelAccumTextRef.current)) {
              liveModelAccumTextRef.current = modelText;
            } else {
              liveModelAccumTextRef.current += (liveModelAccumTextRef.current ? " " : "") + modelText;
            }
            // Stream the partial transcription into the ghost bubble so the
            // professor's words appear as they are spoken, not after.
            setModelInterim(liveModelAccumTextRef.current);
          }
        }
        if (sc.modelTurn && sc.modelTurn.parts && sc.modelTurn.parts.length) {
          setVoicePhase("speaking");
          if (liveInterimTextRef.current) {
            const transcriptNow = transcriptRef.current;
            const last = transcriptNow.length && transcriptNow[transcriptNow.length - 1];
            if (!(last && last.role === "user" && last.text === liveInterimTextRef.current)) {
              setTranscript([...transcriptNow, { role: "user", text: liveInterimTextRef.current }]);
              setRenderedCount((prev) => prev + 1);
            }
            liveInterimTextRef.current = "";
            setInterimText("");
          }
          sc.modelTurn.parts.forEach(
            (part: { inlineData?: { mimeType: string; data: string } }) => {
              if (!part.inlineData) return;
              if (!part.inlineData.mimeType) return;
              const mimeLower = part.inlineData.mimeType.toLowerCase();
              if (!mimeLower.includes("audio")) return;
              playLiveAudio(part.inlineData.data, part.inlineData.mimeType);
            }
          );
        }
        if (sc.interrupted) {
          // Only treat as a genuine interruption if we've accumulated
          // meaningful text — brief stutter artifacts should be ignored
          // so the model can finish its answer without being cut off.
          const accumulated = liveModelAccumTextRef.current || "";
          const MIN_INTERRUPT_LENGTH = 20;
          if (accumulated.length >= MIN_INTERRUPT_LENGTH) {
            if (livePlayCtxRef.current) {
              try { livePlayCtxRef.current.close(); } catch {}
              livePlayCtxRef.current = null;
            }
            livePlayScheduleTimeRef.current = 0;
            playbackLevelRef.current = 0;
            // The student cut the professor off mid-sentence — commit whatever
            // the professor had said so far so the interruption is preserved in
            // the transcript for both sides.
            if (accumulated) {
              finalizeModelText(accumulated);
            }
            resetModelAccum();
            setVoicePhase("listening");
          }
          // else: stutter artifact — keep speaking, do nothing
        }
        if (sc.turnComplete) {
          if (liveModelAccumTextRef.current) {
            finalizeModelText(liveModelAccumTextRef.current);
          }
          playbackLevelRef.current = 0;
          setVoicePhase("idle");
        }
      } catch (e) {
        console.error("[GeminiLive] parse error:", e);
      }
    }

    ws.onerror = (ev: Event) => {
      // WebSocket error events carry no detail by spec — the real error
      // arrives in the close event's code/reason. Defer the user-facing
      // message to onclose so we can surface "401 invalid API key" instead
      // of a generic "connection failed".
      console.error("[GeminiLive] WebSocket error event:", ev);
    };

    ws.onclose = (ev: CloseEvent) => {
      liveSessionRef.current = null;
      stopLiveMic();
      setVoicePhase("idle");
      micLevelRef.current = 0;
      playbackLevelRef.current = 0;
      // 1000 = normal close (user toggled voice off); 1001 = going away
      // (page unload). Anything else is an error — surface the close
      // code/reason so the user sees WHY the connection dropped instead
      // of a generic failure banner.
      if (ev.code !== 1000 && ev.code !== 1001) {
        let reason = ev.reason || "";
        // Gemini Live sometimes sends a structured error JSON in the
        // reason field on 400/401/403/429 — extract the human message.
        try {
          const parsed = JSON.parse(reason);
          if (parsed?.error?.message) reason = parsed.error.message;
        } catch {}
        if (!reason) {
          if (ev.code === 1006) reason = "Network or auth failure — check your Gemini API key.";
          else if (ev.code === 1008) reason = "Policy violation — check your Gemini API key and model name.";
          else reason = `Connection closed (code ${ev.code})`;
        }
        setError("Gemini Live disconnected: " + reason + " Falling back to text mode.");
      }
    };
  }

  function stopGeminiLive() {
    stopLiveMic();
    livePlayScheduleTimeRef.current = 0;
    liveInterimTextRef.current = "";
    resetModelAccum();
    if (liveSessionRef.current) {
      try { liveSessionRef.current.close(); } catch {}
      liveSessionRef.current = null;
    }
    if (livePlayCtxRef.current) {
      try { livePlayCtxRef.current.close(); } catch {}
      livePlayCtxRef.current = null;
    }
    if (liveAudioCtxRef.current) {
      try { liveAudioCtxRef.current.close(); } catch {}
      liveAudioCtxRef.current = null;
    }
    setInterimText("");
    setVoicePhase("idle");
    micLevelRef.current = 0;
    playbackLevelRef.current = 0;
  }

  /** Cheap RMS amplitude (0..1) of a PCM float chunk, downsampled for perf. */
  function rmsLevel(samples: Float32Array): number {
    if (!samples || !samples.length) return 0;
    const step = Math.max(1, Math.floor(samples.length / 256));
    let sum = 0;
    let n = 0;
    for (let i = 0; i < samples.length; i += step) {
      const v = samples[i];
      sum += v * v;
      n++;
    }
    const rms = Math.sqrt(sum / Math.max(1, n));
    // Perceptual boost so normal speech visibly moves the orb rather than
    // needing to shout, then clamp to the shader's expected 0..1 range.
    return Math.max(0, Math.min(1, rms * 4.5));
  }

  /** Read by the voice-mode FluidOrb every animation frame — no re-renders. */
  function getVoiceLevel(): number {
    if (voicePhaseRef.current === "speaking") return playbackLevelRef.current;
    if (voicePhaseRef.current === "listening") return micLevelRef.current;
    return 0;
  }

  /** Encode one Float32 PCM chunk and stream it to the Live socket.
      Shared by the AudioWorklet and ScriptProcessor mic paths. */
  function sendLiveAudioChunk(samples: Float32Array): boolean {
    const ws = liveSessionRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    const pcm = new Int16Array(samples.length);
    for (let i = 0; i < samples.length; i++) pcm[i] = Math.max(-32768, Math.min(32767, Math.round(samples[i] * 32767)));
    const bytes = new Uint8Array(pcm.buffer);
    // Chunked base64 encoding — String.fromCharCode.apply(null, ...)
    // processes ~32KB at a time and is O(n) instead of the previous
    // O(n^2) string-concatenation loop, which stalled the audio
    // thread on long chunks and caused glitchy playback.
    const CHUNK = 0x8000;
    let binary = "";
    for (let i = 0; i < bytes.length; i += CHUNK) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK) as unknown as number[]);
    }
    ws.send(JSON.stringify({ realtimeInput: { audio: { data: btoa(binary), mimeType: "audio/pcm;rate=" + liveMicSampleRateRef.current } } }));
    return true;
  }

  function startLiveMic() {
    navigator.mediaDevices
      .getUserMedia({ audio: true })
      .then((stream) => {
        liveMicStreamRef.current = stream;
        const actx = new (window.AudioContext || (window as unknown as Record<string, unknown>).webkitAudioContext)({ sampleRate: 16000 }) as AudioContext;
        liveAudioCtxRef.current = actx;
        // Capture the ACTUAL context sample rate — iOS Safari may silently
        // ignore the requested 16000Hz and create the context at 48000. If
        // we hard-code rate=16000 in the mime but the PCM is actually at
        // 48000, Gemini's VAD hears chipmunk-speed audio and never fires.
        const micSampleRate = actx.sampleRate;
        liveMicSampleRateRef.current = micSampleRate;
        const source = actx.createMediaStreamSource(stream);
        // Guard `inputs[0][0]` — when the mic is briefly disconnected
        // (e.g., iOS Safari backgrounding, Bluetooth headset swap) the
        // worklet receives an empty inputs array, and posting `undefined`
        // crashes the receiver's Float32Array constructor.
        const processorCode =
          "class MicProcessor extends AudioWorkletProcessor{process(inputs){const c=inputs[0]&&inputs[0][0];if(c)this.port.postMessage(c);return true;}}registerProcessor('mic-processor',MicProcessor);";
        const blob = new Blob([processorCode], { type: "application/javascript" });
        const url = URL.createObjectURL(blob);
        actx.audioWorklet.addModule(url).then(() => {
          const node = new AudioWorkletNode(actx, "mic-processor");
          // The worklet fires every 128-frame quantum (~375 msgs/sec at
          // 48kHz). Encoding + JSON.stringify + ws.send at that rate floods
          // the main thread and was the main cause of voice-mode stutter.
          // Batch quanta into ~2048-sample chunks (~43ms) before sending —
          // still far below Live's latency floor, but ~16x fewer main-thread
          // roundtrips, which also steadies the orb's level input.
          const MIC_CHUNK_SAMPLES = 2048;
          let micBuf = new Float32Array(MIC_CHUNK_SAMPLES);
          let micBufFill = 0;
          node.port.onmessage = (e) => {
            if (!liveSessionRef.current || liveSessionRef.current.readyState !== WebSocket.OPEN) {
              micBufFill = 0;
              return;
            }
            // Microphone audio is streamed continuously — including while the
            // model speaks — so Gemini Live's VAD can hear the student talk
            // over the professor and emit sc.interrupted (auto-interruption).
            const input = e.data as Float32Array;
            if (!input || !input.length) return;
            micLevelRef.current = rmsLevel(input);
            let offset = 0;
            while (offset < input.length) {
              const n = Math.min(MIC_CHUNK_SAMPLES - micBufFill, input.length - offset);
              micBuf.set(input.subarray(offset, offset + n), micBufFill);
              micBufFill += n;
              offset += n;
              if (micBufFill === MIC_CHUNK_SAMPLES) {
                sendLiveAudioChunk(micBuf);
                micBufFill = 0;
              }
            }
          };
          source.connect(node);
          liveMicProcessorRef.current = node;
          URL.revokeObjectURL(url);
        }).catch(() => {
          startLiveMicFallback(stream);
        });
      })
      .catch((err) => {
        stopGeminiLive();
        setError("Microphone access denied: " + err.message);
      });
  }

  function startLiveMicFallback(stream: MediaStream) {
    try {
      const actx = liveAudioCtxRef.current;
      if (!actx) return;
      // Mirror the worklet path: use the ACTUAL context sample rate, not
      // a hard-coded 16000 — see startLiveMic() for the iOS rationale.
      liveMicSampleRateRef.current = actx.sampleRate;
      const processor = actx.createScriptProcessor(4096, 1, 1);
      processor.onaudioprocess = (e) => {
        // Streamed continuously — see the AudioWorklet mic path above.
        const input = e.inputBuffer.getChannelData(0);
        if (!input || !input.length) return;
        micLevelRef.current = rmsLevel(input);
        sendLiveAudioChunk(input);
      };
      const source = actx.createMediaStreamSource(stream);
      source.connect(processor);
      liveMicProcessorRef.current = processor;
    } catch {
      stopGeminiLive();
      setError("Microphone init failed.");
    }
  }

  function stopLiveMic() {
    if (liveMicProcessorRef.current) {
      try { (liveMicProcessorRef.current as AudioNode).disconnect(); } catch {}
      liveMicProcessorRef.current = null;
    }
    if (liveMicStreamRef.current) {
      liveMicStreamRef.current.getTracks().forEach((t) => t.stop());
      liveMicStreamRef.current = null;
    }
    micLevelRef.current = 0;
  }

  async function playLiveAudio(b64data: string, mimeType: string) {
    try {
      // If we are actively listening to the user, discard any leftover/delayed audio chunks from the server
      if (voicePhaseRef.current === "listening") return;

      let sampleRate = 24000;
      const match = mimeType && mimeType.match(/rate=(\d+)/);
      if (match) sampleRate = parseInt(match[1], 10);

      // Browsers may close the playback AudioContext under memory pressure
      // or after a long idle — if so, drop the stale handle and recreate.
      if (livePlayCtxRef.current && livePlayCtxRef.current.state === "closed") {
        livePlayCtxRef.current = null;
        livePlayScheduleTimeRef.current = 0;
      }

      // Create the AudioContext WITHOUT an explicit sampleRate option —
      // Safari iOS silently rejects non-standard rates like 24000 (falls
      // back to 48000 anyway) and Chrome prints a console warning when
      // the requested rate differs from the hardware rate. Letting the
      // browser pick the default avoids both; the AudioBuffer below is
      // tagged with the real PCM rate and the buffer source resamples
      // on play.
      if (!livePlayCtxRef.current) {
        const Ctor = (window.AudioContext || (window as unknown as Record<string, unknown>).webkitAudioContext) as typeof AudioContext;
        livePlayCtxRef.current = new Ctor() as AudioContext;
      }

      // resume() returns a Promise — if we don't await it, scheduled
      // buffers fire while the context is still suspended and play
      // silently. This is the root cause of "Gemini speaks but I hear
      // nothing" on iOS Safari after a tab regains focus.
      if (livePlayCtxRef.current.state === "suspended") {
        try { await livePlayCtxRef.current.resume(); } catch (e) { console.warn("[GeminiLive] ctx.resume() failed:", e); }
      }

      const ctx = livePlayCtxRef.current;
      if (!ctx) return;

      // Decode base64 audio data
      let raw: string;
      try { raw = atob(b64data); } catch { console.error("[GeminiLive] failed to decode base64 audio"); return; }
      if (raw.length === 0) return;

      // Convert base64 to PCM16 bytes
      const bytes = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
      const int16 = new Int16Array(bytes.buffer);
      const float32 = new Float32Array(int16.length);
      for (let j = 0; j < int16.length; j++) float32[j] = int16[j] / 32768;
      playbackLevelRef.current = rmsLevel(float32);

      // Create AudioBuffer — tag with the real PCM sample rate; the
      // browser resamples to the AudioContext's rate during playback.
      const buf = ctx.createBuffer(1, float32.length, sampleRate);
      buf.getChannelData(0).set(float32);

      // Schedule playback — use scheduleTimeRef to play chunks sequentially
      const startDelay = 0.15;
      const when = livePlayScheduleTimeRef.current > ctx.currentTime
        ? livePlayScheduleTimeRef.current
        : ctx.currentTime + startDelay;
      livePlayScheduleTimeRef.current = when + buf.duration;

      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(ctx.destination);
      src.start(when);
      // Disconnect the source after playback to avoid leaking
      // AudioBufferSourceNode graphs across a long exam session —
      // otherwise Chrome caps at ~256 nodes and silently drops audio.
      src.onended = () => { try { src.disconnect(); } catch {} };
      setVoicePhase("speaking");
    } catch (e) {
      console.error("[GeminiLive] playLiveAudio error:", e);
    }
  }

  function sendLiveText(text: string) {
    if (liveSessionRef.current && liveSessionRef.current.readyState === WebSocket.OPEN) {
      liveSessionRef.current.send(
        JSON.stringify({ clientContent: { turns: [{ role: "user", parts: [{ text }] }], turnComplete: true } })
      );
    }
  }

  function toggleVoice() {
    if (!hasApiKey()) { setError("Set a Gemini API key in Settings first."); return; }
    const next = !voiceOn;
    setVoiceOn(next);
    // Opening voice also opens the full-screen overlay (ChatGPT-voice-style).
    // Closing voice dismisses the overlay and ends the call.
    setVoiceOverlayOpen(next);
    localStorage.setItem(STORAGE.voiceOn, String(next));
    if (!next) {
      stopGeminiLive();
      setVoicePhase("idle");
    } else {
      stopGeminiLive();
      startGeminiLive();
    }
  }

  /** Used by the Printed Materials modal's "Open in Voice Mode" button —
      closes the modal and starts (or re-opens) the voice overlay so the
      student can go straight from reviewing the materials to being quizzed
      on them out loud. */
  function openMaterialsInVoiceMode() {
    setMaterialsModalOpen(false);
    if (!voiceOn) {
      toggleVoice();
    } else {
      setVoiceOverlayOpen(true);
    }
  }

  /** End the Live call completely — closes the WebSocket, mic, and overlay. */
  function endVoiceCall() {
    setVoiceOn(false);
    setVoiceOverlayOpen(false);
    localStorage.setItem(STORAGE.voiceOn, "false");
    stopGeminiLive();
    setVoicePhase("idle");
    micLevelRef.current = 0;
    playbackLevelRef.current = 0;
  }

  /** Whether on-screen transcripts are enabled in Live mode (opt-in, default off). */
  function isLiveTranscriptsOn(): boolean {
    return typeof window !== "undefined" && localStorage.getItem(STORAGE.liveTranscripts) === "true";
  }

  /** Toggle the Live transcripts setting from inside the voice overlay.
      Note: this takes effect on the NEXT Live connection — the running
      WebSocket's setup message already negotiated the transcription
      modality, so toggling mid-call doesn't retroactively start receiving
      sc.inputTranscription / sc.outputTranscription frames. */
  function toggleLiveTranscripts() {
    const next = !isLiveTranscriptsOn();
    localStorage.setItem(STORAGE.liveTranscripts, String(next));
    // Force a re-render so the overlay's captions badge updates.
    setRenderedCount((prev) => prev + 1);
  }

  function stopSpeaking() {
    if (livePlayCtxRef.current) {
      try { livePlayCtxRef.current.close(); } catch {}
      livePlayCtxRef.current = null;
    }
    livePlayScheduleTimeRef.current = 0;
    playbackLevelRef.current = 0;
    setVoicePhase("idle");
  }

  /* Manual interrupt — same as the automatic sc.interrupted path: commit the
     professor's partial utterance, cut the audio, and go back to listening so
     the student's interjection is picked up. */
  function interruptSpeaking() {
    const accumulated = liveModelAccumTextRef.current || "";
    const MIN_INTERRUPT_LENGTH = 20;
    if (accumulated.length >= MIN_INTERRUPT_LENGTH) {
      if (livePlayCtxRef.current) {
        try { livePlayCtxRef.current.close(); } catch {}
        livePlayCtxRef.current = null;
      }
      livePlayScheduleTimeRef.current = 0;
      playbackLevelRef.current = 0;
      if (accumulated) {
        finalizeModelText(accumulated);
      }
      resetModelAccum();
      setVoicePhase(voiceOnRef.current ? "listening" : "idle");
    }
  }

  /* TTS fallback */
  const voiceOnRef = React.useRef(false);
  React.useEffect(() => { voiceOnRef.current = voiceOn; }, [voiceOn]);

  function speakText(text: string) {
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    setVoicePhase("speaking");
    const utt = new SpeechSynthesisUtterance(text);
    const savedVoice = localStorage.getItem(STORAGE.ttsVoice);
    const voices = window.speechSynthesis.getVoices();
    if (savedVoice) {
      const v = voices.find((v) => v.name === savedVoice);
      if (v) utt.voice = v;
    } else {
      const preferred = voices.find(
        (v) => /en.gb/i.test(v.lang) || /daniel|samantha|karen|moira/i.test(v.name)
      );
      if (preferred) utt.voice = preferred;
    }
    utt.rate = parseFloat(localStorage.getItem(STORAGE.ttsRate) || "0.95");
    utt.pitch = 1;
    utt.onend = () => { setVoicePhase(voiceOnRef.current ? "listening" : "idle"); };
    utt.onerror = () => { setVoicePhase(voiceOnRef.current ? "listening" : "idle"); };
    window.speechSynthesis.speak(utt);
  }

  /* Init voice when entering conversation */
  React.useEffect(() => {
    if (phase !== "conversation") return;
    const on = localStorage.getItem(STORAGE.voiceOn) === "true";
    setVoiceOn(on);
    if (on) setTimeout(startGeminiLive, 500);
    return () => { stopGeminiLive(); };
  }, [phase]);

  /* ── Timer — auto-starts when entering conversation ── */
  React.useEffect(() => {
    if (phase !== "conversation") return;
    if (timerRef.current) clearInterval(timerRef.current);
    // Set the end-time anchor from the current remaining so wall-clock
    // ticks stay in sync even after background throttling / screen sleep.
    timerEndTimeRef.current = Date.now() + timerRemaining * 1000;
    timerRef.current = setInterval(() => {
      const r = Math.max(0, Math.ceil((timerEndTimeRef.current - Date.now()) / 1000));
      setTimerRemaining(r);
      if (r <= 0 && timerRef.current) clearInterval(timerRef.current);
    }, 1000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [phase]);

  function stopTimer() {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
  }

  /** Set the timer remaining and sync the wall-clock anchor so the
   *  countdown stays accurate after background throttling / screen sleep. */
  function resetTimer(seconds: number) {
    timerEndTimeRef.current = Date.now() + seconds * 1000;
    setTimerRemaining(seconds);
  }

  /* Session save/load */
  function sessionKey(): string {
    return STORAGE.session + (activeItem?.uid || selectedPackUid || "osce");
  }

  function saveSession(list?: TranscriptEntry[]) {
    const entries = list ?? transcript;
    if (!activeCase || !entries.length) return;
    try {
      localStorage.setItem(sessionKey(), JSON.stringify({ transcript: entries, timerRemaining }));
    } catch {}
  }

  function loadSession(): { transcript: TranscriptEntry[]; timerRemaining: number } | null {
    try {
      const r = localStorage.getItem(sessionKey());
      return r ? JSON.parse(r) : null;
    } catch { return null; }
  }

  function clearSession() {
    try { localStorage.removeItem(sessionKey()); } catch {}
  }

  /* Scroll to bottom */
  React.useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [transcript, thinking, streamingText, modelInterim]);

  /* Keyboard Escape */
  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && phase === "conversation") {
        if (resetModalOpen) { setResetModalOpen(false); return; }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [phase, resetModalOpen]);

  /* Waveform keyframes */
  React.useEffect(() => {
    if (typeof document === "undefined") return;
    if (document.getElementById("osce-wavestyles")) return;
    const st = document.createElement("style");
    st.id = "osce-wavestyles";
    st.textContent =
      "@keyframes w1{0%,100%{height:4px}50%{height:18px}}@keyframes w2{0%,100%{height:9px}50%{height:26px}}@keyframes w3{0%,100%{height:6px}50%{height:22px}}";
    document.head.appendChild(st);
  }, []);

  /* ── Phase: Select (Scenario Picker) ──────────────────────── */

  async function selectPack(pack: { node: ContentTreeNode; content: OsceContent | null }) {
    let content = pack.content;
    // Guard: branch nodes (folders with sub-packs but no direct data files)
    // can't be loaded as a single pack. This shouldn't happen now that the
    // hub uses flattenTree(), but a stale saved session or deep link could
    // still surface one — bail with a clear message instead of throwing
    // "No JSON data files in <path>" inside loadNodeContent.
    if (!content && (pack.node.files ?? []).filter((f) => f.endsWith(".json")).length === 0) {
      setError(
        `"${pack.node.title}" is a folder, not a pack. Open one of its sub-packs instead.`
      );
      return;
    }
    if (!content) {
      // Lazy content fetch — manifest-first loading means this only happens
      // when the user actually opens a pack, not when the hub mounts.
      setLoadingPack(true);
      try {
        const loaded = await loadContentByUid(pack.node.uid, "osce");
        content = loaded.type === "osce" ? (loaded as OsceContent) : null;
      } catch (err) {
        console.error("Failed to load OSCE pack:", err);
        content = null;
      } finally {
        setLoadingPack(false);
      }
      if (!content) {
        setError(
          "Could not load this OSCE pack. Check your connection and try again."
        );
        return;
      }
      setAllPacks((prev) =>
        prev.map((p) => (p.node.uid === pack.node.uid ? { ...p, content } : p)),
      );
    }
    const normalized = content.stations.map((s, i) =>
      normalizeStation(s as unknown as Record<string, unknown>, i)
    );
    setStations(normalized);
    setActiveIdx(0);
    setSelectedPackUid(pack.node.uid);
    setTranscript([]);
    setResult(null);
    setError(null);
    resetTimer(normalized[0]?.time || EXAM_TIME);
    setPhase("lobby");
  }

  // ── Folder-navigation helpers (ported from qbank's ContentTab) ────────
  // contentByUid gives O(1) lookup of cached content when computing per-folder
  // stats and rendering pack cards. Built from the flat leaf list since only
  // leaves have loadable content.
  const contentByUid = React.useMemo(() => {
    const map = new Map<string, OsceContent | null>();
    for (const { node, content } of allPacks) {
      map.set(node.uid, content);
    }
    return map;
  }, [allPacks]);

  // Universal content-language filter (Settings → Language): root leaves are
  // filtered by lang; branches stay intact so the user can still drill in.
  const filteredRootTree = React.useMemo(() => {
    if (contentFilter === "all") return allTree;
    return allTree.filter((node) => {
      if (node.items.length > 0) return true;
      return (node.lang ?? contentByUid.get(node.uid)?.meta.lang ?? "en") === contentFilter;
    });
  }, [allTree, contentFilter, contentByUid]);

  /** Recursively collect every leaf uid under a node (used for folder stats). */
  const collectLeafUids = React.useCallback((node: ContentTreeNode): string[] => {
    if (node.items.length === 0) return [node.uid];
    return node.items.flatMap(collectLeafUids);
  }, []);

  /** Per-folder rollup: total leaf packs and total stations across all leaves. */
  const folderStats = React.useCallback(
    (node: ContentTreeNode): { packs: number; stations: number } => {
      const uids = collectLeafUids(node);
      let packs = 0;
      let stations = 0;
      for (const uid of uids) {
        packs += 1;
        const leaf = allPacks.find((p) => p.node.uid === uid);
        const content = leaf?.content;
        const nodeStationCount =
          content?.stations?.length
          || leaf?.node.stationSummary?.length
          || leaf?.node.itemCount
          || 0;
        stations += nodeStationCount;
      }
      return { packs, stations };
    },
    [collectLeafUids, allPacks],
  );

  /** Render a single OSCE leaf pack as a clickable card. Shared by the root
   *  grid and the subfolder grid so the look is identical everywhere. */
  const renderOscePackCard = (node: ContentTreeNode, idx: number) => {
    const content = contentByUid.get(node.uid) ?? null;
    const stationCount =
      content?.stations?.length
      || node.stationSummary?.length
      || node.itemCount
      || 0;
    const tags = content?.meta.tags?.slice(0, 4) || node.tags?.slice(0, 4) || [];
    const description = content?.meta.description || node.description;
    const packUrls = collectPackUrls(node);
    const lang = node.lang ?? content?.meta.lang;
    return (
      <motion.div
        key={node.uid}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ ...MOTION_TRANSITION.quick, delay: idx * 0.04 }}
        className="h-full"
      >
        <div
          role="button"
          tabIndex={0}
          onClick={() => void selectPack({ node, content })}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              void selectPack({ node, content });
            }
          }}
          {...ctxLinkAttrs(routeFor("osce", { uid: node.uid }), node.title)}
          className={cn(
            "w-full h-full text-start group relative overflow-hidden bg-card border border-border rounded-xl p-5 hover:border-primary/40 hover:shadow-md transition-all duration-200 active:scale-[0.99] cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 flex flex-col",
            lang === "ar" && "osler-content-ar",
          )}
          dir={lang === "ar" ? "rtl" : undefined}
          lang={lang ?? undefined}
        >
          <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-primary/60 to-primary/20 opacity-0 group-hover:opacity-100 transition-opacity" />
          <div className="flex items-start justify-between gap-3 mb-3">
            <div className="size-9 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
              <Stethoscope className="size-4 text-primary" />
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <ContentCacheButton packId={node.uid} urls={packUrls} />
              <span className="text-[11px] font-medium text-muted-foreground tabular-nums">
                {stationCount} {stationCount === 1 ? "station" : "stations"}
              </span>
              <ArrowRight className="size-3.5 text-muted-foreground group-hover:text-primary group-hover:translate-x-0.5 transition-all" />
            </div>
          </div>
          <h3 className="font-semibold text-sm mb-1 group-hover:text-primary transition-colors leading-snug">
            {node.title}
          </h3>
          {description && (
            <p className="text-xs text-muted-foreground line-clamp-2 mb-3 leading-relaxed">
              {description}
            </p>
          )}
          {tags.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-auto pt-3">
              {tags.map((tag) => (
                <span
                  key={tag}
                  className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full bg-muted/60 text-muted-foreground border border-border"
                >
                  <Tag className="size-2.5" />
                  {tag}
                </span>
              ))}
            </div>
          )}
        </div>
      </motion.div>
    );
  };

  /** Render a single folder card (mirrors qbank's folder card). Clicking
   *  pushes the folder onto the selectedFolders stack, sliding in the
   *  subfolder view via NavigationStack. */
  const renderOsceFolderCard = (node: ContentTreeNode, idx: number) => {
    const fs = folderStats(node);
    return (
      <motion.div
        key={node.uid}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ ...MOTION_TRANSITION.quick, delay: idx * 0.04 }}
        className="h-full"
      >
        <button
          type="button"
          aria-label={node.title}
          onClick={() => {
            setSelectedFolders((folders) => [...folders, node]);
          }}
          className="osler-fade-in h-full w-full min-w-0 justify-start text-start bg-card border border-border rounded-xl p-5 hover:border-primary/40 hover:shadow-md hover:bg-card transition-all group flex items-center gap-3.5 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        >
          <div className="size-11 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
            <Folder className="size-5 text-primary" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="font-semibold text-sm truncate">{node.title}</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              {t("osce.folder.stats", { packs: fs.packs, stations: fs.stations })}
            </p>
          </div>
          <ChevronRight className="size-4 text-muted-foreground/40 group-hover:text-primary transition-colors shrink-0" />
        </button>
      </motion.div>
    );
  };

  if (selfPackError && uid) {
    return (
      <div className="osler-page">
        <div className="osler-page__inner flex items-center">
          <EmptyState
            icon={Stethoscope}
            title={t("empty.osce.title")}
            description={t("empty.osce.description")}
            actions={
              <Button variant="outline" onClick={() => navigate("osce")}>
                {t("empty.osce.back")}
              </Button>
            }
          />
        </div>
      </div>
    );
  }

  if (phase === "select") {
    // Topmost breadcrumb entry — null means "root grid is showing".
    const selectedFolder = selectedFolders.at(-1) ?? null;

    // ── ROOT VIEW (folder cards + leaf pack cards) ─────────────────────
    // Always rendered as the NavigationStack home layer. When a folder is
    // open, this layer dims to 65% opacity and the subfolder view slides in
    // on top (see `subfolderView` below). Mirrors qbank's ContentTab.
    const decksView = (
      <div className="osler-page__inner">
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={MOTION_TRANSITION.slow}
        >
          {/* Page header */}
          <div className="osler-page-header--inline">
            <div className="size-10 rounded-xl bg-primary/15 border border-primary/30 flex items-center justify-center shrink-0">
              <Stethoscope className="size-5 text-primary" />
            </div>
            <div>
              <h1 className="osler-page-header__title">{t("osce.home.title")}</h1>
              <p className="osler-page-header__subtitle">
                {t("osce.home.subtitle")}
              </p>
            </div>
          </div>

          {/* Inline error banner — shown if a lazy pack fetch fails */}
          {error && phase === "select" && (
            <div className="mb-3 flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              <AlertCircle className="size-4 shrink-0 mt-0.5" />
              <div className="flex-1">{error}</div>
              <button
                className="text-destructive/80 hover:text-destructive text-[11px] font-medium underline"
                onClick={() => setError(null)}
              >
                {t("common.dismiss")}
              </button>
            </div>
          )}

          {/* Folder / pack grid — branches render as folder cards (click to
              drill in), leaves render as the existing OSCE pack cards. */}
          {packsLoading ? (
            <div className="osler-loading">
              <Loader2 className="size-6 animate-spin text-primary" />
              <span className="text-sm">{t("osce.home.loading")}</span>
            </div>
          ) : allTree.length === 0 ? (
            <ComingSoonState icon={Stethoscope} />
          ) : filteredRootTree.length === 0 ? (
            <div className="osler-empty">
              <div className="osler-empty__icon">
                <Stethoscope className="size-6" />
              </div>
              <div>
                <p className="osler-empty__title mb-1">{t("osce.home.empty")}</p>
                <p className="osler-empty__body">
                  {t("osce.home.empty")}
                </p>
              </div>
              <button
                onClick={onExit}
                className="h-9 px-4 rounded-md border border-border text-sm font-medium hover:bg-muted/60 transition-colors"
              >
                {t("nav.dashboard")}
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 auto-rows-fr">
              {filteredRootTree.map((node, idx) =>
                node.items.length > 0
                  ? renderOsceFolderCard(node, idx)
                  : renderOscePackCard(node, idx),
              )}
            </div>
          )}
        </motion.div>
      </div>
    );

    // ── SUBFOLDER VIEW (drill-down) ────────────────────────────────────
    // Slides in on top of the root view when a folder is clicked. Has its
    // own header (back button + folder title + stats) and a search box that
    let subfolderView: React.ReactNode = null;
    if (selectedFolder) {
      const fs = folderStats(selectedFolder);
      // Local search removed — the unified global search bar handles content
      // discovery. Just render the folder's children directly.
      const childTree = selectedFolder.items;

      subfolderView = (
        <div className="osler-page__inner">
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={MOTION_TRANSITION.slow}
          >
            {/* Header block — back button + breadcrumb + title + stats,
                wrapped in mb-6 so the child grid breathes (mirrors qbank). */}
            <div className="mb-6">
              <button
                onClick={() => {
                  setSelectedFolders((folders) => folders.slice(0, -1));
                }}
                className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors mb-3"
              >
                <ArrowLeft className={cn("size-3.5", rtl && "rtl-flip-x")} />
                {t("osce.home.title")}
              </button>

              <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
                <Folder className="size-3.5 text-primary" />
                <span className="text-primary">{t("osce.home.title")}</span>
              </div>
              <h1 className="text-2xl md:text-3xl font-bold tracking-tight mb-1">
                {selectedFolder.title}
              </h1>
              <p className="text-sm text-muted-foreground">
                {fs.packs} {fs.packs === 1 ? "pack" : "packs"} · {fs.stations} {fs.stations === 1 ? "station" : "stations"}
              </p>
            </div>

            {/* Child grid */}
            {childTree.length === 0 ? (
              <div className="osler-empty">
                <div className="osler-empty__icon">
                  <Folder className="size-6" />
                </div>
                <div>
                  <p className="osler-empty__title mb-1">{t("osce.home.empty")}</p>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 auto-rows-fr">
                {childTree.map((child, idx) =>
                  child.items.length > 0
                    ? renderOsceFolderCard(child, idx)
                    : renderOscePackCard(child, idx),
                )}
              </div>
            )}
          </motion.div>
        </div>
      );
    }

    return (
      <motion.div {...learnHubDismiss} className="osler-page">
        {/* Loading overlay — hoisted outside NavigationStack so it stays
            visible at full opacity even when a subfolder view is open. */}
        {loadingPack && (
          <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center pointer-events-none">
            <div className="flex items-center gap-2 rounded-lg bg-card border border-border px-4 py-3 shadow-md">
              <Loader2 className="size-4 animate-spin text-primary" />
              <span className="text-sm font-medium">Loading pack…</span>
            </div>
          </div>
        )}

        <NavigationStack
          className="h-full"
          homeClassName="osler-page"
          subpageClassName="osler-page"
          rtl={rtl}
          home={decksView}
          subpage={subfolderView}
          onBack={() => {
            setSelectedFolders((folders) => folders.slice(0, -1));
          }}
        />
      </motion.div>
    );
  }

  /* ── Lobby Screen ──────────────────────────────────────────── */

  if (phase === "lobby" && activeCase) {
    const p = activeCase.patient;
    const isDataInterp = activeCase.type === "data-interp";
    const dur = Math.floor((activeCase.time || EXAM_TIME) / 60);
    const stationDuration = activeCase.time || EXAM_TIME;

    function startConsultation() {
      const saved = loadSession();
      if (saved && saved.transcript && saved.transcript.length) {
        setTranscript(saved.transcript);
        resetTimer(saved.timerRemaining || stationDuration);
      } else {
        setTranscript([]);
        resetTimer(stationDuration);
      }
      setRenderedCount(0);
      setResult(null);
      setError(null);
      setPhase("conversation");
    }

     return (
      <motion.div
        className="fixed inset-0 z-50 bg-background overflow-y-auto osler-scroll"
        {...lobbyDismiss}
      >
        <div className="max-w-3xl mx-auto px-4 md:px-8 py-8">
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={MOTION_TRANSITION.slow}
          >
            {/* Back */}
            <button
              onClick={() => setPhase("select")}
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground mb-4 transition-colors"
            >
              <ChevronLeft className="size-3.5" />
              All scenarios
            </button>

            {/* Header */}
            <div className="relative overflow-hidden bg-card border border-border rounded-xl p-5 md:p-6 mb-5">
              <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-primary/60 to-transparent" />
              <div className="flex items-start gap-4">
                <div className="size-12 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
                  <Stethoscope className="size-6 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <span className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">
                      {isDataInterp ? "Data Interpretation" : "Virtual Patient"}
                    </span>
                    <span className={cn("text-[11px] font-semibold px-2 py-0.5 rounded-full border", diffClass(activeCase.difficulty))}>
                      {activeCase.difficulty}
                    </span>
                  </div>
                  <h2 className="text-lg font-bold tracking-tight mb-0.5">{activeCase.title}</h2>
                  <p className="text-xs text-muted-foreground">{activeCase.specialty}</p>
                </div>
              </div>
            </div>

            {/* Patient info */}
            {!isDataInterp && (
              <div className="bg-card border border-border rounded-xl p-4 mb-4">
                <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium mb-2">Patient</p>
                <div className="flex items-center gap-3">
                  <div className="size-10 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center text-primary font-bold text-sm shrink-0">
                    {p.name[0]}
                  </div>
                  <div>
                    <div className="font-semibold text-sm">{p.name}</div>
                    <div className="text-xs text-muted-foreground">{p.age} years old · {p.gender}</div>
                  </div>
                </div>
              </div>
            )}

            {/* Task */}
            <div className="bg-card border border-border rounded-xl p-4 mb-4">
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium mb-2">{t("osce.session.yourTask")}</p>
              <p className="text-sm leading-relaxed">{activeCase.task}</p>
            </div>

            {/* Data (if data-interp) */}
            {isDataInterp && activeCase.dataPresented?.scenario && (
              <div className="bg-card border border-border rounded-xl p-4 mb-4">
                <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium mb-2">{t("osce.session.clinicalScenario")}</p>
                <p className="text-sm leading-relaxed">{activeCase.dataPresented.scenario}</p>
              </div>
            )}
            {isDataInterp && activeCase.dataPresented?.tables && activeCase.dataPresented.tables.length > 0 && (
              <div className="mb-4">
                <DataTablesRenderer tables={activeCase.dataPresented.tables} />
              </div>
            )}
            {isDataInterp && activeCase.dataPresented?.images && activeCase.dataPresented.images.length > 0 && (
              <div className="mb-4">
                <DataImagesRenderer images={activeCase.dataPresented.images} packPath={activePackPath} />
              </div>
            )}

            {/* Stats row */}
            <div className="grid grid-cols-3 gap-3 mb-6">
              {[
                { icon: Clock, val: dur + " min", label: t("osce.session.timeLimit") },
                { icon: Activity, val: String(MAX_TURNS), label: t("osce.session.maxTurns") },
                { icon: BarChart3, val: "AI", label: t("osce.session.examiner") },
              ].map(({ icon: Icon, val, label }) => (
                <div key={label} className="bg-card border border-border rounded-xl p-3 text-center">
                  <Icon className="size-4 text-primary mx-auto mb-1" />
                  <div className="text-sm font-bold tabular-nums">{val}</div>
                  <div className="text-[11px] text-muted-foreground mt-0.5">{label}</div>
                </div>
              ))}
            </div>

            {/* Station navigation (if multiple) */}
            {stations.length > 1 && (
              <div className="bg-card border border-border rounded-xl p-4 mb-4">
                <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium mb-3">
                  {t("osce.session.stations", { n: stations.length })}
                </p>
                <div className="flex flex-wrap gap-2">
                  {stations.map((s, i) => (
                    <button
                      key={s.id}
                      onClick={() => {
                        setActiveIdx(i);
                        setTranscript([]);
                        setResult(null);
                        resetTimer(s.time || EXAM_TIME);
                      }}
                      className={cn(
                        "h-8 px-3 rounded-md text-xs font-medium border transition-colors",
                        i === activeIdx
                          ? "bg-primary/10 border-primary/30 text-primary"
                          : "border-border text-muted-foreground hover:border-primary/30 hover:text-foreground"
                      )}
                    >
                      {i + 1}. {s.title}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Actions */}
            <div className="flex items-center gap-3">
              <button
                onClick={startConsultation}
                className="inline-flex items-center gap-2 h-11 px-6 rounded-lg bg-primary text-primary-foreground font-semibold text-sm hover:bg-primary/90 transition-colors active:scale-[0.98]"
              >
                <Play className="size-4" />
                {isDataInterp ? t("osce.session.beginExam") : t("osce.session.enterRoom")}
              </button>
            </div>
          </motion.div>
        </div>
      </motion.div>
    );
  }

  /* ── Conversation Phase ─────────────────────────────────────── */

  if (phase === "conversation" && activeCase) {
    const p = activeCase.patient;
    const isDataInterp = activeCase.type === "data-interp";
    const isTimeUp = timerRemaining <= 0;
    const stationDuration = activeCase.time || EXAM_TIME;
    const turnCount = userTurnCount(transcript);
    const timeUsedPct = Math.round(((stationDuration - timerRemaining) / stationDuration) * 100);
    const turnPct = Math.min(100, Math.round((turnCount / Math.max(1, WARN_TURNS)) * 100));
    const momentum = Math.min(100, Math.round(turnPct * 0.7 + Math.min(timeUsedPct, 90) * 0.3));
    const mapStep = (() => {
      if (turnCount < 2) return 0;
      if (turnCount < 7) return 1;
      if (turnCount < 12) return 2;
      if (turnCount < 17) return 3;
      return 4;
    })();
    const speakerName = getSpeakerName(activeCase);

    // Orb phase sets — the professor/presenter alternates between them while
    // composing a reply, mirroring the AI assistant's orb vocabulary.
    const thinkingPhases: ThinkingPhase[] = isDataInterp
      ? [
          { label: t("osce.session.listening"), state: "listening" },
          { label: t("osce.session.orb.evaluating"), state: "searching" },
          { label: t("osce.session.orb.scoring"), state: "solving" },
          { label: t("osce.session.orb.composing"), state: "composing" },
        ]
      : [
          { label: t("osce.session.orb.thinking"), state: "working" },
          { label: t("osce.session.orb.recalling"), state: "searching" },
          { label: t("osce.session.orb.composing"), state: "composing" },
          { label: t("osce.session.orb.responding"), state: "solving" },
        ];
    const isSpeaking = voiceOn && voicePhase === "speaking";
    const isListening = voiceOn && voicePhase === "listening";
    const presenceOrbState: OrbState = isSpeaking
      ? "composing"
      : isListening
        ? "listening"
        : thinking
          ? isDataInterp
            ? "searching"
            : "working"
          : "breathing";

    async function handleSend() {
      const text = inputText.trim();
      if (!text || !activeCase) return;
      // A reply is still being revealed — finish writing before accepting
      // the next question so transcript order and session saves stay sane.
      if (streamingText !== null) return;
      if (!hasApiKey()) {
        setError("Configure your Gemini API key in Settings first.");
        return;
      }
      if (userTurnCount(transcript) >= MAX_TURNS) {
        setError(`Maximum ${MAX_TURNS} questions reached. Click Submit for feedback.`);
        return;
      }
      // The student cut the professor off by typing their answer — interrupt
      // the live speech and commit the professor's partial statement first.
      if (voiceOn && voicePhaseRef.current === "speaking") interruptSpeaking();
      setInputText("");
      setSending(true);
      setError(null);
      const newTranscript = [...transcript, { role: "user" as const, text }];
      setTranscript(newTranscript);
      setRenderedCount((prev) => prev + 1);
      setThinking(true);
      abortRef.current = new AbortController();
      let streamed = "";
      try {
        const onDelta = (full: string) => {
          streamed = full;
          // First token flips the thinking card into a live writing bubble.
          setThinking(false);
          setStreamingText(full);
        };
        const reply =
          activeCase.type === "data-interp"
            ? await askExaminer(activeCase, newTranscript, abortRef.current.signal, activePackPath, onDelta)
            : await askPatient(activeCase, newTranscript, abortRef.current.signal, onDelta);
        const cleanReply = sanitizeModelText(reply);
        const updated = [...newTranscript, { role: "model" as const, text: cleanReply }];
        // Defer the commit until the typewriter reveal catches up so the
        // answer visibly finishes writing instead of snapping to full.
        streamSettleRef.current = () => {
          setStreamingText(null);
          setTranscript(updated);
          setRenderedCount((prev) => prev + 2);
          saveSession(updated);
          if (voiceOn) speakText(cleanReply);
        };
        setThinking(false);
        setStreamingText(cleanReply);
      } catch (err: unknown) {
        setThinking(false);
        streamSettleRef.current = null;
        setStreamingText(null);
        if (err instanceof Error && err.name === "AbortError") {
          // Keep whatever streamed before the abort so the student still
          // sees the partial answer instead of it vanishing.
          if (streamed.trim()) {
            const updated = [...newTranscript, { role: "model" as const, text: sanitizeModelText(streamed) }];
            setTranscript(updated);
            setRenderedCount((prev) => prev + 2);
            saveSession(updated);
          }
          return;
        }
        setError(err instanceof Error ? err.message : "Failed to get response");
      } finally {
        setSending(false);
        if (inputRef.current) inputRef.current.focus();
      }
    }

    async function handleSubmit() {
      if (!hasApiKey()) { setError("Configure your Gemini API key first."); return; }
      if (!transcript.filter((m) => m.role === "user").length) {
        setError("Ask at least one question first.");
        return;
      }
      if (!activeCase) return;
      stopTimer();
      if (abortRef.current) abortRef.current.abort();
      setThinking(true);
      setError(null);
      abortRef.current = new AbortController();
      try {
        const r =
          activeCase.type === "data-interp"
            ? await scoreDataInterpExam(activeCase, transcript, abortRef.current.signal, activePackPath)
            : await scoreInterview(activeCase, transcript, abortRef.current.signal);
        clearSession();
        setResult(r);
        setPhase("debrief");
        if (r.score >= 80) setTimeout(launchConfetti, 400);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Feedback failed");
      } finally {
        setThinking(false);
      }
    }

    function handleReset() {
      stopTimer();
      if (voiceOn) stopSpeaking();
      streamSettleRef.current = null;
      setStreamingText(null);
      setTranscript([]);
      setRenderedCount(0);
      autoOpenRef.current = false;
      resetTimer(activeCase?.time || EXAM_TIME);
      setResult(null);
      setError(null);
      clearSession();
      setPhase("lobby");
      setResetModalOpen(false);
    }

    function insertPrompt(text: string) {
      setInputText(text);
      if (inputRef.current) inputRef.current.focus();
    }

    return (
      <motion.div className="fixed inset-0 z-50 bg-background flex flex-col overflow-hidden" {...conversationDismiss}>
        {/* ── Header ────────────────────────────────────────────
            Slimmer, cleaner header. The mic / end-call buttons live here so
            they're always reachable even when the voice overlay is minimised. */}
        <header className="flex items-center gap-2 px-3 md:px-4 py-2.5 bg-card/70 backdrop-blur-xl border-b border-border shrink-0">
          <button
            onClick={() => { stopTimer(); setPhase("lobby"); }}
            className="size-8 rounded-lg hover:bg-muted/60 flex items-center justify-center shrink-0 transition-colors"
            title={t("osce.session.backToLobby")}
            aria-label={t("osce.session.backToLobby")}
          >
            <ChevronLeft className="size-4" />
          </button>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold truncate">
              {isDataInterp ? activeCase.examiner?.name || "Examiner" : activeCase.title}
            </div>
            <div className="text-[11px] text-muted-foreground truncate">{activeCase.specialty}</div>
          </div>
          {/* Timer pill */}
          <div className="flex items-center gap-1.5 shrink-0 px-2.5 py-1 rounded-lg bg-muted/40 border border-border">
            <Clock className="size-3 text-muted-foreground" />
            <span
              className={cn(
                "text-sm font-bold tabular-nums",
                timerState(timerRemaining) === "ok" && "text-success",
                timerState(timerRemaining) === "warn" && "text-warning",
                timerState(timerRemaining) === "danger" && "text-destructive animate-pulse"
              )}
            >
              {formatTime(timerRemaining)}
            </span>
          </div>
          {/* Voice toggle — primary action */}
          <button
            onClick={toggleVoice}
            className={cn(
              "h-8 px-3 rounded-lg border flex items-center gap-1.5 text-xs font-semibold transition-all shrink-0",
              voiceOn
                ? "bg-destructive-soft border-destructive/30 text-destructive hover:bg-destructive/20"
                : "border-primary/30 bg-primary/10 text-primary hover:bg-primary/20"
            )}
            title={voiceOn ? t("osce.session.voiceOverlay.minimise") : t("osce.session.toggleVoice")}
            aria-label={voiceOn ? t("osce.session.voiceOverlay.minimise") : t("osce.session.toggleVoice")}
          >
            {voiceOn ? <PhoneOff className="size-3.5" /> : <Phone className="size-3.5" />}
            <span className="hidden sm:inline">{voiceOn ? t("osce.session.voiceOverlay.endCall") : t("osce.session.toggleVoice")}</span>
          </button>
        </header>

        {/* Timer progress bar (slim, gradient) */}
        <div className="h-0.5 bg-muted/40 shrink-0">
          <div
            className={cn(
              "h-full transition-all duration-1000",
              timerState(timerRemaining) === "ok" && "bg-gradient-to-r from-success/70 to-success",
              timerState(timerRemaining) === "warn" && "bg-gradient-to-r from-warning/70 to-warning",
              timerState(timerRemaining) === "danger" && "bg-gradient-to-r from-destructive/70 to-destructive"
            )}
            style={{ width: (timerRemaining / stationDuration) * 100 + "%" }}
          />
        </div>

        {/* Time up banner */}
        <AnimatePresence>
          {isTimeUp && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="bg-destructive-soft border-b border-destructive/20 text-destructive text-xs font-medium text-center py-1.5 shrink-0"
            >
              Time expired — submit for examiner feedback
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Body: single sidebar + chat zone ──────────────────
            Two asides (data-ref column + meta column) collapsed into one.
            On mobile the sidebar disappears entirely and the chat zone
            takes the full width; quick prompts move into a collapsible
            card pinned above the input area. */}
        <div className="flex-1 min-h-0 flex overflow-hidden">
          {/* Sidebar (desktop) */}
          {!isMobile && (
            <aside
              className="bg-card/60 border-e border-border flex flex-col gap-3 p-3 overflow-y-auto shrink-0 osler-scroll"
              style={{ width: SIDEBAR_WIDTH }}
            >
              {/* Speaker card */}
              <div className="bg-card border border-border rounded-xl p-3 shadow-e1">
                <div className="flex items-center gap-2.5">
                  <div className="size-10 rounded-full bg-gradient-to-br from-primary/15 to-primary/5 border border-primary/20 flex items-center justify-center text-primary font-semibold text-sm shrink-0">
                    {isDataInterp
                      ? (activeCase.examiner?.name?.[0] || "E")
                      : p.name[0]}
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-semibold truncate">
                      {isDataInterp ? activeCase.examiner?.name || "Examiner" : p.name}
                    </div>
                    <div className="text-[11px] text-muted-foreground truncate">
                      {isDataInterp
                        ? activeCase.examiner?.title || "Consultant"
                        : `${p.age}y · ${p.gender} · ${activeCase.specialty}`}
                    </div>
                  </div>
                </div>
              </div>

              {/* Printed materials — moved here from the old chat-zone strip
                  so reference material lives alongside the rest of the
                  station's meta (speaker, progress, map) instead of eating
                  vertical space above the transcript. Opens in a modal that
                  also offers a one-tap shortcut into voice mode. */}
              {isDataInterp && (activeCase.dataPresented?.scenario || (activeCase.dataPresented?.images || []).length > 0 || (activeCase.dataPresented?.tables || []).length > 0) && (
                <div className="bg-card border border-border rounded-xl p-3 shadow-e1">
                  <button
                    onClick={() => setMaterialsModalOpen(true)}
                    className="w-full flex items-center justify-between text-[11px] font-bold uppercase tracking-wider text-muted-foreground group"
                  >
                    <span className="flex items-center gap-1.5">
                      <BarChart3 className="size-3.5 text-primary" />
                      {t("osce.dataPresented.printedMaterials")}
                      {(() => {
                        const n = (activeCase.dataPresented?.images || []).length;
                        return n > 0 ? <span className="font-medium normal-case tracking-normal">({n})</span> : null;
                      })()}
                    </span>
                    <ChevronRight className="size-3.5 group-hover:text-primary transition-colors" />
                  </button>
                  {(activeCase.dataPresented?.images || []).length > 0 && (
                    <div className="mt-2 grid grid-cols-3 gap-1">
                      {(activeCase.dataPresented?.images || []).slice(0, 3).map((im, i) => {
                        const src = dataImageUrl(im, activePackPath);
                        if (!src) return null;
                        return (
                          <button
                            key={i}
                            onClick={() => setMaterialsModalOpen(true)}
                            className="rounded-md border border-border overflow-hidden bg-background aspect-square"
                          >
                            <img src={src} alt="" className="w-full h-full object-cover" loading="lazy" />
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* Progress card */}
              <div className="bg-card border border-border rounded-xl p-3 space-y-2.5 shadow-e1">
                <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{t("osce.home.progress")}</div>
                <div className="flex justify-between text-[11px]">
                  <span className="text-muted-foreground">Questions</span>
                  <span className="font-semibold tabular-nums">{turnCount} / {MAX_TURNS}</span>
                </div>
                <div className="h-1.5 bg-border/40 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-primary/60 to-primary transition-all duration-500"
                    style={{ width: momentum + "%" }}
                  />
                </div>
                <div className="flex justify-between text-[11px]">
                  <span className="text-muted-foreground">{t("osce.session.timeUsed")}</span>
                  <span className="font-semibold tabular-nums">{timeUsedPct}%</span>
                </div>
              </div>

              {/* Consultation map */}
              {!isDataInterp && (
                <div className="bg-card border border-border rounded-xl p-3 shadow-e1">
                  <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-2">{t("osce.session.consultationMap")}</div>
                  <div className="flex flex-col gap-0.5">
                    {MAP_STEPS.map(([label, desc], i) => (
                      <div
                        key={i}
                        className={cn(
                          "flex items-center gap-2 text-[11px] px-1.5 py-1 rounded-md transition-all",
                          i < mapStep && "text-success",
                          i === mapStep && "text-foreground font-semibold bg-primary/10",
                          i > mapStep && "text-muted-foreground"
                        )}
                      >
                        <div
                          className={cn(
                            "size-1.5 rounded-full shrink-0",
                            i < mapStep ? "bg-success" : i === mapStep ? "bg-primary" : "bg-border"
                          )}
                        />
                        <span>{label}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Quick prompts */}
              {!isDataInterp && (
                <div className="bg-card border border-border rounded-xl p-3 shadow-e1">
                  <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-2">{t("osce.session.quickPrompts")}</div>
                  <div className="flex flex-col gap-1">
                    {[
                      [t("osce.session.prompt.open"), "Can you tell me more about what brought you in today?"],
                      [t("osce.session.prompt.timing"), "When did this start, and what were you doing?"],
                      [t("osce.session.prompt.severity"), "On a scale of 1-10, how bad is it?"],
                      [t("osce.session.prompt.triggers"), "Does anything make it better or worse?"],
                      [t("osce.session.prompt.pmh"), "Do you have any medical conditions or take regular medicines?"],
                      [t("osce.session.prompt.ice"), "Is there anything you are particularly worried this might be?"],
                    ].map(([label, prompt]) => (
                      <button
                        key={label}
                        onClick={() => insertPrompt(prompt)}
                        className="w-full text-left px-2 py-1.5 rounded-md text-[11px] text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Submit button (sidebar footer) */}
              <button
                onClick={handleSubmit}
                disabled={sending || thinking || !transcript.length}
                className="w-full h-10 rounded-xl bg-primary/10 border border-primary/30 text-primary text-xs font-semibold hover:bg-primary/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed mt-auto"
              >
                {t("osce.session.submitFeedback")}
              </button>
            </aside>
          )}

          {/* Chat Zone */}
          <div className="flex-1 min-w-0 flex flex-col">
            {/* Printed materials — on mobile there's no sidebar, so a
                compact header button stands in for the sidebar card and
                opens the same modal. */}
            {isDataInterp && isMobile && (
              <div className="shrink-0 border-b border-border bg-card/60 backdrop-blur-md px-3 py-2">
                <button
                  onClick={() => setMaterialsModalOpen(true)}
                  className="w-full flex items-center justify-between text-xs font-semibold"
                >
                  <span className="flex items-center gap-1.5">
                    <BarChart3 className="size-3.5 text-primary" />
                    {t("osce.dataPresented.printedMaterials")}
                    {(() => {
                      const n = (activeCase.dataPresented?.images || []).length;
                      return n > 0 ? <span className="text-[11px] font-medium text-muted-foreground">({n})</span> : null;
                    })()}
                  </span>
                  <ChevronRight className="size-3.5" />
                </button>
              </div>
            )}

            {/* Transcript */}
            <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 md:px-6 py-4 space-y-4 osler-scroll flex flex-col">
              {transcript.length === 0 && (
                <div className="flex flex-col items-center justify-center h-full text-center gap-3 py-12 text-muted-foreground">
                  <div className="size-14 rounded-2xl bg-primary/5 border border-primary/10 flex items-center justify-center">
                    <Stethoscope className="size-6 text-primary/50" />
                  </div>
                  <div className="space-y-1">
                    <p className="text-sm font-medium">
                      {isDataInterp
                        ? t("osce.dataPresented.examinerOpening")
                        : t("osce.session.sayHello", { name: p.name })}
                    </p>
                    <p className="text-xs opacity-70">{t("osce.session.emptyState")}</p>
                  </div>
                </div>
              )}

              {transcript.map((m, i) => {
                const isModel = m.role === "model";
                const label = isDataInterp
                  ? isModel ? activeCase.examiner?.name || t("osce.session.examiner") : t("osce.session.you")
                  : isModel ? speakerName : t("osce.session.you");
                return (
                  <motion.div
                    key={i}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={MOTION_TRANSITION.quick}
                    className={cn(
                      "flex flex-col gap-1 max-w-[80%] md:max-w-[640px]",
                      isModel ? "self-start" : "self-end items-end"
                    )}
                  >
                    <div
                      className={cn(
                        "text-[11px] font-semibold uppercase tracking-wider flex items-center gap-1",
                        isModel ? "text-primary/70" : "text-muted-foreground"
                      )}
                    >
                      {isModel && <Stethoscope className="size-2.5" />}
                      {label}
                    </div>
                    <div
                      className={cn(
                        "px-3.5 py-2.5 rounded-2xl text-sm leading-relaxed",
                        isModel
                          ? "bg-card border border-border text-foreground rounded-tl-sm shadow-e1"
                          : "bg-primary/10 border border-primary/20 text-foreground rounded-tr-sm"
                      )}
                    >
                      <AiMarkdown text={m.text} />
                    </div>
                  </motion.div>
                );
              })}

              {/* Streaming reply — painted token-by-token while the model
                  writes, with a blinking caret; commits when the reveal
                  finishes (see OsceStreamBubble). */}
              {streamingText !== null && (
                <OsceStreamBubble
                  label={isDataInterp ? activeCase.examiner?.name || t("osce.session.examiner") : speakerName}
                  text={streamingText}
                  onSettled={handleStreamSettled}
                />
              )}

              {/* Thinking indicator */}
              <AnimatePresence>
                {thinking && (
                  <motion.div
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    className="self-start flex flex-col gap-1"
                  >
                    <div className="text-[11px] font-semibold uppercase tracking-wider text-primary/70 flex items-center gap-1">
                      <Stethoscope className="size-2.5" />
                      {isDataInterp ? activeCase.examiner?.name || "Examiner" : speakerName}
                    </div>
                    <div className="bg-card border border-border rounded-2xl rounded-tl-sm px-4 py-3 flex items-center gap-3 shadow-e1">
                      <ThinkingStatus
                        size={64}
                        interval={1800}
                        phases={thinkingPhases}
                        labelClassName="text-xs italic text-muted-foreground"
                      />
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Interim voice text */}
              {interimText && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="self-end flex flex-col gap-1 items-end max-w-[80%]"
                >
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{t("osce.session.you")}</div>
                  <div className="px-3.5 py-2.5 rounded-2xl rounded-tr-sm bg-primary/5 border border-primary/10 text-sm text-muted-foreground italic">
                    {interimText}
                  </div>
                </motion.div>
              )}

              {/* Live-mode professor ghost caption — grows while the
                  professor speaks, only when transcripts are enabled. */}
              {voiceOn && isLiveTranscriptsOn() && modelInterim && (
                <div className="self-start flex flex-col gap-1 max-w-[80%] md:max-w-[640px]">
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-primary/70 flex items-center gap-1">
                    <Stethoscope className="size-2.5" />
                    {isDataInterp ? activeCase.examiner?.name || t("osce.session.examiner") : speakerName}
                  </div>
                  <div className="px-3.5 py-2.5 rounded-2xl rounded-tl-sm bg-card/60 border border-dashed border-border text-sm leading-relaxed text-muted-foreground italic">
                    {modelInterim}
                    <span className="osler-stream-caret" />
                  </div>
                </div>
              )}
            </div>

            {/* Error */}
            <AnimatePresence>
              {error && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  className="mx-3 md:mx-6 mb-1"
                >
                  <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-destructive/10 border border-destructive/20 text-xs text-destructive">
                    <AlertCircle className="size-3.5 shrink-0" />
                    {error}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Input area */}
            <div className="border-t border-border bg-card/70 backdrop-blur-xl shrink-0 p-3 md:px-6">
              {/* Voice status pill (only when voice on AND overlay minimised) */}
              <AnimatePresence>
                {voiceOn && !voiceOverlayOpen && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    className="mb-2"
                  >
                    <button
                      onClick={() => setVoiceOverlayOpen(true)}
                      className="w-full flex items-center gap-2 px-3 py-2 rounded-xl bg-primary/5 border border-primary/20 hover:bg-primary/10 transition-colors"
                    >
                      <FluidOrb
                        size={20}
                        level={getVoiceLevel}
                        className="shrink-0"
                        aria-hidden="true"
                      />
                      <span className="text-[11px] text-muted-foreground flex-1 text-left min-w-0 truncate">
                        {voicePhase === "speaking" ? t("osce.session.voiceOverlay.speaking") :
                         voicePhase === "listening" ? t("osce.session.voiceOverlay.listening") :
                         t("osce.session.voiceOverlay.title")}
                      </span>
                      <Maximize2 className="size-3.5 text-muted-foreground shrink-0" />
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Input row */}
              <div className="flex items-end gap-2">
                <button
                  onClick={toggleVoice}
                  className={cn(
                    "size-10 rounded-xl border flex items-center justify-center shrink-0 transition-all",
                    voiceOn
                      ? "bg-destructive-soft border-destructive/30 text-destructive hover:bg-destructive/20"
                      : "border-border bg-muted/40 text-muted-foreground hover:border-primary/40 hover:text-primary hover:bg-primary/5"
                  )}
                  title={voiceOn ? t("osce.session.voiceOverlay.endCall") : t("osce.session.toggleVoice")}
                  aria-label={voiceOn ? t("osce.session.voiceOverlay.endCall") : t("osce.session.toggleVoice")}
                >
                  {voiceOn ? <PhoneOff className="size-4" /> : <Phone className="size-4" />}
                </button>

                <textarea
                  ref={inputRef}
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      handleSend();
                    }
                  }}
                  placeholder={isDataInterp ? "Answer the examiner's question…" : "Ask the patient a question…"}
                  rows={1}
                  className="flex-1 resize-none min-h-[40px] max-h-[120px] px-3 py-2 rounded-xl border border-border bg-background text-sm outline-none focus:border-primary/60 focus:ring-2 focus:ring-primary/10 transition-all placeholder:text-muted-foreground"
                  style={{ height: "auto", minHeight: "40px" }}
                  onInput={(e) => {
                    const el = e.currentTarget;
                    el.style.height = "auto";
                    el.style.height = Math.min(120, el.scrollHeight) + "px";
                  }}
                />

                <button
                  onClick={handleSend}
                  disabled={sending || streamingText !== null || !inputText.trim()}
                  className="h-10 px-4 rounded-xl bg-primary text-primary-foreground font-medium text-sm hover:bg-primary/90 transition-all disabled:opacity-30 disabled:cursor-not-allowed active:scale-95 shrink-0 flex items-center gap-1.5"
                >
                  {sending ? <Loader2 className="size-4 animate-spin" /> : <><Send className="size-3.5" />Send</>}
                </button>
              </div>

              {/* Bottom bar */}
              <div className="flex items-center gap-2 mt-2">
                <span
                  className={cn(
                    "text-[11px] font-semibold px-2 py-0.5 rounded-full border tabular-nums",
                    turnCount >= WARN_TURNS
                      ? "border-destructive/30 text-destructive bg-destructive-soft"
                      : turnCount >= Math.floor(WARN_TURNS * 0.7)
                      ? "border-warning/30 text-warning bg-warning-soft"
                      : "border-border text-muted-foreground"
                  )}
                >
                  {turnCount}/{MAX_TURNS}
                </span>

                {isMobile && (
                  <button
                    onClick={handleSubmit}
                    disabled={sending || thinking || !transcript.length}
                    className="flex-1 h-7 px-3 rounded-md border border-border text-[11px] font-medium text-muted-foreground hover:border-primary/40 hover:text-primary transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    {t("osce.session.submitFeedback")}
                  </button>
                )}

                <div className="ml-auto flex items-center gap-1">
                  {!isMobile && (
                    <button
                      onClick={handleSubmit}
                      disabled={sending || thinking || !transcript.length}
                      className="h-7 px-3 rounded-md border border-border text-[11px] font-medium text-muted-foreground hover:border-primary/40 hover:text-primary transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      {t("osce.session.submitFeedback")}
                    </button>
                  )}
                  <button
                    onClick={() => setResetModalOpen(true)}
                    className="h-7 px-2.5 rounded-md border border-border text-[11px] text-muted-foreground hover:border-destructive/40 hover:text-destructive transition-colors flex items-center gap-1"
                  >
                    <RotateCcw className="size-3" />
                    Reset
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ── ChatGPT-style Live Voice Overlay ────────────────── */}
        <AnimatePresence>
          {voiceOn && voiceOverlayOpen && (
            <LiveVoiceOverlay
              speakerName={isDataInterp ? activeCase.examiner?.name || t("osce.session.examiner") : speakerName}
              speakerRole={
                isDataInterp
                  ? activeCase.examiner?.title || activeCase.specialty
                  : `${p.age}y · ${p.gender} · ${activeCase.specialty}`
              }
              orbState={presenceOrbState}
              voicePhase={voicePhase}
              getVoiceLevel={getVoiceLevel}
              thinking={thinking}
              thinkingPhases={thinkingPhases}
              interimText={interimText}
              lastModelText={(() => {
                for (let i = transcript.length - 1; i >= 0; i--) {
                  if (transcript[i].role === "model") return transcript[i].text;
                }
                return "";
              })()}
              partialModelText={modelInterim}
              transcriptsOn={isLiveTranscriptsOn()}
              onToggleTranscripts={toggleLiveTranscripts}
              onMinimise={() => setVoiceOverlayOpen(false)}
              onEndCall={endVoiceCall}
              onInterrupt={interruptSpeaking}
              error={error}
            />
          )}
        </AnimatePresence>

        {/* Printed Materials Modal — reachable from the sidebar card
            (desktop) or the header button (mobile); offers a one-tap
            shortcut straight into voice mode. */}
        {isDataInterp && (
          <PrintedMaterialsModal
            open={materialsModalOpen}
            onOpenChange={setMaterialsModalOpen}
            data={activeCase.dataPresented}
            packPath={activePackPath}
            onOpenVoiceMode={openMaterialsInVoiceMode}
          />
        )}

        {/* Reset Modal */}
        <AnimatePresence>
          {resetModalOpen && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm p-4"
              onClick={() => setResetModalOpen(false)}
            >
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 12 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 12 }}
                transition={MOTION_SPRING.snappy}
                className="bg-card border border-border rounded-xl p-6 max-w-sm w-full shadow-lg"
                onClick={(e) => e.stopPropagation()}
              >
                <h3 className="text-base font-semibold mb-1">Reset Consultation?</h3>
                <p className="text-sm text-muted-foreground mb-5 leading-relaxed">
                  This will clear the entire conversation, timer, and progress. This cannot be undone.
                </p>
                <div className="flex gap-2 justify-end">
                  <button
                    onClick={() => setResetModalOpen(false)}
                    className="h-9 px-4 rounded-lg border border-border text-sm font-medium hover:bg-muted/60 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => {
                      stopTimer();
                      if (voiceOn) endVoiceCall();
                      streamSettleRef.current = null;
                      setStreamingText(null);
                      setTranscript([]);
                      setRenderedCount(0);
                      resetTimer(activeCase?.time || EXAM_TIME);
                      setResult(null);
                      setError(null);
                      clearSession();
                      setPhase("lobby");
                      setResetModalOpen(false);
                    }}
                    className="h-9 px-4 rounded-lg bg-destructive/10 border border-destructive/30 text-destructive text-sm font-medium hover:bg-destructive/20 transition-colors"
                  >
                    Reset
                  </button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    );
  }

  /* ── Debrief Phase ──────────────────────────────────────────── */

  if (phase === "debrief" && result && activeCase) {
    const isDataInterp = activeCase.type === "data-interp";
    const stationDuration = activeCase.time || EXAM_TIME;
    const turnCount = userTurnCount(transcript);
    const timeUsedPct = Math.round(((stationDuration - timerRemaining) / stationDuration) * 100);
    const hp = activeCase.hiddenProfile;
    const band =
      result.score >= 90 ? "Outstanding" :
      result.score >= 75 ? "Strong pass" :
      result.score >= 60 ? "Clear pass" :
      result.score >= 40 ? "Needs improvement" :
      "Restart recommended";

    const domainDefs = isDataInterp
      ? [
          { k: "knowledge", l: "Knowledge", m: 30 },
          { k: "interpretation", l: "Interpretation", m: 30 },
          { k: "reasoning", l: "Reasoning", m: 25 },
          { k: "communication", l: "Communication", m: 15 },
        ]
      : [
          { k: "communication", l: "Communication", m: 25 },
          { k: "infoGathering", l: "Info Gathering", m: 25 },
          { k: "clinicalReasoning", l: "Clinical Reasoning", m: 25 },
          { k: "professionalism", l: "Professionalism", m: 25 },
        ];

    const badges = buildAchievements(result, timeUsedPct, turnCount);

    return (
      <motion.div
        className="fixed inset-0 z-50 bg-background overflow-y-auto osler-scroll"
        {...debriefDismiss}
      >
        <div className="max-w-3xl mx-auto px-4 md:px-8 py-8">
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={MOTION_TRANSITION.slow}
            className="space-y-4"
          >
            {/* Back */}
            <button
              onClick={() => { setResult(null); setPhase("conversation"); }}
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <ChevronLeft className="size-3.5" />
              Back to consultation
            </button>

            {/* Score banner */}
            <div className="relative overflow-hidden bg-card border border-border rounded-xl p-5 md:p-6">
              <div
                className="absolute top-0 left-0 right-0 h-0.5"
                style={{
                  background: `linear-gradient(90deg, ${
                    result.score >= 75 ? "oklch(0.65 0.18 145)" :
                    result.score >= 50 ? "oklch(0.78 0.16 80)" :
                    "oklch(0.68 0.21 22)"
                  }, transparent)`,
                }}
              />
              <div className="flex items-center gap-5 flex-wrap">
                <div className="size-20 rounded-full border-2 border-primary/30 bg-primary/10 flex flex-col items-center justify-center shrink-0">
                  <div className="text-2xl font-bold text-primary leading-none">{result.score}</div>
                  <div className="text-[11px] text-muted-foreground mt-0.5">/ 100</div>
                </div>
                <div className="flex-1 min-w-[160px]">
                  <div className="text-lg font-bold mb-1">{band}</div>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className={cn(
                      "text-xs font-semibold px-2 py-0.5 rounded-full border",
                      result.passed
                        ? "border-success/30 text-success bg-success-soft"
                        : "border-destructive/30 text-destructive bg-destructive-soft"
                    )}>
                      {result.passed ? "Passed" : "Not Passed"}
                    </span>
                    <span className="text-xs text-muted-foreground">{turnCount} turns · {timeUsedPct}% time used</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Stats row */}
            <div className="grid grid-cols-4 gap-3">
              {[
                { val: timeUsedPct + "%", label: "Time Used", color: "text-success" },
                { val: String(turnCount), label: "Turns", color: "text-primary" },
                { val: String(result.asked.length), label: "Covered", color: "text-success" },
                { val: String(result.missed.length), label: "Missed", color: "text-destructive" },
              ].map((s) => (
                <div key={s.label} className="bg-card border border-border rounded-xl p-3 text-center">
                  <div className={cn("text-base font-bold tabular-nums", s.color)}>{s.val}</div>
                  <div className="text-[11px] text-muted-foreground mt-0.5">{s.label}</div>
                </div>
              ))}
            </div>

            {/* Domain scores */}
            <div className="bg-card border border-border rounded-xl p-4">
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-bold mb-3 flex items-center gap-1.5">
                <Activity className="size-3" /> Domain Scores
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {domainDefs.map((dd) => {
                  const v = result.domains[dd.k] || 0;
                  const pct = (v / dd.m) * 100;
                  const q = pct >= 70 ? "good" : pct >= 40 ? "avg" : "low";
                  return (
                    <div key={dd.k}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-medium">{dd.l}</span>
                        <span className={cn(
                          "text-xs font-bold tabular-nums",
                          q === "good" && "text-success",
                          q === "avg" && "text-warning",
                          q === "low" && "text-destructive"
                        )}>
                          {v}/{dd.m}
                        </span>
                      </div>
                      <div className="h-1.5 bg-border/40 rounded-full overflow-hidden">
                        <div
                          className={cn(
                            "h-full rounded-full transition-all",
                            q === "good" && "bg-success",
                            q === "avg" && "bg-warning",
                            q === "low" && "bg-destructive"
                          )}
                          style={{ width: pct + "%" }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Feedback */}
            <div className="bg-card border border-border rounded-xl p-4">
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-bold mb-2 flex items-center gap-1.5">
                <Lightbulb className="size-3" /> Examiner Feedback
              </p>
              <AiMarkdown text={result.feedback} className="text-sm leading-relaxed" />
              {hp.diagnosis && (
                <div className="mt-3 flex items-start gap-2 px-3 py-2 rounded-lg bg-primary/5 border border-primary/20 text-xs">
                  <Stethoscope className="size-3.5 text-primary shrink-0 mt-0.5" />
                  <span><strong className="text-primary">Hidden diagnosis:</strong> {hp.diagnosis}</span>
                </div>
              )}
            </div>

            {/* Criteria review */}
            <div className="bg-card border border-border rounded-xl p-4">
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-bold mb-3 flex items-center gap-1.5">
                <AlignLeft className="size-3" /> Criteria Review
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <h4 className="text-[11px] font-bold uppercase tracking-wider text-success mb-2">
                    Covered ({result.asked.length})
                  </h4>
                  <div className="space-y-1">
                    {(result.asked.length ? result.asked : ["(none matched)"]).map((x, i) => (
                      <div key={i} className="flex items-start gap-2 text-xs px-2 py-1.5 rounded-md bg-success-soft border border-success/20 text-success">
                        <Check className="size-3 mt-0.5 shrink-0" /> {x}
                      </div>
                    ))}
                  </div>
                </div>
                <div>
                  <h4 className="text-[11px] font-bold uppercase tracking-wider text-destructive mb-2">
                    Missed ({result.missed.length})
                  </h4>
                  <div className="space-y-1">
                    {(result.missed.length ? result.missed : ["(nothing missed — excellent!)"]).map((x, i) => (
                      <div key={i} className="flex items-start gap-2 text-xs px-2 py-1.5 rounded-md bg-destructive-soft border border-destructive/20 text-destructive">
                        <X className="size-3 mt-0.5 shrink-0" /> {x}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* Achievements */}
            {badges.length > 0 && (
              <div className="bg-card border border-border rounded-xl p-4">
                <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-bold mb-3">
                  Achievements
                </p>
                <div className="flex flex-wrap gap-2">
                  {badges.map((b, i) => (
                    <div
                      key={i}
                      className={cn(
                        "flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold border",
                        b.color === "gold" && "border-warning/30 bg-warning-soft text-warning",
                        b.color === "green" && "border-success/30 bg-success-soft text-success",
                        b.color === "blue" && "border-sky-500/30 bg-sky-500/10 text-sky-500",
                        b.color === "purple" && "border-purple-500/30 bg-purple-500/10 text-purple-500"
                      )}
                    >
                      <span>{b.icon}</span>
                      <span>{b.label}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Actions */}
            <div className="flex items-center gap-3 flex-wrap">
              <button
                onClick={() => {
                  stopTimer();
                  setResult(null);
                  setPhase("conversation");
                }}
                className="h-10 px-4 rounded-lg border border-border text-sm font-medium hover:bg-muted/60 transition-colors flex items-center gap-2"
              >
                <ChevronLeft className="size-3.5" /> Back to Consultation
              </button>
              <button
                onClick={() => {
                  stopTimer();
                  setTranscript([]);
                  setRenderedCount(0);
                  resetTimer(activeCase?.time || EXAM_TIME);
                  setResult(null);
                  setError(null);
                  clearSession();
                  setPhase("lobby");
                }}
                className="h-10 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors flex items-center gap-2 active:scale-[0.98]"
              >
                <RefreshCw className="size-3.5" /> Try Again
              </button>
              <button
                onClick={() => setPhase("select")}
                className="h-10 px-4 rounded-lg border border-border text-sm font-medium hover:bg-muted/60 transition-colors flex items-center gap-2"
              >
                <Home className="size-3.5" /> All Scenarios
              </button>
            </div>
          </motion.div>
        </div>
      </motion.div>
    );
  }

  /* Fallback loading — premium skeleton that mirrors the OSCE hub layout. */
  return (
    <HubSkeleton statCount={3} cardCount={4} />
  );
}