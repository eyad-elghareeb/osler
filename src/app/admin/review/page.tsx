"use client";

import * as React from "react";
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { ClipboardList } from "lucide-react";
import { useI18n } from "@/components/osler/i18n-provider";
import { AdminPageFrame } from "@/components/osler/admin/admin-page-frame";
import { AdminRouteGuard } from "@/components/osler/admin/admin-route-guard";
import { ReviewQueue } from "@/components/osler/admin/review-queue";
import { ContentDiff } from "@/components/osler/admin/content-diff";

/**
 * Admin review hub + diff viewer, driven by `?id=<content-uuid>`.
 * Static export friendly: no dynamic route, no `_redirects` fallback needed.
 * `useSearchParams` is wrapped in `<Suspense>` so the page prerenders cleanly.
 */
export default function AdminReviewPage() {
  return (
    <Suspense fallback={null}>
      <AdminReviewView />
    </Suspense>
  );
}

function AdminReviewView() {
  const { t } = useI18n();
  const params = useSearchParams();
  const id = params.get("id");

  if (id) {
    return (
      <AdminRouteGuard requireSuperAdmin>
        <div className="h-full">
          <ContentDiff id={id} />
        </div>
      </AdminRouteGuard>
    );
  }

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
