"use client";

import { AdminRouteGuard } from "@/components/osler/admin/admin-route-guard";
import { ContentDiff } from "@/components/osler/admin/content-diff";

export default function AdminReviewDiffClient({ id }: { id: string }) {
  return (
    <AdminRouteGuard requireSuperAdmin>
      <div className="h-full">
        <ContentDiff id={id} />
      </div>
    </AdminRouteGuard>
  );
}
