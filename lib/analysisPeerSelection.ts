export const ANALYSIS_PEER_LIMIT = 6;
export const ANALYSIS_PEER_PAGE_SIZE = 2;

export type AnalysisPeerSource = "related" | "filler";
export type AnalysisPeerFillerBucket =
  | "sub_theme"
  | "theme"
  | "industry_group"
  | "sector";

export type AnalysisPeerCandidate = {
  symbol: string;
  companyName?: string;
  exchange?: string;
  source: AnalysisPeerSource;
  fillerBucket?: AnalysisPeerFillerBucket;
  relevanceScore?: number;
  sortOrder?: number;
  role?: string;
};

export type AnalysisPeerFillerBuckets = Partial<
  Record<AnalysisPeerFillerBucket, AnalysisPeerCandidate[]>
>;

const fillerPriority: AnalysisPeerFillerBucket[] = [
  "sub_theme",
  "theme",
  "industry_group",
  "sector",
];

export function selectAnalysisPeers({
  fillerBuckets,
  limit = ANALYSIS_PEER_LIMIT,
  primaryTicker,
  related,
}: {
  fillerBuckets: AnalysisPeerFillerBuckets;
  limit?: number;
  primaryTicker: string;
  related: AnalysisPeerCandidate[];
}) {
  const normalizedPrimary = normalizeAnalysisTicker(primaryTicker);
  const selected: AnalysisPeerCandidate[] = [];
  const seen = new Set(normalizedPrimary ? [normalizedPrimary] : []);
  const cappedLimit = Math.max(0, Math.min(ANALYSIS_PEER_LIMIT, Math.floor(limit)));

  const append = (
    candidate: AnalysisPeerCandidate,
    source: AnalysisPeerSource,
    fillerBucket?: AnalysisPeerFillerBucket,
  ) => {
    if (selected.length >= cappedLimit) return;
    const symbol = normalizeAnalysisTicker(candidate.symbol);
    if (!symbol || seen.has(symbol)) return;
    seen.add(symbol);
    selected.push({
      ...candidate,
      symbol,
      source,
      ...(fillerBucket ? { fillerBucket } : {}),
    });
  };

  const rankedRelated = related
    .map((candidate, index) => ({ candidate, index }))
    .sort((left, right) => {
      const relevanceDifference =
        sortableRelevance(right.candidate.relevanceScore) -
        sortableRelevance(left.candidate.relevanceScore);
      if (relevanceDifference) return relevanceDifference;

      const sortOrderDifference =
        sortableOrder(left.candidate.sortOrder, left.index) -
        sortableOrder(right.candidate.sortOrder, right.index);
      return sortOrderDifference || left.index - right.index;
    });

  for (const { candidate } of rankedRelated) {
    append(candidate, "related");
  }

  if (selected.length < cappedLimit) {
    for (const bucket of fillerPriority) {
      for (const candidate of fillerBuckets[bucket] || []) {
        append(candidate, "filler", bucket);
      }
      if (selected.length >= cappedLimit) break;
    }
  }

  return selected;
}

export function paginateAnalysisPeers<T>(
  peers: readonly T[],
  pageSize = ANALYSIS_PEER_PAGE_SIZE,
) {
  const normalizedPageSize = Math.max(1, Math.floor(pageSize));
  const pages: T[][] = [];
  for (let index = 0; index < peers.length; index += normalizedPageSize) {
    pages.push(peers.slice(index, index + normalizedPageSize));
  }
  return pages;
}

export function normalizeAnalysisTicker(value: string | null | undefined) {
  const ticker = String(value || "").trim().replace(/^\$/, "").toUpperCase();
  return /^[A-Z][A-Z0-9.-]{0,9}$/.test(ticker) ? ticker : "";
}

function sortableRelevance(value: number | undefined) {
  return Number.isFinite(value) ? Number(value) : -1;
}

function sortableOrder(value: number | undefined, fallback: number) {
  return Number.isFinite(value) ? Number(value) : 10_000 + fallback;
}
