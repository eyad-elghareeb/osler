"use client";

// Public barrel for the /admin/assistant harness. The route page imports the
// panel from here; agent.ts (the `ai` SDK client) is dynamically imported
// inside the panel so provider packages stay inside this route's chunk.

export { AssistantPanel } from "./assistant-panel";
export type { ProviderConfig, ProviderKind, ChatMsg, ChatRole, ToolCallView } from "./types";
