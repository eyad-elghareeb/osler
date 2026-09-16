"use client";

import { AdminRouteGuard } from "@/components/osler/admin/admin-route-guard";
import { AssistantPanel } from "@/components/osler/admin/assistant";

export default function AdminAssistantPage() {
  return (
    <AdminRouteGuard>
      <AssistantPanel />
    </AdminRouteGuard>
  );
}
