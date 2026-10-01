import { fetchSecCompanyTickers } from "@/lib/integrations";
import { supabaseSelect } from "@/lib/supabase";

export type StockHeaderSecIdentity = Readonly<{
  companyName: string;
  exchange: string;
}>;

type ReadCatalog = (ticker: string, options: { exactTicker: true }) => Promise<{
  ok: boolean;
  data: unknown;
}>;
type SelectRows = (table: string, search: Record<string, string>) => Promise<{
  ok: boolean;
  data: unknown;
}>;
type ReadCanonicalExchange = (ticker: string, issuerCik: string) => Promise<string>;

const EMPTY_IDENTITY: StockHeaderSecIdentity = { companyName: "", exchange: "" };
const TICKER_PATTERN = /^[A-Z0-9][A-Z0-9.-]{0,11}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function readStockHeaderSecIdentity(
  tickerValue: string,
  dependencies: { readCatalog?: ReadCatalog; selectRows?: SelectRows; readCanonicalExchange?: ReadCanonicalExchange } = {},
): Promise<StockHeaderSecIdentity> {
  const ticker = tickerValue.trim().toUpperCase();
  if (!TICKER_PATTERN.test(ticker)) return EMPTY_IDENTITY;
  const readCatalog = dependencies.readCatalog ?? fetchSecCompanyTickers;
  const selectRows = dependencies.selectRows ?? supabaseSelect;

  // The live SEC catalog establishes the current ticker/CIK association. Stored
  // observations alone could belong to a former holder of the same symbol.
  const catalog = await readCatalog(ticker, { exactTicker: true });
  if (!catalog.ok || !Array.isArray(catalog.data)) return EMPTY_IDENTITY;
  const matches = catalog.data.filter((value) => {
    const row = record(value);
    return stringValue(row.ticker).toUpperCase() === ticker &&
      normalizeCik(row.cik_str) !== null;
  });
  if (matches.length !== 1) return EMPTY_IDENTITY;
  const issuerCik = normalizeCik(record(matches[0]).cik_str)!;
  const canonicalExchange = () => (dependencies.readCanonicalExchange ?? readCanonicalExchange)(ticker, issuerCik);

  // Use only the newest main submissions document. Historical submissions files
  // and older ticker/exchange observations cannot establish a current listing.
  const sourceIdentity = `https://data.sec.gov/submissions/CIK${issuerCik}.json`;
  const sources = await selectRows("sec_structured_raw_sources", {
    select: "id,fetched_at",
    cik: `eq.${issuerCik}`,
    source_kind: "eq.submissions",
    source_identity: `eq.${sourceIdentity}`,
    order: "fetched_at.desc,id.desc",
    limit: "2",
  });
  const sourceRows = rows(sources);
  const sourceId = stringValue(record(sourceRows[0]).id);
  if (!sources.ok || !Array.isArray(sources.data) ||
      (sourceRows.length > 1 && record(sourceRows[0]).fetched_at === record(sourceRows[1]).fetched_at)) {
    return EMPTY_IDENTITY;
  }
  if (!sourceRows.length) return { companyName: "", exchange: await canonicalExchange() };
  if (!UUID_PATTERN.test(sourceId)) return EMPTY_IDENTITY;

  const [names, listings] = await Promise.all([
    selectRows("sec_issuer_source_observations", {
      select: "entity_name",
      issuer_cik: `eq.${issuerCik}`,
      source_raw_id: `eq.${sourceId}`,
      limit: "2",
    }),
    selectRows("sec_issuer_ticker_observations", {
      select: "ticker,exchange",
      issuer_cik: `eq.${issuerCik}`,
      source_raw_id: `eq.${sourceId}`,
      ticker: `eq.${ticker}`,
      limit: "2",
    }),
  ]);
  const nameRows = rows(names);
  const listingRows = rows(listings);
  return {
    companyName: nameRows.length === 1
      ? stringValue(record(nameRows[0]).entity_name)
      : "",
    exchange: listingRows.length === 1 &&
      stringValue(record(listingRows[0]).ticker).toUpperCase() === ticker
      ? stringValue(record(listingRows[0]).exchange) || await canonicalExchange()
      : listings.ok && Array.isArray(listings.data) && listingRows.length === 0
        ? await canonicalExchange() : "",
  };
}

async function readCanonicalExchange(ticker: string, issuerCik: string): Promise<string> {
  const { readStockHeaderCanonicalExchange } = await import("./stockHeaderCanonicalExchange.ts");
  return readStockHeaderCanonicalExchange(ticker, issuerCik);
}

function rows(result: { ok: boolean; data: unknown }): unknown[] {
  return result.ok && Array.isArray(result.data) ? result.data : [];
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeCik(value: unknown): string | null {
  const digits = typeof value === "number" && Number.isSafeInteger(value)
    ? String(value)
    : stringValue(value);
  return /^\d{1,10}$/.test(digits) && Number(digits) > 0
    ? digits.padStart(10, "0")
    : null;
}
