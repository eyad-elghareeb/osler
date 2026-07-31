"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { OsceStudio } from "@/components/osler/osce-studio";
import { loadContentByUid } from "@/lib/osler/content";
import type { AnyContent, ContentTreeNode, OsceContent } from "@/lib/osler/types";
import { LoadingState, EmptyState } from "@/components/osler/ui-primitives";
import { Stethoscope } from "lucide-react";
import { useOslerRouter } from "@/lib/osler/navigation";
import { useI18n } from "@/components/osler/i18n-provider";

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

export default function OscePackPage({ params }: { params: Promise<{ uid: string }> }) {
  const { uid } = React.use(params);
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
          router.replace(`/flashcards/${uid}`);
          return;
        }
        if (loadedContent.type !== "osce") {
          router.replace(`/qbank/${uid}`);
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
