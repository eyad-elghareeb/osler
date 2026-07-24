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
        <div>
          <ShieldOff className="mx-auto mb-3 size-12 text-destructive" />
          <h1 className="mb-2 text-xl font-bold">{t("admin.access.denied")}</h1>
          <p className="mb-4 text-sm text-muted-foreground">{t("admin.access.deniedDesc")}</p>
          <Button variant="outline" size="sm" onClick={() => router.push("/admin/content")}>
            {t("admin.nav.content")}
          </Button>
        </div>
      </div>
    );
  }

  return children;
}
