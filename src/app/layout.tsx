import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { OslerThemeProvider } from "@/components/osler/theme-provider";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Osler — Medical Study Platform",
  description:
    "Osler — Quiz, Question Bank, Flashcards, Written Prompts, and OSCE clinical cases. Rebased on MedOS Lite UI/UX.",
  keywords: [
    "Osler",
    "MedOS",
    "medical",
    "USMLE",
    "quiz",
    "flashcards",
    "OSCE",
    "question bank",
  ],
  authors: [{ name: "Osler Team" }],
  icons: {
    icon: "https://z-cdn.chatglm.cn/z-ai/static/logo.svg",
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

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning className="dark">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        <OslerThemeProvider>{children}</OslerThemeProvider>
        <Toaster />
      </body>
    </html>
  );
}
