"use client";

import * as React from "react";
import { Camera, CheckCircle2, Mic, ShieldAlert, ShieldOff, VideoOff } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useI18n } from "@/components/osler/i18n-provider";
import { haptic } from "@/lib/osler/native";
import { useMediaPermissions } from "@/hooks/use-native";
import { cn } from "@/lib/utils";

type RowKind = "microphone" | "camera";

/** One permission row: what it unlocks, current state, and an Allow button. */
function PermissionRow({ kind, icon: Icon, titleKey, descKey }: {
  kind: RowKind;
  icon: typeof Mic;
  titleKey: "onboarding.permissions.micTitle" | "onboarding.permissions.cameraTitle";
  descKey: "onboarding.permissions.micDesc" | "onboarding.permissions.cameraDesc";
}) {
  const { t } = useI18n();
  const { states, request } = useMediaPermissions([kind]);
  const state = states[kind];
  const [busy, setBusy] = React.useState(false);

  const handleAllow = async () => {
    setBusy(true);
    const result = await request(kind);
    haptic(result === "granted" ? "success" : "warning");
    setBusy(false);
  };

  return (
    <div className="rounded-lg border border-border bg-card p-3.5 flex items-start gap-3">
      <span
        className={cn(
          "size-9 rounded-lg flex items-center justify-center shrink-0",
          state === "granted" ? "bg-success-soft text-success" : "bg-muted text-muted-foreground",
        )}
      >
        <Icon className="size-4.5" />
      </span>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold">{t(titleKey)}</div>
        <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{t(descKey)}</p>

        {state === "denied" && (
          <p className="text-xs text-warning mt-2 flex items-start gap-1.5">
            <ShieldOff className="size-3.5 shrink-0 mt-0.5" />
            <span>{t("onboarding.permissions.deniedHint")}</span>
          </p>
        )}
        {state === "unsupported" && (
          <p className="text-xs text-muted-foreground mt-2 flex items-start gap-1.5">
            <VideoOff className="size-3.5 shrink-0 mt-0.5" />
            <span>{t("onboarding.permissions.unavailableHint")}</span>
          </p>
        )}
      </div>

      {state === "granted" ? (
        <span className="flex items-center gap-1 text-xs font-medium text-success shrink-0 mt-1">
          <CheckCircle2 className="size-4" />
          {t("onboarding.permissions.allowed")}
        </span>
      ) : state === "denied" ? (
        <span className="flex items-center gap-1 text-xs font-medium text-warning shrink-0 mt-1">
          <ShieldAlert className="size-4" />
          {t("onboarding.permissions.denied")}
        </span>
      ) : state === "prompt" || state === null ? (
        <Button size="sm" onClick={handleAllow} disabled={busy} className="shrink-0 mt-1">
          {t("onboarding.permissions.allow")}
        </Button>
      ) : null}
    </div>
  );
}

export function PermissionsStep() {
  const { t } = useI18n();

  return (
    <div>
      <div className="w-11 h-11 rounded-xl bg-primary-soft text-primary flex items-center justify-center mb-4">
        <Mic className="size-5" />
      </div>
      <h2 className="text-lg font-bold tracking-tight">{t("onboarding.permissions.title")}</h2>
      <p className="text-sm text-muted-foreground mt-1 mb-4">{t("onboarding.permissions.subtitle")}</p>

      <div className="space-y-2.5">
        <PermissionRow
          kind="microphone"
          icon={Mic}
          titleKey="onboarding.permissions.micTitle"
          descKey="onboarding.permissions.micDesc"
        />
        <PermissionRow
          kind="camera"
          icon={Camera}
          titleKey="onboarding.permissions.cameraTitle"
          descKey="onboarding.permissions.cameraDesc"
        />
      </div>

      <p className="text-[11px] text-muted-foreground mt-3 leading-relaxed">
        {t("onboarding.permissions.skipNote")}
      </p>
    </div>
  );
}
