"use client";

import { ClipboardList } from "lucide-react";
import { useI18n } from "@/components/osler/i18n-provider";
import { AdminPageFrame } from "@/components/osler/admin/admin-page-frame";
import { AdminRouteGuard } from "@/components/osler/admin/admin-route-guard";
import { ReviewQueue } from "@/components/osler/admin/review-queue";

export default function AdminReviewPage() {
  const { t } = useI18n();

  return (
    <AdminRouteGuard requireSuperAdmin>
      <AdminPageFrame
        title={t("admin.review.title")}
        subtitle={t("admin.review.subtitle")}
        inlineIcon={ClipboardList}
      >
        <ReviewQueue />
      </AdminPageFrame>
    </AdminRouteGuard>
  );
}
