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
  const response = await handleRpc(ctx, { jsonrpc: "2.0", id: 1, method, params });
  return (Array.isArray(response) ? response[0] : response) as any;
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

  it("mirrors the request shape: single object for single requests, array for batches", async () => {
    const single = await handleRpc(makeCtx(), { jsonrpc: "2.0", id: 1, method: "tools/list" });
    expect(Array.isArray(single)).toBe(false);
    expect((single as any).result.tools).toBeDefined();
    const batch = await handleRpc(makeCtx(), [
      { jsonrpc: "2.0", id: 1, method: "tools/list" },
      { jsonrpc: "2.0", id: 2, method: "ping" },
    ]);
    expect(Array.isArray(batch)).toBe(true);
    expect(batch).toHaveLength(2);
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

describe("MCP bulk tools", () => {
  const ID_A = "11111111-1111-4111-8111-111111111111";
  const ID_B = "22222222-2222-4222-8222-222222222222";

  function ctxWithObject(obj: any, overrides: Partial<McpCtx> = {}): McpCtx {
    const db = {
      prepare: (_sql: string) => ({
        bind: (..._args: unknown[]) => ({ first: async () => obj, all: async () => ({ results: [] }), run: async () => {} }),
      }),
    } as unknown as McpCtx["env"]["DB"];
    return makeCtx({ env: { ...makeCtx().env, DB: db } as any, ...overrides });
  }

  it("bulk_get_content_objects fetches several packs in one call", async () => {
    const r = await call(makeCtx(), "tools/call", { name: "bulk_get_content_objects", arguments: { ids: [ID_A, ID_B] } });
    expect(r.result.structuredContent.total).toBe(2);
    expect(r.result.structuredContent.succeeded).toBe(2);
  });

  it("bulk_update_draft_bodies writes owned drafts", async () => {
    const r = await call(makeCtx(), "tools/call", {
      name: "bulk_update_draft_bodies",
      arguments: { updates: [{ id: ID_A, body: VALID_QUIZ }, { id: ID_B, body: VALID_QUIZ }] },
    });
    expect(r.result.structuredContent.succeeded).toBe(2);
  });

  it("bulk_update_draft_bodies fails inline (not aborts) on foreign objects", async () => {
    const ctx = ctxWithObject({ id: ID_A, r2_key_base: "content/quiz/obj1", content_type: "quiz", title: "T", language: "en", status: "draft", created_by: "user-2" });
    const r = await call(ctx, "tools/call", {
      name: "bulk_update_draft_bodies",
      arguments: { updates: [{ id: ID_A, body: VALID_QUIZ }] },
    });
    expect(r.result.structuredContent.succeeded).toBe(0);
    expect(r.result.structuredContent.results[0].error).toMatch(/Not authorized/);
  });

  it("bulk_submit_for_review refuses published objects inline", async () => {
    const ctx = ctxWithObject({ id: ID_A, r2_key_base: "content/quiz/obj1", content_type: "quiz", title: "T", language: "en", status: "published", created_by: "user-1" });
    const r = await call(ctx, "tools/call", { name: "bulk_submit_for_review", arguments: { ids: [ID_A] } });
    expect(r.result.structuredContent.succeeded).toBe(0);
    expect(r.result.structuredContent.results[0].error).toMatch(/unpublish to draft/);
  });

  it("bulk_create_content_packs creates several packs in one call", async () => {
    const r = await call(makeCtx(), "tools/call", {
      name: "bulk_create_content_packs",
      arguments: { packs: [{ contentType: "quiz", title: "P1", body: VALID_QUIZ }, { contentType: "quiz", title: "P2", body: VALID_QUIZ }] },
    });
    expect(r.result.structuredContent.total).toBe(2);
    expect(r.result.structuredContent.succeeded).toBe(2);
    expect(r.result.structuredContent.results[0].id).toBeTypeOf("string");
  });

  it("bulk tools reject oversized batches wholesale", async () => {
    const r = await call(makeCtx(), "tools/call", {
      name: "bulk_submit_for_review",
      arguments: { ids: Array.from({ length: 21 }, () => ID_A) },
    });
    expect(JSON.stringify(r.result.content[0].text)).toMatch(/1-20/);
  });
});

describe("MCP observability tools", () => {
  it("get_analytics_overview is admin-only", async () => {
    const r = await call(makeCtx(), "tools/call", { name: "get_analytics_overview", arguments: { days: 7 } });
    expect(JSON.stringify(r.result.content[0].text)).toMatch(/'admin' privilege/);
  });

  it("get_analytics_overview reports unwired hosts", async () => {
    const r = await call(makeCtx({ scope: "admin" }), "tools/call", { name: "get_analytics_overview", arguments: {} });
    expect(JSON.stringify(r.result.content[0].text)).toMatch(/not wired/);
  });

  it("get_analytics_overview returns aggregates when wired", async () => {
    const ctx = makeCtx({ scope: "admin", getAnalyticsOverview: async () => ({ totalEvents: 42, jsErrors: 3 }) });
    const r = await call(ctx, "tools/call", { name: "get_analytics_overview", arguments: { days: 30 } });
    expect(r.result.structuredContent.days).toBe(30);
    expect(r.result.structuredContent.totalEvents).toBe(42);
  });

  it("get_js_errors is admin-only and returns groups when wired", async () => {
    const denied = await call(makeCtx(), "tools/call", { name: "get_js_errors", arguments: {} });
    expect(JSON.stringify(denied.result.content[0].text)).toMatch(/'admin' privilege/);
    const ctx = makeCtx({ scope: "admin", getJsErrors: async () => [{ message: "boom", count: 2 }] });
    const r = await call(ctx, "tools/call", { name: "get_js_errors", arguments: { days: 1 } });
    expect(r.result.structuredContent.count).toBe(1);
    expect(r.result.structuredContent.items[0].message).toBe("boom");
  });

  it("tools/list advertises the bulk and observability tools", async () => {
    const r = await call(makeCtx(), "tools/list");
    const names = r.result.tools.map((t: any) => t.name);
    for (const n of ["bulk_get_content_objects", "bulk_update_draft_bodies", "bulk_create_content_packs", "bulk_submit_for_review", "get_analytics_overview", "get_js_errors"]) {
      expect(names).toContain(n);
    }
  });
});

describe("MCP bulk_validate", () => {
  const ID_A = "11111111-1111-4111-8111-111111111111";

  it("reports valid packs with content counts", async () => {
    const ctx = makeCtx();
    await ctx.r2Put("content/quiz/obj1/draft.json", VALID_QUIZ);
    const r = await call(ctx, "tools/call", { name: "bulk_validate", arguments: { ids: [ID_A] } });
    expect(r.result.structuredContent.valid).toBe(1);
    expect(r.result.structuredContent.results[0].counts).toEqual({ questions: 1 });
  });

  it("reports schema errors inline without aborting", async () => {
    const ctx = makeCtx({ validateContent: () => ["quiz: `questions` array required"] });
    await ctx.r2Put("content/quiz/obj1/draft.json", VALID_QUIZ);
    const r = await call(ctx, "tools/call", { name: "bulk_validate", arguments: { ids: [ID_A] } });
    expect(r.result.structuredContent.invalid).toBe(1);
    expect(r.result.structuredContent.results[0].errors).toEqual(["quiz: `questions` array required"]);
  });

  it("reports unknown ids inline", async () => {
    const db = {
      prepare: (_sql: string) => ({
        bind: (..._args: unknown[]) => ({ first: async () => null, all: async () => ({ results: [] }), run: async () => {} }),
      }),
    } as unknown as McpCtx["env"]["DB"];
    const ctx = makeCtx({ env: { ...makeCtx().env, DB: db } as any });
    const r = await call(ctx, "tools/call", { name: "bulk_validate", arguments: { ids: [ID_A] } });
    expect(r.result.structuredContent.invalid).toBe(1);
    expect(r.result.structuredContent.results[0].error).toMatch(/not found/i);
  });
});

describe("MCP duplicate_content_object", () => {
  const ID_A = "11111111-1111-4111-8111-111111111111";

  it("clones a readable pack into an owned draft", async () => {
    const ctx = makeCtx();
    await ctx.r2Put("content/quiz/obj1/draft.json", VALID_QUIZ);
    const r = await call(ctx, "tools/call", { name: "duplicate_content_object", arguments: { id: ID_A } });
    const sc = r.result.structuredContent;
    expect(sc.ok).toBe(true);
    expect(sc.sourceId).toBe(ID_A);
    expect(sc.id).not.toBe(ID_A);
    expect(sc.title).toMatch(/Copy of/);
    expect(sc.status).toBe("draft");
    // Clone body readable through the new draft slot.
    const dup = await ctx.r2Get(`content/quiz/${sc.id}/draft.json`);
    expect(dup).toBe(VALID_QUIZ);
  });

  it("accepts a custom title and refuses body-less sources", async () => {
    const ctx = makeCtx();
    await ctx.r2Put("content/quiz/obj1/draft.json", VALID_QUIZ);
    const r = await call(ctx, "tools/call", { name: "duplicate_content_object", arguments: { id: ID_A, title: "Remix" } });
    expect(r.result.structuredContent.title).toBe("Remix");
    const empty = makeCtx();
    const bad = await call(empty, "tools/call", { name: "duplicate_content_object", arguments: { id: ID_A } });
    expect(JSON.stringify(bad.result.content[0].text)).toMatch(/no readable body/);
  });
});

describe("MCP bulk_delete_content_objects", () => {
  const ID_A = "11111111-1111-4111-8111-111111111111";

  it("requires two-step confirm, then deletes", async () => {
    const ctx = makeCtx();
    const first = await call(ctx, "tools/call", { name: "bulk_delete_content_objects", arguments: { ids: [ID_A] } });
    const text = JSON.stringify(first.result.content[0].text);
    expect(text).toMatch(/DESTRUCTIVE ACTION/);
    const token = text.match(/continueToken\\": \\"([0-9a-z]+)\\"/)?.[1];
    expect(token).toBeTypeOf("string");
    const second = await call(ctx, "tools/call", {
      name: "bulk_delete_content_objects",
      arguments: { ids: [ID_A], confirm: true, continueToken: token },
    });
    expect(second.result.structuredContent).toMatchObject({ ok: true, deleted: [ID_A] });
  });

  it("restarts the flow when the id set changes", async () => {
    const ctx = makeCtx();
    const first = await call(ctx, "tools/call", { name: "bulk_delete_content_objects", arguments: { ids: [ID_A] } });
    const token = JSON.stringify(first.result.content[0].text).match(/continueToken\\": \\"([0-9a-z]+)\\"/)?.[1];
    const ID_B = "22222222-2222-4222-8222-222222222222";
    const retry = await call(ctx, "tools/call", {
      name: "bulk_delete_content_objects",
      arguments: { ids: [ID_A, ID_B], confirm: true, continueToken: token },
    });
    expect(JSON.stringify(retry.result.content[0].text)).toMatch(/DESTRUCTIVE ACTION/);
  });

  it("skips published items inline for content_admin", async () => {
    const db = {
      prepare: (_sql: string) => ({
        bind: (..._args: unknown[]) => ({
          first: async () => ({ id: ID_A, r2_key_base: "content/quiz/obj1", content_type: "quiz", title: "T", language: "en", status: "published", created_by: "user-1" }),
          all: async () => ({ results: [] }),
          run: async () => {},
        }),
      }),
    } as unknown as McpCtx["env"]["DB"];
    const ctx = makeCtx({ env: { ...makeCtx().env, DB: db } as any });
    const r = await call(ctx, "tools/call", { name: "bulk_delete_content_objects", arguments: { ids: [ID_A] } });
    expect(r.result.structuredContent.ok).toBe(false);
    expect(r.result.structuredContent.skipped[0].error).toMatch(/admin privilege/);
  });
});

describe("MCP review triage tools", () => {
  const ID_A = "11111111-1111-4111-8111-111111111111";

  function ctxWithStatus(status: string, overrides: Partial<McpCtx> = {}): McpCtx {
    const db = {
      prepare: (_sql: string) => ({
        bind: (..._args: unknown[]) => ({
          first: async () => ({ id: ID_A, r2_key_base: "content/quiz/obj1", content_type: "quiz", title: "T", language: "en", status, created_by: "user-1" }),
          all: async () => ({ results: [] }),
          run: async () => {},
        }),
      }),
    } as unknown as McpCtx["env"]["DB"];
    return makeCtx({ env: { ...makeCtx().env, DB: db } as any, ...overrides });
  }

  it("bulk_approve_content is admin-only", async () => {
    const r = await call(makeCtx(), "tools/call", { name: "bulk_approve_content", arguments: { items: [{ id: ID_A }] } });
    expect(JSON.stringify(r.result.content[0].text)).toMatch(/'admin' privilege/);
  });

  it("bulk_approve_content publishes pending items when wired", async () => {
    const ctx = ctxWithStatus("pending", { scope: "admin", publishObject: async () => ({ ok: true, hybridKeys: [] }) });
    const r = await call(ctx, "tools/call", { name: "bulk_approve_content", arguments: { items: [{ id: ID_A }] } });
    expect(r.result.structuredContent.succeeded).toBe(1);
    expect(r.result.structuredContent.results[0].status).toBe("published");
  });

  it("bulk_approve_content fails non-pending items inline", async () => {
    const ctx = ctxWithStatus("draft", { scope: "admin", publishObject: async () => ({ ok: true, hybridKeys: [] }) });
    const r = await call(ctx, "tools/call", { name: "bulk_approve_content", arguments: { items: [{ id: ID_A }] } });
    expect(r.result.structuredContent.succeeded).toBe(0);
    expect(r.result.structuredContent.results[0].error).toMatch(/expected 'pending'/);
  });

  it("bulk_reject_content records per-item reasons", async () => {
    const ctx = ctxWithStatus("pending", { scope: "admin" });
    const r = await call(ctx, "tools/call", { name: "bulk_reject_content", arguments: { items: [{ id: ID_A, reason: "Q3 has two correct answers" }] } });
    expect(r.result.structuredContent.succeeded).toBe(1);
    expect(r.result.structuredContent.results[0].reason).toBe("Q3 has two correct answers");
  });

  it("get_object_diff shows all three slots to the owner", async () => {
    const ctx = makeCtx();
    await ctx.r2Put("content/quiz/obj1/draft.json", VALID_QUIZ);
    const r = await call(ctx, "tools/call", { name: "get_object_diff", arguments: { id: ID_A } });
    expect(r.result.structuredContent.draft).toBe(VALID_QUIZ);
    expect(r.result.structuredContent.pending).toBeNull();
    expect(r.result.structuredContent.published).toBeNull();
  });

  it("get_object_diff refuses foreign drafts", async () => {
    const db = {
      prepare: (_sql: string) => ({
        bind: (..._args: unknown[]) => ({
          first: async () => ({ id: ID_A, r2_key_base: "content/quiz/obj1", content_type: "quiz", title: "T", language: "en", status: "draft", created_by: "user-2" }),
          all: async () => ({ results: [] }),
          run: async () => {},
        }),
      }),
    } as unknown as McpCtx["env"]["DB"];
    const ctx = makeCtx({ env: { ...makeCtx().env, DB: db } as any });
    const r = await call(ctx, "tools/call", { name: "get_object_diff", arguments: { id: ID_A } });
    expect(JSON.stringify(r.result.content[0].text)).toMatch(/Not authorized/);
  });
});

describe("MCP organize tools", () => {
  const ID_A = "11111111-1111-4111-8111-111111111111";
  const ID_B = "22222222-2222-4222-8222-222222222222";

  function ctxWithObjects(byId: Record<string, any>): McpCtx {
    const db = {
      prepare: (_sql: string) => ({
        bind: (...args: unknown[]) => ({
          first: async () => byId[String(args[0])] ?? null,
          all: async () => ({ results: [] }),
          run: async () => {},
        }),
      }),
    } as unknown as McpCtx["env"]["DB"];
    return makeCtx({ env: { ...makeCtx().env, DB: db } as any });
  }

  const draftObj = (id: string, by = "user-1", status = "draft") => ({
    id, r2_key_base: "content/quiz/obj1", content_type: "quiz", title: "T", language: "en", status, created_by: by,
  });

  it("bulk_set_titles renames owned packs", async () => {
    const ctx = ctxWithObjects({ [ID_A]: draftObj(ID_A), [ID_B]: draftObj(ID_B) });
    const r = await call(ctx, "tools/call", {
      name: "bulk_set_titles",
      arguments: { items: [{ id: ID_A, title: "New A" }, { id: ID_B, title: "New B" }] },
    });
    expect(r.result.structuredContent.succeeded).toBe(2);
    expect(r.result.structuredContent.results[0].title).toBe("New A");
  });

  it("bulk_set_titles fails foreign packs inline", async () => {
    const ctx = ctxWithObjects({ [ID_A]: draftObj(ID_A, "user-2") });
    const r = await call(ctx, "tools/call", {
      name: "bulk_set_titles",
      arguments: { items: [{ id: ID_A, title: "Hijack" }] },
    });
    expect(r.result.structuredContent.succeeded).toBe(0);
    expect(r.result.structuredContent.results[0].error).toMatch(/Not authorized/);
  });

  it("bulk_set_target_paths moves drafts but refuses published", async () => {
    const ctx = ctxWithObjects({ [ID_A]: draftObj(ID_A), [ID_B]: draftObj(ID_B, "user-1", "published") });
    const r = await call(ctx, "tools/call", {
      name: "bulk_set_target_paths",
      arguments: { items: [{ id: ID_A, targetPath: "cardio/acs" }, { id: ID_B, targetPath: "cardio/acs" }] },
    });
    expect(r.result.structuredContent.succeeded).toBe(1);
    expect(r.result.structuredContent.results[0].targetPath).toBe("cardio/acs");
    expect(r.result.structuredContent.results[1].error).toMatch(/unpublish to draft/);
  });
});
describe("MCP listing/search filters", () => {
  function capturingDb(first: unknown, all: unknown, seen: { sql: string; args: unknown[] }[]) {
    // D1 statements expose first/all/run both directly and under bind() —
    // the overview/count queries bind no params, so the stub needs both.
    return {
      prepare: (sql: string) => {
        const stmt = {
          first: async () => first,
          all: async () => all,
          run: async () => {},
        };
        return {
          ...stmt,
          bind: (...args: unknown[]) => {
            seen.push({ sql, args });
            return stmt;
          },
        };
      },
    } as unknown as McpCtx["env"]["DB"];
  }

  it("list_content_objects filters by engine type and language", async () => {
    const seen: { sql: string; args: unknown[] }[] = [];
    const ctx = makeCtx({ env: { ...makeCtx().env, DB: capturingDb(null, { results: [] }, seen) } as any });
    const r = await call(ctx, "tools/call", { name: "list_content_objects", arguments: { contentType: "quiz", language: "ar" } });
    expect(r.result.structuredContent.total).toBe(0);
    expect(seen[0].sql).toMatch(/co\.content_type = \?/);
    expect(seen[0].sql).toMatch(/co\.language = \?/);
    expect(seen[0].args).toContain("quiz");
    expect(seen[0].args).toContain("ar");
  });

  it("search_content accepts rejected status, language, and limit", async () => {
    const seen: { sql: string; args: unknown[] }[] = [];
    const ctx = makeCtx({ env: { ...makeCtx().env, DB: capturingDb(null, { results: [] }, seen) } as any });
    const r = await call(ctx, "tools/call", {
      name: "search_content",
      arguments: { query: "cardio", status: "rejected", language: "en", limit: 10 },
    });
    expect(r.result.structuredContent.count).toBe(0);
    expect(seen[0].sql).toMatch(/status = \?/);
    expect(seen[0].args).toEqual(expect.arrayContaining(["%cardio%", "rejected", "en", 10]));
  });

  it("get_instance_overview reports per-engine counts and the pending total", async () => {
    const db = {
      prepare: (sql: string) => {
        const stmt = {
          first: async () => ({ n: 7 }),
          all: async () => (sql.includes("content_type")
            ? { results: [{ content_type: "quiz", n: 3 }] }
            : { results: [{ status: "pending", n: 2 }, { status: "draft", n: 5 }] }),
          run: async () => {},
        };
        return { ...stmt, bind: (..._args: unknown[]) => stmt };
      },
    } as unknown as McpCtx["env"]["DB"];
    const ctx = makeCtx({ scope: "admin", env: { ...makeCtx().env, DB: db } as any, readContentVersion: async () => "v42" });
    const r = await call(ctx, "tools/call", { name: "get_instance_overview", arguments: {} });
    const sc = r.result.structuredContent;
    expect(sc.contentByType).toEqual({ quiz: 3 });
    expect(sc.pendingReview).toBe(2);
    expect(sc.users).toBe(7);
    expect(sc.contentVersion).toBe("v42");
  });

  it("list_content_files can browse manifests with the content-manifests/ prefix", async () => {
    let prefix = "";
    const base = makeCtx();
    const ctx = makeCtx({
      env: {
        ...base.env,
        CONTENT: {
          ...(base.env.CONTENT as any),
          list: async (opts: any) => {
            prefix = opts.prefix;
            return { objects: [], truncated: false };
          },
        },
      } as any,
    });
    await call(ctx, "tools/call", { name: "list_content_files", arguments: { prefix: "content-manifests/qbank" } });
    expect(prefix).toBe("content-manifests/qbank");
  });
});

describe("MCP get_object_diff truncation", () => {
  const ID_A = "11111111-1111-4111-8111-111111111111";

  it("caps long bodies by default with lengths/truncated flags", async () => {
    const ctx = makeCtx();
    await ctx.r2Put("content/quiz/obj1/draft.json", "x".repeat(25_000));
    const r = await call(ctx, "tools/call", { name: "get_object_diff", arguments: { id: ID_A } });
    const sc = r.result.structuredContent;
    expect(sc.draft).toHaveLength(20_000);
    expect(sc.lengths.draft).toBe(25_000);
    expect(sc.truncated.draft).toBe(true);
    expect(sc.pending).toBeNull();
    expect(sc.lengths.pending).toBe(0);
  });

  it("returns full bodies with maxChars 0", async () => {
    const ctx = makeCtx();
    await ctx.r2Put("content/quiz/obj1/draft.json", "y".repeat(25_000));
    const r = await call(ctx, "tools/call", { name: "get_object_diff", arguments: { id: ID_A, maxChars: 0 } });
    const sc = r.result.structuredContent;
    expect(sc.draft).toHaveLength(25_000);
    expect(sc.truncated.draft).toBe(false);
    expect(sc.maxChars).toBeNull();
  });
});

describe("MCP batch handling", () => {  it("rejects a batch over the size cap without executing any of it", async () => {
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
