"use client";

import * as React from "react";
import { Suspense } from "react";
import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import { HubSkeleton } from "@/components/osler/ui-primitives";

/**
 * Videos hub + player, driven by `?video=<id>`.
 * Static export friendly: no dynamic route, no `_redirects` fallback needed.
 * `useSearchParams` is wrapped in `<Suspense>` so the page prerenders cleanly.
 */
export default function VideosPage() {
  return (
    <Suspense fallback={null}>
      <VideosView />
    </Suspense>
  );
}

const VideosStudio = dynamic(
  () => import("@/components/osler/videos-studio").then((m) => ({ default: m.VideosStudio })),
  { ssr: false, loading: () => <HubSkeleton statCount={0} cardCount={6} /> }
);

function VideosView() {
  const params = useSearchParams();
  const video = params.get("video");
  return <VideosStudio initialVideoId={video ?? undefined} />;
}
