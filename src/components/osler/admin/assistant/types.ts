"use client";

// Shared types for the /admin/assistant harness. UI-only — the heavy LLM
// client lives in agent.ts, which the panel lazy-loads so the `ai` SDK never
// enters the student bundle or any other admin chunk.

export type ProviderKind = "openai" | "gemini-native" | "zen";

export interface ProviderConfig {
  kind: ProviderKind;
  /** OpenAI-compatible endpoint base URL (openai + zen). Empty = provider default. */
  baseUrl: string;
  apiKey: string;
  model: string;
}

export const PROVIDER_DEFAULTS: Record<ProviderKind, { baseUrl: string; model: string }> = {
  openai: { baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini" },
  "gemini-native": { baseUrl: "", model: "gemini-3.5-flash-lite" },
  zen: { baseUrl: "", model: "" },
};

const LS_PREFIX = "osler_admin_assistant.";

export function loadProviderConfig(): ProviderConfig {
  if (typeof window === "undefined") {
    return { kind: "openai", baseUrl: PROVIDER_DEFAULTS.openai.baseUrl, apiKey: "", model: PROVIDER_DEFAULTS.openai.model };
  }
  const kind = (localStorage.getItem(`${LS_PREFIX}kind`) as ProviderKind) || "openai";
  const safe = kind === "openai" || kind === "gemini-native" || kind === "zen" ? kind : "openai";
  return {
    kind: safe,
    baseUrl: localStorage.getItem(`${LS_PREFIX}baseUrl`) ?? PROVIDER_DEFAULTS[safe].baseUrl,
    apiKey: localStorage.getItem(`${LS_PREFIX}apiKey`) ?? "",
    model: localStorage.getItem(`${LS_PREFIX}model`) || PROVIDER_DEFAULTS[safe].model,
  };
}

export function saveProviderConfig(cfg: ProviderConfig): void {
  localStorage.setItem(`${LS_PREFIX}kind`, cfg.kind);
  localStorage.setItem(`${LS_PREFIX}baseUrl`, cfg.baseUrl);
  localStorage.setItem(`${LS_PREFIX}apiKey`, cfg.apiKey);
  localStorage.setItem(`${LS_PREFIX}model`, cfg.model);
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
}

export interface ChatMsg {
  id: string;
  role: ChatRole;
  text: string;
  tool?: ToolCallView;
  timestamp: number;
}
