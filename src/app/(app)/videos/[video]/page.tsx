"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import { LoadingState } from "@/components/osler/ui-primitives";
import { useI18n } from "@/components/osler/i18n-provider";

function VideoLoadingFallback() {
  const { t } = useI18n();
  return <LoadingState label={t("loading.video")} />;
}

const VideosStudio = dynamic(
  () => import("@/components/osler/videos-studio").then((m) => ({ default: m.VideosStudio })),
  { ssr: false, loading: () => <VideoLoadingFallback /> }
);

export default function VideosVideoPage({ params }: { params: Promise<{ video: string }> }) {
  // Next.js App Router already decodes dynamic route params.
  const { video } = React.use(params);

  return <VideosStudio initialVideoId={video} />;
}
