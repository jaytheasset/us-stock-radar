import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { NewsAnalysisAdapter } from "@/components/news-analysis-v2/NewsAnalysisAdapter";
import { areAdsEnabledForPlan } from "@/lib/advertisingPolicy";
import { getCurrentViewerPlan } from "@/lib/currentViewerPlan";
import { getOptionalCurrentUserId } from "@/lib/currentUser";
import { getCanonicalAnalysisPath } from "@/lib/analysisRoutes";
import { buildAnalysisMetadata } from "@/lib/analysisSeo";
import { loadNewsAnalysisDetail } from "@/lib/newsAnalysisDetail";
import {
  getViewerContentState,
  savedContentKey,
} from "@/lib/saved/server";

type NewsDetailPageProps = {
  params: Promise<{ id: string }>;
};

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: NewsDetailPageProps): Promise<Metadata> {
  const { id } = await params;
  const detail = await loadNewsAnalysisDetail(id);
  if (!detail || detail.fixture) notFound();

  const canonicalPath = getCanonicalAnalysisPath({
    deliveryLevel: detail.filing.deliveryLevel,
    id,
    metadata: detail.seo.metadata,
    sourceGroup: "news",
  });
  if (!canonicalPath) notFound();

  return buildAnalysisMetadata(detail.seo, canonicalPath);
}

export default async function NewsDetailPage({ params }: NewsDetailPageProps) {
  const { id } = await params;
  const [detail, viewerPlan, userId] = await Promise.all([
    loadNewsAnalysisDetail(id),
    getCurrentViewerPlan(),
    getOptionalCurrentUserId(),
  ]);
  if (!detail || detail.fixture) notFound();

  const canonicalPath = getCanonicalAnalysisPath({
    deliveryLevel: detail.filing.deliveryLevel,
    id,
    metadata: detail.seo.metadata,
    sourceGroup: "news",
  });
  if (!canonicalPath) notFound();
  if (canonicalPath.startsWith("/news/archive/")) {
    permanentRedirect(canonicalPath);
  }

  const viewerState = await getViewerContentState({
    userId,
    references: [{ contentId: id, contentType: "news" }],
    tickers: [detail.filing.ticker],
  });

  return (
    <NewsAnalysisAdapter
      allowAds={areAdsEnabledForPlan(viewerPlan)}
      detail={detail}
      newsId={id}
      viewerState={{
        authenticated: viewerState.authenticated,
        saved: viewerState.savedKeys.has(savedContentKey("news", id)),
        watched: viewerState.watchedTickers.has(
          detail.filing.ticker.trim().toUpperCase(),
        ),
      }}
    />
  );
}
