"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { FlashcardStudio } from "@/components/osler/flashcard-studio";

/**
 * Flashcard hub + deck studio, driven by `?uid=<deck>`.
 * Static export friendly: no dynamic route, no `_redirects` fallback needed.
 * `useSearchParams` is wrapped in `<Suspense>` so the page prerenders cleanly.
 */
export default function FlashcardsPage() {
  return (
    <Suspense fallback={null}>
      <FlashcardsView />
    </Suspense>
  );
}

function FlashcardsView() {
  const params = useSearchParams();
  const uid = params.get("uid");
  return <FlashcardStudio uid={uid ?? null} />;
}
