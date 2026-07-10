import type { Metadata } from "next";
import { Geist, Geist_Mono, Cairo } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { OslerThemeProvider } from "@/components/osler/theme-provider";
import { OslerI18nProvider } from "@/components/osler/i18n-provider";
import { ServiceWorkerRegistrar } from "@/components/osler/service-worker-registrar";
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
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
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
        {/* Set <html lang/dir> from localStorage BEFORE React hydrates so the
            user's preferred UI language (incl. RTL Arabic) is applied without
            a flash of the default LTR English layout. */}
        <script dangerouslySetInnerHTML={{ __html: LANG_INIT_SCRIPT }} />
        {process.env.NODE_ENV !== "production" && (
          <script
            dangerouslySetInnerHTML={{
              __html:
                "if('serviceWorker' in navigator){navigator.serviceWorker.getRegistrations().then(function(r){r.forEach(function(x){x.unregister();});});}",
            }}
          />
        )}
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${cairo.variable} antialiased bg-background text-foreground`}
      >
        <OslerThemeProvider>
          <OslerI18nProvider>{children}</OslerI18nProvider>
        </OslerThemeProvider>
        <Toaster />
        <ServiceWorkerRegistrar />
      </body>
    </html>
  );
}
