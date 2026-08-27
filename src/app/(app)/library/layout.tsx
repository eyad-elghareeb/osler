import type { Metadata } from "next";
import { buildSectionMetadata } from "@/lib/osler/section-metadata";

export const metadata: Metadata = buildSectionMetadata({
  path: "/library",
  titleSuffix: "Clinical Library",
  description: "Clinical reference library covering diagnosis and management.",
  ogType: "library",
});

export default function LibraryLayout({ children }: { children: React.ReactNode }) {
  return children;
}
