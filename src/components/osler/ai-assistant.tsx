"use client";

import * as React from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Bot,
  Send,
  Sparkles,
  User as UserIcon,
  Trash2,
  X,
  Settings,
  ChevronDown,
  ChevronUp,
  AlertCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { usePlatform } from "@/hooks/use-platform";
import { useI18n } from "@/components/osler/i18n-provider";
import {
  useResizableSidebar,
  SidebarResizeHandle,
} from "@/hooks/use-resizable-sidebar";
import { useSwipeBackDismiss } from "@/hooks/use-swipe-back-dismiss";
import { GEMINI_CLOUD_SYNCED_FLAG } from "@/lib/osler/cloud";
import { Combobox } from "@/components/osler/ui-primitives";
import { ThinkingStatus } from "@/components/osler/thinking-status";
import { StreamingMarkdown } from "@/components/osler/streaming-markdown";
import { MOTION_TRANSITION, MOTION_SPRING } from "@/lib/osler/motion";

const MODELS = [
  ["gemini-3.5-flash-lite", "Gemini 3.5 Flash-Lite (default, fastest & cost-efficient)"],
  ["gemini-3.7-flash", "Gemini 3.7 Flash (newest, most capable Flash)"],
  ["gemini-3.6-flash", "Gemini 3.6 Flash (fast & efficient)"],
  ["gemini-3.5-flash", "Gemini 3.5 Flash (stable, high-throughput)"],
  ["gemini-3.1-flash-lite", "Gemini 3.1 Flash-Lite (fast & modern)"],
  ["gemini-3.1-pro-preview", "Gemini 3.1 Pro Preview (most capable, premium)"],
  ["gemini-3-flash-preview", "Gemini 3 Flash Preview (experimental)"],
  ["gemma-4-26b-a4b-it", "Gemma 4 26B IT (open model, strong & free)"],
  ["gemma-4-31b-it", "Gemma 4 31B IT (larger open model)"],
  ["gemini-2.5-flash-lite", "Gemini 2.5 Flash-Lite (budget fallback)"],
  ["gemini-2.5-flash", "Gemini 2.5 Flash (older fallback)"],
] as const;

const STORAGE_KEYS = {
  apiKey: "osler_gemini_api_key",
  model: "osler_gemini_model",
  maxWait: "osler_gemini_max_wait",
} as const;

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
}

const STORAGE_KEY = "osler-ai-chat-v1";

const SUGGESTIONS = [
  "Explain the difference between systolic and diastolic heart failure.",
  "What are the indications for IV thrombolysis in ischemic stroke?",
  "Walk me through the GOLD classification for COPD.",
  "How do I interpret an arterial blood gas?",
  "What's the workup for suspected pulmonary embolism?",
  "Compare asthma vs COPD pathophysiology.",
  "What are the complications of cirrhosis?",
  "How do I manage acute STEMI?",
];

interface AiAssistantProps {
  open?: boolean;
  onClose?: () => void;
  questionContext?: {
    stem: string;
    choices?: string[];
    correct?: number;
    engine: string;
    submitted: boolean;
  };
}

function buildSystemPrompt(): string {
  return [
    "You are a medical quiz tutor and study assistant for USMLE prep.",
    "",
    "Your purpose is to help students understand medical concepts, clarify doubts, and deepen their knowledge through clear, focused explanations.",
    "",
    "Rules:",
    "- Answer in 1-3 short sentences or a few bullet points.",
    "- Be direct and concise. No introductions, no conclusions, no fluff.",
    "- When explaining concepts, reference the specific question context provided.",
    "- If you need more information to give a precise answer, ask a focused follow-up question.",
    "- Always maintain an encouraging, educational tone.",
    "- Use clear language appropriate for medical students.",
    "- Reply in the same language the student writes in (Arabic, English, or a natural mix); clinical terms may stay in English.",
    "",
    "Scope:",
    "- Focus on medical and health sciences education.",
    "- For questions outside this scope, politely redirect to the question at hand.",
  ].join("\n");
}

function buildUserPrompt(context: NonNullable<AiAssistantProps["questionContext"]>, userQuery: string): string {
  const keys = ["A", "B", "C", "D", "E", "F", "G", "H"];
  let ctx = "## Current Question\n" + (context.stem || "");
  if (context.choices?.length) {
    context.choices.forEach((opt, i) => {
      ctx += "\n" + (keys[i] || i) + ". " + opt;
    });
    const correctIdx = context.correct ?? -1;
    if (context.submitted && correctIdx >= 0 && context.choices[correctIdx]) {
      ctx += "\n\nCorrect answer: " + (keys[correctIdx] || correctIdx) + ". " + context.choices[correctIdx];
    }
  }
  ctx += "\n\n## My Question\n" + userQuery;
  return ctx;
}

export function AiAssistant({
  open,
  onClose,
  questionContext,
}: AiAssistantProps) {
  const { t, rtl } = useI18n();
  const platform = usePlatform();
  const resizable = useResizableSidebar({
    storageKey: "osler-ai-assistant-width",
    defaultWidth: 384,
    minWidth: 320,
    maxWidth: 640,
    disabled: platform.isPhone,
  });
  const [messages, setMessages] = React.useState<Message[]>(() => loadChat());
  const [input, setInput] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [showSettings, setShowSettings] = React.useState(false);
  const [showContext, setShowContext] = React.useState(false);

  const [apiKey, setApiKey] = React.useState("");
  const [model, setModel] = React.useState<string>(MODELS[0][0]);
  const [maxWait, setMaxWait] = React.useState("30");

  const scrollRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLTextAreaElement>(null);

  // ── Swipe-to-dismiss (mirrors Settings NavigationStack pattern) ──────
  // Only meaningful in overlay mode (when `open`/`onClose` are provided).
  // The hook returns {} when disabled, so the embedded-mode render path is
  // unaffected. We still MUST call it unconditionally to satisfy the Rules
  // of Hooks.
  const isOverlay = open !== undefined && !!onClose;
  const isPhone = platform.isPhone;
  // Disable swipe while the inner settings panel is open so the user
  // doesn't lose their API-key form mid-edit.
  const dismissProps = useSwipeBackDismiss({
    onDismiss: () => onClose?.(),
    direction: isPhone ? "vertical" : "horizontal",
    rtl,
    disabled: !isOverlay || showSettings,
  });

  React.useEffect(() => {
    setApiKey(localStorage.getItem(STORAGE_KEYS.apiKey) || "");
    setModel(localStorage.getItem(STORAGE_KEYS.model) || MODELS[0][0]);
    setMaxWait(localStorage.getItem(STORAGE_KEYS.maxWait) || "30");
  }, []);

  // Persist
  React.useEffect(() => {
    if (typeof window === "undefined") return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
  }, [messages]);

  // Auto-scroll
  React.useEffect(() => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, loading]);

  // Initialize welcome message on open / question change
  React.useEffect(() => {
    if (open) {
      setMessages([
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: t("ai.chatCleared"),
          timestamp: Date.now(),
        },
      ]);
      setError(null);
      setTimeout(() => inputRef.current?.focus(), 150);
    }
  }, [open, questionContext?.stem]);

  const saveApiKey = (key: string) => {
    setApiKey(key);
    localStorage.setItem(STORAGE_KEYS.apiKey, key);
    // A locally-entered key isn't a cloud-synced copy — clear the
    // reconciliation flag so a future cloud removal doesn't wipe it.
    localStorage.removeItem(GEMINI_CLOUD_SYNCED_FLAG);
  };
  const saveModel = (m: string) => {
    setModel(m);
    localStorage.setItem(STORAGE_KEYS.model, m);
  };
  const saveMaxWait = (w: string) => {
    setMaxWait(w);
    localStorage.setItem(STORAGE_KEYS.maxWait, w);
  };

  const send = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || loading) return;
    if (!apiKey) {
      setError(t("ai.error.noKey"));
      setShowSettings(true);
      return;
    }

    setInput("");
    setError(null);
    setLoading(true);

    const userMsg: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content: trimmed,
      timestamp: Date.now(),
    };
    // The assistant reply is appended immediately and grows in place as
    // SSE tokens arrive — the answer writes itself instead of spawning.
    const assistantId = crypto.randomUUID();
    setMessages((m) => [
      ...m,
      userMsg,
      { id: assistantId, role: "assistant", content: "", timestamp: Date.now() },
    ]);

    let streamed = "";
    const paintStreamed = () =>
      setMessages((prev) =>
        prev.map((m) => (m.id === assistantId ? { ...m, content: streamed } : m))
      );

    try {
      const chatMessages = messages.map((m) => ({
        role: m.role === "user" ? "user" : "model",
        parts: [{ text: m.content }],
      }));
      chatMessages.push({
        role: "user",
        parts: [
          {
            text: questionContext
              ? buildUserPrompt(questionContext, trimmed)
              : trimmed,
          },
        ],
      });

      const controller = new AbortController();
      const timeoutMs = parseInt(maxWait) * 1000 || 30000;
      // Idle timeout — reset on every chunk so a long healthy stream is
      // never cut off; maxWait now bounds silence, not total duration.
      let timeoutId = setTimeout(() => controller.abort(), timeoutMs);
      const resetIdleTimeout = () => {
        clearTimeout(timeoutId);
        timeoutId = setTimeout(() => controller.abort(), timeoutMs);
      };

      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse&key=${apiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: buildSystemPrompt() }] },
            contents: chatMessages,
            generationConfig: { temperature: 0.3, maxOutputTokens: 1024 },
          }),
          signal: controller.signal,
        }
      );

      if (!res.ok) {
        clearTimeout(timeoutId);
        const errBody = await res.text().catch(() => "");
        throw new Error(errBody || `HTTP ${res.status}`);
      }
      if (!res.body) throw new Error(t("ai.error.noResponse"));

      // Same SSE contract as the OSCE studio (mirrors js-genai's
      // processStreamResponse): data:-prefixed JSON events, mid-stream
      // {"error": ...} chunks surface their message, final event may lack
      // a trailing newline so the buffer is flushed after the loop.
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      const handleDataLine = (line: string) => {
        if (!line.startsWith("data:")) return;
        const json = line.slice(5).trim();
        if (!json) return;
        let chunk: {
          error?: { message?: string };
          candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
        };
        try {
          chunk = JSON.parse(json);
        } catch {
          return;
        }
        if (chunk && typeof chunk === "object" && chunk.error) {
          throw new Error(chunk.error.message || "Gemini stream error");
        }
        const parts = chunk?.candidates?.[0]?.content?.parts;
        const piece = Array.isArray(parts)
          ? parts.map((p) => p.text ?? "").join("")
          : "";
        if (piece) {
          streamed += piece;
          paintStreamed();
        }
      };
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          resetIdleTimeout();
          buf += decoder.decode(value, { stream: true });
          const lines = buf.split("\n");
          buf = lines.pop() ?? "";
          for (const line of lines) handleDataLine(line.trim());
        }
        for (const line of buf.split("\n")) handleDataLine(line.trim());
      } finally {
        clearTimeout(timeoutId);
        reader.releaseLock();
      }

      if (!streamed.trim()) throw new Error(t("ai.error.noResponse"));
    } catch (err: any) {
      // Drop the empty placeholder on failure; keep any partial answer.
      if (!streamed.trim()) {
        setMessages((prev) => prev.filter((m) => m.id !== assistantId));
      }
      if (err.name === "AbortError") {
        setError(t("ai.error.timeout"));
      } else {
        setError(
          err.message?.includes("API_KEY")
            ? t("ai.error.invalidKey")
            : err.message || t("ai.error.requestFailed")
        );
      }
    } finally {
      setLoading(false);
    }
  };

  const clear = () => {
    setMessages([
      {
        id: crypto.randomUUID(),
        role: "assistant",
        content: t("ai.chatCleared"),
        timestamp: Date.now(),
      },
    ]);
    setError(null);
  };

  const content = (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 md:px-6 py-3 border-b border-border bg-card shrink-0">
        <div className="w-9 h-9 rounded-full bg-primary/15 text-primary flex items-center justify-center">
          <Bot className="size-5" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold">{t("ai.title")}</h3>
          <p className="text-[11px] text-muted-foreground">
            {questionContext
              ? t("ai.subtitle.context", { engine: questionContext.engine })
              : t("ai.subtitle.general")}
          </p>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setShowSettings(!showSettings)}
            className={`size-7 rounded-lg flex items-center justify-center transition-colors ${
              showSettings ? "bg-primary/15 text-primary" : "hover:bg-muted text-muted-foreground"
            }`}
            title={t("ai.settings")}
          >
            <Settings className="size-3.5" />
          </button>
          {onClose && (
            <button
              onClick={onClose}
              className="size-7 rounded-lg hover:bg-muted flex items-center justify-center transition-colors"
            >
              <X className="size-4" />
            </button>
          )}
        </div>
        {messages.length > 0 && !onClose && (
          <Button variant="ghost" size="sm" onClick={clear}>
            <Trash2 className="size-3.5" />
            <span className="hidden sm:inline">{t("ai.clear")}</span>
          </Button>
        )}
      </div>

      {/* Settings panel */}
      <AnimatePresence>
        {showSettings && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden border-b border-border"
          >
            <div className="p-4 space-y-3 bg-muted/30">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-muted-foreground">{t("ai.apiKey")}</label>
                <div className="flex gap-2">
                  <input
                    type="password"
                    value={apiKey}
                    onChange={(e) => saveApiKey(e.target.value)}
                    placeholder={t("ai.apiKeyPlaceholder")}
                    className="flex-1 h-8 rounded-lg border border-border bg-card px-3 text-xs outline-none focus:border-primary"
                  />
                </div>
                <p className="text-[11px] text-muted-foreground">
                  {t("ai.apiKeyHint")}{" "}
                  <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener" className="text-primary underline">
                    AI Studio
                  </a>
                </p>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-muted-foreground">{t("ai.model")}</label>
                <Combobox
                  aria-label={t("ai.model")}
                  value={model}
                  onChange={saveModel}
                  options={MODELS.map(([id, label]) => {
                    // Labels are authored as "Name (description)" — split
                    // once so the Combobox can show the description as a
                    // muted secondary line instead of one long string.
                    const match = label.match(/^(.*?)\s*\((.*)\)$/);
                    return match
                      ? { value: id, label: match[1], description: match[2] }
                      : { value: id, label };
                  })}
                  placeholder={t("ai.model")}
                  searchPlaceholder={t("common.search")}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-muted-foreground">{t("ai.maxWait")}</label>
                <select
                  value={maxWait}
                  onChange={(e) => saveMaxWait(e.target.value)}
                  className="w-full h-8 rounded-lg border border-border bg-card px-3 text-xs outline-none focus:border-primary"
                >
                  <option value="15">15 seconds</option>
                  <option value="30">30 seconds</option>
                  <option value="60">60 seconds</option>
                  <option value="120">2 minutes</option>
                </select>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Question context toggle */}
      {questionContext && (
        <div className="border-b border-border shrink-0">
          <button
            onClick={() => setShowContext(!showContext)}
            className="w-full flex items-center justify-between px-4 py-2 text-xs text-muted-foreground hover:bg-muted/40 transition-colors"
          >
            <span className="font-medium">{t("ai.questionContext")}</span>
            {showContext ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
          </button>
          <AnimatePresence>
            {showContext && (
              <motion.div
                initial={{ height: 0 }}
                animate={{ height: "auto" }}
                exit={{ height: 0 }}
                className="overflow-hidden"
              >
                <div className="px-4 py-2 bg-muted/20 text-xs space-y-1 max-h-28 overflow-y-auto">
                  <p className="font-medium text-foreground">{questionContext.stem?.slice(0, 200)}</p>
                  {questionContext.choices?.map((opt, i) => {
                    const letter = String.fromCharCode(65 + i);
                    const isCorrect = questionContext.submitted && questionContext.correct != null && i === questionContext.correct;
                    return (
                      <p key={i} className={`pl-2 ${isCorrect ? "text-primary font-medium" : "text-muted-foreground"}`}>
                        {letter}. {opt} {isCorrect ? "✓" : ""}
                      </p>
                    );
                  })}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      {/* Messages */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto osler-scroll px-4 md:px-6 py-4 flex flex-col gap-3"
      >
        {messages.length === 0 ? (
          <EmptyState onSuggestion={(s) => send(s)} />
        ) : (
          messages.map((m, i) => (
            <ChatBubble
              key={m.id}
              msg={m}
              isStreaming={loading && m.role === "assistant" && i === messages.length - 1}
            />
          ))
        )}
        {/* Orb shows until the first streamed token lands; afterwards the
            growing bubble itself signals progress. */}
        {loading && !(messages.at(-1)?.role === "assistant" && messages.at(-1)!.content) && (
          <div className="flex gap-2 items-center text-muted-foreground text-sm">
            <div className="w-7 h-7 rounded-full bg-primary/15 text-primary flex items-center justify-center shrink-0">
              <Bot className="size-4" />
            </div>
            <ThinkingStatus
              phases={[
                { label: t("ai.orb.thinking"), state: "working" },
                { label: t("ai.orb.searching"), state: "searching" },
                { label: t("ai.orb.composing"), state: "composing" },
                { label: t("ai.orb.reviewing"), state: "solving" },
              ]}
            />
          </div>
        )}
        {error && (
          <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-xs">
            <AlertCircle className="size-3.5 shrink-0 mt-0.5" />
            <p>{error}</p>
          </div>
        )}
      </div>

      {/* Input */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
        className="border-t border-border bg-card p-3 md:p-4 shrink-0"
      >
        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send(input);
              }
            }}
            placeholder={t("ai.inputPlaceholder")}
            rows={1}
            className="flex-1 resize-none max-h-32 bg-card border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-primary transition-colors"
            style={{ minHeight: "40px" }}
          />
          <Button
            type="submit"
            disabled={!input.trim() || loading}
            size="icon"
            className="size-10 shrink-0"
          >
            <Send className="size-4" />
          </Button>
        </div>
        <div className="flex items-center justify-between mt-1.5">
          <p className="text-[11px] text-muted-foreground hidden sm:block">
            {t("ai.enterHint")}
          </p>
          <button
            type="button"
            onClick={clear}
            className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
          >
            {t("ai.clearChat")}
          </button>
        </div>
      </form>
    </div>
  );

  if (isOverlay) {
    return (
      <AnimatePresence>
        {open && (
          <motion.div
            initial={isPhone ? { y: "100%", opacity: 0 } : { x: rtl ? -360 : 360, opacity: 0 }}
            animate={isPhone ? { y: 0, opacity: 1 } : { x: 0, opacity: 1 }}
            exit={isPhone ? { y: "100%", opacity: 0 } : { x: rtl ? -360 : 360, opacity: 0 }}
            transition={isPhone ? MOTION_SPRING.snappy : MOTION_SPRING.soft}
            {...dismissProps}
            className={isPhone
              ? "fixed inset-0 z-50 bg-card flex flex-col"
              : "fixed right-0 top-12 bottom-0 z-50 border-l border-border bg-card shadow-e4 flex flex-col"
            }
            style={
              isPhone
                ? undefined
                : { width: resizable.width ? `${resizable.width}px` : "24rem" }
            }
          >
            {!isPhone && (
              <SidebarResizeHandle
                onMouseDown={resizable.onDragHandleMouseDown}
                onTouchStart={resizable.onDragHandleTouchStart}
                active={resizable.isResizing}
                ariaLabel={t("sidebar.resize")}
              />
            )}
            {content}
          </motion.div>
        )}
      </AnimatePresence>
    );
  }

  return content;
}

function EmptyState({ onSuggestion }: { onSuggestion: (s: string) => void }) {
  const { t } = useI18n();
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex flex-col items-center justify-center h-full text-center py-12"
    >
      <div className="w-14 h-14 rounded-full bg-primary/15 text-primary flex items-center justify-center mb-3">
        <Sparkles className="size-7" />
      </div>
      <h3 className="text-base font-semibold mb-1">{t("ai.emptyTitle")}</h3>
      <p className="text-xs text-muted-foreground max-w-xs mb-5">
        {t("ai.emptyDesc")}
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 w-full max-w-lg">
        {SUGGESTIONS.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => onSuggestion(s)}
            className="text-left text-xs px-3 py-2.5 rounded-md border border-border bg-card hover:border-primary/40 hover:bg-primary/5 transition-colors"
          >
            {s}
          </button>
        ))}
      </div>
    </motion.div>
  );
}

function ChatBubble({ msg, isStreaming }: { msg: Message; isStreaming?: boolean }) {
  const { t } = useI18n();
  const isUser = msg.role === "user";
  // Only messages that arrived live get the streaming-word reveal
  // (transitions.dev P30); history from storage renders static. The latch
  // keeps the animation running until it catches the final word even after
  // `loading` flips false — matching the previous typewriter behaviour.
  const everStreamedRef = React.useRef(isStreaming === true);
  if (isStreaming) everStreamedRef.current = true;
  const animate = !isUser && everStreamedRef.current;
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={MOTION_TRANSITION.quick}
      className={cn(
        "flex flex-col gap-1 max-w-[85%]",
        isUser ? "self-end items-end" : "self-start"
      )}
    >
      {/* Speaker label — mirrors the OSCE conversation bubbles */}
      <div
        className={cn(
          "text-[11px] font-semibold uppercase tracking-wider flex items-center gap-1",
          isUser ? "text-muted-foreground" : "text-primary/70"
        )}
      >
        {isUser ? <UserIcon className="size-2.5" /> : <Bot className="size-2.5" />}
        {isUser ? t("ai.label.you") : t("ai.title")}
      </div>
      <div
        className={cn(
          "px-3.5 py-2.5 rounded-2xl text-sm leading-relaxed",
          isUser
            ? "bg-primary/10 border border-primary/20 text-foreground rounded-tr-sm"
            : "bg-card border border-border text-foreground rounded-tl-sm shadow-e1"
        )}
      >
        {isUser ? <p>{msg.content}</p> : <StreamingMarkdown text={msg.content} animate={animate} />}
      </div>
    </motion.div>
  );
}

function loadChat(): Message[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Message[]) : [];
  } catch {
    return [];
  }
}
