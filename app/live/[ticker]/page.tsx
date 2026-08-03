import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { LiveRoomClient } from "@/components/live-room/LiveRoomClient";
import {
  getLiveRoomHref,
  normalizeLiveRoomTicker,
} from "@/lib/live-room/adapters";
import { getLiveRoomRealtimeConfig } from "@/lib/live-room/realtimeServerConfig";
import { getLiveRoomAvailability } from "@/lib/live-room/roomAvailabilityServer";
import { getCurrentViewerPlan } from "@/lib/currentViewerPlan";
import { createCompanyLiveRoomEntryPath } from "@/lib/live-room/memberActions";

type LiveRoomPageProps = {
  params: Promise<{ ticker: string }>;
  searchParams: Promise<{
    event?: string | string[];
    message?: string | string[];
    src?: string | string[];
  }>;
};

export function generateMetadata({
  params,
}: LiveRoomPageProps): Promise<Metadata> {
  return params.then(({ ticker: routeTicker }) => {
    const ticker = normalizeLiveRoomTicker(routeTicker);
    return ticker
      ? {
          alternates: { canonical: getLiveRoomHref(ticker) ?? undefined },
          description: `Discuss the latest ${ticker} company news and filings in one company Live Room.`,
          title: `${ticker} Live Room`,
        }
      : {
          description: "Company Live Room unavailable.",
          title: "Live Room unavailable",
        };
  });
}

export default async function LiveRoomPage({
  params,
  searchParams,
}: LiveRoomPageProps) {
  const { ticker: routeTicker } = await params;
  const query = await searchParams;
  const ticker = normalizeLiveRoomTicker(routeTicker);

  if (!ticker) notFound();
  const loginReturnPath = createCompanyLiveRoomEntryPath({
    ticker,
    eventId: query.event,
    source: query.src,
  });
  if (routeTicker !== ticker) {
    redirect(loginReturnPath);
  }

  const [viewerPlan, roomAvailability] = await Promise.all([
    getCurrentViewerPlan(),
    getLiveRoomAvailability({ ticker }),
  ]);

  return (
    <LiveRoomClient
      activityMessageId={
        typeof query.message === "string" ? query.message : null
      }
      loginReturnPath={loginReturnPath}
      realtimeConfig={getLiveRoomRealtimeConfig()}
      roomAvailability={roomAvailability}
      ticker={ticker}
      viewerPlan={viewerPlan}
    />
  );
}
