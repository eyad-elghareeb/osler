"use client";

import * as React from "react";
import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { FlashcardStudio } from "@/components/osler/flashcard-studio";
import { loadContentByUid } from "@/lib/osler/content";
import { routeFor, useOslerRouter } from "@/lib/osler/navigation";
import type { AnyContent, ContentTreeNode } from "@/lib/osler/types";
import { LoadingState, EmptyState } from "@/components/osler/ui-primitives";
import { Layers } from "lucide-react";
import { useI18n } from "@/components/osler/i18n-provider";

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
  if (!uid) return <FlashcardStudio />;
  return <FlashcardPackView uid={uid} />;
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

function FlashcardPackView({ uid }: { uid: string }) {
  const router = useRouter();
  const { navigate } = useOslerRouter();
  const { t } = useI18n();

  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState(false);
  const [content, setContent] = React.useState<AnyContent | null>(null);
  const [item, setItem] = React.useState<ContentTreeNode | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(false);

    loadContentByUid(uid, "flashcard")
      .then((loadedContent) => {
        if (cancelled) return;
        if (loadedContent.type === "osce") {
          router.replace(routeFor("osce", { uid }));
          return;
        }
        if (loadedContent.type !== "flashcard") {
          router.replace(routeFor("qbank", { uid }));
          return;
        }
        setContent(loadedContent);
        setItem(nodeFromPack(uid, loadedContent));
        setLoading(false);
      })
      .catch((e) => {
        if (cancelled) return;
        console.error("Failed to load Flashcard pack:", e);
        setError(true);
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [uid, router]);

  if (loading) {
    return <LoadingState label={t("loading.flashcardDeck")} />;
  }

  if (error || !content || !item) {
    return (
      <EmptyState
        icon={Layers}
        title={t("empty.flashcard.title")}
        description={t("empty.flashcard.description")}
        actions={<button onClick={() => navigate("flashcards")} className="text-sm font-medium text-primary underline">{t("empty.flashcard.back")}</button>}
      />
    );
  }

  return <FlashcardStudio activeItem={item} activeContent={content} />;
}
