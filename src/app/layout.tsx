import type { Metadata } from "next";
import { Geist, Geist_Mono, Cairo } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { OslerThemeProvider } from "@/components/osler/theme-provider";
import { OslerI18nProvider } from "@/components/osler/i18n-provider";
import { SerwistProvider } from "@/components/osler/serwist-provider";
import { LANG_INIT_SCRIPT } from "@/lib/osler/i18n";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Cairo covers Latin + Arabic; we load it as a variable font so the same family
// can render both UI English and UI Arabic without reflow.
const cairo = Cairo({
  variable: "--font-cairo",
  subsets: ["arabic", "latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Osler — Medical Study Platform",
  description:
    "Osler — Quiz, Question Bank, Flashcards, Written Prompts, and OSCE clinical cases.",
  keywords: [
    "Osler",
    "medical",
    "USMLE",
    "quiz",
    "flashcards",
    "OSCE",
    "question bank",
  ],
  authors: [{ name: "Osler Team" }],
  manifest: "/manifest.webmanifest",
  applicationName: "Osler",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Osler",
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
    title: "Osler — Medical Study Platform",
    description: "Quiz, Bank, Flashcards, Written, OSCE — one app.",
    siteName: "Osler",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Osler — Medical Study Platform",
    description: "Quiz, Bank, Flashcards, Written, OSCE — one app.",
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
        {/* PWA native-feel meta tags.
            - `apple-mobile-web-app-capable` + `mobile-web-app-capable` make
              iOS Safari and Android Chrome launch the PWA in standalone
              mode (no URL bar, no browser chrome) when added to the home
              screen.
            - `apple-mobile-web-app-status-bar-style: black-translucent`
              lets our background extend under the iOS status bar; the
              .safe-pt utility compensates for the inset.
            - `apple-mobile-web-app-title` is the name shown under the
              home-screen icon on iOS (shorter than the page title).
            - `mobile-web-app-capable` is the standard equivalent for
              Android Chrome.
            Docs: https://whatpwacando.today/viewport */}
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="Osler" />
        <meta name="mobile-web-app-title" content="Osler" />
        {/* Disable iOS Safari's telephone link detection — otherwise a
            sequence of digits in a medical record could get auto-linked
            as a phone number. */}
        <meta name="format-detection" content="telephone=no" />
        {/* Set <html lang/dir> from localStorage BEFORE React hydrates so the
            user's preferred UI language (incl. RTL Arabic) is applied without
            a flash of the default LTR English layout. */}
        <script dangerouslySetInnerHTML={{ __html: LANG_INIT_SCRIPT }} />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${cairo.variable} antialiased bg-background text-foreground`}
      >
        <SerwistProvider>
          <OslerThemeProvider>
            <OslerI18nProvider>{children}</OslerI18nProvider>
          </OslerThemeProvider>
        </SerwistProvider>
        <Toaster />
      </body>
    </html>
  );
}
