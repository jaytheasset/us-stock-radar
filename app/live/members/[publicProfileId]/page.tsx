import type { Metadata } from "next";
import { PublicMemberProfileClient } from "@/components/live-room/PublicMemberProfileClient";

export const metadata: Metadata = {
  description: "Public Live Room member posts.",
  title: "Live Room Member",
};

export default async function LiveRoomMemberPage({
  params,
  searchParams,
}: {
  params: Promise<{ publicProfileId: string }>;
  searchParams: Promise<{ edit?: string | string[] }>;
}) {
  const { publicProfileId } = await params;
  const query = await searchParams;
  return (
    <PublicMemberProfileClient
      editOnLoad={query.edit === "profile"}
      publicProfileId={publicProfileId}
    />
  );
}
