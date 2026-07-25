import Link from "next/link";
import type { ReactNode } from "react";
import { ExternalLink, TrendingDown, TrendingUp } from "lucide-react";
import { MarketTickerLogo } from "@/components/market/MarketTickerLogo";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { isRealTicker, type DetailTone } from "@/app/events/[id]/detailTypes";
import { getEventTypeBadge, type EventTypeBadgeTone } from "@/lib/eventTypeRegistry";
import { shouldShowAnalysisSignalCompanionAd } from "@/lib/advertisingPolicy";
import { AnalysisSignalCompanionAd } from "./AnalysisSignalCompanionAd";
import { FilingBookmarkButton } from "./FilingBookmarkButton";
import { FilingInlineAdSlot } from "./FilingInlineAdSlot";
import { FilingRailAdSlot } from "./FilingRailAdSlot";
import { ScoreRationale } from "./ScoreRationale";
import styles from "./GenericFilingAnalysis.module.css";

type GenericFilingRecentItem = {
  id?: string;
  eventType: string;
  filedAt: string;
  form: string;
  score: number | null;
  title: string;
};

type GenericFilingRelatedNewsItem = {
  age: string;
  eventId?: string;
  eventType?: string;
  source: string;
  sourceUrl?: string;
  title: string;
};

export type GenericFilingAnalysisData = {
  bearishPoints: string[];
  bullishPoints: string[];
  company: string;
  deliveryLevel: "alert" | "archive" | "feed" | null;
  exchange: string;
  filedAt: string;
  filingBrief: string;
  formType: string;
  impact: "high" | "low" | "medium" | null;
  keyEvidence: string[];
  recentFilings: GenericFilingRecentItem[];
  relatedNews: GenericFilingRelatedNewsItem[];
  score: number | null;
  scoreRationale: string;
  signal: DetailTone | null;
  source: string;
  sourceUrl: string;
  summary: string;
  ticker: string;
  title: string;
  watchNext: string[];
  whyItMatters: string;
};

type GenericFilingAnalysisProps = {
  allowAds: boolean;
  bodyRenderer?: ReactNode;
  bookmarkRenderer?: ReactNode | false;
  briefLabel?: string;
  contextRenderer?: ReactNode;
  detailRenderer?: ReactNode;
  eventLabel: string;
  eventTone: BadgeTone;
  filingId: string;
  filing: GenericFilingAnalysisData;
  originalBodyRenderer?: ReactNode;
  originalLinkLabel?: string;
  originalRenderer?: ReactNode;
  originalSectionTitle?: string;
  priceRenderer?: ReactNode;
  sourceFooterActionRenderer?: ReactNode;
  sourceFooterLabel?: string;
  summaryHeaderActionRenderer?: ReactNode;
  summaryAsideRenderer?: ReactNode;
  timestampLabel?: string;
};

export function GenericFilingAnalysis({
  allowAds,
  bodyRenderer,
  bookmarkRenderer,
  briefLabel = "Filing Brief",
  contextRenderer,
  detailRenderer,
  eventLabel,
  eventTone,
  filingId,
  filing,
  originalBodyRenderer,
  originalLinkLabel = "View Original Filing",
  originalRenderer,
  originalSectionTitle,
  priceRenderer,
  sourceFooterActionRenderer,
  sourceFooterLabel = "Source",
  summaryHeaderActionRenderer,
  summaryAsideRenderer,
  timestampLabel = "Filed",
}: GenericFilingAnalysisProps) {
  const filingBrief = cleanText(filing.filingBrief);
  const whyItMatters = cleanText(filing.whyItMatters);
  const primaryAnalysis = whyItMatters || filingBrief;
  const primaryAnalysisLabel = whyItMatters ? "Why It Matters" : briefLabel;
  const summary = cleanText(filing.summary);
  const showSummary = Boolean(
    summary && normalizeCopy(summary) !== normalizeCopy(primaryAnalysis),
  );
  const hasDetailRenderer = Boolean(detailRenderer);
  const hasSummaryAsideRenderer = Boolean(summaryAsideRenderer);
  const showInlineSummary = showSummary && !hasDetailRenderer && !hasSummaryAsideRenderer;
  const bullishPoints = compactItems(filing.bullishPoints);
  const bearishPoints = compactItems(filing.bearishPoints);
  const keyEvidence = compactItems(filing.keyEvidence);
  const watchNext = compactItems(filing.watchNext);
  const recentFilings = filing.recentFilings.filter(hasRecentFilingContent);
  const relatedNews = filing.relatedNews.filter(hasRelatedNewsContent);
  const showSignalCompanionAd = shouldShowAnalysisSignalCompanionAd({
    adsAllowed: allowAds,
    bearishCount: bearishPoints.length,
    bullishCount: bullishPoints.length,
  });
  const source = cleanText(filing.source);
  const sourceUrl = cleanText(filing.sourceUrl);
  const hasOriginalFiling = Boolean(
    originalBodyRenderer || originalRenderer || source || sourceUrl,
  );
  const hasRelatedContent = Boolean(recentFilings.length || relatedNews.length);
  const showRail = hasRelatedContent || allowAds;
  const useNoChartDetailSplit = Boolean(
    !priceRenderer && hasDetailRenderer && (primaryAnalysis || showSummary),
  );
  const useNoChartAnalysisSplit = Boolean(
    !priceRenderer && !hasDetailRenderer && primaryAnalysis && showSummary,
  );
  const useSplitAnalysisLayout = Boolean(
    (priceRenderer && (primaryAnalysis || showSummary || hasDetailRenderer)) ||
      useNoChartDetailSplit ||
      useNoChartAnalysisSplit,
  );
  const hasTicker = isRealTicker(filing.ticker);
  const company = cleanText(filing.company);
  const exchange = cleanText(filing.exchange);
  const hasCompanyLine = Boolean(hasTicker || company || exchange);
  const score =
    typeof filing.score === "number" && Number.isFinite(filing.score)
      ? filing.score
      : null;
  const bookmark =
    bookmarkRenderer === false
      ? null
      : bookmarkRenderer === undefined
        ? <FilingBookmarkButton filingId={filingId} />
        : bookmarkRenderer;

  return (
    <div className={styles.page}>
      <div className={styles.workspace}>
        <div
          className={`${styles.layout}${
            showRail ? "" : ` ${styles.layoutWithoutRail}`
          }`}
        >
          <article className={styles.mainColumn}>
            <header className={styles.hero}>
              {cleanText(filing.filedAt) ? (
                <div className={styles.heroTimestamp}>
                  <span>{timestampLabel}</span>
                  <time>{filing.filedAt}</time>
                </div>
              ) : null}

              {bookmark ? <div className={styles.heroActions}>{bookmark}</div> : null}

              <div
                className={`${styles.heroIdentity}${
                  hasTicker ? "" : ` ${styles.heroIdentityWithoutTicker}`
                }`}
              >
                {hasTicker ? <MarketTickerLogo size="detail" ticker={filing.ticker} /> : null}
                <div className={styles.heroTitleGroup}>
                  {hasCompanyLine ? (
                    <div className={styles.companyLine}>
                      {hasTicker ? <strong>{filing.ticker}</strong> : null}
                      {company ? <span>{company}</span> : null}
                      {exchange ? <span>{exchange}</span> : null}
                    </div>
                  ) : null}
                  <h1>{filing.title}</h1>
                  <div className={styles.classification}>
                    {cleanText(filing.formType) ? (
                      <span className={styles.formLabel}>{filing.formType}</span>
                    ) : null}
                    {cleanText(eventLabel) ? (
                      <Badge size="small" tone={eventTone}>
                        {eventLabel}
                      </Badge>
                    ) : null}
                    {filing.signal ? (
                      <span className={`${styles.signal} ${styles[filing.signal]}`}>
                        {filing.signal}
                      </span>
                    ) : null}
                    {score !== null ? (
                      <span
                        aria-label={`Impact score ${score}`}
                        className={`${styles.impactScore}${
                          filing.impact ? ` ${styles[filing.impact]}` : ""
                        }`}
                      >
                        <span>Impact</span>
                        <strong>{score}</strong>
                      </span>
                    ) : null}
                  </div>
                </div>
              </div>
            </header>

            {priceRenderer || primaryAnalysis || showSummary || hasDetailRenderer ? (
              <div
                className={`${styles.chartSummaryGrid}${
                  useSplitAnalysisLayout ? ` ${styles.chartSummaryGridSplit}` : ""
                }`}
              >
                {useNoChartDetailSplit ? (
                  <div className={styles.detailColumn}>{detailRenderer}</div>
                ) : useNoChartAnalysisSplit ? (
                  <section className={`${styles.card} ${styles.analysisCopyCard}`}>
                    <SectionLabel>{primaryAnalysisLabel}</SectionLabel>
                    <p>{primaryAnalysis}</p>
                  </section>
                ) : priceRenderer ? (
                  <section
                    aria-label={`${filing.ticker} market reaction`}
                    className={styles.rendererCard}
                  >
                    {priceRenderer}
                  </section>
                ) : null}
                {primaryAnalysis || showSummary || hasDetailRenderer ? (
                  <div
                    className={`${styles.summaryStack}${
                      primaryAnalysis &&
                      !useNoChartAnalysisSplit &&
                      (showInlineSummary || hasDetailRenderer)
                        ? ` ${styles.summaryStackSplit}`
                        : ""
                    }`}
                  >
                    {primaryAnalysis && !useNoChartAnalysisSplit ? (
                      <section className={`${styles.card} ${styles.analysisCopyCard}`}>
                        <SectionLabel>{primaryAnalysisLabel}</SectionLabel>
                        <p>{primaryAnalysis}</p>
                      </section>
                    ) : null}
                    {useNoChartDetailSplit ? null : detailRenderer}
                    {showInlineSummary ||
                    (useNoChartDetailSplit && showSummary && !hasSummaryAsideRenderer) ? (
                      <section className={`${styles.card} ${styles.analysisCopyCard}`}>
                        <div className={styles.summaryHeader}>
                          <SectionLabel>Summary</SectionLabel>
                          {summaryHeaderActionRenderer}
                        </div>
                        <p>{summary}</p>
                      </section>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : null}

            {hasSummaryAsideRenderer ? (
              <div
                className={`${styles.summaryCompanionGrid}${
                  showSummary ? "" : ` ${styles.summaryCompanionGridSingle}`
                }`}
              >
                {showSummary ? (
                  <section className={`${styles.card} ${styles.analysisCopyCard}`}>
                    <div className={styles.summaryHeader}>
                      <SectionLabel>Summary</SectionLabel>
                      {summaryHeaderActionRenderer}
                    </div>
                    <p>{summary}</p>
                  </section>
                ) : null}
                <div className={styles.summaryCompanion}>{summaryAsideRenderer}</div>
              </div>
            ) : hasDetailRenderer && showSummary && !useNoChartDetailSplit ? (
              <section className={`${styles.card} ${styles.analysisCopyCard}`}>
                <div className={styles.summaryHeader}>
                  <SectionLabel>Summary</SectionLabel>
                  {summaryHeaderActionRenderer}
                </div>
                <p>{summary}</p>
              </section>
            ) : null}

            {filing.deliveryLevel && filing.impact && score !== null && filing.signal ? (
              <ScoreRationale
                deliveryLevel={filing.deliveryLevel}
                impact={filing.impact}
                rationale={filing.scoreRationale}
                score={score}
                signal={filing.signal}
              />
            ) : null}

            {bodyRenderer ? <div className={styles.specializedBody}>{bodyRenderer}</div> : null}

            {bullishPoints.length || bearishPoints.length ? (
              <div className={styles.caseGrid}>
                {bullishPoints.length ? (
                  <AnalysisList
                    items={bullishPoints}
                    title="Bullish"
                    tone="bullish"
                  />
                ) : null}
                {bearishPoints.length ? (
                  <AnalysisList
                    items={bearishPoints}
                    title="Bearish"
                    tone="bearish"
                  />
                ) : null}
                {showSignalCompanionAd ? <AnalysisSignalCompanionAd /> : null}
              </div>
            ) : null}

            {keyEvidence.length || watchNext.length ? (
              <div className={styles.analysisGrid}>
                {keyEvidence.length ? (
                  <TextList items={keyEvidence} title="Key Evidence" />
                ) : null}
                {watchNext.length ? (
                  <TextList items={watchNext} numbered title="What To Watch Next" />
                ) : null}
              </div>
            ) : null}

            {contextRenderer ? (
              <>
                {allowAds ? <FilingInlineAdSlot /> : null}
                <section
                  aria-label={`${filing.ticker || company || "Filing"} market context`}
                  className={styles.rendererCard}
                >
                  {contextRenderer}
                </section>
              </>
            ) : null}

          </article>

          {showRail ? (
            <aside
              aria-label="Related filing content"
              className={`${styles.rail}${
                hasRelatedContent ? "" : ` ${styles.railAdsOnly}`
              }`}
            >
              {recentFilings.length ? (
                <section className={styles.railCard}>
                  <div className={styles.railHeadingRow}>
                    <SectionLabel>Related Filings</SectionLabel>
                    <Link href="/filings">View all</Link>
                  </div>
                  <div className={styles.recentList}>
                    {recentFilings.slice(0, 4).map((item) => (
                      <Link
                        href={item.id ? `/filings/${item.id}` : "/filings"}
                        key={`${item.id || item.form}-${item.title}`}
                      >
                        {cleanText(item.form) ? (
                          <span className={styles.formLabel}>{item.form}</span>
                        ) : null}
                        <div>
                          <strong>{item.title}</strong>
                          <span>
                            {[item.eventType, item.filedAt].filter(Boolean).join(" \u00b7 ")}
                          </span>
                        </div>
                        {item.score !== null ? <b>{item.score}</b> : null}
                      </Link>
                    ))}
                  </div>
                </section>
              ) : null}

              {allowAds ? <FilingRailAdSlot format="rectangle" /> : null}

              {relatedNews.length ? (
                <section className={styles.railCard}>
                  <div className={styles.railHeadingRow}>
                    <SectionLabel>Related News</SectionLabel>
                    <Link href="/news">View all</Link>
                  </div>
                  <div className={styles.newsList}>
                    {relatedNews.slice(0, 4).map((story) => (
                      <RelatedNewsItem
                        key={`${story.eventId || story.sourceUrl || story.source}-${story.title}`}
                        story={story}
                      />
                    ))}
                  </div>
                </section>
              ) : null}

              {allowAds ? <FilingRailAdSlot format="skyscraper" /> : null}
            </aside>
          ) : null}

          {hasOriginalFiling ? (
            <div
              className={`${styles.originalColumn}${
                hasRelatedContent ? "" : ` ${styles.originalColumnWithoutRelatedContent}`
              }`}
            >
              {allowAds ? (
                <div className={styles.collapsedRailOnlyAd}>
                  <FilingInlineAdSlot />
                </div>
              ) : null}
              <section
                aria-label={originalSectionTitle || "Original filing"}
                className={`${styles.rendererCard} ${styles.originalRendererCard}`}
              >
                {originalBodyRenderer ? (
                  <section className="stock-detail-card full-text-card filing-original-card">
                    {originalSectionTitle ? (
                      <div className="card-heading-row">
                        <div>
                          <h2>{originalSectionTitle}</h2>
                        </div>
                      </div>
                    ) : null}
                    {originalBodyRenderer}
                  </section>
                ) : null}
                {originalRenderer}
                {source || sourceUrl || sourceFooterActionRenderer ? (
                  <footer
                    className={`${styles.originalSourceFooter}${
                      originalRenderer ? "" : ` ${styles.originalSourceFooterOnly}`
                    }`}
                  >
                    {source ? (
                      <div className={styles.originalSourceIdentity}>
                        <span>{sourceFooterLabel}</span>
                        <strong>{source}</strong>
                      </div>
                    ) : null}
                    {sourceUrl || sourceFooterActionRenderer ? (
                      <div className={styles.originalSourceActions}>
                        {sourceFooterActionRenderer}
                        {sourceUrl ? (
                          <a
                            className={styles.originalSourceLink}
                            href={sourceUrl}
                            rel="noreferrer"
                            target="_blank"
                          >
                            <span>{originalLinkLabel}</span>
                            <ExternalLink aria-hidden="true" size={15} />
                          </a>
                        ) : null}
                      </div>
                    ) : null}
                  </footer>
                ) : null}
              </section>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function RelatedNewsItem({ story }: { story: GenericFilingRelatedNewsItem }) {
  const eventId = cleanText(story.eventId);
  const eventType = cleanText(story.eventType);
  const eventBadge = eventType ? getEventTypeBadge(eventType) : null;
  const sourceUrl = cleanText(story.sourceUrl);
  const content = (
    <>
      <div className={styles.newsTitleRow}>
        {eventBadge ? (
          <Badge size="micro" tone={toNewsBadgeTone(eventBadge.tone)}>
            {eventBadge.label}
          </Badge>
        ) : null}
        <strong>{story.title}</strong>
      </div>
      {[story.source, story.age].filter(Boolean).length ? (
        <span>{[story.source, story.age].filter(Boolean).join(" \u00b7 ")}</span>
      ) : null}
    </>
  );

  if (eventId) {
    return (
      <Link className={styles.newsListItem} href={`/events/${encodeURIComponent(eventId)}`}>
        {content}
      </Link>
    );
  }

  if (sourceUrl) {
    return (
      <a
        className={styles.newsListItem}
        href={sourceUrl}
        rel="noreferrer"
        target="_blank"
      >
        {content}
      </a>
    );
  }

  return <div className={styles.newsListItem}>{content}</div>;
}

function toNewsBadgeTone(tone: EventTypeBadgeTone): BadgeTone {
  if (tone === "earnings") return "earnings";
  if (tone === "risk" || tone === "dilution") return "legal";
  if (tone === "deal") return "transaction";
  if (tone === "clinical" || tone === "market") return "product";
  if (tone === "regulatory") return "insider";
  return "neutral";
}

function AnalysisList({
  items,
  title,
  tone,
}: {
  items: string[];
  title: string;
  tone: "bearish" | "bullish";
}) {
  const Icon = tone === "bullish" ? TrendingUp : TrendingDown;

  return (
    <section className={`${styles.card} ${styles.caseCard} ${styles[tone]}`}>
      <h2>
        <Icon aria-hidden="true" size={18} strokeWidth={2.2} />
        <span>{title}</span>
      </h2>
      <ul>
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </section>
  );
}

function TextList({
  items,
  numbered = false,
  title,
}: {
  items: string[];
  numbered?: boolean;
  title: string;
}) {
  const List = numbered ? "ol" : "ul";

  return (
    <section className={`${styles.card} ${styles.analysisCopyCard}`}>
      <SectionLabel>{title}</SectionLabel>
      <List className={numbered ? styles.numberedList : styles.textList}>
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </List>
    </section>
  );
}

function SectionLabel({ children }: { children: ReactNode }) {
  return <h2 className={styles.sectionLabel}>{children}</h2>;
}

function cleanText(value: string | null | undefined) {
  return typeof value === "string" ? value.trim() : "";
}

function compactItems(items: string[]) {
  return items.map(cleanText).filter(Boolean);
}

function normalizeCopy(value: string) {
  return cleanText(value).replace(/\s+/g, " ").toLowerCase();
}

function hasRecentFilingContent(item: GenericFilingRecentItem) {
  return Boolean(cleanText(item.title) || cleanText(item.form));
}

function hasRelatedNewsContent(item: GenericFilingRelatedNewsItem) {
  return Boolean(cleanText(item.title));
}
