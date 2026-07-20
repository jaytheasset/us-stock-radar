import Link from "next/link";
import type { ReactNode } from "react";
import { ExternalLink, TrendingDown, TrendingUp } from "lucide-react";
import { MarketTickerLogo } from "@/components/market/MarketTickerLogo";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { isRealTicker, type DetailTone } from "@/app/events/[id]/detailTypes";
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
  score: number;
  title: string;
};

type GenericFilingRelatedNewsItem = {
  age: string;
  eventId?: string;
  source: string;
  sourceUrl?: string;
  title: string;
};

export type GenericFilingAnalysisData = {
  bearishPoints: string[];
  bullishPoints: string[];
  company: string;
  deliveryLevel: "alert" | "archive" | "feed";
  exchange: string;
  filedAt: string;
  filingBrief: string;
  formType: string;
  impact: "high" | "low" | "medium";
  keyEvidence: string[];
  recentFilings: GenericFilingRecentItem[];
  relatedNews: GenericFilingRelatedNewsItem[];
  score: number;
  scoreRationale: string;
  signal: DetailTone;
  source: string;
  sourceUrl: string;
  summary: string;
  ticker: string;
  title: string;
  watchNext: string[];
  whyItMatters: string;
};

type GenericFilingAnalysisProps = {
  contextRenderer?: ReactNode;
  detailRenderer?: ReactNode;
  eventLabel: string;
  eventTone: BadgeTone;
  filingId: string;
  filing: GenericFilingAnalysisData;
  originalRenderer?: ReactNode;
  priceRenderer?: ReactNode;
};

export function GenericFilingAnalysis({
  contextRenderer,
  detailRenderer,
  eventLabel,
  eventTone,
  filingId,
  filing,
  originalRenderer,
  priceRenderer,
}: GenericFilingAnalysisProps) {
  const filingBrief = cleanText(filing.filingBrief);
  const whyItMatters = cleanText(filing.whyItMatters);
  const primaryAnalysis = whyItMatters || filingBrief;
  const primaryAnalysisLabel = whyItMatters ? "Why It Matters" : "Filing Brief";
  const summary = cleanText(filing.summary);
  const showSummary = Boolean(
    summary && normalizeCopy(summary) !== normalizeCopy(primaryAnalysis),
  );
  const hasDetailRenderer = Boolean(detailRenderer);
  const showInlineSummary = showSummary && !hasDetailRenderer;
  const bullishPoints = compactItems(filing.bullishPoints);
  const bearishPoints = compactItems(filing.bearishPoints);
  const keyEvidence = compactItems(filing.keyEvidence);
  const watchNext = compactItems(filing.watchNext);
  const recentFilings = filing.recentFilings.filter(hasRecentFilingContent);
  const relatedNews = filing.relatedNews.filter(hasRelatedNewsContent);
  const source = cleanText(filing.source);
  const sourceUrl = cleanText(filing.sourceUrl);
  const hasOriginalFiling = Boolean(originalRenderer || source || sourceUrl);
  const hasRelatedContent = Boolean(recentFilings.length || relatedNews.length);
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

  return (
    <div className={styles.page}>
      <div className={styles.workspace}>
        <div className={styles.layout}>
          <article className={styles.mainColumn}>
            <header className={styles.hero}>
              {cleanText(filing.filedAt) ? (
                <div className={styles.heroTimestamp}>
                  <span>Filed</span>
                  <time>{filing.filedAt}</time>
                </div>
              ) : null}

              <div className={styles.heroActions}>
                <FilingBookmarkButton filingId={filingId} />
              </div>

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
                    <span className={`${styles.signal} ${styles[filing.signal]}`}>
                      {filing.signal}
                    </span>
                    <span
                      aria-label={`Impact score ${filing.score}`}
                      className={`${styles.impactScore} ${styles[filing.impact]}`}
                    >
                      <span>Impact</span>
                      <strong>{filing.score}</strong>
                    </span>
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
                    {showInlineSummary || (useNoChartDetailSplit && showSummary) ? (
                      <section className={`${styles.card} ${styles.analysisCopyCard}`}>
                        <SectionLabel>Summary</SectionLabel>
                        <p>{summary}</p>
                      </section>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : null}

            {hasDetailRenderer && showSummary && !useNoChartDetailSplit ? (
              <section className={`${styles.card} ${styles.analysisCopyCard}`}>
                <SectionLabel>Summary</SectionLabel>
                <p>{summary}</p>
              </section>
            ) : null}

            <ScoreRationale
              deliveryLevel={filing.deliveryLevel}
              impact={filing.impact}
              rationale={filing.scoreRationale}
              score={filing.score}
              signal={filing.signal}
            />

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
                <FilingInlineAdSlot />
                <section
                  aria-label={`${filing.ticker || company || "Filing"} market context`}
                  className={styles.rendererCard}
                >
                  {contextRenderer}
                </section>
              </>
            ) : null}

          </article>

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
                        <b>{item.score}</b>
                      </Link>
                    ))}
                  </div>
                </section>
              ) : null}

              <FilingRailAdSlot format="rectangle" />

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

              <FilingRailAdSlot format="skyscraper" />
          </aside>

          {hasOriginalFiling ? (
            <div
              className={`${styles.originalColumn}${
                hasRelatedContent ? "" : ` ${styles.originalColumnWithoutRelatedContent}`
              }`}
            >
              <div className={styles.collapsedRailOnlyAd}>
                <FilingInlineAdSlot />
              </div>
              <section
                aria-label="Original filing"
                className={`${styles.rendererCard} ${styles.originalRendererCard}`}
              >
                {originalRenderer}
                {source || sourceUrl ? (
                  <footer
                    className={`${styles.originalSourceFooter}${
                      originalRenderer ? "" : ` ${styles.originalSourceFooterOnly}`
                    }`}
                  >
                    {source ? (
                      <div className={styles.originalSourceIdentity}>
                        <span>Source</span>
                        <strong>{source}</strong>
                      </div>
                    ) : null}
                    {sourceUrl ? (
                      <a
                        className={styles.originalSourceLink}
                        href={sourceUrl}
                        rel="noreferrer"
                        target="_blank"
                      >
                        <span>View Original Filing</span>
                        <ExternalLink aria-hidden="true" size={15} />
                      </a>
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
  const sourceUrl = cleanText(story.sourceUrl);
  const content = (
    <>
      <strong>{story.title}</strong>
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
