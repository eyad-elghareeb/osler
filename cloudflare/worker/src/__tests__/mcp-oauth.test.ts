import { describe, it, expect } from "vitest";
import { handleAuthorizePost, handleToken, type McpOAuthHost } from "../mcp/oauth";

// Scope-grant rules: the approver picks content_admin or admin on the consent
// page, but only an `admin` approver may grant `admin`. These tests pin that
// anti-escalation boundary plus the scope plumbing into minted tokens.

const CALLBACK = "https://claude.ai/api/mcp/auth_callback";

function b64url(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let str = "";
  for (let i = 0; i < arr.length; i++) str += String.fromCharCode(arr[i]);
  return btoa(str).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

async function b64urlChallenge(verifier: string): Promise<string> {
  return b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
}

interface StubDbOpts {
  userRole?: string;
  claimedScope?: string;
  claimRow?: Record<string, unknown> | null;
  onCodesInsert?: (scope: unknown) => void;
  onTokenInsert?: (scopes: unknown) => void;
}

function stubDb(opts: StubDbOpts = {}) {
  const { userRole = "admin", claimedScope = "content_admin", claimRow = undefined, onCodesInsert, onTokenInsert } = opts;
  return {
    DB: {
    prepare: (sql: string) => ({
      bind: (...args: unknown[]) => ({
        first: async () => {
          if (sql.startsWith("SELECT client_name, redirect_uris FROM mcp_oauth_clients")) {
            return { client_name: "TestApp", redirect_uris: JSON.stringify([CALLBACK]) };
          }
          if (sql.startsWith("UPDATE mcp_oauth_codes SET used_at")) {
            if (claimRow === null) return null;
            if (claimRow !== undefined) return claimRow;
            return { client_id: "osler_mc_test", user_id: "user-1", scope: claimedScope, redirect_uri: CALLBACK, code_challenge: await b64urlChallenge("verifier-123") };
          }
          if (sql.startsWith("SELECT id, role FROM users")) return { id: "user-1", role: userRole };
          if (sql.startsWith("SELECT client_name FROM mcp_oauth_clients")) return { client_name: "TestApp" };
          return null;
        },
        run: async () => {
          if (sql.startsWith("INSERT INTO mcp_oauth_codes")) onCodesInsert?.(args[3]);
          if (sql.startsWith("INSERT INTO api_tokens")) onTokenInsert?.(args[5]);
          return {};
        },
      }),
    }),
    },
  } as unknown as Parameters<typeof handleAuthorizePost>[1];
}

function stubHost(role: string): McpOAuthHost {
  return {
    requireAdminSession: async () => ({ id: "user-1", username: "approver", displayName: "Approver", role }),
    rateLimit: () => true,
    sha256: async (v: string) =>
      [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(v)))]
        .map((b) => b.toString(16).padStart(2, "0"))
        .join(""),
    auditLog: async () => {},
    now: () => 1_700_000_000_000,
  };
}

function postJson(body: Record<string, unknown>): Request {
  return new Request("https://worker.test/v1/mcp/oauth/authorize", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const authParams = async (scope?: string) => ({
  client_id: "osler_mc_test",
  redirect_uri: CALLBACK,
  state: "st-1",
  code_challenge: await b64urlChallenge("verifier-123"),
  code_challenge_method: "S256",
  ...(scope === undefined ? {} : { scope }),
});

describe("MCP OAuth scope grants", () => {
  it("lets an admin approver grant the admin tier", async () => {
    let stored: unknown;
    const res = await handleAuthorizePost(postJson(await authParams("admin")), stubDb({ onCodesInsert: (s) => (stored = s) }), "", "127.0.0.1", stubHost("admin"));
    expect(res.status).toBe(200);
    expect(stored).toBe("admin");
  });

  it("refuses when a content_admin approver grants the admin tier", async () => {
    let stored: unknown = "not-written";
    const res = await handleAuthorizePost(
      postJson(await authParams("admin")),
      stubDb({ onCodesInsert: (s) => (stored = s) }),
      "",
      "127.0.0.1",
      stubHost("content_admin"),
    );
    expect(res.status).toBe(403);
    expect(stored).toBe("not-written");
  });

  it("defaults to content_admin when no scope is requested", async () => {
    let stored: unknown;
    const res = await handleAuthorizePost(postJson(await authParams()), stubDb({ onCodesInsert: (s) => (stored = s) }), "", "127.0.0.1", stubHost("content_admin"));
    expect(res.status).toBe(200);
    expect(stored).toBe("content_admin");
  });

  it("rejects unknown or multiple scopes", async () => {
    for (const scope of ["superuser", "content_admin admin"]) {
      const res = await handleAuthorizePost(postJson(await authParams(scope)), stubDb(), "", "127.0.0.1", stubHost("admin"));
      expect(res.status).toBe(400);
    }
  });

  it("mints the token with the granted scope", async () => {
    let minted: unknown;
    const res = await handleToken(
      postJson({ grant_type: "authorization_code", code: "osler_ac_x", code_verifier: "verifier-123", client_id: "osler_mc_test", redirect_uri: CALLBACK }),
      stubDb({ claimedScope: "admin", onTokenInsert: (s) => (minted = s) }),
      "",
      "127.0.0.1",
      stubHost("admin"),
    );
    expect(res.status).toBe(200);
    expect(minted).toBe("admin");
    expect((await res.json() as any).scope).toBe("admin");
  });

  it("refuses an admin grant when the approver was demoted before exchange", async () => {
    const res = await handleToken(
      postJson({ grant_type: "authorization_code", code: "osler_ac_x", code_verifier: "verifier-123", client_id: "osler_mc_test", redirect_uri: CALLBACK }),
      stubDb({ claimedScope: "admin", userRole: "content_admin" }),
      "",
      "127.0.0.1",
      stubHost("content_admin"),
    );
    expect(res.status).toBe(400);
  });

  it("rejects already-used codes at exchange", async () => {
    const res = await handleToken(
      postJson({ grant_type: "authorization_code", code: "osler_ac_used", code_verifier: "verifier-123", client_id: "osler_mc_test", redirect_uri: CALLBACK }),
      stubDb({ claimRow: null }),
      "",
      "127.0.0.1",
      stubHost("admin"),
    );
    expect(res.status).toBe(400);
  });
});
