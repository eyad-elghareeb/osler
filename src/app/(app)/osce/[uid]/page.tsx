"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { OsceStudio } from "@/components/osler/osce-studio";
import { loadContentByUid } from "@/lib/osler/content";
import type { AnyContent, ContentTreeNode, OsceContent } from "@/lib/osler/types";
import { LoadingState, EmptyState } from "@/components/osler/ui-primitives";
import { Stethoscope } from "lucide-react";
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

export default function OscePackPage({ params }: { params: Promise<{ uid: string }> }) {
  const { uid } = React.use(params);
  const router = useRouter();
  const { navigate } = useOslerRouter();

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
    return <LoadingState label="Loading OSCE scenario…" />;
  }

  if (error || !content || !item) {
    return (
      <EmptyState
        icon={Stethoscope}
        title="Scenario Not Found"
        description="The requested OSCE case could not be loaded."
        actions={<button onClick={() => navigate("osce")} className="text-sm font-medium text-primary underline">Back to OSCE Cases</button>}
      />
    );
  }

  return <OsceStudio activeItem={item} activeContent={content} />;
}
