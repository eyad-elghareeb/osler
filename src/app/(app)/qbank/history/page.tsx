"use client";

import * as React from "react";
import { SessionHistoryView } from "@/components/osler/session-history";

/**
 * /qbank/history — full-page version of the QBank Tracker tab's "Recent
 * sessions" section. Lists every saved session grouped by source file in
 * the same TrackerTree the wrong & flagged browser uses, with per-pack
 * sheets exposing Review / Retake / PDF / Delete actions.
 *
 * Static-export friendly: no dynamic route, no server data — every session
 * is loaded from IndexedDB via the storage module.
 */
export default function QBankHistoryPage() {
  return <SessionHistoryView />;
}
