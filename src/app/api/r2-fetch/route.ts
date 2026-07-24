/**
 * /api/r2-fetch — proxy that fetches a raw R2 key from the Cloudflare Worker
 * without exposing the worker URL to the browser. Used by the admin R2 browser
 * for file preview and download.
 *
 * Query: ?key=<full R2 key, e.g. "content-files/library/asthma.md">
 *
 * Returns the raw bytes with the appropriate content-type. Refuses to serve
 * anything outside content-files/ and content-manifests/ (defense in depth —
 * the Worker also enforces this for public content endpoints, but we double
 * -check here so this proxy can't be abused to fetch arbitrary R2 keys).
 */

import { NextResponse } from "next/server";
import { getConfig } from "@/lib/osler/config";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const key = (url.searchParams.get("key") || "").trim();
  if (!key) return NextResponse.json({ error: "key required" }, { status: 400 });
  if (!key.startsWith("content-files/") && !key.startsWith("content-manifests/")) {
    return NextResponse.json({ error: "Only content-files/ and content-manifests/ keys can be fetched" }, { status: 400 });
  }

  const cfg = getConfig();
  const apiUrl = (process.env.NEXT_PUBLIC_CLOUD_API_URL ?? cfg.cloud?.apiUrl ?? "").replace(/\/$/, "");
  if (!apiUrl) return NextResponse.json({ error: "Cloud not configured" }, { status: 503 });

  // content-files/<category>/<path> → /v1/content/<category>/<path>
  // content-manifests/<category>/manifest.json → /v1/content-manifests/<category>/manifest.json
  let workerUrl: string;
  if (key.startsWith("content-files/")) {
    const rel = key.slice("content-files/".length);
    workerUrl = `${apiUrl}/v1/content/${rel}`;
  } else {
    const rel = key.slice("content-manifests/".length);
    workerUrl = `${apiUrl}/v1/content-manifests/${rel}`;
  }

  try {
    const upstream = await fetch(workerUrl, { cache: "no-store" });
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
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
