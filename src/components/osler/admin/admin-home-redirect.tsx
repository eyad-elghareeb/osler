"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAdminIdentity } from "@/components/osler/admin/admin-context";
import { useAdminSettings } from "@/components/osler/admin/admin-settings-context";
import { LoadingState } from "@/components/osler/ui-primitives";

export function AdminHomeRedirect() {
  const router = useRouter();
  const identity = useAdminIdentity();
  const { settings } = useAdminSettings();

  useEffect(() => {
    const fallback =
      identity.user.role === "admin" ? "/admin/dashboard" : "/admin/content";
    const target = settings.defaultLanding ? `/admin/${settings.defaultLanding}` : fallback;
    router.replace(target);
  }, [identity, router, settings.defaultLanding]);

  return <LoadingState />;
}
