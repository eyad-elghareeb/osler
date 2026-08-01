"use client";

import * as React from "react";
import { Library } from "@/components/osler/library";

export default function LibraryArticleClient({ article }: { article: string }) {
  // Next.js App Router already decodes dynamic route params — do NOT call
  // decodeURIComponent again, or a literal `%` in an article id will throw
  // URIError and blank the page.
  return <Library initialArticleId={article} />;
}
