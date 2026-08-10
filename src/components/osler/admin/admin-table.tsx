"use client";

import * as React from "react";
import { Search, ChevronLeft, ChevronRight, type LucideIcon } from "lucide-react";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useI18n } from "@/components/osler/i18n-provider";
import { EmptyState } from "@/components/osler/ui-primitives";

interface Column<T> {
  key: string;
  label: string;
  render: (item: T, index: number) => React.ReactNode;
  className?: string;
  hideOnMobile?: boolean;
}

interface AdminTableProps<T> {
  columns: Column<T>[];
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  loading?: boolean;
  search?: string;
  searchable?: boolean;
  placeholder?: string;
  emptyIcon?: LucideIcon;
  emptyTitle?: string;
  emptyDesc?: string;
  onSearch?: (q: string) => void;
  onPageChange?: (page: number) => void;
  rowKey: (item: T) => string;
  className?: string;
}

export function AdminTable<T>({
  columns,
  data,
  total,
  page,
  pageSize,
  loading,
  search,
  searchable = false,
  placeholder,
  emptyIcon,
  emptyTitle,
  emptyDesc,
  onSearch,
  onPageChange,
  rowKey,
  className,
}: AdminTableProps<T>) {
  const { t, rtl } = useI18n();
  const totalPages = Math.ceil(total / pageSize);

  return (
    <div className={className}>
      {searchable && (
        <div className="mb-4 flex items-center gap-3">
          <div className="relative flex-1 max-w-xs">
            <Search className="absolute start-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <Input
              placeholder={placeholder ?? t("admin.table.search")}
              value={search ?? ""}
              onChange={(e) => onSearch?.(e.target.value)}
              className="ps-9"
            />
          </div>
          <span className="text-sm text-muted-foreground whitespace-nowrap">
            {t("admin.table.total", { n: String(total) })}
          </span>
        </div>
      )}

      {loading ? (
        /* Shimmer row loading — mirrors the real table layout (header +
         * N rows × columns) so the transition to populated content is
         * seamless. 21st.dev-inspired skeleton pattern. */
        <div className="rounded-xl border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40">
                {columns.map((col) => (
                  <th
                    key={col.key}
                    className={cn(
                      "px-4 py-2.5 text-start text-xs font-semibold uppercase tracking-wider text-muted-foreground whitespace-nowrap",
                      col.hideOnMobile && "hidden sm:table-cell",
                      col.className,
                    )}
                  >
                    {col.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: 6 }).map((_, i) => (
                <tr key={i} className="border-b border-border last:border-0">
                  {columns.map((col, ci) => (
                    <td
                      key={ci}
                      className={cn(
                        "px-4 py-3",
                        col.hideOnMobile && "hidden sm:table-cell",
                      )}
                    >
                      <Skeleton className={cn("h-4", ci === 0 ? "w-32" : "w-20")} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : data.length === 0 ? (
        <EmptyState
          icon={emptyIcon ?? Search}
          title={emptyTitle ?? t("admin.table.empty")}
          description={emptyDesc}
        />
      ) : (
        <div className="rounded-xl border border-border overflow-hidden overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40">
                {columns.map((col) => (
                  <th
                    key={col.key}
                    className={cn(
                      "px-4 py-2.5 text-start text-xs font-semibold uppercase tracking-wider text-muted-foreground whitespace-nowrap",
                      col.hideOnMobile && "hidden sm:table-cell",
                      col.className,
                    )}
                  >
                    {col.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.map((item, i) => (
                <motion.tr
                  key={rowKey(item)}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: i * 0.025 }}
                  className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors"
                >
                  {columns.map((col) => (
                    <td
                      key={`${rowKey(item)}-${col.key}`}
                      className={cn(
                        "px-4 py-3",
                        col.hideOnMobile && "hidden sm:table-cell",
                        col.className,
                      )}
                    >
                      {col.render(item, i)}
                    </td>
                  ))}
                </motion.tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {totalPages > 1 && (
        <div className="mt-4 flex items-center justify-center gap-2">
          <Button
            variant="outline"
            size="iconSm"
            onClick={() => onPageChange?.(Math.max(1, page - 1))}
            disabled={page === 1}
          >
            <ChevronLeft className={cn("size-4", rtl && "rtl-flip-x")} />
          </Button>
          <span className="text-sm text-muted-foreground">
            {t("admin.table.page", { page: String(page), total: String(totalPages) })}
          </span>
          <Button
            variant="outline"
            size="iconSm"
            onClick={() => onPageChange?.(Math.min(totalPages, page + 1))}
            disabled={page === totalPages}
          >
            <ChevronRight className={cn("size-4", rtl && "rtl-flip-x")} />
          </Button>
        </div>
      )}
    </div>
  );
}
