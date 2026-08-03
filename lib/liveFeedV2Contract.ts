export const liveFeedV2BatchSize = 25;

export const liveFeedV2Filters = [
  { label: "All", value: "all" },
  { label: "News", value: "news" },
  { label: "Filings", value: "filings" },
  { label: "Market", value: "market" },
  { label: "Alerts", value: "alerts" },
  { label: "Watchlist", value: "watchlist" },
] as const;

export type LiveFeedV2Filter = (typeof liveFeedV2Filters)[number]["value"];
export type LiveFeedV2Kind = "news" | "filings" | "market";
export type LiveFeedV2Sentiment =
  | "Bearish"
  | "Bullish"
  | "Neutral"
  | "Volatile";

export type LiveFeedV2RailDestination = "events" | "filings" | "news";

const liveFeedV2EventUuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function createLiveFeedV2RailEventIdentity({
  destination,
  eventId,
  fallbackId,
}: {
  destination: LiveFeedV2RailDestination;
  eventId?: string | null;
  fallbackId: string;
}) {
  const eventIdCandidate = eventId?.trim() || "";
  const persistentEventId = liveFeedV2EventUuidPattern.test(eventIdCandidate)
    ? eventIdCandidate.toLowerCase()
    : null;

  return {
    detailHref: persistentEventId
      ? `/${destination}/${encodeURIComponent(persistentEventId)}`
      : null,
    id: persistentEventId || fallbackId,
  };
}

export type LiveFeedV2RelatedItem = {
  href: string;
  label: string;
  metadata: string;
  title: string;
};

export type LiveFeedV2RelatedCompany = {
  company: string | null;
  context: string | null;
  ticker: string;
};

type LiveFeedV2PreviewBase = {
  detailHref: string;
  id: string;
  impact: number;
  publishedAt: string;
  signal: LiveFeedV2Sentiment;
  source: string;
  sourceUrl: string | null;
  title: string;
};

export type LiveFeedV2FilingPreview = LiveFeedV2PreviewBase & {
  authenticated: boolean;
  accession: string | null;
  company: string | null;
  events: readonly string[];
  filingBrief: string | null;
  formType: string | null;
  keyPoints: readonly string[];
  keyPointsLabel:
    | "Capital Snapshot"
    | "Key Business Updates"
    | "Key Changes"
    | "Key Points";
  kind: "filing";
  relatedFilings: readonly LiveFeedV2RelatedItem[];
  saved: boolean;
  showKeyPoints: boolean;
  ticker: string;
  watchlist: boolean;
};

export type LiveFeedV2CompanyNewsPreview = LiveFeedV2PreviewBase & {
  authenticated: boolean;
  brief: string | null;
  category: string;
  company: string | null;
  coverage: "Company";
  keyPoints: readonly string[];
  kind: "company-news";
  relatedNews: readonly LiveFeedV2RelatedItem[];
  saved: boolean;
  ticker: string;
  watchlist: boolean;
};

export type LiveFeedV2MarketNewsPreview = LiveFeedV2PreviewBase & {
  company: string | null;
  coverage: string;
  drivers: readonly string[];
  kind: "market-news";
  marketBrief: string | null;
  relatedCompanies: readonly LiveFeedV2RelatedCompany[];
  theme: string;
  ticker: string | null;
};

export type LiveFeedV2Preview =
  | LiveFeedV2FilingPreview
  | LiveFeedV2CompanyNewsPreview
  | LiveFeedV2MarketNewsPreview;

export type LiveFeedV2Item = {
  category: string;
  changePercent: number | null;
  company: string;
  detailHref: string;
  feedType: LiveFeedV2Kind;
  headline: string;
  id: string;
  identityKind: "market" | "ticker";
  impactScore: number;
  price: string | null;
  sentiment: LiveFeedV2Sentiment;
  source: string;
  sparkline: readonly number[];
  summary: string;
  ticker: string;
  timestamp: string;
  timeDateLabel: string;
  timeLabel: string;
  preview: LiveFeedV2Preview;
};

export type LiveFeedV2MarketData = Pick<
  LiveFeedV2Item,
  "changePercent" | "price" | "sparkline"
>;

export function resolveLiveFeedV2MarketData({
  changeLabel,
  chartCloses,
  priceLabel,
}: {
  changeLabel: string | null | undefined;
  chartCloses: readonly number[];
  priceLabel: string | null | undefined;
}): LiveFeedV2MarketData {
  const normalizedPrice = priceLabel?.trim() || "";
  const price =
    /^(?:n\/a|no data|unavailable|industry|macro|sector|sub theme|theme|-{1,2}|—)$/i.test(
      normalizedPrice,
    )
      ? null
      : normalizedPrice || null;
  const normalizedChange = changeLabel?.trim() || "";
  const parsedChange = normalizedChange.endsWith("%")
    ? Number(normalizedChange.replace(/[%+,]/g, ""))
    : Number.NaN;
  const finiteCloses = chartCloses.filter(Number.isFinite);

  return {
    changePercent: Number.isFinite(parsedChange) ? parsedChange : null,
    price,
    sparkline: finiteCloses.length >= 2 ? finiteCloses : [],
  };
}

export type LiveFeedV2Page = {
  availability: "available" | "unavailable";
  emptyMessage?: string;
  error?: string;
  filter: LiveFeedV2Filter;
  items: readonly LiveFeedV2Item[];
  nextCursor: string | null;
  totalCount: number | null;
};

export function normalizeLiveFeedV2Filter(
  value: string | null | undefined,
): LiveFeedV2Filter {
  return liveFeedV2Filters.some((filter) => filter.value === value)
    ? (value as LiveFeedV2Filter)
    : "all";
}

export function encodeLiveFeedV2Cursor(page: number) {
  return `page:${Math.max(1, Math.trunc(page))}`;
}

export function decodeLiveFeedV2Cursor(cursor: string | null | undefined) {
  const match = /^page:(\d{1,5})$/.exec(cursor || "");
  if (!match) return 1;

  const page = Number(match[1]);
  return Number.isSafeInteger(page) && page > 0 ? page : 1;
}

export function formatLiveFeedV2Timestamp(
  value: string,
  now = new Date(),
): { dateLabel: string; timeLabel: string } {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) {
    return { dateLabel: "Date unavailable", timeLabel: "Time unavailable" };
  }

  const dateKey = formatNewYorkDateKey(date);
  const todayKey = formatNewYorkDateKey(now);
  const dateLabel =
    dateKey === todayKey
      ? "Today"
      : new Intl.DateTimeFormat("en-US", {
          day: "numeric",
          month: "short",
          timeZone: "America/New_York",
        }).format(date);

  return {
    dateLabel,
    timeLabel: new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      hour12: true,
      minute: "2-digit",
      timeZone: "America/New_York",
    }).format(date),
  };
}

function formatNewYorkDateKey(date: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "America/New_York",
    year: "numeric",
  }).formatToParts(date);
  const values = Object.fromEntries(
    parts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  return `${values.year}-${values.month}-${values.day}`;
}
