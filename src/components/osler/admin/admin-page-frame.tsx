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
    <div className="osler-page">
      <div className="osler-page__inner py-6 md:py-8">
        <PageHeader
          inline={!!inlineIcon}
          inlineIcon={inlineIcon}
          title={title}
          subtitle={subtitle}
        />
        {children}
      </div>
    </div>
  );
}
