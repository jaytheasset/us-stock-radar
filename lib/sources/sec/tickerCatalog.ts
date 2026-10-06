import { getServerEnv } from "../../env.ts";
import { secFetch } from "./secFetch.ts";
import { createTickerCatalogCache } from "./tickerCatalogCache.ts";
import type { SecTickerSelectionRow } from "./sourceTickerSelection.ts";

export const SEC_COMPANY_CATALOG_URL = "https://www.sec.gov/files/company_tickers.json";
export const SEC_EXCHANGE_CATALOG_URL = "https://www.sec.gov/files/company_tickers_exchange.json";
export type SecCompanyTickerRow = { cik_str: number; ticker: string; title: string };

export class SecCompanyCatalogHttpError extends Error {
  readonly status: number;
  constructor(status: number, statusText: string) { super(statusText); this.status = status; }
}

// Independent snapshots, clocks and flights. Neither source substitutes for the other.
const companyCache = createTickerCatalogCache(loadCompanyCatalog);
const exchangeCache = createTickerCatalogCache(loadExchangeCatalog);

/** Defaults to live revalidation: also used by identity/projection checks and probeSec. */
export async function readSecCompanyCatalog(fresh = true) {
  // Check on every read, including cache hits and joins; a cache is not configuration.
  if (!getServerEnv().secUserAgent) throw new Error("SEC_USER_AGENT is missing");
  return companyCache.get(fresh);
}

export function readSecExchangeCatalog(fresh = false) {
  return exchangeCache.get(fresh);
}

async function loadCompanyCatalog() {
  const userAgent = getServerEnv().secUserAgent;
  if (!userAgent) throw new Error("SEC_USER_AGENT is missing");
  // One 15-second budget through headers and the complete body, with no retry.
  // Other integrations' timedFetch callers remain untouched.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(SEC_COMPANY_CATALOG_URL, { cache: "no-store", signal: controller.signal,
      headers: { "User-Agent": userAgent, Accept: "application/json" } });
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new SecCompanyCatalogHttpError(response.status, response.statusText);
    }
    const data: unknown = await response.json();
    // A completion arriving after cancellation must never become a fresh snapshot.
    controller.signal.throwIfAborted();
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("SEC company catalog invalid schema");
    const rows = Object.values(data);
    if (!rows.length || !rows.every((row) => row && typeof row === "object" && !Array.isArray(row) &&
      typeof row.cik_str === "number" && Number.isSafeInteger(row.cik_str) && row.cik_str > 0 && row.cik_str <= 9_999_999_999 &&
      typeof row.ticker === "string" && row.ticker.trim() && typeof row.title === "string" && row.title.trim())) {
      throw new Error("SEC company catalog invalid rows");
    }
    // Keep original values/types, duplicate candidates and Object.values row order.
    return { rows: rows as SecCompanyTickerRow[], status: response.status };
  } finally { clearTimeout(timeout); }
}

async function loadExchangeCatalog() {
  const response = await secFetch(SEC_EXCHANGE_CATALOG_URL);
  if (!response.ok) throw new Error(`SEC ticker catalog HTTP ${response.status}`);
  const data = await response.json();
  if (!data || !Array.isArray(data.fields) || !data.fields.every((field: unknown) => typeof field === "string" && field.trim()) ||
      !Array.isArray(data.data) || !data.data.length) throw new Error("SEC ticker catalog invalid schema");
  const fields: string[] = data.fields.map((field: string) => stringValue(field));
  const rows: unknown[] = data.data;
  const cikIndex = fields.indexOf("cik");
  const nameIndex = fields.indexOf("name");
  const tickerIndex = fields.indexOf("ticker");
  const exchangeIndex = fields.indexOf("exchange");
  if ([cikIndex, nameIndex, tickerIndex, exchangeIndex].some((index) => index < 0) || new Set(fields).size !== fields.length) {
    throw new Error("SEC ticker catalog invalid fields");
  }
  const lookup = new Map<string, SecTickerSelectionRow[]>();
  for (const row of rows) {
    if (!Array.isArray(row) || row.length !== fields.length ||
        !((typeof row[cikIndex] === "number" && Number.isSafeInteger(row[cikIndex]) && row[cikIndex] > 0 && row[cikIndex] <= 9_999_999_999) ||
          (typeof row[cikIndex] === "string" && /^\d{1,10}$/.test(row[cikIndex].trim()) && Number(row[cikIndex]) > 0)) ||
        typeof row[tickerIndex] !== "string" || !row[tickerIndex].trim() ||
        ![nameIndex, exchangeIndex].every((index) => row[index] === null || typeof row[index] === "string")) {
      throw new Error("SEC ticker catalog invalid row");
    }
    // Same stage-1 exchange normalization; no company-source supplementation.
    const digits = stringValue(row[cikIndex]).replace(/\D/g, "");
    const cik = digits ? String(Number(digits)) : null;
    const ticker = stringValue(row[tickerIndex]).toUpperCase();
    if (!cik || !ticker) throw new Error("SEC ticker catalog invalid identity");
    const tickerRow = { cik, ticker, exchange: stringValue(row[exchangeIndex]) || null, name: stringValue(row[nameIndex]) || null };
    const existing = lookup.get(cik) || [];
    existing.push(tickerRow);
    lookup.set(cik, existing);
  }
  return lookup;
}

function stringValue(value: unknown) {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}
