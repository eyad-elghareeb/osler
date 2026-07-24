"use client";

import type { LucideIcon } from "lucide-react";
import { PageHeader } from "@/components/osler/ui-primitives";

interface AdminPageFrameProps {
  title: string;
  subtitle?: string;
  inlineIcon?: LucideIcon;
  children: React.ReactNode;
}

export function AdminPageFrame({
  title,
  subtitle,
  inlineIcon,
  children,
}: AdminPageFrameProps) {
  return (
    <div className="px-4 md:px-6 lg:px-8 py-6 md:py-8 max-w-6xl">
      <PageHeader
        inline={!!inlineIcon}
        inlineIcon={inlineIcon}
        title={title}
        subtitle={subtitle}
      />
      {children}
    </div>
  );
}
