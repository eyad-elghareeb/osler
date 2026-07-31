"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import { LoadingState } from "@/components/osler/ui-primitives";

const VideosStudio = dynamic(
  () => import("@/components/osler/videos-studio").then((m) => ({ default: m.VideosStudio })),
  { ssr: false, loading: () => <LoadingState label="Loading video…" /> }
);

export default function VideosVideoPage({ params }: { params: Promise<{ video: string }> }) {
  const { video } = React.use(params);
  const videoId = decodeURIComponent(video);

  return <VideosStudio initialVideoId={videoId} />;
}
