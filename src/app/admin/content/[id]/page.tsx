import AdminContentEditorClient from "./client";

/**
 * Static export: emit one placeholder page so Next.js generates the route
 * shell. Actual content_object IDs (UUIDs from the Worker) are resolved
 * client-side via the admin API. See `public/_redirects`.
 */
export function generateStaticParams() {
  return [{ id: "_" }];
}


export default async function AdminContentEditorPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <AdminContentEditorClient id={id} />;
}
