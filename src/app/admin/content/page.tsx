"use client";

import * as React from "react";
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { useI18n } from "@/components/osler/i18n-provider";
import { useAdminIdentity } from "@/components/osler/admin/admin-context";
import { ContentEditor } from "@/components/osler/admin/content-editor";
import { ContentStudio } from "@/components/osler/admin/content-studio/content-studio";

/**
 * Admin content hub + editor, driven by `?id=<content-uuid>` or
 * `?key=<r2-key>`.
 *
 * Static export friendly: no dynamic route, no `_redirects` fallback needed.
 * `useSearchParams` is wrapped in `<Suspense>` so the page prerenders
 * cleanly.
 *
 * The hub now renders the new Content Studio — a file-explorer-style
 * workspace that fills the full admin content area. When `?id=` is set,
 * the in-place content editor takes over instead.
 */
export default function AdminContentPage() {
  return (
    <Suspense fallback={null}>
      <AdminContentView />
    </Suspense>
  );
}

function AdminContentView() {
  const identity = useAdminIdentity();
  const params = useSearchParams();
  const id = params.get("id");

  if (id) {
    return (
      <div className="h-full">
        <ContentEditor id={id} capabilities={identity.capabilities} />
      </div>
    );
  }

  // The studio has its own header + three-column layout — bypass the
  // AdminPageFrame so it can use the full window area.
  return (
    <div className="h-full min-h-0">
      <ContentStudio capabilities={identity.capabilities} />
    </div>
  );
}
