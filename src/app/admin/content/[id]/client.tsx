"use client";

import { useAdminIdentity } from "@/components/osler/admin/admin-context";
import { ContentEditor } from "@/components/osler/admin/content-editor";

export default function AdminContentEditorClient({ id }: { id: string }) {
  const identity = useAdminIdentity();

  return (
    <div className="h-full">
      <ContentEditor id={id} capabilities={identity.capabilities} />
    </div>
  );
}
