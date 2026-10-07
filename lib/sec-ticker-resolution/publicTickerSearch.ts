import "server-only";

import { readTickerCatalogSearch } from "@/lib/alerts/tickers/getAlertTickersViewModel";
import { fetchSecCompanyTickers } from "@/lib/integrations";
import { normalizeTickerSearchQuery, completeTickerSearch, requireCompleteTickerSearch, type TickerSearchResult, type TickerSearchRead } from "@/lib/tickerSearchContract";
import {
  readSecTickerProductProjectionForTicker,
  readSecTickerSourceFiling,
} from "./productProjection";
import type {
  SecTickerProductProjectionReadResult,
  SecTickerSourceFiling,
} from "./productProjectionTypes";

type AvailableProjection = Extract<SecTickerProductProjectionReadResult, { status: "available" }>;

export type IssuerBoundPublicProjectionReadResult =
  | Readonly<{
      status: "available";
      projection: AvailableProjection;
      currentSecTicker: TickerSearchResult;
    }>
  | Readonly<{ status: "not_found" }>
  | Readonly<{ status: "unavailable"; reason: string }>;

export async function searchPublicStockTickerCatalog(
  query: string,
  limit = 8,
): Promise<TickerSearchResult[]> {
  return requireCompleteTickerSearch(await readPublicStockTickerCatalogSearch(query, limit));
}

export async function readPublicStockTickerCatalogSearch(query: string, limit = 8): Promise<TickerSearchRead> {
  const normalized = normalizeTickerSearchQuery(query);
  if (!normalized) return { data: [] };
  const cappedLimit = Math.max(1, Math.min(limit, 12));
  const base = await readTickerCatalogSearch(normalized, cappedLimit);
  const baseResults = base.data;
  const exactTicker = /^[A-Z0-9][A-Z0-9.-]{0,11}$/.test(normalized.toUpperCase())
    ? normalized.toUpperCase()
    : "";
  if (!exactTicker) return base;

  const bound = await readIssuerBoundPublicStockTickerProjection(exactTicker);
  if (bound.status === "unavailable") return completeTickerSearch(baseResults, true);
  if (
    bound.status !== "available" ||
    bound.projection.currentTicker === exactTicker ||
    !bound.projection.historicalTickers.includes(exactTicker)
  ) return base;

  const historicalResult: TickerSearchResult = {
    ...bound.currentSecTicker,
    historicalTicker: exactTicker,
    isHistoricalTicker: true,
  };
  return completeTickerSearch([
    historicalResult,
    ...baseResults.filter((result) => result.ticker !== historicalResult.ticker),
  ].slice(0, cappedLimit), base.partial);
}

export async function readIssuerBoundPublicStockTickerProjection(
  ticker: string,
  dependencies: Readonly<{
    readProjection?: typeof readSecTickerProductProjectionForTicker;
    fetchCompanyTickers?: typeof fetchSecCompanyTickers;
  }> = {},
): Promise<IssuerBoundPublicProjectionReadResult> {
  const projection = await (dependencies.readProjection ?? readSecTickerProductProjectionForTicker)({ ticker });
  if (projection.status !== "available") return projection;
  const currentSecResult = await (dependencies.fetchCompanyTickers ?? fetchSecCompanyTickers)(
    projection.currentTicker,
  );
  const current = currentSecResult.ok && Array.isArray(currentSecResult.data)
    ? readProjectedCurrentSecTicker(
        currentSecResult.data,
        projection.currentTicker,
        projection.issuerCik,
      )
    : null;
  return current
    ? { status: "available", projection, currentSecTicker: current }
    : { status: "unavailable", reason: "projection_current_issuer_not_confirmed" };
}

export async function readIssuerBoundPublicSecTickerSourceFiling(
  input: { decisionId: string; side: "before" | "after" },
  dependencies: Readonly<{
    readProjection?: typeof readSecTickerProductProjectionForTicker;
    readSourceFiling?: typeof readSecTickerSourceFiling;
    fetchCompanyTickers?: typeof fetchSecCompanyTickers;
  }> = {},
): Promise<SecTickerSourceFiling | null> {
  const filing = await (dependencies.readSourceFiling ?? readSecTickerSourceFiling)(input);
  if (!filing) return null;
  const bound = await readIssuerBoundPublicStockTickerProjection(
    filing.currentTicker,
    dependencies,
  );
  if (bound.status !== "available") return null;
  const current = bound.projection.sourceFilings.find((source) =>
    source.detailHref === filing.detailHref &&
    source.accessionNumber === filing.accessionNumber &&
    source.issuerCik === filing.issuerCik);
  return current ?? null;
}

export function readProjectedCurrentSecTicker(
  values: readonly unknown[],
  expectedTicker: string,
  expectedIssuerCik: string,
): TickerSearchResult | null {
  const ticker = expectedTicker.trim().toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9.-]{0,11}$/.test(ticker) || !/^\d{10}$/.test(expectedIssuerCik)) {
    return null;
  }
  const candidates = values.flatMap((value) => {
    const row = value && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null;
    const rowTicker = typeof row?.ticker === "string" ? row.ticker.trim().toUpperCase() : "";
    const rawCik = typeof row?.cik_str === "number" || typeof row?.cik_str === "string"
      ? String(row.cik_str).trim()
      : "";
    const title = typeof row?.title === "string" ? row.title.trim() : "";
    if (rowTicker !== ticker || !/^\d{1,10}$/.test(rawCik) || !title) return [];
    return [{
      assetType: "stock",
      cik: rawCik.padStart(10, "0"),
      companyName: title,
      exchange: null,
      marketCap: null,
      ticker,
    }];
  });
  if (candidates.length !== 1 || candidates[0]!.cik !== expectedIssuerCik) return null;
  const [{ cik: _cik, ...result }] = candidates;
  return result satisfies TickerSearchResult;
}
