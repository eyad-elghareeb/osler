/**
 * /api/r2-fetch — proxy that fetches a raw R2 key from the Cloudflare Worker
 * without exposing the worker URL to the browser. Used by the admin R2 browser
 * for file preview and download.
 *
 * SECURITY: This route requires a valid Osler session cookie (HMAC-signed).
 * Without it, anyone could use this proxy to fetch any public R2 key via the
 * Pages backend — pointless overhead since the Worker endpoint is already
 * public, but the auth check prevents abuse (log spam, bandwidth) and keeps
 * the door closed if R2 ever holds non-public content.
 *
 * Query: ?key=<full R2 key, e.g. "content-files/library/asthma.md">
 *
 * Returns the raw bytes with the appropriate content-type. Refuses to serve
 * anything outside content-files/ and content-manifests/ (defense in depth —
 * the Worker also enforces this for public content endpoints, but we double
 * -check here so this proxy can't be abused to fetch arbitrary R2 keys).
 */

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getConfig } from "@/lib/osler/config";
import { verifySessionCookie, SESSION_COOKIE_NAME } from "@/lib/osler/server-session";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  // 1. Auth — require a valid session cookie.
  const cookieStore = await cookies();
  const cookie = cookieStore.get(SESSION_COOKIE_NAME);
  const session = await verifySessionCookie(cookie?.value);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 2. Validate the requested key.
  const url = new URL(request.url);
  const key = (url.searchParams.get("key") || "").trim();
  if (!key) return NextResponse.json({ error: "key required" }, { status: 400 });
  if (!key.startsWith("content-files/") && !key.startsWith("content-manifests/")) {
    return NextResponse.json({ error: "Only content-files/ and content-manifests/ keys can be fetched" }, { status: 400 });
  }
  // Reject path traversal attempts — check both literal `..` and URL-encoded
  // forms (`%2e`, `%2E`) so an attacker can't bypass with `%2e%2e`.
  const lowerKey = key.toLowerCase();
  if (lowerKey.includes("..") || lowerKey.includes("%2e%2e") || key.includes("\\")) {
    return NextResponse.json({ error: "Invalid key" }, { status: 400 });
  }
  // Reject query-string / fragment separators in the key — they could be
  // used to inject extra params or path segments into the upstream URL.
  if (key.includes("?") || key.includes("#")) {
    return NextResponse.json({ error: "Invalid key" }, { status: 400 });
  }
  // Cap key length.
  if (key.length > 1024) {
    return NextResponse.json({ error: "Key too long" }, { status: 400 });
  }

  // 3. Resolve the Worker URL.
  const cfg = getConfig();
  const apiUrl = (process.env.NEXT_PUBLIC_CLOUD_API_URL ?? cfg.cloud?.apiUrl ?? "").replace(/\/$/, "");
  if (!apiUrl) return NextResponse.json({ error: "Cloud not configured" }, { status: 503 });

  // 4. Map the R2 key to the Worker's public content endpoint.
  // content-files/<category>/<path> → /v1/content/<category>/<path>
  // content-manifests/<category>/manifest.json → /v1/content-manifests/<category>/manifest.json
  // We split the relative path into segments and encodeURIComponent each one,
  // then rejoin with `/`. This neutralizes any remaining special characters
  // without double-encoding already-encoded sequences in legitimate paths.
  let workerUrl: string;
  if (key.startsWith("content-files/")) {
    const rel = key.slice("content-files/".length);
    const encoded = rel.split("/").map(encodeURIComponent).join("/");
    workerUrl = `${apiUrl}/v1/content/${encoded}`;
  } else {
    const rel = key.slice("content-manifests/".length);
    const encoded = rel.split("/").map(encodeURIComponent).join("/");
    workerUrl = `${apiUrl}/v1/content-manifests/${encoded}`;
  }

  // 5. Fetch from the Worker with a timeout.
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    const upstream = await fetch(workerUrl, {
      cache: "no-store",
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!upstream.ok) {
      return NextResponse.json({ error: `Upstream ${upstream.status}` }, { status: upstream.status });
    }
    const body = await upstream.arrayBuffer();
    const ext = key.split(".").pop()?.toLowerCase() ?? "";
    const contentType =
      ext === "json" ? "application/json"
      : ext === "md" ? "text/markdown; charset=utf-8"
      : ext === "html" || ext === "htm" ? "text/html; charset=utf-8"
      : ext === "pdf" ? "application/pdf"
      : ext === "svg" ? "image/svg+xml"
      : ext === "png" ? "image/png"
      : ext === "jpg" || ext === "jpeg" ? "image/jpeg"
      : ext === "gif" ? "image/gif"
      : ext === "webp" ? "image/webp"
      : ext === "mp3" ? "audio/mpeg"
      : ext === "mp4" ? "video/mp4"
      : "application/octet-stream";
    return new Response(body, {
      status: 200,
      headers: {
        "content-type": contentType,
        "cache-control": "no-store",
      },
    });
  } catch (err) {
    // Log the full error server-side; return a generic message to the client
    // so we don't leak internal URLs, stack traces, or file paths.
    console.error("[r2-fetch] upstream fetch failed:", err);
    return NextResponse.json({ error: "Failed to fetch content from upstream" }, { status: 502 });
  }
}
