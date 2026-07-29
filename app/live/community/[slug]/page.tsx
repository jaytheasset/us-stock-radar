import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { CommunityRoomClient } from "@/components/live-room/CommunityRoomClient";
import {
  getCommunityRoom,
} from "@/lib/live-room/communityServerRepository";
import { getCommunityRoomSlugOrNull } from "@/lib/live-room/community";
import { getLiveRoomRealtimeConfig } from "@/lib/live-room/realtimeServerConfig";
import { LiveRoomPolicyError } from "@/lib/live-room/policy";

type CommunityRoomPageProps = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ message?: string | string[] }>;
};

export async function generateMetadata({
  params,
}: CommunityRoomPageProps): Promise<Metadata> {
  const { slug: rawSlug } = await params;
  const slug = getCommunityRoomSlugOrNull(rawSlug);
  if (!slug) {
    return {
      title: "Community Room unavailable | Stock Radar",
    };
  }
  try {
    const room = await getCommunityRoom(slug);
    return {
      alternates: { canonical: `/live/community/${room.slug}` },
      description: room.summary,
      title: `${room.name} Community Room | Stock Radar`,
    };
  } catch {
    return {
      title: "Community Room unavailable | Stock Radar",
    };
  }
}

export default async function CommunityRoomPage({
  params,
  searchParams,
}: CommunityRoomPageProps) {
  const { slug: rawSlug } = await params;
  const query = await searchParams;
  const slug = getCommunityRoomSlugOrNull(rawSlug);
  if (!slug) notFound();
  if (rawSlug !== slug) redirect(`/live/community/${slug}`);

  try {
    const room = await getCommunityRoom(slug);
    return (
      <CommunityRoomClient
        activityMessageId={
          typeof query.message === "string" ? query.message : null
        }
        realtimeConfig={getLiveRoomRealtimeConfig()}
        room={room}
      />
    );
  } catch (error) {
    if (
      error instanceof LiveRoomPolicyError &&
      error.status === 404
    ) {
      notFound();
    }
    throw error;
  }
}
