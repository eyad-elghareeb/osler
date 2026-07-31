"use client";

import * as React from "react";
import { Profile } from "@/components/osler/profile";
import { useOslerSession } from "@/lib/osler/session-context";

export default function ProfilePage() {
  const { username } = useOslerSession();

  return <Profile username={username || "User"} />;
}
