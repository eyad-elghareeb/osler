"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Settings, type SettingsSection } from "@/components/osler/settings";
import { LoadingState } from "@/components/osler/ui-primitives";
import { useI18n } from "@/components/osler/i18n-provider";

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
  "about",
  "danger",
]);

export default function SettingsSectionClient({ section }: { section: string }) {
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
