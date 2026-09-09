"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Home, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/components/osler/i18n-provider";
import { haptic } from "@/lib/osler/native";

/**
 * Route-segment error boundary (Next.js error.tsx — default export is a
 * framework requirement, like page.tsx). The app previously had no error
 * boundary anywhere, so any render-time throw — most commonly a next/dynamic
 * chunk that failed to load while offline — unmounted the whole React tree
 * and left a white screen. Catch it and offer recovery instead.
 */
export default function AppErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const { t } = useI18n();
  const router = useRouter();

  React.useEffect(() => {
    console.error("[osler] screen crashed:", error);
    haptic("error");
  }, [error]);

  return (
    <div className="flex h-full min-h-[60vh] flex-col items-center justify-center gap-4 bg-background px-6 py-16 text-center text-foreground">
      <div className="flex size-14 items-center justify-center rounded-full bg-destructive-soft">
        <AlertTriangle className="size-6 text-destructive" />
      </div>
      <div className="space-y-1">
        <h1 className="text-base font-semibold">{t("errorBoundary.title")}</h1>
        <p className="mx-auto max-w-sm text-sm text-muted-foreground">{t("errorBoundary.body")}</p>
      </div>
      <div className="flex items-center gap-2">
        <Button variant="outline" onClick={() => { haptic("light"); router.push("/"); }}>
          <Home className="size-4" />
          {t("errorBoundary.home")}
        </Button>
        <Button onClick={() => { haptic("light"); reset(); }}>
          <RefreshCw className="size-4" />
          {t("errorBoundary.retry")}
        </Button>
      </div>
    </div>
  );
}
