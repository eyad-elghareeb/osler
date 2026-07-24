"use client";

import { use } from "react";
import { useAdminIdentity } from "@/components/osler/admin/admin-context";
import { ContentEditor } from "@/components/osler/admin/content-editor";

export default function AdminContentEditorPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const identity = useAdminIdentity();

  return (
    <div className="h-full">
      <ContentEditor id={id} capabilities={identity.capabilities} />
    </div>
  );
}
