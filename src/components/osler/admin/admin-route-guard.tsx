"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { ShieldOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/components/osler/i18n-provider";
import { useAdminIdentity } from "@/components/osler/admin/admin-context";

interface AdminRouteGuardProps {
  /** When true, only users with role `admin` may view this page. */
  requireSuperAdmin?: boolean;
  children: React.ReactNode;
}

export function AdminRouteGuard({
  requireSuperAdmin = false,
  children,
}: AdminRouteGuardProps) {
  const { t } = useI18n();
  const router = useRouter();
  const identity = useAdminIdentity();
  const allowed = !requireSuperAdmin || identity.user.role === "admin";

  useEffect(() => {
    if (!allowed) router.replace("/admin/content");
  }, [allowed, router]);

  if (!allowed) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center">
        <div className="flex flex-col items-center gap-3">
          <div className="osler-empty__icon">
            <ShieldOff className="size-6" />
          </div>
          <h1 className="osler-empty__title">{t("admin.access.denied")}</h1>
          <p className="osler-empty__body">{t("admin.access.deniedDesc")}</p>
          <Button variant="outline" size="sm" onClick={() => router.push("/admin/content")}>
            {t("admin.nav.content")}
          </Button>
        </div>
      </div>
    );
  }

  return children;
}
