import { requireAdminPermission } from "@/lib/admin/server";

export default async function SourcesAdminLayout({ children }: { children: React.ReactNode }) {
  await requireAdminPermission("data.read");
  return children;
}
