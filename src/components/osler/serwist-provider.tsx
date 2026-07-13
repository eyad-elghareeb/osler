"use client";

import { SerwistProvider as BaseSerwistProvider } from "@serwist/turbopack/react";

export function SerwistProvider({ children }: { children: React.ReactNode }) {
  return (
    <BaseSerwistProvider swUrl="/serwist/sw.js">{children}</BaseSerwistProvider>
  );
}
