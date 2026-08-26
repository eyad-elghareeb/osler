"use client";

import * as React from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { useI18n } from "@/components/osler/i18n-provider";
import { getConfig } from "@/lib/osler/config";

export interface PageSeoOptions {
  title?: string;
  description?: string;
  /** Engine type for dynamic OG image (quiz|bank|flashcard|osce|library|video) */
  engineType?: string;
}

/** Build the dynamic OG image URL pointing at the worker /og endpoint. */
function buildOgImageUrl(
  apiBase: string,
  title: string,
  type: string,
  siteName: string,
  sub?: string
): string {
  const params = new URLSearchParams({ title, type, site: siteName });
  if (sub) params.set("sub", sub);
  return `${apiBase}/og?${params.toString()}`;
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
 * Dynamically updates document.title, meta description, and all OpenGraph/Twitter
 * tags on client navigation — including a dynamic og:image from the worker /og endpoint
 * for content-specific pages (packs, articles, decks, stations).
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
    // Infer engine type from explicit prop or pathname
    let engineType = options?.engineType;

    if (!pageTitle) {
      if (pathname === "/" || pathname === "") {
        pageTitle = t("nav.dashboard");
        pageDesc = `${siteName} — ${siteTagline}. Adaptive quiz, question bank, flashcards, and OSCE simulation.`;
      } else if (pathname.includes("/qbank")) {
        pageTitle = t("nav.qbank");
        pageDesc = "High-yield medical question bank and practice questions.";
        engineType ??= "bank";
      } else if (pathname.includes("/flashcards")) {
        pageTitle = t("nav.flashcards");
        pageDesc = "Spaced repetition flashcards and active recall decks.";
        engineType ??= "flashcard";
      } else if (pathname.includes("/osce")) {
        pageTitle = t("nav.osce");
        pageDesc = "Interactive clinical stations and patient simulations.";
        engineType ??= "osce";
      } else if (pathname.includes("/library")) {
        pageTitle = t("nav.library");
        pageDesc = "Evidence-based medical reference articles and clinical guidelines.";
        engineType ??= "library";
      } else if (pathname.includes("/videos")) {
        pageTitle = t("nav.videos");
        pageDesc = "Curated high-yield video lectures and clinical procedures.";
        engineType ??= "video";
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
    const queryContent =
      searchParams?.get("pack") ||
      searchParams?.get("deck") ||
      searchParams?.get("article") ||
      searchParams?.get("qbank") ||
      searchParams?.get("station");
    let contentName: string | undefined;
    if (queryContent) {
      contentName = queryContent.split("/").pop()?.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
      if (contentName) pageTitle = `${contentName} · ${pageTitle || siteName}`;
    }

    const fullTitle = pageTitle ? `${pageTitle} — ${siteName}` : `${siteName} — ${siteTagline}`;
    document.title = fullTitle;

    // ── Meta & OG tags ─────────────────────────────────────────────────────
    if (pageDesc) {
      setMeta("name", "description", pageDesc);
      setMeta("property", "og:description", pageDesc);
      setMeta("name", "twitter:description", pageDesc);
    }
    setMeta("property", "og:title", fullTitle);
    setMeta("name", "twitter:title", fullTitle);

    // ── Dynamic OG image ────────────────────────────────────────────────────
    // When viewing a specific content piece, point og:image to the worker /og
    // endpoint which renders a branded SVG with the pack/article name embedded.
    // Falls back to the static default image for hub pages.
    const apiUrl = cfg?.cloud?.apiUrl;
    if (apiUrl && contentName && engineType) {
      const dynamicOg = buildOgImageUrl(
        apiUrl,
        contentName,
        engineType,
        siteName,
        pageDesc
      );
      setMeta("property", "og:image", dynamicOg);
      setMeta("name", "twitter:image", dynamicOg);
      setMeta("name", "twitter:card", "summary_large_image");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, searchParams?.toString(), options?.title, options?.description, options?.engineType, siteName, siteTagline]);
}
