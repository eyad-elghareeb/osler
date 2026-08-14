"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { OsceStudio } from "@/components/osler/osce-studio";

/**
 * OSCE hub + scenario studio, driven by `?uid=<scenario>`.
 * Static export friendly: no dynamic route, no `_redirects` fallback needed.
 * `useSearchParams` is wrapped in `<Suspense>` so the page prerenders cleanly.
 */
export default function OscePage() {
  return (
    <Suspense fallback={null}>
      <OsceView />
    </Suspense>
  );
}

function OsceView() {
  const params = useSearchParams();
  const uid = params.get("uid");
  return <OsceStudio uid={uid ?? null} />;
}
