import type {
  LiveFeedV2Kind,
  LiveFeedV2Preview,
  LiveFeedV2Sentiment,
} from "./liveFeedV2Contract.ts";

export type LiveFeedV2PreviewRelatedTicker = {
  companyName?: string | null;
  context?: string | null;
  ticker: string;
};

export type LiveFeedV2PreviewSource = {
  accessionNumber?: string | null;
  category: string;
  companyName?: string | null;
  detailHref: string;
  feedType: LiveFeedV2Kind;
  formType?: string | null;
  headline: string;
  id: string;
  impactScore: number;
  keyEvidence?: readonly string[];
  marketScopeLabel?: string | null;
  primaryTicker?: string | null;
  publishedAt: string;
  relatedTickers?: readonly LiveFeedV2PreviewRelatedTicker[];
  sentiment: LiveFeedV2Sentiment;
  source: string;
  sourceUrl?: string | null;
  summary?: string | null;
  themeLabel?: string | null;
  ticker: string;
};

export function createLiveFeedV2Preview(
  item: LiveFeedV2PreviewSource,
  relatedItems: readonly LiveFeedV2PreviewSource[] = [],
): LiveFeedV2Preview {
  const base = {
    detailHref: item.detailHref,
    id: item.id,
    impact: clampImpact(item.impactScore),
    publishedAt: item.publishedAt,
    signal: item.sentiment,
    source: availableText(item.source) || "—",
    sourceUrl: availableText(item.sourceUrl),
    title: availableText(item.headline) || "—",
  };
  const keyEvidence = compactTextList(item.keyEvidence);
  const companyName = availableText(item.companyName);
  const primaryTicker = normalizeTicker(item.primaryTicker);

  if (item.feedType === "filings") {
    return {
      ...base,
      accession: availableText(item.accessionNumber),
      company: companyName,
      events: compactTextList([item.category]),
      filingBrief: availableSummary(item.summary),
      formType: availableText(item.formType),
      keyPoints: keyEvidence,
      kind: "filing",
      relatedFilings: relatedItems
        .filter(
          (related) =>
            related.feedType === "filings" &&
            related.id !== item.id &&
            sameTicker(related.primaryTicker, item.primaryTicker),
        )
        .slice(0, 2)
        .map((related) => ({
          href: related.detailHref,
          label: availableText(related.formType) || "Filing",
          metadata: formatRelatedMetadata(related),
          title: availableText(related.headline) || "—",
        })),
      ticker: primaryTicker || normalizeTicker(item.ticker) || "N/A",
      watchlist: null,
    };
  }

  if (item.feedType === "market") {
    const theme =
      availableText(item.themeLabel) ||
      availableText(item.ticker) ||
      availableText(item.marketScopeLabel) ||
      "Market";

    return {
      ...base,
      company: companyName,
      coverage: availableText(item.marketScopeLabel) || "Market",
      drivers: keyEvidence,
      kind: "market-news",
      marketBrief: availableSummary(item.summary),
      relatedCompanies: (item.relatedTickers || [])
        .filter((related) => Boolean(normalizeTicker(related.ticker)))
        .slice(0, 3)
        .map((related) => ({
          company: availableText(related.companyName),
          context: availableText(related.context),
          ticker: normalizeTicker(related.ticker) || "N/A",
        })),
      theme,
      ticker: primaryTicker,
    };
  }

  return {
    ...base,
    brief: availableSummary(item.summary),
    category: availableText(item.category) || "News",
    company: companyName,
    coverage: "Company",
    keyPoints: keyEvidence,
    kind: "company-news",
    relatedNews: relatedItems
      .filter(
        (related) =>
          related.feedType === "news" &&
          related.id !== item.id &&
          sameTicker(related.primaryTicker, item.primaryTicker),
      )
      .slice(0, 2)
      .map((related) => ({
        href: related.detailHref,
        label: "News",
        metadata: formatRelatedMetadata(related),
        title: availableText(related.headline) || "—",
      })),
    ticker: primaryTicker || normalizeTicker(item.ticker) || "N/A",
    watchlist: null,
  };
}

function availableSummary(value: string | null | undefined) {
  const normalized = availableText(value);
  return normalized === "No summary available yet." ? null : normalized;
}

function availableText(value: string | null | undefined) {
  const normalized = value?.trim() || "";
  if (!normalized || /^(?:n\/a|unknown|unavailable|—|-{1,2})$/i.test(normalized)) {
    return null;
  }
  return normalized;
}

function clampImpact(value: number) {
  return Math.min(99, Math.max(0, Math.round(value)));
}

function compactTextList(values: readonly string[] | null | undefined) {
  return Array.from(
    new Set(
      (values || [])
        .map((value) => availableText(value))
        .filter((value): value is string => Boolean(value)),
    ),
  ).slice(0, 4);
}

function formatRelatedMetadata(item: LiveFeedV2PreviewSource) {
  return [normalizeTicker(item.primaryTicker), availableText(item.source)]
    .filter(Boolean)
    .join(" · ") || "—";
}

function normalizeTicker(value: string | null | undefined) {
  const normalized = value?.trim().toUpperCase() || "";
  return /^[A-Z][A-Z0-9.-]{0,14}$/.test(normalized) ? normalized : null;
}

function sameTicker(
  left: string | null | undefined,
  right: string | null | undefined,
) {
  const normalizedLeft = normalizeTicker(left);
  return Boolean(
    normalizedLeft &&
      normalizedLeft === normalizeTicker(right),
  );
}
