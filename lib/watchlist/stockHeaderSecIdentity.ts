import { fetchSecCompanyTickers } from "@/lib/integrations";
import { readStockHeaderCurrent } from "./stockHeaderCurrentReader.ts";
import type { SecCurrentSubmissionsResult } from "../sec-structured-data/types.ts";

export type StockHeaderSecIdentity = Readonly<
  | { ticker: string; status: "available"; companyName: string; exchange: string; confirmedAt: string }
  | { ticker: string; status: "not-confirmed"; reason: "no-current" | "ticker-not-listed" | "no-catalog-match" }
  | { ticker: string; status: "unavailable" }
>;

type ReadCatalog = (ticker: string, options: { exactTicker: true; fresh: true }) => Promise<{ ok: boolean; data: unknown }>;
type ReadCurrent = (cik: string) => Promise<SecCurrentSubmissionsResult>;
const TICKER_PATTERN = /^[A-Z0-9][A-Z0-9.-]{0,11}$/;

export async function readStockHeaderSecIdentity(
  tickerValue: string,
  dependencies: { readCatalog?: ReadCatalog; readCurrent?: ReadCurrent } = {},
): Promise<StockHeaderSecIdentity> {
  const ticker = tickerValue.trim().toUpperCase();
  const unavailable = { ticker, status: "unavailable" } as const;
  if (!TICKER_PATTERN.test(ticker)) return unavailable;
  try {
    const catalog = await (dependencies.readCatalog ?? fetchSecCompanyTickers)(ticker, { exactTicker: true, fresh: true });
    if (!catalog.ok || !Array.isArray(catalog.data)) return unavailable;
    const matches = catalog.data.filter(value => record(value).ticker === ticker);
    if (!matches.length) return { ticker, status: "not-confirmed", reason: "no-catalog-match" };
    if (matches.length !== 1) return unavailable;
    const issuerCik = normalizeCik(record(matches[0]).cik_str);
    if (!issuerCik) return unavailable;
    const current = await (dependencies.readCurrent ?? readStockHeaderCurrent)(issuerCik);
    if (current.status === "not-confirmed") return { ticker, status: "not-confirmed", reason: "no-current" };
    if (current.status !== "available" || current.cik !== issuerCik) return unavailable;
    const listings = current.listings.filter(pair => pair.ticker === ticker);
    if (!listings.length) return { ticker, status: "not-confirmed", reason: "ticker-not-listed" };
    if (listings.length !== 1 || !listings[0].exchange.trim() || !current.entityName.trim() ||
        !Number.isFinite(Date.parse(current.confirmedAt))) return unavailable;
    // Explicit allowlist: no raw/payload/provenance internals or DB errors in props.
    return { ticker, status: "available", companyName: current.entityName,
      exchange: listings[0].exchange, confirmedAt: current.confirmedAt };
  } catch {
    return unavailable;
  }
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function normalizeCik(value: unknown): string | null {
  const digits = typeof value === "number" && Number.isSafeInteger(value) ? String(value)
    : typeof value === "string" ? value.trim() : "";
  return /^\d{1,10}$/.test(digits) && Number(digits) > 0 ? digits.padStart(10, "0") : null;
}
