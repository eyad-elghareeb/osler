"use client";

/**
 * PdfViewer — shared PDF surface for every article reader (library reader,
 * floating article modal). Desktop renders the browser's native PDF viewer
 * in an iframe; phones get an open/download CTA instead, since mobile
 * browsers don't render PDFs in iframes.
 */

import * as React from "react";
import { FileText, ExternalLink, Download } from "lucide-react";
import { useI18n } from "./i18n-provider";
import { useIsMobile } from "@/hooks/use-mobile";
import { haptic } from "@/lib/osler/native";

export function PdfViewer({ url, title }: { url: string; title: string }) {
  const { t } = useI18n();
  const isMobile = useIsMobile();

  if (isMobile) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center px-6 py-12 gap-6 bg-muted/20">
        <div className="w-20 h-20 rounded-2xl bg-warning-soft text-warning flex items-center justify-center">
          <FileText className="size-10" />
        </div>
        <div className="text-center max-w-xs">
          <h2 className="text-base font-semibold mb-1">{title}</h2>
          <p className="text-sm text-muted-foreground">{t("library.pdfOpenDesc")}</p>
        </div>
        <div className="flex flex-col gap-3 w-full max-w-xs">
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            className="flex items-center justify-center gap-2 h-11 rounded-xl bg-primary text-primary-foreground text-sm font-medium transition-colors hover:bg-primary/90"
            onClick={() => haptic("light")}
          >
            <ExternalLink className="size-4" />
            {t("library.pdfOpen")}
          </a>
          <a
            href={url}
            download
            className="flex items-center justify-center gap-2 h-11 rounded-xl bg-muted text-foreground text-sm font-medium transition-colors hover:bg-muted/70"
            onClick={() => haptic("light")}
          >
            <Download className="size-4" />
            {t("library.pdfDownload")}
          </a>
        </div>
      </div>
    );
  }

  // Desktop: native browser PDF rendering via iframe
  return (
    <div className="flex-1 flex flex-col">
      <div className="flex items-center justify-between px-6 py-2.5 border-b border-border bg-card/60 backdrop-blur-md shrink-0">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <FileText className="size-3.5 text-warning" />
          <span className="font-medium">{t("library.pdfViewer")}</span>
        </div>
        <div className="flex items-center gap-2">
          <a
            href={url}
            download
            className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors"
            title={t("library.pdfDownload")}
          >
            <Download className="size-3" />
            {t("library.pdfDownload")}
          </a>
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            className="text-xs text-primary hover:underline flex items-center gap-1 font-medium"
          >
            <ExternalLink className="size-3" />
            {t("library.pdfOpen")}
          </a>
        </div>
      </div>
      <iframe
        src={url}
        className="w-full flex-1 border-0 bg-background"
        title={title}
      />
    </div>
  );
}
