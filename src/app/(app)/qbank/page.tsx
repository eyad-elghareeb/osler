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
 *
 * Additional deep-link params:
 *   - `?resume=1`            force-resume the active in-progress session.
 *   - `?review=<sessionId>`  open a saved session in read-only review mode.
 *   - `?retake=<sessionId>`  restart a saved session with only its wrong questions.
 *   - `?folder=<node-uid>`   open the Content tab inside the given folder.
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
  const folder = params.get("folder");
  const resume = params.get("resume") === "1";
  const reviewSessionId = params.get("review");
  const retakeSessionId = params.get("retake");
  return (
    <QBankStudio
      uid={uid ?? null}
      folder={folder}
      forceResume={resume}
      reviewSessionId={reviewSessionId ?? null}
      retakeSessionId={retakeSessionId ?? null}
    />
  );
}
