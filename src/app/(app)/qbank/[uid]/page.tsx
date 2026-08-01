import QBankPackClient from "./client";

/**
 * Static export: emit one placeholder page so Next.js generates the route
 * shell. Actual UIDs are resolved client-side from the URL parameter and
 * fetched via `loadContentByUid`. The `_redirects` file in `public/`
 * ensures Cloudflare Pages serves this shell for any `/qbank/<uid>` URL.
 */
export function generateStaticParams() {
  return [{ uid: "_" }];
}


export default async function QBankPackPage({
  params,
}: {
  params: Promise<{ uid: string }>;
}) {
  const { uid } = await params;
  return <QBankPackClient uid={uid} />;
}
