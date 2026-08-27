import type { Metadata } from "next";
import { buildSectionMetadata } from "@/lib/osler/section-metadata";

export const metadata: Metadata = buildSectionMetadata({
  path: "/qbank",
  titleSuffix: "Question Bank",
  description: "Adaptive question bank with instant explanations and spaced review.",
  ogType: "bank",
});

export default function QbankLayout({ children }: { children: React.ReactNode }) {
  return children;
}
