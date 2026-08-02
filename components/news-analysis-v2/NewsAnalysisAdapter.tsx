import { PriceChartCard } from "@/app/events/[id]/PriceChartCard";
import { SectorThemeContextPanel } from "@/app/events/[id]/SectorThemeContextPanel";
import { GenericFilingAnalysis } from "@/components/filing-analysis-v2/GenericFilingAnalysis";
import { StockRadarAppShell } from "@/components/shell/StockRadarAppShell";
import type { BadgeTone } from "@/components/ui/Badge";
import { GooglePreferredSourceLink } from "@/components/ui/GooglePreferredSourceLink";
import { getEventTypeBadge, type EventTypeBadgeTone } from "@/lib/eventTypeRegistry";
import { buildGooglePreferredSourceUrl } from "@/lib/googlePreferredSource";
import type { NewsAnalysisDetail } from "@/lib/newsAnalysisDetail";
import { isRealTicker } from "@/app/events/[id]/detailTypes";
import { OriginalNewsArticle } from "./OriginalNewsArticle";

type NewsAnalysisAdapterProps = {
  allowAds: boolean;
  detail: NewsAnalysisDetail;
  newsId: string;
  viewerState: {
    authenticated: boolean;
    saved: boolean;
    watched: boolean;
  };
};

export function NewsAnalysisAdapter({
  allowAds,
  detail,
  newsId,
  viewerState,
}: NewsAnalysisAdapterProps) {
  const { filing } = detail;
  const analysisFiling = { ...filing, filingBrief: "" };
  const badge = detail.eventType ? getEventTypeBadge(detail.eventType) : null;
  const chartTone = filing.signal || toneFromStoredChange(detail.priceChange);
  const hasRealTicker = isRealTicker(filing.ticker);
  const preferredSourceUrl = buildGooglePreferredSourceUrl();

  return (
    <StockRadarAppShell activeNavigationItem="news" themeMode="user-selectable">
      <GenericFilingAnalysis
        allowAds={allowAds}
        eventLabel={badge?.label || ""}
        eventTone={badge ? toBadgeTone(badge.tone) : "neutral"}
        filing={analysisFiling}
        filingId={newsId}
        initialAuthenticated={viewerState.authenticated}
        initialSaved={viewerState.saved}
        initialWatched={viewerState.watched}
        savedContentType="news"
        originalBodyRenderer={detail.originalHtml ? <OriginalNewsArticle html={detail.originalHtml} /> : undefined}
        originalLinkLabel="View Original Article"
        originalSectionTitle="Original Article"
        presentationVariant="news-document"
        priceRenderer={hasRealTicker ? (
          <PriceChartCard
            change={detail.priceChange}
            changeAmount={detail.priceChangeAmount}
            mobileCollapsible
            price={detail.price}
            series={detail.priceSeries}
            ticker={filing.ticker}
            tone={chartTone}
          />
        ) : undefined}
        sourceFooterLabel="Source"
        summaryHeaderActionRenderer={
          preferredSourceUrl ? <GooglePreferredSourceLink href={preferredSourceUrl} summary /> : undefined
        }
        timestampLabel={detail.timestampLabel}
        contextRenderer={detail.marketContext ? (
          <SectorThemeContextPanel context={detail.marketContext} ticker={filing.ticker} />
        ) : (
          <section className="stock-detail-card sector-theme-main-card">
            <div className="card-heading-row context-heading-row">
              <h2>Market Context</h2>
            </div>
            <p>Stored company and market context is unavailable for this event.</p>
          </section>
        )}
      />
    </StockRadarAppShell>
  );
}

function toBadgeTone(tone: EventTypeBadgeTone): BadgeTone {
  if (tone === "earnings") return "earnings";
  if (tone === "risk" || tone === "dilution") return "legal";
  if (tone === "deal") return "transaction";
  if (tone === "clinical" || tone === "market") return "product";
  if (tone === "regulatory") return "insider";
  return "neutral";
}

function toneFromStoredChange(change: string) {
  if (change.trim().startsWith("-")) return "bearish" as const;
  if (change.trim().startsWith("+")) return "bullish" as const;
  return "neutral" as const;
}
