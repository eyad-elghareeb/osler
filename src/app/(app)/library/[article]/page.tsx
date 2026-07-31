"use client";

import * as React from "react";
import { Library } from "@/components/osler/library";

export default function LibraryArticlePage({ params }: { params: Promise<{ article: string }> }) {
  // Next.js App Router already decodes dynamic route params — do NOT call
  // decodeURIComponent again, or a literal `%` in an article id will throw
  // URIError and blank the page.
  const { article } = React.use(params);

  return <Library initialArticleId={article} />;
}
