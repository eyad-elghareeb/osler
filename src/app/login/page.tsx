"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { LoginScreen } from "@/components/osler/login-screen";
import { useOslerSession } from "@/lib/osler/session-context";

function LoginContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { login, username } = useOslerSession();

  const next = searchParams.get("next") || "/";

  React.useEffect(() => {
    if (username) {
      router.replace(next);
    }
  }, [username, router, next]);

  const handleLogin = (name: string) => {
    login(name);
    router.push(next);
  };

  return <LoginScreen onLogin={handleLogin} />;
}

export default function LoginPage() {
  return (
    <React.Suspense fallback={null}>
      <LoginContent />
    </React.Suspense>
  );
}
