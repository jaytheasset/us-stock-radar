import { AdminTelegramCampaignEditor } from "@/components/admin/AdminTelegramCampaignEditor";
import { getServerEnv } from "@/lib/env";
import { requireAdminPermission } from "@/lib/admin/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function NewAdminTelegramCampaignPage() {
  await requireAdminPermission("telegram.write");
  return (
    <AdminTelegramCampaignEditor
      baseUrl={adminBaseUrl()}
      initialCampaign={null}
    />
  );
}

function adminBaseUrl() {
  const configured = getServerEnv().appBaseUrl.trim();
  return configured || "http://127.0.0.1:3110";
}
