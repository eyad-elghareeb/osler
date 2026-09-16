"use client";

// Curated tool catalog for the admin harness. Each entry mirrors one MCP
// capability but executes over the admin's session (adminApi) — no separate
// MCP token needed. The catalog stays content-first; observability tools
// (instance overview, audit, analytics, JS errors) are read-only and only
// registered when the signed-in admin has the matching capability, so a
// content_admin never even sees them advertised to the model.

import { adminApi, analyticsApi, type AdminCapabilities, type ContentType } from "@/components/osler/admin/admin-api";

export interface AssistantToolDef {
  name: string;
  description: string;
  /** JSON Schema for the tool input (passed to the AI SDK's jsonSchema()). */
  inputSchema: Record<string, unknown>;
  /** Destructive / publishing tools pause for an Approve click before running. */
  destructive: boolean;
  /** Capability required to register the tool at all (absent = both admin tiers). */
  requires?: keyof AdminCapabilities;
  execute: (args: Record<string, unknown>) => Promise<string>;
}

const str = (description: string) => ({ type: "string", description });
const MAX_RESULT_CHARS = 12_000;

function summarize(value: unknown): string {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return text.length > MAX_RESULT_CHARS
    ? `${text.slice(0, MAX_RESULT_CHARS)}\n…[truncated ${text.length - MAX_RESULT_CHARS} chars — use a narrower query]`
    : text;
}

function truncateBody(body: unknown, cap = 60_000): string {
  const text = typeof body === "string" ? body : JSON.stringify(body ?? null, null, 2);
  return text.length > cap ? `${text.slice(0, cap)}\n…[body truncated]` : text;
}

const num = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);
const optStr = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);

/** Client-side guard for R2 keys the raw-file tools accept. Mirrors the
 *  worker's server-side checks — catching typos here gives the model an
 *  immediately actionable error instead of a 400 round-trip. */
function assertSafeR2Key(key: string, prefixes: string[]): string {
  const trimmed = key.trim();
  if (!trimmed) throw new Error("key is required");
  if (trimmed.includes("..") || trimmed.includes("\\")) throw new Error("Invalid key: path traversal is not allowed");
  if (!prefixes.some((p) => trimmed.startsWith(p))) throw new Error(`Key must start with one of: ${prefixes.join(", ")}`);
  return trimmed;
}

const CONTENT_TYPES: ContentType[] = ["quiz", "bank", "written", "mixed", "flashcard", "osce", "library", "video"];

const BASE_TOOLS: AssistantToolDef[] = [
  {
    name: "list_content",
    description: "List managed content objects (id, type, title, status). Filter by status and title substring.",
    inputSchema: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["draft", "pending", "rejected", "published", "all"], description: "Workflow status filter (default all)" },
        q: { type: "string", description: "Title substring search" },
        page: { type: "number", description: "1-based page (default 1)" },
        limit: { type: "number", description: "Page size 1-100 (default 20 — keep small)" },
      },
    },
    destructive: false,
    execute: async (a) => summarize(await adminApi.listContent(
      typeof a.status === "string" ? a.status : "all",
      optStr(a.q),
      num(a.page, 1),
      Math.min(100, num(a.limit, 20)),
    )),
  },
  {
    name: "review_queue",
    description: "List content awaiting admin review (status pending). Start here when asked what's waiting.",
    inputSchema: { type: "object", properties: {} },
    destructive: false,
    execute: async () => summarize(await adminApi.pendingQueue()),
  },
  {
    name: "get_content",
    description: "Fetch one content object by id — metadata plus its full body. Bodies can be large; prefer validate_content for a quick check.",
    inputSchema: {
      type: "object",
      properties: { id: str("Content object id") },
      required: ["id"],
    },
    destructive: false,
    execute: async (a) => {
      const obj = await adminApi.getContent(String(a.id));
      return summarize({ ...obj, body: obj.body != null ? truncateBody(obj.body) : null });
    },
  },
  {
    name: "get_diff",
    description: "Show the pending vs published bodies of one object side by side (for review decisions).",
    inputSchema: {
      type: "object",
      properties: { id: str("Content object id") },
      required: ["id"],
    },
    destructive: false,
    execute: async (a) => summarize(await adminApi.getDiff(String(a.id))),
  },
  {
    name: "validate_content",
    description: "Validate a draft body against its engine schema. Pass id to validate the stored draft, or contentType + body to validate inline JSON.",
    inputSchema: {
      type: "object",
      properties: {
        id: str("Content object id (validates its stored draft)"),
        contentType: { type: "string", enum: CONTENT_TYPES },
        body: str("Inline JSON body to validate"),
      },
    },
    destructive: false,
    execute: async (a) => {
      if (optStr(a.id)) return summarize(await adminApi.validateContent(String(a.id)));
      if (typeof a.contentType === "string" && typeof a.body === "string") {
        return summarize(await adminApi.validateStandalone(a.contentType as ContentType, a.body));
      }
      throw new Error("Provide id or contentType + body");
    },
  },
  {
    name: "bulk_validate_drafts",
    description: "Validate every draft (or the first N drafts) and report which pass or fail schema validation, with per-item error counts. Cheap health sweep before a publishing session.",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Max drafts to check, 1-30 (default 20)" },
        q: { type: "string", description: "Optional title substring filter" },
      },
    },
    destructive: false,
    execute: async (a) => {
      const limit = Math.min(30, Math.max(1, num(a.limit, 20)));
      const page = await adminApi.listContent("draft", optStr(a.q), 1, limit);
      const results: Array<{ id: string; title: string | null; ok: boolean; errors: string[] }> = [];
      for (const item of page.items.slice(0, limit)) {
        try {
          const r = await adminApi.validateContent(item.id);
          const errors = Array.isArray(r.errors) ? r.errors.map(String) : [];
          results.push({ id: item.id, title: item.title ?? null, ok: errors.length === 0, errors: errors.slice(0, 5) });
        } catch (e: unknown) {
          results.push({ id: item.id, title: item.title ?? null, ok: false, errors: [e instanceof Error ? e.message : String(e)] });
        }
      }
      const failing = results.filter((r) => !r.ok);
      return summarize({
        checked: results.length,
        passing: results.length - failing.length,
        failing: failing.length,
        results: failing.length ? results : results.map((r) => ({ id: r.id, title: r.title, ok: true })),
      });
    },
  },
  {
    name: "create_draft",
    description: "Create a new draft content object. Body must be valid engine JSON (validate first with validate_content). Returns the new id.",
    inputSchema: {
      type: "object",
      properties: {
        contentType: { type: "string", enum: CONTENT_TYPES, description: "Engine type" },
        title: str("Display title"),
        language: { type: "string", enum: ["en", "ar"], description: "Content language (default en)" },
        content: str("Full JSON body (max ~2 MB)"),
        targetPath: str('Subfolder inside the category, e.g. "cardiology/acute-coronary"'),
      },
      required: ["contentType", "title"],
    },
    destructive: false,
    execute: async (a) => summarize(await adminApi.createContent({
      contentType: String(a.contentType) as ContentType,
      title: String(a.title ?? "Untitled"),
      language: a.language === "ar" ? "ar" : "en",
      content: optStr(a.content),
      targetPath: optStr(a.targetPath),
    })),
  },
  {
    name: "duplicate_content",
    description: "Duplicate (remix) any readable content object into a new draft owned by you — copies the current body plus pack assets. Great for adapting a published pack. Returns the new id.",
    inputSchema: {
      type: "object",
      properties: {
        id: str("Source content object id"),
        title: str('Title for the clone (default "Copy of <source title>")'),
      },
      required: ["id"],
    },
    destructive: false,
    execute: async (a) => summarize(await adminApi.duplicateContent(String(a.id), optStr(a.title))),
  },
  {
    name: "update_draft",
    description: "Replace the draft body of a content object (full replacement, max ~2 MB). Always validate afterwards.",
    inputSchema: {
      type: "object",
      properties: { id: str("Content object id"), body: str("Full replacement JSON body") },
      required: ["id", "body"],
    },
    destructive: false,
    execute: async (a) => summarize(await adminApi.saveDraft(String(a.id), String(a.body ?? ""))),
  },
  {
    name: "submit_for_review",
    description: "Submit a draft for admin review (moves it to the pending queue).",
    inputSchema: {
      type: "object",
      properties: { id: str("Content object id") },
      required: ["id"],
    },
    destructive: false,
    execute: async (a) => summarize(await adminApi.submitForReview(String(a.id))),
  },
  {
    name: "approve_content",
    description: "Approve a pending object and publish it to student files. Requires admin role.",
    inputSchema: {
      type: "object",
      properties: { id: str("Content object id"), targetPath: str("Optional destination subfolder inside the category") },
      required: ["id"],
    },
    destructive: true,
    execute: async (a) => summarize(await adminApi.approveContent(
      String(a.id),
      optStr(a.targetPath),
    )),
  },
  {
    name: "reject_content",
    description: "Send a pending object back to draft with a feedback reason. Every rejection needs an actionable reason.",
    inputSchema: {
      type: "object",
      properties: { id: str("Content object id"), reason: str("Actionable feedback for the author") },
      required: ["id", "reason"],
    },
    destructive: true,
    execute: async (a) => summarize(await adminApi.rejectContent(String(a.id), String(a.reason ?? ""))),
  },
  {
    name: "publish_direct",
    description: "Directly publish a draft to student files, bypassing review. Admin role only. Prefer approve_content for reviewed items.",
    inputSchema: {
      type: "object",
      properties: { id: str("Content object id"), targetPath: str("Optional destination subfolder inside the category") },
      required: ["id"],
    },
    destructive: true,
    execute: async (a) => summarize(await adminApi.publishDirect(
      String(a.id),
      optStr(a.targetPath) ? { targetPath: optStr(a.targetPath) } : undefined,
    )),
  },
  {
    name: "unpublish_content",
    description: "Retract a published object back to draft and remove student-facing files. Admin role only.",
    inputSchema: {
      type: "object",
      properties: { id: str("Content object id") },
      required: ["id"],
    },
    destructive: true,
    execute: async (a) => summarize(await adminApi.unpublish(String(a.id))),
  },
  {
    name: "delete_content",
    description: "Permanently delete a content object and its files. IRREVERSIBLE. Admin role only.",
    inputSchema: {
      type: "object",
      properties: { id: str("Content object id") },
      required: ["id"],
    },
    destructive: true,
    execute: async (a) => summarize(await adminApi.deleteContent(String(a.id))),
  },
  {
    name: "parse_pdf",
    description: "Extract raw text from an inline PDF (data URI or base64), page by page. Use for reading lecture notes before authoring. For exam MCQs prefer parse_qbank_pdf.",
    inputSchema: {
      type: "object",
      properties: {
        pdfDataUri: str("PDF as data:application/pdf;base64,… or raw base64 (max ~20 MB decoded)"),
        maxPages: { type: "number", description: "Page cap 1-400 (default 120)" },
      },
      required: ["pdfDataUri"],
    },
    destructive: false,
    execute: async (a) => summarize(await adminApi.parsePdf(
      String(a.pdfDataUri ?? ""),
      typeof a.maxPages === "number" ? a.maxPages : undefined,
    )),
  },
  {
    name: "parse_qbank_pdf",
    description: "Parse an exam PDF into a draft quiz pack ({ questions: [...] } with warnings). Review warnings, resolve missing answers, validate, then create_draft.",
    inputSchema: {
      type: "object",
      properties: {
        pdfDataUri: str("PDF as data:application/pdf;base64,… or raw base64 (max ~20 MB decoded)"),
        maxPages: { type: "number", description: "Page cap 1-400 (default 120)" },
      },
      required: ["pdfDataUri"],
    },
    destructive: false,
    execute: async (a) => summarize(await adminApi.parseQbankPdf(
      String(a.pdfDataUri ?? ""),
      typeof a.maxPages === "number" ? a.maxPages : undefined,
    )),
  },
  {
    name: "parse_written_pdf",
    description: "Parse a written-exam PDF into a draft written pack ({ prompts: [...] } with warnings). Replace default rubrics with graded schemes, validate, then create_draft.",
    inputSchema: {
      type: "object",
      properties: {
        pdfDataUri: str("PDF as data:application/pdf;base64,… or raw base64 (max ~20 MB decoded)"),
        maxPages: { type: "number", description: "Page cap 1-400 (default 120)" },
      },
      required: ["pdfDataUri"],
    },
    destructive: false,
    execute: async (a) => summarize(await adminApi.parseWrittenPdf(
      String(a.pdfDataUri ?? ""),
      typeof a.maxPages === "number" ? a.maxPages : undefined,
    )),
  },
];

/* ── Raw file tools (manageContent) ────────────────────────────────────────
 * Direct access to the content-files/ R2 keyspace the student apps serve
 * from — the same surface the content browser's file tree shows. */

const FILE_TOOLS: AssistantToolDef[] = [
  {
    name: "list_content_files",
    description: 'List raw student-facing content files under a prefix, e.g. "library/" or "qbank/cardiology/". Returns keys + sizes. Use to explore the published file tree.',
    inputSchema: {
      type: "object",
      properties: { prefix: str('R2 prefix inside content-files/, e.g. "library/" (default "")'), scope: { type: "string", enum: ["content-files", "content-staging"], description: "Keyspace to list (default content-files)" } },
    },
    destructive: false,
    requires: "manageContent",
    execute: async (a) => {
      const prefix = typeof a.prefix === "string" ? a.prefix.replace(/^\/+/, "") : "";
      const scope = a.scope === "content-staging" ? "content-staging" : "content-files";
      return summarize(await adminApi.listR2Keys(prefix, undefined, scope));
    },
  },
  {
    name: "read_content_file",
    description: 'Read the raw body of one content file (content-files/, content-staging/ or content-manifests/ key). Use for files that are not managed content objects.',
    inputSchema: {
      type: "object",
      properties: { key: str('Full R2 key, e.g. "content-files/library/cardiology/asthma.md"') },
      required: ["key"],
    },
    destructive: false,
    requires: "manageContent",
    execute: async (a) => {
      const key = assertSafeR2Key(String(a.key ?? ""), ["content-files/", "content-staging/", "content-manifests/"]);
      const res = await adminApi.getR2Content(key);
      return summarize({ key, contentType: res.contentType, body: truncateBody(res.body, 20_000) });
    },
  },
  {
    name: "upload_asset",
    description: 'Write a raw file into the student-facing content-files/ keyspace (text or data-URI binary). Existing keys are overwritten — use for assets and articles. Prefer create_draft for managed packs.',
    inputSchema: {
      type: "object",
      properties: {
        key: str('Destination R2 key starting with "content-files/", e.g. "content-files/library/notes/intro.md"'),
        body: str("File body: plain text/markdown/JSON, or a data URI (data:image/png;base64,…) for binaries"),
      },
      required: ["key", "body"],
    },
    destructive: true,
    requires: "manageContent",
    execute: async (a) => {
      const key = assertSafeR2Key(String(a.key ?? ""), ["content-files/"]);
      const body = String(a.body ?? "");
      if (!body) throw new Error("body is required");
      return summarize(await adminApi.uploadFile(key, body));
    },
  },
  {
    name: "regenerate_manifest",
    description: 'Rebuild the category manifest students fetch (quiz/qbank/flashcard/library/… or "all") after manual file changes. Use after upload_asset or raw file edits.',
    inputSchema: {
      type: "object",
      properties: { category: str('Category id, e.g. "library" or "qbank" (default "all")') },
    },
    destructive: true,
    requires: "manageContent",
    execute: async (a) => summarize(await adminApi.regenerateManifest(optStr(a.category) ?? "all")),
  },
];

/* ── Read-only observability tools ──────────────────────────────────────────
 * Registered only when the signed-in admin holds the matching capability,
 * so content_admins never see them advertised to the model. */

const OBSERVABILITY_TOOLS: AssistantToolDef[] = [
  {
    name: "instance_overview",
    description: "Instance KPIs: total users, active sessions, published content, pending review counts. Use for 'how are we doing' questions.",
    inputSchema: { type: "object", properties: {} },
    destructive: false,
    requires: "viewStats",
    execute: async () => summarize(await adminApi.stats()),
  },
  {
    name: "recent_audit",
    description: "Recent admin actions (who did what, when) from the audit log. Filter by action name, e.g. publish_direct or reject. Use for 'what happened recently' questions.",
    inputSchema: {
      type: "object",
      properties: {
        page: { type: "number", description: "1-based page (default 1)" },
        action: str("Optional action filter, e.g. approve, publish_direct, delete_content"),
      },
    },
    destructive: false,
    requires: "viewAudit",
    execute: async (a) => summarize(await adminApi.auditLog(Math.max(1, num(a.page, 1)), optStr(a.action))),
  },
  {
    name: "analytics_overview",
    description: "Product analytics for the last 7 days: sessions, active users, events, engagement. Read-only snapshot.",
    inputSchema: { type: "object", properties: {} },
    destructive: false,
    requires: "viewStats",
    execute: async () => summarize(await analyticsApi.overview("7d")),
  },
  {
    name: "js_errors",
    description: "Top client-side JS errors over the last 7 days (message, count, last seen). Use when asked about bugs or crashes students hit.",
    inputSchema: {
      type: "object",
      properties: { limit: { type: "number", description: "Max errors 1-20 (default 10)" } },
    },
    destructive: false,
    requires: "viewStats",
    execute: async () => summarize(await analyticsApi.errors("7d", 10)),
  },
];

/** Full catalog — kept exported for tests / capability introspection. */
export const ASSISTANT_TOOLS: AssistantToolDef[] = [...BASE_TOOLS, ...FILE_TOOLS, ...OBSERVABILITY_TOOLS];

/** Tools registered for a given admin: content tools for both tiers, file +
 *  observability tools only when the capability is present. Unregistered
 *  tools are invisible to the model — a content_admin's assistant simply
 *  doesn't know the admin-only surface exists. */
export function buildAssistantTools(caps: AdminCapabilities | null | undefined): AssistantToolDef[] {
  if (!caps) return BASE_TOOLS;
  return ASSISTANT_TOOLS.filter((t) => !t.requires || caps[t.requires]);
}
