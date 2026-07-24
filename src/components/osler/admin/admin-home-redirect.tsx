"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAdminIdentity } from "@/components/osler/admin/admin-context";
import { useAdminSettings } from "@/components/osler/admin/admin-settings-context";

export function AdminHomeRedirect() {
  const router = useRouter();
  const identity = useAdminIdentity();
  const { settings } = useAdminSettings();

  useEffect(() => {
    // Default landing page — admin users fall back to dashboard, content
    // admins to content, unless the user explicitly picked a different
    // landing page in Settings.
    const fallback =
      identity.user.role === "admin" ? "/admin/dashboard" : "/admin/content";
    const target = `/admin/${settings.defaultLanding}` || fallback;
    router.replace(target);
  }, [identity, router, settings.defaultLanding]);

  return (
    <div className="flex h-full items-center justify-center">
      <div className="size-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
    </div>
  );
}
