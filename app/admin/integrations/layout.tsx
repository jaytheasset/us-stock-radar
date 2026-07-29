import { requireAdminPermission } from "@/lib/admin/server";

export default async function IntegrationsAdminLayout({ children }: { children: React.ReactNode }) {
  await requireAdminPermission("system.read");
  return children;
}
