/**
 * Pack-asset copier for content duplication (remix workflow).
 *
 * Used by the admin-session route POST /v1/admin/content/:id/duplicate (the
 * AI-assistant / content-browser "duplicate" affordance) — mirrors the MCP
 * duplicate_content_object tool. Extracted as a standalone module so the
 * pagination bound, workflow-slot skipping and failure collection are unit
 * testable without standing up the whole router (same pattern as
 * admin-users.ts / mcp/tools.ts).
 *
 * The copy is bounded to `maxPages` list pages of 100 objects so a single
 * duplicate call stays well inside the Workers subrequest budget; oversized
 * packs report `truncated: true` and the caller can tell the admin.
 */

export interface R2BucketLike {
  list(opts: { prefix: string; limit: number; cursor?: string }): Promise<{
    objects: Array<{ key: string }>;
    truncated: boolean;
    cursor?: string;
  }>;
  get(key: string): Promise<{
    arrayBuffer(): Promise<ArrayBuffer>;
    httpMetadata?: { contentType?: string };
  } | null>;
  put(key: string, value: ArrayBuffer, opts?: { httpMetadata?: { contentType?: string } }): Promise<unknown>;
}

export interface CopyAssetsResult {
  assetsCopied: number;
  failedAssets: Array<{ path: string; error: string }>;
  /** True when the source had more asset pages than the bound allows. */
  truncated: boolean;
}

/** Workflow slot files are per-object state, never part of a remix copy. */
const SKIPPED_SLOTS = new Set(["draft.json", "pending.json", "published.json"]);

export async function copyPackAssets(
  bucket: R2BucketLike,
  srcBase: string,
  destBase: string,
  maxPages = 10,
): Promise<CopyAssetsResult> {
  const failedAssets: Array<{ path: string; error: string }> = [];
  let assetsCopied = 0;
  let truncated = false;
  let cursor: string | undefined = undefined;

  for (let page = 0; page < maxPages; page++) {
    const listed = await bucket.list({ prefix: `${srcBase}/`, limit: 100, cursor });
    for (const o of listed.objects ?? []) {
      const rel = String(o.key ?? "").slice(String(srcBase).length + 1);
      if (!rel || SKIPPED_SLOTS.has(rel)) continue;
      try {
        const got = await bucket.get(o.key);
        if (!got) throw new Error("asset vanished mid-copy");
        await bucket.put(`${destBase}/${rel}`, await got.arrayBuffer(), {
          httpMetadata: { contentType: got.httpMetadata?.contentType },
        });
        assetsCopied++;
      } catch (e: unknown) {
        failedAssets.push({ path: rel, error: e instanceof Error ? e.message : String((e as { message?: string })?.message ?? e) });
      }
    }
    if (!listed.truncated) break;
    cursor = listed.cursor;
    if (!cursor) break;
    if (page === maxPages - 1) truncated = true;
  }

  return { assetsCopied, failedAssets, truncated };
}
