import FlashcardPackClient from "./client";

/**
 * Static export: emit one placeholder page so Next.js generates the route
 * shell. Actual UIDs are resolved client-side. See `public/_redirects`.
 */
export function generateStaticParams() {
  return [{ uid: "_" }];
}


export default async function FlashcardPackPage({
  params,
}: {
  params: Promise<{ uid: string }>;
}) {
  const { uid } = await params;
  return <FlashcardPackClient uid={uid} />;
}
