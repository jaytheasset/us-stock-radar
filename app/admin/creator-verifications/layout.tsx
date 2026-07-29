import { requireAdminPermission } from "@/lib/admin/server";

export default async function VerificationAdminLayout({ children }: { children: React.ReactNode }) {
  await requireAdminPermission("verifications.read");
  return children;
}
