import { describe, it, expect } from "vitest";
import { handleRpc } from "../mcp/rpc";
import { findTool, type McpCtx } from "../mcp/tools";

// Pure tests — dispatch and tool logic against a stub context. No Cloudflare
// runtime needed: handlers only touch env.DB / CONTENT on success paths that
// these tests avoid or stub out.

const VALID_QUIZ = JSON.stringify({ questions: [{ id: "q1", question: "2+2?", options: ["3", "4"], correct: 1 }] });

function makeCtx(overrides: Partial<McpCtx> = {}): McpCtx {
  const stored = new Map<string, string>();
  const ownedObject = { id: "11111111-1111-4111-8111-111111111111", r2_key_base: "content/quiz/obj1", content_type: "quiz", title: "T", language: "en", status: "draft", created_by: "user-1" };
  // Minimal D1/R2 stand-ins so handlers pass their configured-storage guards.
  const db = {
    prepare: (_sql: string) => ({
      bind: (..._args: unknown[]) => ({ first: async () => ownedObject, all: async () => ({ results: [] }), run: async () => {} }),
    }),
  } as unknown as McpCtx["env"]["DB"];
  return {
    env: {
      DB: db,
      // Minimal R2 stand-in so handlers pass their configured-storage guard.
      CONTENT: {
        put: async (key: string, value: any) => void stored.set(key, String(value)),
        get: async (key: string) => (stored.has(key) ? { text: async () => stored.get(key)!, httpMetadata: {} } : null),
        delete: async (key: string) => void stored.delete(key),
        list: async () => ({ objects: [], truncated: false }),
      } as unknown as McpCtx["env"]["CONTENT"],
    },
    userId: "user-1",
    username: "tester",
    tokenId: "tok-1",
    scope: "content_admin",
    log: { info() {}, warn() {}, error() {} },
    audit: async () => {},
    r2Get: async (key) => stored.get(key) ?? null,
    r2Put: async (key, text) => void stored.set(key, typeof text === "string" ? text : new TextDecoder().decode(text)),
    r2Delete: async (key) => void stored.delete(key),
    draftKey: (base) => `${base}/draft.json`,
    pendingKey: (base) => `${base}/pending.json`,
    publishedKey: (base) => `${base}/published.json`,
    validateContent: () => [],
    uuid: () => "uuid-" + (stored.size + Math.random()).toString(36).slice(2, 8),
    ...overrides,
  };
}

async function call(ctx: McpCtx, method: string, params?: any) {
  const responses = await handleRpc(ctx, { jsonrpc: "2.0", id: 1, method, params });
  return responses?.[0] as any;
}

describe("MCP protocol", () => {
  it("initialize returns capabilities, server info and instructions", async () => {
    const r = await call(makeCtx(), "initialize");
    expect(r.result.protocolVersion).toBeTypeOf("string");
    expect(r.result.serverInfo.name).toBe("osler-admin");
    expect(r.result.capabilities.tools).toBeDefined();
    expect(r.result.instructions).toContain("content_admin");
    expect(r.result.instructions).toContain("Authoring & Review Queue");
  });

  it("tools/list advertises schemas without handlers", async () => {
    const r = await call(makeCtx(), "tools/list");
    const names = r.result.tools.map((t: any) => t.name);
    expect(names).toContain("create_content_pack");
    expect(names).not.toContain("approve");
    for (const t of r.result.tools) {
      expect(t.inputSchema.type).toBe("object");
      expect(t.run).toBeUndefined();
    }
  });

  it("never exposes publishing tools", async () => {
    for (const name of ["publish", "approve", "reject", "unpublish", "delete_content", "put_config"]) {
      expect(findTool(name)).toBeUndefined();
    }
  });

  it("unknown methods produce a -32601 error", async () => {
    const r = await call(makeCtx(), "resources/list");
    expect(r.error.code).toBe(-32601);
  });

  it("notifications alone yield a null payload (HTTP 202)", async () => {
    const payload = await handleRpc(makeCtx(), { jsonrpc: "2.0", method: "notifications/initialized" });
    expect(payload).toBeNull();
  });
});

describe("MCP tools/call", () => {
  it("returns structured content for a successful validation", async () => {
    const ctx = makeCtx({ validateContent: () => [] });
    const r = await call(ctx, "tools/call", { name: "validate_content", arguments: { contentType: "quiz", body: VALID_QUIZ } });
    expect(r.result.structuredContent.errors).toEqual([]);
    expect(r.result.content[0].type).toBe("text");
  });

  it("surfaces schema errors from create_content_pack validateFirst without writing anything", async () => {
    const writes: string[] = [];
    const ctx = makeCtx({
      validateContent: () => ["quiz: `questions` array required"],
      r2Put: async (key) => void writes.push(key),
    });
    const r = await call(ctx, "tools/call", {
      name: "create_content_pack",
      arguments: { contentType: "quiz", title: "Broken", body: "{ not valid", validateFirst: true },
    });
    expect(r.result.structuredContent.ok).toBe(false);
    expect(writes).toHaveLength(0);
  });

  it("rejects invalid asset paths in upload_asset", async () => {
    const ctx = makeCtx();
    const r = await call(ctx, "tools/call", {
      name: "upload_asset",
      arguments: { id: "11111111-1111-4111-8111-111111111111", path: "../escape.png", dataUri: "data:image/png;base64,AAA" },
    });
    expect(JSON.stringify(r.result.content[0].text)).toContain("Invalid asset path");
  });

  it("reports (not aborts) on a bad asset inside create_content_pack", async () => {
    const r = await call(makeCtx(), "tools/call", {
      name: "create_content_pack",
      arguments: { contentType: "quiz", title: "P", body: VALID_QUIZ, assets: [{ path: "../evil.png", dataUri: "data:image/png;base64,AAA" }] },
    });
    expect(r.result.structuredContent.failedAssets[0].error).toContain("Invalid asset path");
    expect(r.result.structuredContent.status).toBe("draft");
  });

  it("errors on unknown tools", async () => {
    const r = await call(makeCtx(), "tools/call", { name: "nope", arguments: {} });
    expect(r.error.code).toBe(-32601);
  });

  it("rejects update_published_content bodies over the size cap", async () => {
    const ctx = makeCtx({ scope: "admin" });
    const r = await call(ctx, "tools/call", {
      name: "update_published_content",
      arguments: { key: "content-files/quiz/x.json", body: "x".repeat(6_000_000) },
    });
    expect(JSON.stringify(r.result.content[0].text)).toMatch(/up to 5 MB/);
  });

  it("rejects update_config payloads over the size cap", async () => {
    const ctx = makeCtx({ scope: "admin" });
    const r = await call(ctx, "tools/call", {
      name: "update_config",
      arguments: { config: { blob: "x".repeat(2_000_000) } },
    });
    expect(JSON.stringify(r.result.content[0].text)).toMatch(/up to 1 MB/);
  });

  it("prompts/get builds the qbank-from-pdf workflow message", async () => {
    const r = await call(makeCtx(), "prompts/get", { name: "qbank_from_pdf", arguments: { sourceDescription: "/docs/cardio.pdf" } });
    const text = r.result.messages[0].content.text;
    expect(text).toContain("/docs/cardio.pdf");
    expect(text).toContain("create_content_pack");
  });
});

describe("MCP batch handling", () => {
  it("rejects a batch over the size cap without executing any of it", async () => {
    const writes: string[] = [];
    const ctx = makeCtx({ r2Put: async (key) => void writes.push(key) });
    const entries = Array.from({ length: 30 }, (_, i) => ({
      jsonrpc: "2.0",
      id: i,
      method: "tools/call",
      params: { name: "create_content_pack", arguments: { contentType: "quiz", title: `P${i}`, body: VALID_QUIZ } },
    }));
    const payload = await handleRpc(ctx, entries);
    expect(payload).toHaveLength(1);
    expect((payload as any)[0].error.message).toMatch(/Batch too large/);
    expect(writes).toHaveLength(0);
  });

  it("accepts a batch at the cap", async () => {
    const ctx = makeCtx();
    const entries = Array.from({ length: 25 }, (_, i) => ({ jsonrpc: "2.0", id: i, method: "tools/list" }));
    const payload = await handleRpc(ctx, entries);
    expect(payload).toHaveLength(25);
  });
});
