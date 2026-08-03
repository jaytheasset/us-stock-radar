import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { CommunityHubClient } from "@/components/community/CommunityHubClient";
import { StockRadarAppShell } from "@/components/shell/StockRadarAppShell";
import { getOptionalCurrentUserId } from "@/lib/currentUser";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Community",
  description:
    "Manage member messages, people, joined rooms, and Community activity.",
  robots: {
    index: false,
    follow: false,
  },
};

export default async function CommunityPage() {
  const userId = await getOptionalCurrentUserId();
  if (!userId) {
    redirect("/login?next=%2Fcommunity");
  }

  return (
    <StockRadarAppShell
      activeNavigationItem={null}
      themeMode="user-selectable"
    >
      <CommunityHubClient />
    </StockRadarAppShell>
  );
}
