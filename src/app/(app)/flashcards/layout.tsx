import type { Metadata } from "next";
import { buildSectionMetadata } from "@/lib/osler/section-metadata";

export const metadata: Metadata = buildSectionMetadata({
  path: "/flashcards",
  titleSuffix: "Flashcards",
  description: "Active recall flashcards with spaced repetition scheduling.",
  ogType: "flashcard",
});

export default function FlashcardsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
