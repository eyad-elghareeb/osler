"use client";

import { createContext, useContext } from "react";
import type { AdminIdentity } from "@/components/osler/admin/admin-api";

const AdminContext = createContext<AdminIdentity | null>(null);

export function AdminProvider({
  identity,
  children,
}: {
  identity: AdminIdentity;
  children: React.ReactNode;
}) {
  return (
    <AdminContext.Provider value={identity}>{children}</AdminContext.Provider>
  );
}

export function useAdminIdentity(): AdminIdentity {
  const ctx = useContext(AdminContext);
  if (!ctx) {
    throw new Error("useAdminIdentity must be used within AdminShell");
  }
  return ctx;
}
