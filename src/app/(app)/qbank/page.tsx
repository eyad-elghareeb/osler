"use client";

import * as React from "react";
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { QBankStudio } from "@/components/osler/qbank-studio";

/**
 * QBank hub + pack studio, driven by `?uid=<pack>`.
 * Static export friendly: no dynamic route, no `_redirects` fallback needed.
 * `useSearchParams` is wrapped in `<Suspense>` so the page prerenders cleanly.
 *
 * The studio is ALWAYS mounted and self-loads the pack from the `uid` prop —
 * navigating `/qbank` → `/qbank?uid=X` never changes the rendered component
 * type, so the hub is never unmounted/remounted and its loaded tree survives.
 */
export default function QBankPage() {
  return (
    <Suspense fallback={null}>
      <QBankView />
    </Suspense>
  );
}

function QBankView() {
  const params = useSearchParams();
  const uid = params.get("uid");
  const resume = params.get("resume") === "1";
  return <QBankStudio uid={uid ?? null} forceResume={resume} />;
}
