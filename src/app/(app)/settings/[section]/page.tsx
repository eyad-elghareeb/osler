"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Settings, type SettingsSection } from "@/components/osler/settings";

const VALID_SECTIONS: Set<string> = new Set([
  "account",
  "appearance",
  "language",
  "ai",
  "shortcuts",
  "downloads",
  "sync",
  "backup",
  "native",
  "about",
  "danger",
]);

export default function SettingsSectionPage({ params }: { params: Promise<{ section: string }> }) {
  const { section: rawSection } = React.use(params);
  const section = decodeURIComponent(rawSection);
  const router = useRouter();

  if (!VALID_SECTIONS.has(section)) {
    router.replace("/settings");
    return null;
  }

  return <Settings initialSection={section as SettingsSection} />;
}
