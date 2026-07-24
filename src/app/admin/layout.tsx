import { headers } from "next/headers";
import { AdminShell } from "@/components/osler/admin/admin-shell";

export const metadata = {
  title: "Admin — Osler",
  robots: { index: false, follow: false },
};

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const headersList = await headers();
  const cfEmail =
    headersList.get("cf-access-authenticated-user-email") ??
    headersList.get("CF-Access-Authenticated-User-Email");

  return <AdminShell cfEmail={cfEmail}>{children}</AdminShell>;
}
