import { notFound } from "next/navigation";
import { AdminTelegramCampaignEditor } from "@/components/admin/AdminTelegramCampaignEditor";
import { getAdminTelegramCampaign } from "@/lib/admin/telegramCampaigns";
import { requireAdminPermission } from "@/lib/admin/server";
import { getServerEnv } from "@/lib/env";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type Context = { params: Promise<{ campaignId: string }> };

export default async function AdminTelegramCampaignPage({ params }: Context) {
  await requireAdminPermission("telegram.read");
  const { campaignId } = await params;
  const campaign = await getAdminTelegramCampaign(campaignId);
  if (!campaign) notFound();

  return (
    <AdminTelegramCampaignEditor
      baseUrl={adminBaseUrl()}
      initialCampaign={campaign}
    />
  );
}

function adminBaseUrl() {
  const configured = getServerEnv().appBaseUrl.trim();
  return configured || "http://127.0.0.1:3110";
}
