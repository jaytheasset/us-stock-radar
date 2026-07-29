import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { BrokerageAccountClient } from "@/components/brokerage/BrokerageAccountClient";
import { StockRadarAppShell } from "@/components/shell/StockRadarAppShell";
import { getOptionalCurrentUserId } from "@/lib/currentUser";
import { getBrokerageConnectionStatus } from "@/lib/brokerage/serverRepository";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Brokerage verification | Stock Radar",
  robots: { follow: false, index: false },
};

export default async function BrokeragePage() {
  const userId = await getOptionalCurrentUserId();
  if (!userId) redirect("/login?next=%2Faccount%2Fbrokerage");
  const initialStatus = await getBrokerageConnectionStatus(userId);
  return (
    <StockRadarAppShell activeNavigationItem={null} themeMode="user-selectable">
      <BrokerageAccountClient initialStatus={initialStatus} />
    </StockRadarAppShell>
  );
}
