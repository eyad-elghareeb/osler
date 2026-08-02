"use client";

import * as React from "react";
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Library } from "@/components/osler/library";

/**
 * Library hub + reader, driven by `?article=<file>`.
 * Static export friendly: no dynamic route, no `_redirects` fallback needed.
 * `useSearchParams` is wrapped in `<Suspense>` so the page prerenders cleanly.
 */
export default function LibraryPage() {
  return (
    <Suspense fallback={null}>
      <LibraryView />
    </Suspense>
  );
}

function LibraryView() {
  const params = useSearchParams();
  const article = params.get("article");
  return <Library initialArticleId={article ?? undefined} />;
}
