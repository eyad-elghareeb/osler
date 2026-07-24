"use client";

import { useCallback, useEffect, useState } from "react";
import { ScrollText, ChevronLeft, ChevronRight } from "lucide-react";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useI18n } from "@/components/osler/i18n-provider";
import { cn } from "@/lib/utils";
import { adminApi, type AdminAuditEntry } from "@/components/osler/admin/admin-api";
import { LoadingState, EmptyState } from "@/components/osler/ui-primitives";
import { useToast } from "@/hooks/use-toast";

const ACTION_COLORS: Record<string, string> = {
  // User actions
  change_role:      "bg-primary/15 text-primary border-primary/30",
  delete_user:      "bg-destructive/15 text-destructive border-destructive/30",
  reset_password:   "bg-warning/15 text-warning border-warning/30",
  revoke_sessions:  "bg-warning/15 text-warning border-warning/30",
  // Content actions
  create_content:   "bg-muted text-muted-foreground border-border",
  submit_content:   "bg-warning/15 text-warning border-warning/30",
  approve:          "bg-success/15 text-success border-success/30",
  reject:           "bg-destructive/15 text-destructive border-destructive/30",
  publish_direct:   "bg-success/15 text-success border-success/30",
  unpublish:        "bg-muted text-muted-foreground border-border",
  delete_content:   "bg-destructive/15 text-destructive border-destructive/30",
};

const ACTION_FILTERS: { value: string; labelKey: string }[] = [
  { value: "all",              labelKey: "admin.audit.filter.all" },
  { value: "change_role",      labelKey: "admin.audit.filter.change_role" },
  { value: "delete_user",      labelKey: "admin.audit.filter.delete_user" },
  { value: "reset_password",   labelKey: "admin.audit.filter.reset_password" },
  { value: "revoke_sessions",  labelKey: "admin.audit.filter.revoke_sessions" },
  { value: "create_content",   labelKey: "admin.audit.filter.create_content" },
  { value: "submit_content",   labelKey: "admin.audit.filter.submit_content" },
  { value: "approve",          labelKey: "admin.audit.filter.approve" },
  { value: "reject",           labelKey: "admin.audit.filter.reject" },
  { value: "publish_direct",   labelKey: "admin.audit.filter.publish_direct" },
  { value: "unpublish",        labelKey: "admin.audit.filter.unpublish" },
  { value: "delete_content",   labelKey: "admin.audit.filter.delete_content" },
];

export function AuditLogTable() {
  const { t } = useI18n();
  const { toast } = useToast();
  const [entries, setEntries] = useState<AdminAuditEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [action, setAction] = useState<string>("all");
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    adminApi.auditLog(page, action === "all" ? undefined : action)
      .then((r) => { setEntries(r.items); setTotal(r.total); })
      .catch(() => toast({ title: "Failed to load audit log", variant: "destructive" }))
      .finally(() => setLoading(false));
  }, [page, action]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load(); }, [load]);

  const totalPages = Math.ceil(total / 50);

  return (
    <>
      {/* Filter bar */}
      <div className="mb-4 flex items-center gap-3">
        <div className="flex items-center gap-2">
          <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {t("admin.audit.filterBy")}
          </label>
          <Select value={action} onValueChange={(v) => { setAction(v); setPage(1); }}>
            <SelectTrigger id="audit-filter" className="w-56">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ACTION_FILTERS.map((f) => (
                <SelectItem key={f.value} value={f.value}>
                  {t(f.labelKey as any) ?? f.value}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <span className="text-sm text-muted-foreground">
          {t("admin.audit.total", { n: String(total) })}
        </span>
      </div>

      {/* Audit table */}
      {loading ? (
        <LoadingState label={t("common.loading")} />
      ) : entries.length === 0 ? (
        <EmptyState icon={ScrollText} title={t("common.none")} />
      ) : (
        <div className="rounded-xl border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40">
                <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {t("admin.audit.col.when")}
                </th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {t("admin.audit.col.actor")}
                </th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {t("admin.audit.col.action")}
                </th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {t("admin.audit.col.target")}
                </th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {t("admin.audit.col.detail")}
                </th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry, i) => (
                <motion.tr
                  key={entry.id}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: i * 0.015 }}
                  className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors"
                >
                  <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                    <div>{new Date(entry.createdAt).toLocaleString()}</div>
                  </td>
                  <td className="px-4 py-3">
                    {entry.actorDisplayName ? (
                      <div>
                        <div className="font-medium">{entry.actorDisplayName}</div>
                        {entry.actorUsername && (
                          <div className="text-xs text-muted-foreground">@{entry.actorUsername}</div>
                        )}
                      </div>
                    ) : (
                      <span className="text-muted-foreground italic">{t("admin.audit.unknownActor")}</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className={cn(
                      "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium font-mono",
                      ACTION_COLORS[entry.action] ?? "bg-muted text-muted-foreground border-border",
                    )}>
                      {entry.action}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground font-mono text-xs">
                    {entry.targetId ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {entry.detail ? (
                      <code className="block max-w-md overflow-x-auto rounded bg-muted/60 px-2 py-1 font-mono">
                        {JSON.stringify(entry.detail)}
                      </code>
                    ) : "—"}
                  </td>
                </motion.tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="mt-4 flex items-center justify-center gap-2">
          <Button variant="outline" size="iconSm" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}>
            <ChevronLeft className="size-4" />
          </Button>
          <span className="text-sm text-muted-foreground">
            {page} / {totalPages} ({total} {t("admin.audit.entries")})
          </span>
          <Button variant="outline" size="iconSm" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages}>
            <ChevronRight className="size-4" />
          </Button>
        </div>
      )}
    </>
  );
}
