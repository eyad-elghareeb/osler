import type { Metadata } from "next";
import { Geist, Geist_Mono, Cairo, Newsreader, Playfair_Display, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { OslerThemeProvider } from "@/components/osler/theme-provider";
import { OslerI18nProvider } from "@/components/osler/i18n-provider";
import { AnimationsProvider } from "@/components/osler/animations-provider";
import { SerwistProvider } from "@/components/osler/serwist-provider";
import { AnalyticsProvider } from "@/components/osler/analytics-provider";
import { LANG_INIT_SCRIPT } from "@/lib/osler/i18n";
import { getBuildTimeSiteConfig } from "@/lib/osler/config.server";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Editorial serif for Library article body — high readability, warm tone.
const newsreader = Newsreader({
  variable: "--font-newsreader",
  subsets: ["latin"],
  weight: ["400"],
  style: ["normal", "italic"],
  display: "swap",
});

// Display serif for headings, pull quotes, brand moments — high contrast, elegant.
const playfair = Playfair_Display({
  variable: "--font-playfair",
  subsets: ["latin"],
  weight: ["400", "700", "900"],
  style: ["normal", "italic"],
  display: "swap",
});

// Purpose-built monospace for code — better legibility than Geist Mono at small sizes.
const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  display: "swap",
});

// Cairo covers Latin + Arabic; we load it as a variable font so the same family
// can render both UI English and UI Arabic without reflow.
const cairo = Cairo({
  variable: "--font-cairo",
  subsets: ["arabic", "latin"],
  display: "swap",
});

/**
 * Read the site identity from `osler.config.json` at build time so the static
 * metadata (`<title>`, OpenGraph, PWA manifest name) reflects the user's
 * customisation. Falls back to "Osler" defaults when the config is absent.
 *
 * On the client, the i18n provider overlays the same config values on
 * `t("app.name")` / `t("app.tagline")` so the in-app brand mark and document
 * title stay in sync after hydration.
 */
const siteConfig = getBuildTimeSiteConfig();
const siteName = siteConfig.name;
const siteTagline = siteConfig.tagline;
const siteShortName = siteConfig.shortName;

export const metadata: Metadata = {
  title: `${siteName} — ${siteTagline}`,
  description:
    `${siteName} — Quiz, Question Bank, Flashcards, Written Prompts, and OSCE clinical cases.`,
  keywords: [
    siteName,
    "medical",
    "USMLE",
    "quiz",
    "flashcards",
    "OSCE",
    "question bank",
  ],
  authors: [{ name: siteConfig.organisation }],
  manifest: "/manifest.webmanifest",
  applicationName: siteName,
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: siteShortName,
  },
  formatDetection: {
    telephone: false,
  },
  icons: {
    icon: [
      { url: "/assets/favicon.png", sizes: "32x32", type: "image/png" },
      { url: "/assets/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/assets/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { url: "/assets/icon.svg", sizes: "any", type: "image/svg+xml" },
    ],
    apple: [{ url: "/assets/icons/apple-touch-icon.png" }],
  },
  openGraph: {
    title: `${siteName} — ${siteTagline}`,
    description: `${siteName} — High-yield question bank, active recall flashcards, OSCE simulation, and clinical reference library. Adaptive, offline-ready, and open-source.`,
    siteName: siteName,
    type: "website",
    // Relative URL — instance-agnostic, crawlers resolve against page URL.
    // PNG is used for widest preview support (SVG isn't rendered as an
    // og:image by most crawlers, including Facebook/Meta's and Twitter/X's).
    // Section routes (qbank, flashcards, osce, library, videos) override
    // this with a more specific image via their own layout.tsx metadata —
    // see scripts/generate-social-images.js for how these are generated.
    images: [{ url: "/assets/og-image.png", width: 1200, height: 630, alt: `${siteName} — ${siteTagline}`, type: "image/png" }],
  },
  twitter: {
    card: "summary_large_image",
    title: `${siteName} — ${siteTagline}`,
    description: `${siteName} — High-yield question bank, active recall flashcards, OSCE simulation, and clinical reference library.`,
    images: ["/assets/og-image.png"],
  },
};

export const viewport = {
  // Standard mobile viewport.
  width: "device-width",
  initialScale: 1,
  // Disable user zoom — this matches native app behaviour (you can't pinch
  // to zoom a native app's UI). Combined with `user-scalable=no` it
  // prevents the accidental double-tap zoom that breaks the immersive feel.
  maximumScale: 1,
  userScalable: false,
  // `cover` extends the layout under the iOS notch / Dynamic Island and
  // the Android status bar / navigation bar. The .safe-pt / .safe-pb /
  // .safe-screen utilities in globals.css then add the correct env()
  // padding so content never sits underneath the system chrome.
  viewportFit: "cover",
  // Tell iOS Safari this is a standalone-capable PWA — the OS will hide
  // the URL bar and add the native app-switcher snapshot when launched
  // from the home screen.
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
  ],
} as const;

import { OslerSessionProvider } from "@/lib/osler/session-context";
import { RouteGuard } from "@/components/osler/route-guard";
import { CookieConsentBanner } from "@/components/osler/cookie-consent-banner";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning className="dark">
      <head>
        <meta name="theme-color" content="#0a0a0a" media="(prefers-color-scheme: dark)" />
        <meta name="theme-color" content="#ffffff" media="(prefers-color-scheme: light)" />
        <link rel="apple-touch-icon" href="/assets/icons/apple-touch-icon.png" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content={siteShortName} />
        <meta name="mobile-web-app-title" content={siteShortName} />
        <meta name="format-detection" content="telephone=no" />
        <script dangerouslySetInnerHTML={{ __html: LANG_INIT_SCRIPT }} />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${newsreader.variable} ${playfair.variable} ${jetbrainsMono.variable} ${cairo.variable} antialiased bg-background text-foreground`}
      >
        <SerwistProvider>
          <OslerThemeProvider>
            <OslerI18nProvider>
              <OslerSessionProvider>
                <RouteGuard>
                  <AnalyticsProvider>
                    <AnimationsProvider>{children}</AnimationsProvider>
                  </AnalyticsProvider>
                </RouteGuard>
              </OslerSessionProvider>
            </OslerI18nProvider>
          </OslerThemeProvider>
        </SerwistProvider>
        <CookieConsentBanner />
        <Toaster />
      </body>
    </html>
  );
}
