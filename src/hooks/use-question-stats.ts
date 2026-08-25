"use client";

import * as React from "react";
import { getPackStats, type PackStats } from "@/lib/osler/question-stats";

/**
 * Fetch aggregated per-question choice stats for a set of pack uids
 * (usually the distinct sourceUids of the session's questions — one pack
 * in the common case). Returns uid → stats; packs with no data or a failed
 * request are simply absent. Results are cached inside question-stats.ts,
 * so remounts are free.
 */
export function useQuestionStats(uids: string[]): Record<string, PackStats> {
  const key = React.useMemo(() => [...new Set(uids)].sort().join("|"), [uids]);
  const [stats, setStats] = React.useState<Record<string, PackStats>>({});

  React.useEffect(() => {
    if (!key) {
      setStats({});
      return;
    }
    let cancelled = false;
    const list = key.split("|");
    void Promise.all(list.map((uid) => getPackStats(uid))).then((results) => {
      if (cancelled) return;
      const out: Record<string, PackStats> = {};
      list.forEach((uid, i) => {
        const s = results[i];
        if (s && Object.keys(s).length > 0) out[uid] = s;
      });
      setStats(out);
    });
    return () => { cancelled = true; };
  }, [key]);

  return stats;
}
