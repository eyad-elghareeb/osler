import type { Metadata } from "next";
import { buildSectionMetadata } from "@/lib/osler/section-metadata";

export const metadata: Metadata = buildSectionMetadata({
  path: "/videos",
  titleSuffix: "Video Lessons",
  description: "Curated video lessons organised by clinical topic.",
  ogType: "video",
});

export default function VideosLayout({ children }: { children: React.ReactNode }) {
  return children;
}
