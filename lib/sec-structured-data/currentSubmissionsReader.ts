import "server-only";
import { isDeepStrictEqual } from "node:util";
import { normalizeCik } from "./normalization.ts";
import { normalizeMainSubmissions } from "./mainSubmissions.ts";
import type { SecStructuredSqlClient } from "./repository.ts";
import type { SecCurrentSubmissionsResult } from "./types.ts";

/** One statement, one snapshot. No HTTP, writes, latest-raw fallback or TTL. */
export async function readCurrentIssuerSubmissions(
  client: SecStructuredSqlClient, input: { cik: string },
): Promise<SecCurrentSubmissionsResult> {
  try {
    const cik = normalizeCik(input.cik);
    const result = await client.query(
      `select c.issuer_cik, c.source_raw_id, c.source_kind as current_kind,
         c.refresh_sequence::text, c.confirmed_at::text,
         r.id, r.cik, r.source_kind, r.source_url, r.source_identity,
         r.content_hash, r.raw_content, r.payload, r.fetched_at::text,
         (select coalesce(jsonb_agg(jsonb_build_object('cik', n.issuer_cik,
           'name', n.entity_name, 'kind', n.source_kind)), '[]'::jsonb)
          from public.sec_issuer_source_observations n where n.source_raw_id = c.source_raw_id) as names,
         (select coalesce(jsonb_agg(jsonb_build_object('cik', t.issuer_cik,
           'ticker', t.ticker, 'exchange', t.exchange, 'kind', t.source_kind)), '[]'::jsonb)
          from public.sec_issuer_ticker_observations t where t.source_raw_id = c.source_raw_id) as listings
       from public.sec_submissions_current c
       left join public.sec_structured_raw_sources r on r.id = c.source_raw_id
       where c.issuer_cik = $1`, [cik],
    );
    if (result.rows.length === 0) return { status: "not-confirmed" };
    if (result.rows.length !== 1) throw new Error("ambiguous_current");
    const row = result.rows[0];
    if (row.issuer_cik !== cik || row.cik !== cik || row.current_kind !== "submissions" ||
        row.source_kind !== "submissions" || row.id !== row.source_raw_id ||
        typeof row.refresh_sequence !== "string" || !/^[1-9][0-9]*$/.test(row.refresh_sequence) ||
        typeof row.raw_content !== "string" || typeof row.source_url !== "string" ||
        typeof row.source_identity !== "string") throw new Error("invalid_current_reference");
    const firstFetchedAt = new Date(String(row.fetched_at)).toISOString();
    const confirmedAt = new Date(String(row.confirmed_at)).toISOString();
    const batch = normalizeMainSubmissions([{
      cik, sourceKind: "submissions", sourceUrl: row.source_url, sourceIdentity: row.source_identity,
      fetchedAt: firstFetchedAt, rawBody: row.raw_content, rawBodyKind: "injected_exact_body", payload: row.payload,
    }], cik, firstFetchedAt);
    const raw = batch.rawSources[0];
    if (raw.id !== row.source_raw_id || raw.contentHash !== row.content_hash) throw new Error("invalid_current_raw");
    const names = batch.issuerObservations.map(n => ({ cik, name: n.entityName, kind: n.sourceKind }));
    const listings = batch.tickerObservations.map(t => ({ cik, ticker: t.ticker, exchange: t.exchange, kind: t.sourceKind }));
    const sortListings = (values: typeof listings) => [...values].sort((a, b) =>
      JSON.stringify([a.ticker, a.exchange]).localeCompare(JSON.stringify([b.ticker, b.exchange])));
    if (!Array.isArray(row.listings) || !isDeepStrictEqual(row.names, names) ||
        !isDeepStrictEqual(sortListings(row.listings), sortListings(listings))) throw new Error("invalid_current_observations");
    return {
      status: "available", cik, sourceRawId: raw.id, sourceKind: "submissions",
      sourceUrl: raw.sourceUrl, sourceIdentity: raw.sourceIdentity, contentHash: raw.contentHash,
      entityName: names[0].name, listings: listings.map(({ ticker, exchange }) => ({ ticker, exchange })),
      refreshSequence: row.refresh_sequence, confirmedAt, firstFetchedAt,
    };
  } catch {
    return { status: "unavailable" };
  }
}
