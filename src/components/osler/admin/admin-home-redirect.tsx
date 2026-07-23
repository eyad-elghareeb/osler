"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAdminIdentity } from "@/components/osler/admin/admin-context";

export function AdminHomeRedirect() {
  const router = useRouter();
  const identity = useAdminIdentity();

  useEffect(() => {
    const target =
      identity.user.role === "admin" ? "/admin/dashboard" : "/admin/content";
    router.replace(target);
  }, [identity, router]);

  return (
    <div className="flex h-full items-center justify-center">
      <div className="size-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
    </div>
  );
}
