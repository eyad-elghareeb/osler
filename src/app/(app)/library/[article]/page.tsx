import LibraryArticleClient from "./client";

/**
 * Static export: emit one placeholder page so Next.js generates the route
 * shell. Actual article IDs are resolved client-side. See `public/_redirects`.
 */
export function generateStaticParams() {
  return [{ article: "_" }];
}


export default async function LibraryArticlePage({
  params,
}: {
  params: Promise<{ article: string }>;
}) {
  const { article } = await params;
  return <LibraryArticleClient article={article} />;
}
