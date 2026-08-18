"use client";

import { useCallback, useEffect, useState } from "react";
import { ScrollText } from "lucide-react";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useI18n } from "@/components/osler/i18n-provider";
import { cn } from "@/lib/utils";
import { adminApi, type AdminAuditEntry } from "@/components/osler/admin/admin-api";
import { AdminTable } from "@/components/osler/admin/admin-table";
import { useToast } from "@/hooks/use-toast";

const ACTION_COLORS: Record<string, string> = {
  change_role:      "bg-primary/15 text-primary border-primary/30",
  delete_user:      "bg-destructive/15 text-destructive border-destructive/30",
  reset_password:   "bg-warning/15 text-warning border-warning/30",
  revoke_sessions:  "bg-warning/15 text-warning border-warning/30",
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
      .catch(() => toast({ title: t("admin.toast.failedLoadAuditLog"), variant: "destructive" }))
      .finally(() => setLoading(false));
  }, [page, action]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Select value={action} onValueChange={(v) => { setAction(v); setPage(1); }}>
          <SelectTrigger id="audit-filter" className="w-full sm:w-56">
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
        <span className="text-sm text-muted-foreground whitespace-nowrap">
          {t("admin.audit.total", { n: String(total) })}
        </span>
      </div>

      <AdminTable
        columns={[
          {
            key: "when",
            label: t("admin.audit.col.when"),
            render: (entry) => (
              <span className="text-muted-foreground whitespace-nowrap text-xs">
                {new Date(entry.createdAt).toLocaleString()}
              </span>
            ),
          },
          {
            key: "actor",
            label: t("admin.audit.col.actor"),
            render: (entry) =>
              entry.actorDisplayName ? (
                <div>
                  <div className="font-medium text-sm">{entry.actorDisplayName}</div>
                  {entry.actorUsername && (
                    <div className="text-xs text-muted-foreground">@{entry.actorUsername}</div>
                  )}
                </div>
              ) : (
                <span className="text-muted-foreground italic text-sm">{t("admin.audit.unknownActor")}</span>
              ),
          },
          {
            key: "action",
            label: t("admin.audit.col.action"),
            render: (entry) => (
              <span className={cn(
                "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium font-mono",
                ACTION_COLORS[entry.action] ?? "bg-muted text-muted-foreground border-border",
              )}>
                {entry.action}
              </span>
            ),
          },
          {
            key: "target",
            label: t("admin.audit.col.target"),
            hideOnMobile: true,
            render: (entry) => (
              <span className="text-muted-foreground font-mono text-xs">{entry.targetId ?? "—"}</span>
            ),
          },
          {
            key: "detail",
            label: t("admin.audit.col.detail"),
            hideOnMobile: true,
            render: (entry) =>
              entry.detail ? (
                <code className="block max-w-[12rem] overflow-x-auto rounded bg-muted/60 px-2 py-1 font-mono text-xs">
                  {JSON.stringify(entry.detail)}
                </code>
              ) : (
                <span className="text-muted-foreground">—</span>
              ),
          },
        ]}
        data={entries}
        total={total}
        page={page}
        pageSize={50}
        loading={loading}
        emptyIcon={ScrollText}
        onPageChange={setPage}
        rowKey={(e) => e.id}
      />
    </div>
  );
}
