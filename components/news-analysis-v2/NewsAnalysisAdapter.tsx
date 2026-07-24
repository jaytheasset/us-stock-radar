import { PriceChartCard } from "@/app/events/[id]/PriceChartCard";
import { SectorThemeContextPanel } from "@/app/events/[id]/SectorThemeContextPanel";
import { GenericFilingAnalysis } from "@/components/filing-analysis-v2/GenericFilingAnalysis";
import { StockRadarAppShell } from "@/components/shell/StockRadarAppShell";
import type { BadgeTone } from "@/components/ui/Badge";
import { GooglePreferredSourceLink } from "@/components/ui/GooglePreferredSourceLink";
import { getServerEnv } from "@/lib/env";
import { getEventTypeBadge, type EventTypeBadgeTone } from "@/lib/eventTypeRegistry";
import { buildGooglePreferredSourceUrl } from "@/lib/googlePreferredSource";
import type { NewsAnalysisDetail } from "@/lib/newsAnalysisDetail";
import { OriginalNewsArticle } from "./OriginalNewsArticle";

export function NewsAnalysisAdapter({ detail, newsId }: { detail: NewsAnalysisDetail; newsId: string }) {
  const { filing } = detail;
  const analysisFiling = { ...filing, filingBrief: "" };
  const badge = detail.eventType ? getEventTypeBadge(detail.eventType) : null;
  const chartTone = filing.signal || toneFromStoredChange(detail.priceChange);
  const hasStoredChart = Boolean(filing.ticker && detail.priceSeries && Object.values(detail.priceSeries.periods).some((points) => points?.length));
  const preferredSourceUrl = buildGooglePreferredSourceUrl(getServerEnv().appBaseUrl);

  return (
    <StockRadarAppShell activeNavigationItem="news" themeMode="user-selectable">
      <GenericFilingAnalysis
        bookmarkRenderer={false}
        eventLabel={badge?.label || ""}
        eventTone={badge ? toBadgeTone(badge.tone) : "neutral"}
        filing={analysisFiling}
        filingId={newsId}
        originalBodyRenderer={detail.originalHtml ? <OriginalNewsArticle html={detail.originalHtml} /> : undefined}
        originalLinkLabel="View Original Article"
        originalSectionTitle="Original Article"
        priceRenderer={hasStoredChart ? (
          <PriceChartCard
            change={detail.priceChange}
            changeAmount={detail.priceChangeAmount}
            price={detail.price}
            series={detail.priceSeries}
            storedOnly
            ticker={filing.ticker}
            tone={chartTone}
          />
        ) : undefined}
        sourceFooterLabel="Source"
        summaryHeaderActionRenderer={
          preferredSourceUrl ? <GooglePreferredSourceLink href={preferredSourceUrl} summary /> : undefined
        }
        timestampLabel={detail.timestampLabel}
        contextRenderer={detail.marketContext ? <SectorThemeContextPanel context={detail.marketContext} storedOnly ticker={filing.ticker} /> : undefined}
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
