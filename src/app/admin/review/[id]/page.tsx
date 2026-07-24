"use client";

import { use } from "react";
import { AdminRouteGuard } from "@/components/osler/admin/admin-route-guard";
import { ContentDiff } from "@/components/osler/admin/content-diff";

export default function AdminReviewDiffPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);

  return (
    <AdminRouteGuard requireSuperAdmin>
      <div className="h-full">
        <ContentDiff id={id} />
      </div>
    </AdminRouteGuard>
  );
}
