"use client";

import * as React from "react";
import { AppShell } from "@/components/osler/app-shell";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
