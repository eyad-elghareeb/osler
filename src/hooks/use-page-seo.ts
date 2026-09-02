"use client";

import * as React from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { useI18n } from "@/components/osler/i18n-provider";
import { getConfig } from "@/lib/osler/config";

export interface PageSeoOptions {
  title?: string;
  description?: string;
  /** Engine type, kept for callers that want it in the derived page title. */
  engineType?: string;
}

/** Set or create a <meta> tag by attribute=value selector, returning the element. */
function setMeta(attr: string, key: string, value: string): void {
  let el = document.querySelector(`meta[${attr}="${key}"]`);
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.setAttribute("content", value);
}

/**
 * Dynamically updates `document.title`, the description meta tag, and the
 * og:title/twitter:title tags on client-side navigation, for the visitor's
 * own browser tab, history entry, and bookmarks.
 *
 * This intentionally does NOT touch og:image/twitter:image, and does not
 * attempt a per-content (per-article/per-pack) image or title. This app is a
 * fully static export with no per-request server (see next.config.ts) — the
 * HTML a social crawler fetches for any URL is whatever was baked in at
 * build time, and crawlers (Facebook/Meta, Twitter/X, Slack, Discord,
 * WhatsApp, iMessage) do not execute this hook's JavaScript, so any tag
 * this effect sets is invisible to them. An earlier version of this hook
 * did rewrite og:image here anyway; it had no visible effect for real link
 * previews (nothing called this hook) and, worse, would have pointed
 * og:image at an SVG endpoint that most of those crawlers don't render as a
 * preview image even when they can see it.
 *
 * What actually reaches crawlers is resolved entirely at build time: the
 * root layout ships a site-wide default image, and the five section layouts
 * (qbank, flashcards, osce, library, videos — see
 * `src/lib/osler/section-metadata.ts`) ship a real, distinct, crawler-safe
 * static PNG per section. That's the deliberate "resolve to static" fallback
 * for an app that can't render per-URL metadata server-side.
 */
export function usePageSeo(options?: PageSeoOptions) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { t } = useI18n();

  const cfg = React.useMemo(() => {
    try { return getConfig(); } catch { return null; }
  }, []);

  const siteName = cfg?.site?.name || "Osler";
  const siteTagline = cfg?.site?.tagline || "Medical Study Platform";

  React.useEffect(() => {
    let pageTitle = options?.title;
    let pageDesc = options?.description;

    if (!pageTitle) {
      if (pathname === "/" || pathname === "") {
        pageTitle = t("nav.dashboard");
        pageDesc = `${siteName} — ${siteTagline}. Adaptive quiz, question bank, flashcards, and OSCE simulation.`;
      } else if (pathname.includes("/qbank")) {
        pageTitle = t("nav.qbank");
        pageDesc = "High-yield medical question bank and practice questions.";
      } else if (pathname.includes("/flashcards")) {
        pageTitle = t("nav.flashcards");
        pageDesc = "Spaced repetition flashcards and active recall decks.";
      } else if (pathname.includes("/osce")) {
        pageTitle = t("nav.osce");
        pageDesc = "Interactive clinical stations and patient simulations.";
      } else if (pathname.includes("/library")) {
        pageTitle = t("nav.library");
        pageDesc = "Evidence-based medical reference articles and clinical guidelines.";
      } else if (pathname.includes("/videos")) {
        pageTitle = t("nav.videos");
        pageDesc = "Curated high-yield video lectures and clinical procedures.";
      } else if (pathname.includes("/learn")) {
        pageTitle = t("nav.learn");
        pageDesc = "Personalized learning dashboard and study progress.";
      } else if (pathname.includes("/profile")) {
        pageTitle = t("nav.profile");
      } else if (pathname.includes("/settings")) {
        pageTitle = t("nav.settings");
      } else if (pathname.includes("/login")) {
        pageTitle = "Sign in";
      } else if (pathname.includes("/admin")) {
        pageTitle = `${siteName} Admin`;
      }
    }

    // Content-specific title from query params (e.g. ?pack=Cardiology/STEMI or ?article=Asthma)
    // — this only ever updates the live tab title, never anything crawler-visible; see the
    // module doc comment above.
    const queryContent =
      searchParams?.get("pack") ||
      searchParams?.get("deck") ||
      searchParams?.get("article") ||
      searchParams?.get("qbank") ||
      searchParams?.get("station");
    if (queryContent) {
      const contentName = queryContent.split("/").pop()?.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
      if (contentName) pageTitle = `${contentName} · ${pageTitle || siteName}`;
    }

    const fullTitle = pageTitle ? `${pageTitle} — ${siteName}` : `${siteName} — ${siteTagline}`;
    document.title = fullTitle;

    if (pageDesc) {
      setMeta("name", "description", pageDesc);
      setMeta("property", "og:description", pageDesc);
      setMeta("name", "twitter:description", pageDesc);
    }
    setMeta("property", "og:title", fullTitle);
    setMeta("name", "twitter:title", fullTitle);
  }, [pathname, searchParams?.toString(), options?.title, options?.description, options?.engineType, siteName, siteTagline]);
}
