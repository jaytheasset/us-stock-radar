import type { Metadata } from "next";
import { PublicMemberProfileClient } from "@/components/live-room/PublicMemberProfileClient";

export const metadata: Metadata = {
  description: "Public Live Room member posts.",
  title: "Live Room Member | Stock Radar",
};

export default async function LiveRoomMemberPage({
  params,
}: {
  params: Promise<{ publicProfileId: string }>;
}) {
  const { publicProfileId } = await params;
  return <PublicMemberProfileClient publicProfileId={publicProfileId} />;
}
