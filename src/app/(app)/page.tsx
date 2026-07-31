"use client";

import * as React from "react";
import { Dashboard } from "@/components/osler/dashboard";
import { useOslerSession } from "@/lib/osler/session-context";

export default function DashboardPage() {
  const { username } = useOslerSession();

  return <Dashboard username={username || "User"} />;
}
