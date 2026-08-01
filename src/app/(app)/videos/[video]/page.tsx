import VideosVideoClient from "./client";

/**
 * Static export: emit one placeholder page so Next.js generates the route
 * shell. Actual video IDs are resolved client-side. See `public/_redirects`.
 */
export function generateStaticParams() {
  return [{ video: "_" }];
}


export default async function VideosVideoPage({
  params,
}: {
  params: Promise<{ video: string }>;
}) {
  const { video } = await params;
  return <VideosVideoClient video={video} />;
}
