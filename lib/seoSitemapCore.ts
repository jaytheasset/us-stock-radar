import type { MetadataRoute } from "next";
import { getCanonicalAnalysisPath } from "./analysisRoutes.ts";
import {
  hasMeaningfulAnalysisPayload,
  isIndexableAnalysisDocument,
  isSearchableTicker,
  latestIsoTimestamp,
  type AnalysisSeoDocument,
} from "./analysisSeo.ts";
import { SITE_ORIGIN, buildSitemap } from "./seo.ts";

export type SitemapRow = Record<string, unknown>;

export type DynamicSitemapRows = {
  analyses: SitemapRow[];
  events: SitemapRow[];
  tickers: SitemapRow[];
};

export const SITEMAP_URL_LIMIT = 50_000;

export async function collectPaginatedRows<T>(
  loadPage: (offset: number, limit: number) => Promise<T[]>,
  options: { maxRows?: number; pageSize?: number } = {},
) {
  const maxRows = Math.max(0, options.maxRows ?? SITEMAP_URL_LIMIT);
  const pageSize = Math.max(1, options.pageSize ?? 1_000);
  const rows: T[] = [];

  while (rows.length < maxRows) {
    const limit = Math.min(pageSize, maxRows - rows.length);
    const page = await loadPage(rows.length, limit);
    rows.push(...page.slice(0, limit));
    if (page.length < limit) break;
  }

  return rows;
}

export async function buildSitemapWithDynamicLoader(
  loadRows: () => Promise<DynamicSitemapRows>,
): Promise<MetadataRoute.Sitemap> {
  const staticEntries = buildSitemap();

  try {
    const rows = await loadRows();
    return mergeSitemapEntries(staticEntries, buildDynamicSitemapEntries(rows));
  } catch {
    return staticEntries;
  }
}

export function buildDynamicSitemapEntries({
  analyses,
  events,
  tickers,
}: DynamicSitemapRows): MetadataRoute.Sitemap {
  const analysisByEventId = new Map(
    analyses
      .map((row) => [readString(row, "event_id"), row] as const)
      .filter(([eventId]) => Boolean(eventId)),
  );
  const entries: MetadataRoute.Sitemap = [];

  for (const event of events) {
    const id = readString(event, "id");
    const sourceGroup = readString(event, "source_group");
    if (sourceGroup !== "news" && sourceGroup !== "filings") continue;
    const analysis = analysisByEventId.get(id);
    const document = toAnalysisSeoDocument(event, analysis);
    if (!isIndexableAnalysisDocument(document)) continue;
    const path = getCanonicalAnalysisPath({
      deliveryLevel: readString(event, "delivery_level"),
      id,
      metadata: event.metadata,
      sourceGroup,
    });
    if (!path) continue;
    const lastModified = latestIsoTimestamp(
      analysis?.updated_at,
      event.detected_at,
      event.published_at,
    );
    entries.push({
      url: `${SITE_ORIGIN}${path}`,
      lastModified: lastModified || undefined,
      changeFrequency: "weekly",
      priority: sourceGroup === "news" ? 0.7 : 0.7,
    });
  }

  for (const ticker of tickers) {
    const symbol = readString(ticker, "symbol").toUpperCase();
    const assetType = readString(ticker, "asset_type");
    if (
      ticker.is_active !== true ||
      !isSearchableTicker(symbol) ||
      !readString(ticker, "name") ||
      (assetType && assetType !== "stock" && assetType !== "etf")
    ) {
      continue;
    }
    entries.push({
      url: `${SITE_ORIGIN}/stocks/${encodeURIComponent(symbol)}`,
      lastModified: latestIsoTimestamp(ticker.updated_at, ticker.created_at) || undefined,
      changeFrequency: "daily",
      priority: 0.6,
    });
  }

  return dedupeEntries(entries);
}

function toAnalysisSeoDocument(
  event: SitemapRow,
  analysis: SitemapRow | undefined,
): AnalysisSeoDocument {
  return {
    analysisMetadata: analysis?.metadata,
    brief: readString(event, "quick_take"),
    hasStoredAnalysis: hasMeaningfulAnalysisPayload(analysis),
    id: readString(event, "id"),
    kind: readString(event, "source_group") === "filings" ? "filing" : "news",
    metadata: event.metadata,
    modifiedAt: readString(analysis, "updated_at"),
    publishedAt: readString(event, "published_at") || readString(event, "detected_at"),
    sourceCode: readString(event, "source_code"),
    sourceName: readString(event, "source_name"),
    summary: readString(event, "summary"),
    ticker: readString(event, "ticker"),
    title: readString(event, "title"),
  };
}

function mergeSitemapEntries(
  staticEntries: MetadataRoute.Sitemap,
  dynamicEntries: MetadataRoute.Sitemap,
) {
  return dedupeEntries([...staticEntries, ...dynamicEntries]).slice(0, SITEMAP_URL_LIMIT);
}

function dedupeEntries(entries: MetadataRoute.Sitemap) {
  const byUrl = new Map<string, MetadataRoute.Sitemap[number]>();
  for (const entry of entries) {
    if (!byUrl.has(entry.url)) byUrl.set(entry.url, entry);
  }
  return [...byUrl.values()];
}

function readString(row: SitemapRow | undefined, key: string) {
  const value = row?.[key];
  return typeof value === "string" ? value.trim() : "";
}
