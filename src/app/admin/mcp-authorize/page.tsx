"use client";

import * as React from "react";
import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Bot, PenLine, ShieldCheck, TriangleAlert } from "lucide-react";

import { useI18n } from "@/components/osler/i18n-provider";
import { useAdminIdentity } from "@/components/osler/admin/admin-context";
import { mcpOAuth } from "@/components/osler/admin/admin-api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { OslerCard, LoadingState, FormField, SegmentedControl } from "@/components/osler/ui-primitives";
import { haptic } from "@/lib/osler/native";

/**
 * MCP OAuth consent — the web-UI authorization step of the MCP connect flow.
 *
 * An MCP client (Claude, Cursor, …) opens GET /v1/mcp/oauth/authorize on the
 * worker, which validates the request and redirects here. The admin approves
 * with their normal session; this page POSTs the params back to the worker's
 * authorize endpoint and follows the returned callback URL (with the single-
 * use code + state) back to the client.
 */

type AuthzError = "invalid_client" | "invalid_request" | "invalid_scope" | "invalid_target" | "server_error";

const ERROR_KEYS: Record<AuthzError, string> = {
  invalid_client: "mcp.auth.error.client",
  invalid_request: "mcp.auth.error.invalid",
  invalid_scope: "mcp.auth.error.invalid",
  invalid_target: "mcp.auth.error.invalid",
  server_error: "mcp.auth.error.generic",
};

function McpAuthorizeInner() {
  const { t } = useI18n();
  const router = useRouter();
  const params = useSearchParams();
  const identity = useAdminIdentity();

  const [busy, setBusy] = React.useState(false);
  const [failed, setFailed] = React.useState<string | null>(null);

  const clientId = params.get("client_id") ?? "";
  const redirectUri = params.get("redirect_uri") ?? "";
  const state = params.get("state") ?? "";
  const codeChallenge = params.get("code_challenge") ?? "";
  const codeChallengeMethod = params.get("code_challenge_method") ?? "S256";
  const scope = params.get("scope") ?? "content_admin";
  const clientName = params.get("client_name") || clientId;
  const oauthError = params.get("error") as AuthzError | null;

  // Only `admin` approvers may grant the unrestricted tier — content_admin
  // approvers are capped at content authoring (enforced server-side too).
  const canGrantAdmin = identity.user.role === "admin";
  const [grantScope, setGrantScope] = React.useState<"content_admin" | "admin">(
    scope === "admin" && identity.user.role === "admin" ? "admin" : "content_admin",
  );

  // Deny: per RFC 6749 §4.1.2.1 the user-agent is redirected back to the
  // client with error=access_denied — no server call needed.
  const deny = () => {
    haptic("warning");
    if (!redirectUri) return;
    const sep = redirectUri.includes("?") ? "&" : "?";
    // OAuth callbacks land on the client's registered origin (claude.ai,
    // localhost, a custom app scheme) — a full browser navigation is
    // required, not router.push.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.href = `${redirectUri}${sep}error=access_denied&state=${encodeURIComponent(state)}`;
  };

  const allow = async () => {
    if (busy) return;
    haptic("light");
    setBusy(true);
    setFailed(null);
    try {
      const { redirect_to } = await mcpOAuth.authorize({ clientId, redirectUri, state, codeChallenge, codeChallengeMethod, scope: grantScope });
      haptic("success");
      window.location.href = redirect_to;
    } catch (e: any) {
      haptic("error");
      setFailed(e?.message ?? t("mcp.auth.error.generic"));
      setBusy(false);
    }
  };

  // ── Error state (redirected back by the worker after failed validation) ──
  if (oauthError) {
    return (
      <CenteredCard icon={TriangleAlert} tone="destructive">
        <h1 className="text-lg font-bold tracking-tight">{t("mcp.auth.errorTitle")}</h1>
        <p className="text-sm text-muted-foreground mt-1.5 leading-relaxed">
          {t((ERROR_KEYS[oauthError] ?? "mcp.auth.error.generic") as never)}
        </p>
        <Button variant="outline" onClick={() => router.replace("/admin/dashboard")} className="mt-5">
          {t("mcp.auth.backToAdmin")}
        </Button>
      </CenteredCard>
    );
  }

  // ── Missing/invalid params (page opened directly) ─────────────────────────
  if (!clientId || !redirectUri || !codeChallenge) {
    return (
      <CenteredCard icon={Bot}>
        <h1 className="text-lg font-bold tracking-tight">{t("mcp.auth.title")}</h1>
        <p className="text-sm text-muted-foreground mt-1.5 leading-relaxed">{t("mcp.auth.noRequest")}</p>
        <p className="text-xs text-muted-foreground mt-3 leading-relaxed">{t("mcp.auth.connectHint")}</p>
        <Button variant="outline" onClick={() => router.replace("/admin/settings")} className="mt-5">
          {t("mcp.auth.openSettings")}
        </Button>
      </CenteredCard>
    );
  }

  // ── Consent ────────────────────────────────────────────────────────────────
  return (
    <CenteredCard icon={Bot}>
      <h1 className="text-lg font-bold tracking-tight">{t("mcp.auth.title")}</h1>
      <p className="text-sm text-muted-foreground mt-1.5 leading-relaxed">{t("mcp.auth.subtitle")}</p>

      <div className="mt-5 rounded-xl border border-border bg-muted/30 p-4">
        <div className="flex items-center gap-2.5">
          <span className="size-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
            <Bot className="size-4" />
          </span>
          <span className="text-sm font-semibold truncate">{clientName}</span>
          <Badge variant="outline" className="ms-auto shrink-0 border-primary/30 bg-primary/10 text-primary">
            <ShieldCheck className="size-3 me-1" />
            {grantScope === "admin" ? t("mcp.auth.scopeAdmin") : t("mcp.auth.scopeBadge")}
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground mt-3 leading-relaxed">{t("mcp.auth.scopeDesc")}</p>
      </div>

      {canGrantAdmin && (
        <FormField
          label={t("mcp.auth.scopeLabel")}
          hint={grantScope === "admin" ? t("mcp.auth.scopeAdminDesc") : t("mcp.auth.scopeDesc")}
          className="mt-4"
        >
          <SegmentedControl
            label={t("mcp.auth.scopeLabel")}
            fullWidth
            value={grantScope}
            onChange={(v) => {
              haptic("selection");
              setGrantScope(v);
            }}
            options={[
              { value: "content_admin", label: t("mcp.auth.scopeBadge"), icon: PenLine },
              { value: "admin", label: t("mcp.auth.scopeAdmin"), icon: ShieldCheck },
            ]}
          />
        </FormField>
      )}

      {identity?.user && (
        <p className="text-xs text-muted-foreground mt-3">
          {t("mcp.auth.signedInAs")}{" "}
          <span className="font-medium text-foreground">
            {identity.user.displayName || identity.user.username}
          </span>
        </p>
      )}

      {failed && (
        <p className="text-xs text-destructive mt-3 flex items-start gap-1.5">
          <TriangleAlert className="size-3.5 shrink-0 mt-0.5" />
          <span>{failed}</span>
        </p>
      )}

      <div className="flex items-center gap-2 mt-5">
        <Button variant="outline" onClick={deny} disabled={busy} className="flex-1">
          {t("mcp.auth.deny")}
        </Button>
        <Button onClick={allow} loading={busy} disabled={busy} className="flex-1">
          {t("mcp.auth.allow")}
        </Button>
      </div>

      <p className="text-[11px] text-muted-foreground mt-4 leading-relaxed">{t("mcp.auth.revokeNote")}</p>
    </CenteredCard>
  );
}

/** Centered modal-style card — this page is a decision point, not a hub. */
function CenteredCard({ icon: Icon, tone = "default", children }: {
  icon: React.ElementType;
  tone?: "default" | "destructive";
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-[70vh] flex items-center justify-center px-4 py-10">
      <OslerCard padding="roomy" className={`w-full max-w-md ${tone === "destructive" ? "border-destructive/30" : ""}`}>
        <div
          className={`size-11 rounded-xl flex items-center justify-center mb-4 ${
            tone === "destructive" ? "bg-destructive/10 text-destructive" : "bg-primary-soft text-primary"
          }`}
        >
          <Icon className="size-5" />
        </div>
        {children}
      </OslerCard>
    </div>
  );
}

export default function McpAuthorizePage() {
  return (
    <Suspense fallback={<LoadingState />}>
      <McpAuthorizeInner />
    </Suspense>
  );
}
