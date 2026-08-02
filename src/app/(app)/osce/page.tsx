"use client";

import * as React from "react";
import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { OsceStudio } from "@/components/osler/osce-studio";
import { loadContentByUid } from "@/lib/osler/content";
import { routeFor, useOslerRouter } from "@/lib/osler/navigation";
import type { AnyContent, ContentTreeNode, OsceContent } from "@/lib/osler/types";
import { LoadingState, EmptyState } from "@/components/osler/ui-primitives";
import { Stethoscope } from "lucide-react";
import { useI18n } from "@/components/osler/i18n-provider";

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
  if (!uid) return <OsceStudio activeItem={null} activeContent={null} />;
  return <OscePackView uid={uid} />;
}

function nodeFromPack(uid: string, content: AnyContent): ContentTreeNode {
  return {
    uid,
    title: content.meta?.title || uid,
    type: content.type,
    path: "",
    items: [],
    lang: content.meta?.lang,
  };
}

function OscePackView({ uid }: { uid: string }) {
  const router = useRouter();
  const { navigate } = useOslerRouter();
  const { t } = useI18n();

  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState(false);
  const [content, setContent] = React.useState<OsceContent | null>(null);
  const [item, setItem] = React.useState<ContentTreeNode | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(false);

    loadContentByUid(uid, "osce")
      .then((loadedContent) => {
        if (cancelled) return;
        if (loadedContent.type === "flashcard") {
          router.replace(routeFor("flashcards", { uid }));
          return;
        }
        if (loadedContent.type !== "osce") {
          router.replace(routeFor("qbank", { uid }));
          return;
        }
        setContent(loadedContent as OsceContent);
        setItem(nodeFromPack(uid, loadedContent));
        setLoading(false);
      })
      .catch((e) => {
        if (cancelled) return;
        console.error("Failed to load OSCE pack:", e);
        setError(true);
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [uid, router]);

  if (loading) {
    return <LoadingState label={t("loading.osceScenario")} />;
  }

  if (error || !content || !item) {
    return (
      <EmptyState
        icon={Stethoscope}
        title={t("empty.osce.title")}
        description={t("empty.osce.description")}
        actions={<button onClick={() => navigate("osce")} className="text-sm font-medium text-primary underline">{t("empty.osce.back")}</button>}
      />
    );
  }

  return <OsceStudio activeItem={item} activeContent={content} />;
}
