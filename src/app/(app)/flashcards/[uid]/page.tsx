"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { FlashcardStudio } from "@/components/osler/flashcard-studio";
import { loadContentByUid } from "@/lib/osler/content";
import type { AnyContent, ContentTreeNode } from "@/lib/osler/types";
import { LoadingState, EmptyState } from "@/components/osler/ui-primitives";
import { Layers } from "lucide-react";
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

export default function FlashcardPackPage({ params }: { params: Promise<{ uid: string }> }) {
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

    loadContentByUid(uid, "flashcard")
      .then((loadedContent) => {
        if (cancelled) return;
        if (loadedContent.type === "osce") {
          router.replace(`/osce/${uid}`);
          return;
        }
        if (loadedContent.type !== "flashcard") {
          router.replace(`/qbank/${uid}`);
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
    return <LoadingState label="Loading deck…" />;
  }

  if (error || !content || !item) {
    return (
      <EmptyState
        icon={Layers}
        title="Deck Not Found"
        description="The requested flashcard deck could not be loaded."
        actions={<button onClick={() => navigate("flashcards")} className="text-sm font-medium text-primary underline">Back to Flashcards</button>}
      />
    );
  }

  return <FlashcardStudio activeItem={item} activeContent={content} />;
}
