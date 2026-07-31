"use client";

import * as React from "react";
import { Library } from "@/components/osler/library";

export default function LibraryArticlePage({ params }: { params: Promise<{ article: string }> }) {
  const { article } = React.use(params);
  const articleId = decodeURIComponent(article);

  return <Library initialArticleId={articleId} />;
}
