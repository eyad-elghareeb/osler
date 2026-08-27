import type { Metadata } from "next";
import { buildSectionMetadata } from "@/lib/osler/section-metadata";

export const metadata: Metadata = buildSectionMetadata({
  path: "/osce",
  titleSuffix: "OSCE Stations",
  description: "Simulated OSCE clinical stations with structured mark schemes.",
  ogType: "osce",
});

export default function OsceLayout({ children }: { children: React.ReactNode }) {
  return children;
}
