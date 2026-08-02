"use client";

import * as React from "react";
import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { QBankStudio } from "@/components/osler/qbank-studio";
import { loadContentByUid } from "@/lib/osler/content";
import { routeFor, useOslerRouter } from "@/lib/osler/navigation";
import type { AnyContent, ContentTreeNode } from "@/lib/osler/types";
import { LoadingState, EmptyState } from "@/components/osler/ui-primitives";
import { ListChecks } from "lucide-react";
import { useI18n } from "@/components/osler/i18n-provider";

/**
 * QBank hub + pack studio, driven by `?uid=<pack>`.
 * Static export friendly: no dynamic route, no `_redirects` fallback needed.
 * `useSearchParams` is wrapped in `<Suspense>` so the page prerenders cleanly.
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
  if (!uid) return <QBankStudio />;
  return <QBankPackView uid={uid} />;
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

function QBankPackView({ uid }: { uid: string }) {
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

    loadContentByUid(uid)
      .then((loadedContent) => {
        if (cancelled) return;
        if (loadedContent.type === "flashcard") {
          router.replace(routeFor("flashcards", { uid }));
          return;
        }
        if (loadedContent.type === "osce") {
          router.replace(routeFor("osce", { uid }));
          return;
        }
        setContent(loadedContent);
        setItem(nodeFromPack(uid, loadedContent));
        setLoading(false);
      })
      .catch((e) => {
        if (cancelled) return;
        console.error("Failed to load QBank pack:", e);
        setError(true);
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [uid, router]);

  if (loading) {
    return <LoadingState label={t("loading.qbankPack")} />;
  }

  if (error || !content || !item) {
    return (
      <EmptyState
        icon={ListChecks}
        title={t("empty.qbank.title")}
        description={t("empty.qbank.description")}
        actions={<button onClick={() => navigate("qbank")} className="text-sm font-medium text-primary underline">{t("empty.qbank.back")}</button>}
      />
    );
  }

  return <QBankStudio activeItem={item} activeContent={content} />;
}
