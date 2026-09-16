"use client";

// Curated tool catalog for the admin harness. Each entry mirrors one MCP
// capability but executes over the admin's session (adminApi) — no separate
// MCP token needed. Keep this list small and content-focused; analytics,
// user management, and config stay in their dedicated admin pages.

import { adminApi, type ContentType } from "@/components/osler/admin/admin-api";

export interface AssistantToolDef {
  name: string;
  description: string;
  /** JSON Schema for the tool input (passed to the AI SDK's jsonSchema()). */
  inputSchema: Record<string, unknown>;
  /** Destructive / publishing tools pause for an Approve click before running. */
  destructive: boolean;
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

export const ASSISTANT_TOOLS: AssistantToolDef[] = [
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
      typeof a.q === "string" ? a.q : undefined,
      typeof a.page === "number" ? a.page : 1,
      typeof a.limit === "number" ? Math.min(100, a.limit) : 20,
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
        contentType: { type: "string", enum: ["quiz", "bank", "written", "mixed", "flashcard", "osce", "library", "video"] },
        body: str("Inline JSON body to validate"),
      },
    },
    destructive: false,
    execute: async (a) => {
      if (typeof a.id === "string" && a.id) return summarize(await adminApi.validateContent(a.id));
      if (typeof a.contentType === "string" && typeof a.body === "string") {
        return summarize(await adminApi.validateStandalone(a.contentType as ContentType, a.body));
      }
      throw new Error("Provide id or contentType + body");
    },
  },
  {
    name: "create_draft",
    description: "Create a new draft content object. Body must be valid engine JSON (validate first with validate_content). Returns the new id.",
    inputSchema: {
      type: "object",
      properties: {
        contentType: { type: "string", enum: ["quiz", "bank", "written", "mixed", "flashcard", "osce", "library", "video"], description: "Engine type" },
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
      content: typeof a.content === "string" ? a.content : undefined,
      targetPath: typeof a.targetPath === "string" ? a.targetPath : undefined,
    })),
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
      typeof a.targetPath === "string" && a.targetPath ? a.targetPath : undefined,
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
      typeof a.targetPath === "string" && a.targetPath ? { targetPath: a.targetPath } : undefined,
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
