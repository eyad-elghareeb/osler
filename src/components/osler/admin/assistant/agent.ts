"use client";

// LLM client for the admin harness. Imported ONLY via dynamic import from
// the assistant panel, so the `ai` SDK + provider packages live exclusively
// in the /admin/assistant chunk — the student bundle and every other admin
// page are byte-identical to before.

import {
  generateText,
  jsonSchema,
  stepCountIs,
  tool,
  type ModelMessage,
} from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { ASSISTANT_TOOLS } from "./tool-defs";
import type { ProviderConfig } from "./types";

export type { ModelMessage };

const SYSTEM_PROMPT = [
  "You are the Osler content-authoring assistant. You help admins manage medical-education content through tools.",
  "",
  "Workflow rules:",
  "- Always validate JSON with validate_content before create_draft or update_draft.",
  "- After create_draft / update_draft, validate again and report the new id.",
  "- Publishing tools (approve_content, publish_direct) and destructive tools (reject_content, unpublish_content, delete_content) pause for the admin's Approve click — just call them normally and explain why.",
  "- A rejected tool call means the admin said no: do not retry it, propose an alternative.",
  "- PDF parse results carry warnings: resolve every missing answer / weak rubric before creating a pack.",
  "- Keep answers short. Prefer calling tools over describing what you would do.",
  "- Reply in the admin's language (English or Arabic).",
].join("\n");

export interface ApprovalRequest {
  toolName: string;
  args: Record<string, unknown>;
}

export interface StepToolCall {
  toolName: string;
  args: Record<string, unknown>;
  /** True when the call will pause for approval (its card is created by requestApproval, not onStep). */
  destructive: boolean;
}

export interface TurnCallbacks {
  /** Per completed step: assistant text so far + tool calls made. */
  onStep: (text: string, toolCalls: StepToolCall[]) => void;
  /** Destructive tool calls wait here for an Approve/Reject click. */
  requestApproval: (req: ApprovalRequest) => Promise<boolean>;
  /** Fired when a tool execution settles (run, rejected, or errored). */
  onToolDone: (toolName: string, args: Record<string, unknown>, result: string, isError: boolean) => void;
}

function buildModel(config: ProviderConfig) {
  const modelId = config.model.trim();
  if (!modelId) throw new Error("Model is required");
  if (!config.apiKey.trim()) throw new Error("API key is required");
  switch (config.kind) {
    case "openai": {
      const provider = createOpenAI({
        apiKey: config.apiKey.trim(),
        baseURL: config.baseUrl.trim() || undefined,
      });
      return provider(modelId);
    }
    case "zen": {
      const baseURL = config.baseUrl.trim();
      if (!baseURL) throw new Error("Opencode Zen needs a base URL");
      return createOpenAICompatible({ name: "zen", apiKey: config.apiKey.trim(), baseURL })(modelId);
    }
    case "gemini-native": {
      return createGoogleGenerativeAI({ apiKey: config.apiKey.trim() })(modelId);
    }
  }
}

export async function runAssistantTurn(
  config: ProviderConfig,
  history: ModelMessage[],
  cb: TurnCallbacks,
  abortSignal?: AbortSignal,
): Promise<ModelMessage[]> {
  const tools: NonNullable<Parameters<typeof generateText>[0]["tools"]> = {};
  for (const def of ASSISTANT_TOOLS) {
    tools[def.name] = tool({
      description: def.description,
      inputSchema: jsonSchema(def.inputSchema as Parameters<typeof jsonSchema>[0]),
      execute: async (args) => {
        const record = (args ?? {}) as Record<string, unknown>;
        if (def.destructive) {
          const ok = await cb.requestApproval({ toolName: def.name, args: record });
          if (!ok) {
            const note = "REJECTED by the admin — do not retry this call. Propose an alternative or ask what to change.";
            cb.onToolDone(def.name, record, note, false);
            return note;
          }
        }
        try {
          const out = await def.execute(record);
          cb.onToolDone(def.name, record, out, false);
          return out;
        } catch (e: unknown) {
          const msg = `ERROR: ${e instanceof Error ? e.message : String(e ?? "Tool failed")}`;
          cb.onToolDone(def.name, record, msg, true);
          return msg;
        }
      },
    });
  }

  const result = await generateText({
    model: buildModel(config),
    system: SYSTEM_PROMPT,
    messages: history,
    tools,
    stopWhen: stepCountIs(8),
    abortSignal,
    onStepFinish: (step) => {
      cb.onStep(
        step.text,
        (step.toolCalls ?? []).map((c) => ({
          toolName: c.toolName,
          args: (c.input ?? {}) as Record<string, unknown>,
          destructive: ASSISTANT_TOOLS.some((d) => d.name === c.toolName && d.destructive),
        })),
      );
    },
  });
  return result.response.messages;
}

/** Cheap connectivity check for the provider config form ("Reply with: ok"). */
export async function testProvider(config: ProviderConfig): Promise<string> {
  const result = await generateText({
    model: buildModel(config),
    messages: [{ role: "user", content: "Reply with exactly: ok" }],
    stopWhen: stepCountIs(1),
  });
  return result.text.trim().slice(0, 200) || "ok";
}
