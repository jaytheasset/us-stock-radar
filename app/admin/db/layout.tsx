import { requireAdminPermission } from "@/lib/admin/server";

export default async function DatabaseAdminLayout({ children }: { children: React.ReactNode }) {
  await requireAdminPermission("data.read");
  return children;
}
