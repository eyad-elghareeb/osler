"use client";

import * as React from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Bot,
  Send,
  Sparkles,
  User as UserIcon,
  Trash2,
  Loader2,
  X,
  Settings,
  ChevronDown,
  ChevronUp,
  AlertCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { usePlatform } from "@/hooks/use-platform";

const MODELS = [
  ["gemini-3.1-flash-lite", "Gemini 3.1 Flash-Lite (default, fast & modern)"],
  ["gemini-3.5-flash", "Gemini 3.5 Flash (latest, strongest Flash)"],
  ["gemini-3.1-pro-preview", "Gemini 3.1 Pro Preview (most capable, premium)"],
  ["gemma-4-26b-a4b-it", "Gemma 4 26B IT (open model, strong & free)"],
  ["gemma-4-31b-it", "Gemma 4 31B IT (larger open model)"],
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
    const correctIdx = context.correct != null ? context.correct - 1 : -1;
    if (correctIdx >= 0 && context.choices[correctIdx]) {
      ctx += "\n\nCorrect answer: " + (keys[correctIdx] || correctIdx) + ". " + context.choices[correctIdx];
    }
  }
  ctx += "\n\n## My Question\n" + userQuery;
  return ctx;
}

function renderMarkdown(text: string): string {
  if (!text) return "";
  let t = String(text);
  t = t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  t = t.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, _lang, code) => {
    const c = code.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    return `<pre class="bg-muted p-3 rounded-lg overflow-x-auto text-xs my-2"><code>${c}</code></pre>`;
  });
  t = t.replace(/`([^`]+)`/g, '<code class="bg-muted px-1.5 py-0.5 rounded text-xs">$1</code>');
  t = t.replace(/^### (.+)$/gm, '<h4 class="text-sm font-semibold mt-3 mb-1">$1</h4>');
  t = t.replace(/^## (.+)$/gm, '<h3 class="text-base font-semibold mt-3 mb-1">$1</h3>');
  t = t.replace(/^# (.+)$/gm, '<h2 class="text-lg font-semibold mt-3 mb-1">$1</h2>');
  t = t.replace(/^&gt; (.+)$/gm, '<blockquote class="border-l-2 border-primary pl-3 my-2 text-muted-foreground text-sm">$1</blockquote>');
  t = t.replace(/\*\*(.+?)\*\*/g, '<strong class="font-semibold">$1</strong>');
  t = t.replace(/\*([^*]+)\*/g, '<em class="italic">$1</em>');
  t = t.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener" class="text-primary underline">$1</a>');
  t = t.replace(/^- (.+)$/gm, '<li class="text-sm ml-4 list-disc">$1</li>');
  t = t.replace(/^\d+\. (.+)$/gm, '<li class="text-sm ml-4 list-decimal">$1</li>');
  t = t.replace(/\n\n/g, '</p><p class="my-1.5">');
  t = '<p class="my-1.5">' + t + "</p>";
  return t;
}

export function AiAssistant({
  open,
  onClose,
  questionContext,
}: AiAssistantProps) {
  const platform = usePlatform();
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
          content: `Hi! Ask me anything about this question — I can explain concepts, clarify why an answer is right or wrong, or dive deeper into any topic.`,
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
      setError("Configure your Gemini API key in settings first.");
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
    setMessages((m) => [...m, userMsg]);

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
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
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
      clearTimeout(timeoutId);

      if (!res.ok) {
        const errBody = await res.text().catch(() => "");
        throw new Error(errBody || `HTTP ${res.status}`);
      }

      const data = await res.json();
      const reply =
        data?.candidates?.[0]?.content?.parts?.[0]?.text || "No response from AI.";
      setMessages((prev) => [...prev, {
        id: crypto.randomUUID(),
        role: "assistant",
        content: reply,
        timestamp: Date.now(),
      }]);
    } catch (err: any) {
      if (err.name === "AbortError") {
        setError("Request timed out. Try a shorter question or increase the max wait time.");
      } else {
        setError(
          err.message?.includes("API_KEY")
            ? "Invalid API key. Check your settings."
            : err.message || "Request failed."
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
        content: "Chat cleared. Ask me anything about this question!",
        timestamp: Date.now(),
      },
    ]);
    setError(null);
  };

  const content = (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 md:px-6 py-3 border-b border-border bg-card/40 shrink-0">
        <div className="w-9 h-9 rounded-full bg-primary/15 text-primary flex items-center justify-center">
          <Bot className="size-5" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold">AI Assistant</h3>
          <p className="text-[11px] text-muted-foreground">
            {questionContext
              ? `Context: ${questionContext.engine} question`
              : "Ask about any medical topic"}
          </p>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setShowSettings(!showSettings)}
            className={`size-7 rounded-lg flex items-center justify-center transition-colors ${
              showSettings ? "bg-primary/15 text-primary" : "hover:bg-muted text-muted-foreground"
            }`}
            title="Settings"
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
            <span className="hidden sm:inline">Clear</span>
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
                <label className="text-xs font-semibold text-muted-foreground">Gemini API Key</label>
                <div className="flex gap-2">
                  <input
                    type="password"
                    value={apiKey}
                    onChange={(e) => saveApiKey(e.target.value)}
                    placeholder="Enter your Gemini API key"
                    className="flex-1 h-8 rounded-lg border border-border bg-card px-3 text-xs outline-none focus:border-primary"
                  />
                </div>
                <p className="text-[10px] text-muted-foreground">
                  Get a free key at{" "}
                  <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener" className="text-primary underline">
                    AI Studio
                  </a>
                </p>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-muted-foreground">Model</label>
                <select
                  value={model}
                  onChange={(e) => saveModel(e.target.value)}
                  className="w-full h-8 rounded-lg border border-border bg-card px-3 text-xs outline-none focus:border-primary"
                >
                  {MODELS.map(([id, label]) => (
                    <option key={id} value={id}>{label}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-muted-foreground">Max Wait</label>
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
            <span className="font-medium">Question context</span>
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
                    const isCorrect = questionContext.correct != null && i + 1 === questionContext.correct;
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
        className="flex-1 overflow-y-auto osler-scroll px-4 md:px-6 py-4 space-y-3"
      >
        {messages.length === 0 ? (
          <EmptyState onSuggestion={(s) => send(s)} />
        ) : (
          messages.map((m) => <ChatBubble key={m.id} msg={m} />)
        )}
        {loading && (
          <div className="flex gap-2 items-center text-muted-foreground text-sm">
            <div className="w-7 h-7 rounded-full bg-primary/15 text-primary flex items-center justify-center shrink-0">
              <Bot className="size-4" />
            </div>
            <div className="flex items-center gap-1.5">
              <Loader2 className="size-3.5 animate-spin" />
              <span>Thinking…</span>
            </div>
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
        className="border-t border-border bg-card/40 p-3 md:p-4 shrink-0"
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
            placeholder="Ask a medical question…"
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
          <p className="text-[10px] text-muted-foreground hidden sm:block">
            Press Enter to send · Shift+Enter for newline
          </p>
          <button
            type="button"
            onClick={clear}
            className="text-[10px] text-muted-foreground hover:text-foreground transition-colors"
          >
            Clear chat
          </button>
        </div>
      </form>
    </div>
  );

  if (open !== undefined && onClose) {
    return (
      <AnimatePresence>
        {open && (
          <motion.div
            initial={platform.isPhone ? { y: "100%", opacity: 0 } : { x: 360, opacity: 0 }}
            animate={platform.isPhone ? { y: 0, opacity: 1 } : { x: 0, opacity: 1 }}
            exit={platform.isPhone ? { y: "100%", opacity: 0 } : { x: 360, opacity: 0 }}
            transition={platform.isPhone
              ? { type: "spring", damping: 32, stiffness: 320 }
              : { type: "spring", damping: 28, stiffness: 300 }}
            className={platform.isPhone
              ? "fixed inset-0 z-50 bg-card flex flex-col"
              : "fixed right-0 top-12 bottom-0 z-50 w-full sm:w-96 border-l border-border bg-card shadow-xl flex flex-col"
            }
          >
            {content}
          </motion.div>
        )}
      </AnimatePresence>
    );
  }

  return content;
}

function EmptyState({ onSuggestion }: { onSuggestion: (s: string) => void }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex flex-col items-center justify-center h-full text-center py-12"
    >
      <div className="w-14 h-14 rounded-full bg-primary/15 text-primary flex items-center justify-center mb-3">
        <Sparkles className="size-7" />
      </div>
      <h3 className="text-base font-semibold mb-1">Medical AI Tutor</h3>
      <p className="text-xs text-muted-foreground max-w-xs mb-5">
        Ask about pathophysiology, pharmacology, diagnostic workup, or any
        board topic. Get detailed, structured explanations.
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

function ChatBubble({ msg }: { msg: Message }) {
  const isUser = msg.role === "user";
  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn("flex gap-2", isUser && "flex-row-reverse")}
    >
      <div
        className={cn(
          "w-7 h-7 rounded-full flex items-center justify-center shrink-0 mt-0.5",
          isUser
            ? "bg-primary text-primary-foreground"
            : "bg-primary/15 text-primary"
        )}
      >
        {isUser ? <UserIcon className="size-4" /> : <Bot className="size-4" />}
      </div>
      <div
        className={cn(
          "osler-chat-bubble ai-chat-msg",
          isUser ? "user" : "assistant"
        )}
      >
        {isUser ? (
          <p>{msg.content}</p>
        ) : (
          <div dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.content) }} />
        )}
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
