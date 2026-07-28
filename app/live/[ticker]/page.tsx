import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { LiveRoomClient } from "@/components/live-room/LiveRoomClient";
import {
  getLiveRoomHref,
  normalizeLiveRoomTicker,
} from "@/lib/live-room/adapters";
import { getLiveRoomRealtimeConfig } from "@/lib/live-room/realtimeServerConfig";
import { getCurrentViewerPlan } from "@/lib/currentViewerPlan";

type LiveRoomPageProps = {
  params: Promise<{ ticker: string }>;
  searchParams: Promise<{ message?: string | string[] }>;
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
          title: `${ticker} Live Room | Stock Radar`,
        }
      : {
          description: "Company Live Room unavailable.",
          title: "Live Room unavailable | Stock Radar",
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
  if (routeTicker !== ticker) {
    redirect(getLiveRoomHref(ticker) as string);
  }

  const viewerPlan = await getCurrentViewerPlan();

  return (
    <LiveRoomClient
      activityMessageId={
        typeof query.message === "string" ? query.message : null
      }
      realtimeConfig={getLiveRoomRealtimeConfig()}
      ticker={ticker}
      viewerPlan={viewerPlan}
    />
  );
}
