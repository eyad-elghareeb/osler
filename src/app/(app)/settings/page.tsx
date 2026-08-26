"use client";

import * as React from "react";
import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Settings, type SettingsSection } from "@/components/osler/settings";
import { LoadingState } from "@/components/osler/ui-primitives";
import { useI18n } from "@/components/osler/i18n-provider";

/**
 * Settings hub + sections, driven by `?section=<section>`.
 * Every section is statically generated, so no dynamic route / `_redirects`
 * fallback is needed. `useSearchParams` is wrapped in `<Suspense>` so the
 * page prerenders cleanly.
 */
const VALID_SECTIONS: ReadonlySet<string> = new Set([
  "account",
  "appearance",
  "language",
  "ai",
  "shortcuts",
  "downloads",
  "sync",
  "backup",
  "native",
  "support",
  "about",
  "danger",
]);

export default function SettingsPage() {
  return (
    <Suspense fallback={null}>
      <SettingsView />
    </Suspense>
  );
}

function SettingsView() {
  const params = useSearchParams();
  const section = params.get("section");
  if (!section) return <Settings initialSection="language" />;
  return <SettingsSectionView section={section} />;
}

function SettingsSectionView({ section }: { section: string }) {
  const router = useRouter();
  const { t } = useI18n();
  const [isValid, setIsValid] = React.useState<boolean>(() => VALID_SECTIONS.has(section));

  // Redirect invalid sections to /settings. Done in an effect (not during
  // render) to avoid the React warning "Cannot update a component while
  // rendering a different component" and to ensure the redirect actually
  // fires after the page has mounted.
  React.useEffect(() => {
    if (!VALID_SECTIONS.has(section)) {
      setIsValid(false);
      router.replace("/settings");
    } else {
      setIsValid(true);
    }
  }, [section, router]);

  if (!isValid) {
    return <LoadingState label={t("loading.redirecting")} />;
  }

  return <Settings initialSection={section as SettingsSection} />;
}
