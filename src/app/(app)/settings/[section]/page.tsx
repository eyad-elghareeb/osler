import SettingsSectionClient from "./client";

const SECTIONS = [
  "account",
  "appearance",
  "language",
  "ai",
  "shortcuts",
  "downloads",
  "sync",
  "backup",
  "native",
  "about",
  "danger",
] as const;

/**
 * Static export: enumerate every known settings section so Next.js generates
 * a static HTML page for each. Unknown sections are caught at runtime by
 * the redirect-to-/settings effect in the client component.
 */
export function generateStaticParams() {
  return SECTIONS.map((section) => ({ section }));
}


export default async function SettingsSectionPage({
  params,
}: {
  params: Promise<{ section: string }>;
}) {
  const { section } = await params;
  return <SettingsSectionClient section={section} />;
}
