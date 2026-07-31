"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import { LoadingState } from "@/components/osler/ui-primitives";
import { useI18n } from "@/components/osler/i18n-provider";

function VideosLoadingFallback() {
  const { t } = useI18n();
  return <LoadingState label={t("loading.videos")} />;
}

const VideosStudio = dynamic(
  () => import("@/components/osler/videos-studio").then((m) => ({ default: m.VideosStudio })),
  { ssr: false, loading: () => <VideosLoadingFallback /> }
);

export default function VideosPage() {
  return <VideosStudio />;
}
