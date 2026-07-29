import { requireAdminPermission } from "@/lib/admin/server";

export default async function EventTypesAdminLayout({ children }: { children: React.ReactNode }) {
  await requireAdminPermission("data.read");
  return children;
}
