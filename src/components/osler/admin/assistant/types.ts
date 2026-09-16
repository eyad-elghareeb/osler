"use client";

// Shared types for the /admin/assistant harness. UI-only — the heavy LLM
// client lives in agent.ts, which the panel lazy-loads so the `ai` SDK never
// enters the student bundle or any other admin chunk.
//
// Session persistence: the transcript + model history are saved per session
// in localStorage (compacted — see compactHistoryForStorage) so a reload or
// an accidental navigation never loses an authoring conversation. The
// provider API key follows the admin's storage choice: "remember" keeps it in
// localStorage across browser restarts, "session" keeps it in sessionStorage
// so closing the tab clears it.

export type ProviderKind = "openai" | "gemini-native" | "zen";

export interface ProviderConfig {
  kind: ProviderKind;
  /** OpenAI-compatible endpoint base URL (openai + zen). Empty = provider default. */
  baseUrl: string;
  apiKey: string;
  model: string;
  /** true (default) = persist the API key in localStorage; false = sessionStorage only. */
  rememberKey: boolean;
}

export const PROVIDER_DEFAULTS: Record<ProviderKind, { baseUrl: string; model: string }> = {
  openai: { baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini" },
  "gemini-native": { baseUrl: "", model: "gemini-3.5-flash-lite" },
  zen: { baseUrl: "", model: "" },
};

const LS_PREFIX = "osler_admin_assistant.";
const SESSIONS_KEY = `${LS_PREFIX}sessions`;
const ACTIVE_KEY = `${LS_PREFIX}activeSession`;
const REMEMBER_KEY = `${LS_PREFIX}rememberKey`;

/** The API key never lives in one place blindly: "remember" → localStorage
 *  (survives restarts), "session" → sessionStorage (cleared when the tab
 *  closes). Switching modes moves the key between stores atomically. */
function keyStore(remember: boolean): Storage | null {
  if (typeof window === "undefined") return null;
  return remember ? window.localStorage : window.sessionStorage;
}

function readKey(): { apiKey: string; rememberKey: boolean } {
  if (typeof window === "undefined") return { apiKey: "", rememberKey: true };
  const remember = window.localStorage.getItem(REMEMBER_KEY) !== "0";
  const apiKey = window.localStorage.getItem(`${LS_PREFIX}apiKey`) ?? window.sessionStorage.getItem(`${LS_PREFIX}apiKey`) ?? "";
  return { apiKey, rememberKey: remember };
}

export function loadProviderConfig(): ProviderConfig {
  const { apiKey, rememberKey } = readKey();
  if (typeof window === "undefined") {
    return { kind: "openai", baseUrl: PROVIDER_DEFAULTS.openai.baseUrl, apiKey: "", model: PROVIDER_DEFAULTS.openai.model, rememberKey: true };
  }
  const kind = (localStorage.getItem(`${LS_PREFIX}kind`) as ProviderKind) || "openai";
  const safe = kind === "openai" || kind === "gemini-native" || kind === "zen" ? kind : "openai";
  return {
    kind: safe,
    baseUrl: localStorage.getItem(`${LS_PREFIX}baseUrl`) ?? PROVIDER_DEFAULTS[safe].baseUrl,
    apiKey,
    model: localStorage.getItem(`${LS_PREFIX}model`) || PROVIDER_DEFAULTS[safe].model,
    rememberKey,
  };
}

export function saveProviderConfig(cfg: ProviderConfig): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(`${LS_PREFIX}kind`, cfg.kind);
  localStorage.setItem(`${LS_PREFIX}baseUrl`, cfg.baseUrl);
  localStorage.setItem(`${LS_PREFIX}model`, cfg.model);
  localStorage.setItem(REMEMBER_KEY, cfg.rememberKey ? "1" : "0");
  // Move the key between stores so it only ever lives in the active one.
  localStorage.removeItem(`${LS_PREFIX}apiKey`);
  sessionStorage.removeItem(`${LS_PREFIX}apiKey`);
  if (cfg.apiKey) keyStore(cfg.rememberKey)?.setItem(`${LS_PREFIX}apiKey`, cfg.apiKey);
}

/** Wipe every stored assistant secret (key stores only — sessions stay).
 *  Called from the admin shell's sign-out so a shared machine never keeps
 *  an admin's provider key. */
export function clearAssistantSecrets(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(`${LS_PREFIX}apiKey`);
  sessionStorage.removeItem(`${LS_PREFIX}apiKey`);
}

/** One rendered transcript row. */
export type ChatRole = "user" | "assistant" | "tool" | "system-note";

export interface ToolCallView {
  toolName: string;
  args: Record<string, unknown>;
  /** Destructive calls pause here until the admin approves or rejects. */
  needsApproval: boolean;
  approved: boolean | null;
  result: string | null;
  isError: boolean;
  /** Content-object ids surfaced by this call (deep-link chips into the editor). */
  contentIds?: string[];
}

export interface ChatMsg {
  id: string;
  role: ChatRole;
  text: string;
  tool?: ToolCallView;
  /** Token usage for this completed assistant turn (undefined on user/tool rows). */
  usage?: TurnUsage;
  timestamp: number;
  /** True while this assistant row is still streaming text deltas in. */
  streaming?: boolean;
}

export interface TurnUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  /** Wall-clock ms from request start to turn completion. */
  durationMs: number;
}

/* ── Conversation sessions ──────────────────────────────────────────────── */

export interface AssistantSession {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  /** Rendered transcript (what the admin sees). */
  messages: ChatMsg[];
  /** Serialized ModelMessage[] — the model-visible conversation. Tool message
   *  content is compacted on save (see agent.ts compactForStorage) so a long
   *  authoring session can't blow the ~5 MB localStorage budget. */
  history: unknown[];
  /** Cumulative token totals across the session. */
  totals: { inputTokens: number; outputTokens: number; turns: number };
}

const MAX_SESSIONS = 20;
const MAX_PERSISTED_MESSAGES = 400;

/* ── Storage-side history compaction ─────────────────────────────────────
 * Persisted sessions must never blow the ~5 MB localStorage budget: tool
 * results and injected PDF payloads (huge user strings) are stubbed to 600
 * chars before saving. Runs on plain shapes (no `ai` SDK import) so the
 * panel can call it without breaking the assistant chunk's isolation. */
const STORAGE_STUB_CAP = 600;

export function compactHistoryForStorage(history: unknown[]): unknown[] {
  return history.map((m) => {
    if (!m || typeof m !== "object") return m;
    const rec = m as { role?: unknown; content?: unknown };
    const isTool = rec.role === "tool";
    const isBigUser = rec.role === "user" && typeof rec.content === "string" && rec.content.length > 8_000;
    if (!isTool && !isBigUser) return m;
    if (typeof rec.content !== "string" || rec.content.length <= STORAGE_STUB_CAP) return m;
    return { ...rec, content: `${rec.content.slice(0, STORAGE_STUB_CAP)}…[compacted for storage]` };
  });
}

export function loadSessions(): AssistantSession[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(SESSIONS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as AssistantSession[];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((s) => s && typeof s.id === "string" && Array.isArray(s.messages))
      .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
      .slice(0, MAX_SESSIONS);
  } catch {
    return [];
  }
}

export function saveSessions(sessions: AssistantSession[]): void {
  if (typeof window === "undefined") return;
  try {
    const trimmed = [...sessions]
      .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
      .slice(0, MAX_SESSIONS)
      .map((s) => ({ ...s, messages: s.messages.slice(-MAX_PERSISTED_MESSAGES) }));
    localStorage.setItem(SESSIONS_KEY, JSON.stringify(trimmed));
  } catch {
    // Quota exceeded (huge transcripts) — drop the oldest sessions and retry
    // once rather than silently losing the active one.
    try {
      const trimmed = [...sessions]
        .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
        .slice(0, Math.max(2, Math.ceil(MAX_SESSIONS / 4)))
        .map((s) => ({ ...s, messages: s.messages.slice(-MAX_PERSISTED_MESSAGES), history: s.history.slice(-40) }));
      localStorage.setItem(SESSIONS_KEY, JSON.stringify(trimmed));
    } catch {
      // Give up silently — the in-memory conversation still works.
    }
  }
}

export function getActiveSessionId(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(ACTIVE_KEY);
}

export function setActiveSessionId(id: string | null): void {
  if (typeof window === "undefined") return;
  if (id) localStorage.setItem(ACTIVE_KEY, id);
  else localStorage.removeItem(ACTIVE_KEY);
}

/** Human-ish title from the first user message (kept short for the sidebar). */
export function sessionTitleFrom(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return "New chat";
  return clean.length > 60 ? `${clean.slice(0, 57)}…` : clean;
}

/** Extract content-object ids surfaced by a tool result string (create/
 *  duplicate/approve/publish responses are JSON with an "id" field) so the
 *  transcript can offer "Open in editor" deep links. */
export function collectContentIds(args: Record<string, unknown>, result: string): string[] {
  const ids: string[] = [];
  const push = (v: unknown) => {
    if (typeof v === "string" && /^[0-9a-f-]{16,64}$/i.test(v) && !ids.includes(v)) ids.push(v);
  };
  // Echo back an explicit id argument (approve/reject/unpublish/delete).
  if (typeof args.id === "string") push(args.id);
  // Parse ids out of JSON tool results (create_draft / duplicate / publish).
  try {
    const parsed = JSON.parse(result) as Record<string, unknown>;
    push(parsed.id);
    if (Array.isArray(parsed.hybridKeys)) {
      for (const k of parsed.hybridKeys) {
        if (typeof k === "string") {
          const m = k.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
          if (m) push(m[1]);
        }
      }
    }
  } catch {
    // Not JSON — nothing to extract.
  }
  return ids.slice(0, 4);
}
