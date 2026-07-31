"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { QBankStudio } from "@/components/osler/qbank-studio";
import { loadContentByUid } from "@/lib/osler/content";
import type { AnyContent, ContentTreeNode } from "@/lib/osler/types";
import { LoadingState, EmptyState } from "@/components/osler/ui-primitives";
import { ListChecks } from "lucide-react";
import { useOslerRouter } from "@/lib/osler/navigation";

function nodeFromPack(uid: string, content: AnyContent): ContentTreeNode {
  return {
    uid,
    title: content.meta?.title || uid,
    type: content.type as any,
    path: "",
    items: [],
    lang: content.meta?.lang,
  };
}

export default function QBankPackPage({ params }: { params: Promise<{ uid: string }> }) {
  const { uid } = React.use(params);
  const router = useRouter();
  const { navigate } = useOslerRouter();

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
          router.replace(`/flashcards/${uid}`);
          return;
        }
        if (loadedContent.type === "osce") {
          router.replace(`/osce/${uid}`);
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
    return <LoadingState label="Loading QBank pack…" />;
  }

  if (error || !content || !item) {
    return (
      <EmptyState
        icon={ListChecks}
        title="Pack Not Found"
        description="The requested question bank pack could not be loaded."
        actions={<button onClick={() => navigate("qbank")} className="text-sm font-medium text-primary underline">Back to QBank</button>}
      />
    );
  }

  return <QBankStudio activeItem={item} activeContent={content} />;
}
