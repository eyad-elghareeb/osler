"use client";

import * as React from "react";
import { CheckCircle2, XCircle, AlignLeft } from "lucide-react";
import { useI18n } from "@/components/osler/i18n-provider";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

// ── JSON code editor ───────────────────────────────────────────────────────
//
// A lightweight code-style textarea with inline JSON validation and one-click
// formatting. Avoids pulling in a heavyweight editor like Monaco — this is
// plenty for editing content JSON in the admin panel.

interface JsonCodeEditorProps {
  value: string;
  onChange: (next: string) => void;
  readOnly?: boolean;
  className?: string;
  placeholder?: string;
}

export function JsonCodeEditor({
  value,
  onChange,
  readOnly,
  className,
  placeholder = "{}",
}: JsonCodeEditorProps) {
  const { t } = useI18n();
  const [error, setError] = React.useState<string | null>(null);

  // Re-validate on every change. Cheap for typical content sizes.
  React.useEffect(() => {
    if (!value.trim()) {
      setError(null);
      return;
    }
    try {
      JSON.parse(value);
      setError(null);
    } catch (err) {
      setError(String(err).replace(/^SyntaxError:\s*/, ""));
    }
  }, [value]);

  function format() {
    try {
      const parsed = JSON.parse(value);
      onChange(JSON.stringify(parsed, null, 2));
    } catch (err) {
      // Surface the error in the status bar
      setError(String(err).replace(/^SyntaxError:\s*/, ""));
    }
  }

  const lines = value.split("\n").length;
  const chars = value.length;

  return (
    <div className={cn("flex h-full flex-col", className)}>
      {/* Toolbar */}
      <div className="shrink-0 flex items-center gap-2 px-3 py-1.5 border-b border-border/60 bg-muted/30">
        <AlignLeft className="size-3.5 text-muted-foreground" />
        <span className="text-[11px] text-muted-foreground font-mono">
          {lines} lines · {chars} chars
        </span>
        <div className="ml-auto flex items-center gap-2">
          {error ? (
            <span className="flex items-center gap-1 text-[11px] text-destructive">
              <XCircle className="size-3.5" />
              <span className="truncate max-w-xs">{error}</span>
            </span>
          ) : (
            <span className="flex items-center gap-1 text-[11px] text-success">
              <CheckCircle2 className="size-3.5" />
              {t("admin.content.editor.valid")}
            </span>
          )}
          {!readOnly && (
            <Button size="sm" variant="ghost" onClick={format} className="h-7 text-xs">
              {t("admin.content.editor.formatJson")}
            </Button>
          )}
        </div>
      </div>

      {/* Textarea */}
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        readOnly={readOnly}
        spellCheck={false}
        placeholder={placeholder}
        className={cn(
          "admin-code-textarea flex-1 w-full p-3 outline-none",
          error && "border-l-2 border-l-destructive",
        )}
      />
    </div>
  );
}
