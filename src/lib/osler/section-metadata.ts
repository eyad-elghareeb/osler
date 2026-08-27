import type { Metadata } from "next";
import { getBuildTimeSiteConfig } from "@/lib/osler/config.server";

/**
 * Builds static per-section `<head>` metadata for a top-level route segment
 * (qbank, flashcards, osce, library, videos).
 *
 * Why this exists: the app is a fully static export (`output: "export"`,
 * see next.config.ts) with no per-request server, so a specific *article* or
 * *question pack* — which is chosen client-side via a `?uid=`/`?article=`
 * query string, not a distinct build-time route — can never get its own
 * crawler-visible title or image. Social crawlers (Facebook/Meta, Twitter/X,
 * Slack, Discord, WhatsApp, iMessage) fetch the static HTML only; they don't
 * run JavaScript, so anything set after hydration is invisible to them.
 * That's a hard limit of this architecture, not a bug to work around here.
 *
 * What *is* achievable statically: each top-level section (qbank,
 * flashcards, osce, library, videos) is its own build-time route, so it can
 * have its own genuine, crawler-visible title and preview image — just not
 * one specific to whichever item within that section someone happens to
 * link to. That's a real, meaningful improvement over a single generic
 * image for the entire site, and it degrades honestly: anything not listed
 * here (home, settings, profile, login, admin, …) keeps the site-wide
 * default from the root layout.
 */
export function buildSectionMetadata(section: {
  path: string;
  titleSuffix: string;
  description: string;
  ogType: "quiz" | "bank" | "flashcard" | "osce" | "library" | "video" | "written";
}): Metadata {
  const site = getBuildTimeSiteConfig();
  const title = `${site.name} — ${section.titleSuffix}`;
  const description = `${site.name} — ${section.description}`;
  const imageUrl = `/assets/og/${section.ogType}.png`;

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      siteName: site.name,
      type: "website",
      images: [{ url: imageUrl, width: 1200, height: 630, alt: title, type: "image/png" }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [imageUrl],
    },
  };
}
