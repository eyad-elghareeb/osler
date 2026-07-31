"use client";

import * as React from "react";
import Link from "next/link";
import { Activity, FileQuestion } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/osler/ui-primitives";
import { useI18n } from "@/components/osler/i18n-provider";

export default function NotFound() {
  const { t } = useI18n();

  return (
    <div className="osler-page min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-md text-center">
        <EmptyState
          icon={FileQuestion}
          title={t("notFound.title")}
          description={t("notFound.description")}
          actions={
            <Button asChild>
              <Link href="/">
                <Activity className="size-4 me-2" />
                {t("notFound.backHome")}
              </Link>
            </Button>
          }
        />
      </div>
    </div>
  );
}
