/*
 * Cobalt download backend for the Videos hub. Replaces the Invidious
 * format-stream path (instance-overloaded, CORS-locked, /latest_version dead).
 * Flow: GET {api}/ -> instance info (turnstileSitekey?). If the instance is
 * bot-protected and no NEXT_PUBLIC_COBALT_KEY is set, solve a Turnstile
 * challenge -> POST /session (cf-turnstile-response header) -> Bearer JWT.
 * Then POST {api}/ {url, downloadMode, videoQuality, ...} -> tunnel/redirect
 * URL served by the instance itself (no CORS issue) -> open in a new tab.
 * Override the instance with NEXT_PUBLIC_COBALT_API (defaults to a live
 * community instance) and optionally NEXT_PUBLIC_COBALT_KEY for Api-Key auth.
 */

export const COBALT_API = process.env.NEXT_PUBLIC_COBALT_API || "https://cobalt-api.slipfox.xyz";
export const COBALT_KEY = process.env.NEXT_PUBLIC_COBALT_KEY || "";
export const COBALT_ENABLED = Boolean(COBALT_API);

export interface CobaltInstanceInfo {
  version: string;
  url: string;
  turnstileSitekey?: string;
}

export interface CobaltDownloadResult {
  status: "tunnel" | "redirect" | "picker" | "error";
  url?: string;
  filename?: string;
  picker?: Array<{ type: string; url: string; thumb?: string }>;
  errorCode?: string;
}

export interface CobaltDownloadOptions {
  mode: "video" | "audio";
  videoQuality: string;
}

export type DownloadFailure = "unavailable" | "auth" | "rate" | "unknown";

async function jsonOrThrow(res: Response): Promise<Record<string, unknown>> {
  const ct = res.headers.get("content-type") || "";
  if (!ct.includes("application/json")) throw new Error(`http ${res.status}`);
  const data = (await res.json()) as Record<string, unknown>;
  if (!res.ok && !data?.status) throw new Error(`http ${res.status}`);
  return data;
}

function errorCode(data: Record<string, unknown>): string | undefined {
  const e = data?.error as Record<string, unknown> | undefined;
  return typeof e?.code === "string" ? e.code : undefined;
}

export async function fetchInstanceInfo(): Promise<CobaltInstanceInfo> {
  const res = await fetch(`${COBALT_API}/`);
  const data = await jsonOrThrow(res);
  const cobalt = data?.cobalt as Record<string, unknown> | undefined;
  if (!cobalt) throw new Error("missing instance info");
  return {
    version: typeof cobalt.version === "string" ? cobalt.version : "",
    url: typeof cobalt.url === "string" ? cobalt.url : COBALT_API,
    turnstileSitekey: typeof cobalt.turnstileSitekey === "string" ? cobalt.turnstileSitekey : undefined,
  };
}

export async function createSession(turnstileToken: string): Promise<string> {
  const res = await fetch(`${COBALT_API}/session`, {
    method: "POST",
    headers: { "cf-turnstile-response": turnstileToken },
  });
  const data = await jsonOrThrow(res);
  const token = typeof data?.token === "string" ? data.token : "";
  if (!token) {
    const code = errorCode(data);
    throw new Error(code ? `auth ${code}` : "session failed");
  }
  return token;
}

export async function requestDownload(
  url: string,
  opts: CobaltDownloadOptions,
  auth?: { kind: "apiKey" | "bearer"; token: string },
): Promise<CobaltDownloadResult> {
  const headers: Record<string, string> = {
    Accept: "application/json",
    "Content-Type": "application/json",
  };
  if (auth) headers.Authorization = auth.kind === "apiKey" ? `Api-Key ${auth.token}` : `Bearer ${auth.token}`;

  const body: Record<string, unknown> = {
    url,
    filenameStyle: "pretty",
    audioFormat: "mp3",
  };
  if (opts.mode === "video") {
    body.downloadMode = "auto";
    body.videoQuality = opts.videoQuality;
  } else {
    body.downloadMode = "audio";
  }

  const res = await fetch(`${COBALT_API}/`, { method: "POST", headers, body: JSON.stringify(body) });
  const data = await jsonOrThrow(res);

  const status = data?.status;
  if (status === "tunnel" || status === "redirect") {
    return {
      status,
      url: typeof data.url === "string" ? data.url : undefined,
      filename: typeof data.filename === "string" ? data.filename : undefined,
    };
  }
  if (status === "picker") {
    const list = Array.isArray(data.picker) ? data.picker : [];
    const items = list
      .filter((p): p is Record<string, unknown> => !!p && typeof (p as Record<string, unknown>).url === "string")
      .map((p) => ({
        type: typeof p.type === "string" ? p.type : "video",
        url: String(p.url),
        thumb: typeof p.thumb === "string" ? p.thumb : undefined,
      }));
    return { status, picker: items };
  }
  if (status === "error") {
    return { status, errorCode: errorCode(data) };
  }
  throw new Error("unexpected response");
}

export function classifyError(err: unknown): DownloadFailure {
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.includes("auth")) return "auth";
  if (msg.includes("rate")) return "rate";
  return "unknown";
}
