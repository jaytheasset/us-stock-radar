import { readSecForm25EventIdentity, readStoredSecForm25EventIdentity, type Form25IdentityGate } from "./consumption.ts";
import { buildEventAlertScoreFilters } from "../supabaseEventFilters.ts";
import { classifySecurity } from "../sec-ticker-resolution/canonical.ts";

type Row = Record<string, unknown>;
export type Form25StockEventFilters = {
  ticker: string; limit: number; impact?: string; eventType?: string;
  sourceGroup?: "news" | "filings" | "market"; marketScope?: "company" | "sector" | "theme" | "macro";
  deliveryLevel?: "archive" | "feed" | "alert"; excludeDeliveryLevel?: "archive" | "feed" | "alert";
  signal?: "bullish" | "bearish" | "volatile" | "neutral";
};
type Readers = {
  select(table: string, query: Record<string, string>): Promise<{ ok: boolean; data: unknown; error?: string }>;
  identity(event: Row): Promise<Form25IdentityGate & { subjectCik?: string | null; security?: string | null }>;
  projection?(ticker: string): Promise<{ status: string; currentTicker?: string; historicalTickers?: readonly string[]; issuerCik?: string; sourceFilings?: readonly { securityTitle: string }[] }>;
};
const defaults: Readers = {
  select: async (table, query) => (await import("../supabase.ts")).supabaseSelect(table, query),
  identity: async event => {
    const effective = await (await import("./persistence.ts")).readEffectiveSecForm25Identity({ rawItemId: text(event.raw_item_id) });
    const gate = await readSecForm25EventIdentity(event, { event: async () => event, identity: async () => effective });
    return { ...gate, subjectCik: effective.status === "available" ? effective.evidence.subjectCik : null,
      security: effective.status === "available" ? effective.evidence.security : null };
  },
  projection: async ticker => (await import("../sec-ticker-resolution/productProjection.ts")).readSecTickerProductProjectionForTicker({ ticker }),
};
const rows = (value: unknown): Row[] => Array.isArray(value) ? value.filter(row => row && typeof row === "object") as Row[] : [];
const text = (value: unknown) => typeof value === "string" ? value.trim() : "";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Existing public stock-events read only. Candidate rows locate sources; only the fresh official reader authorizes links. */
export async function readForm25StockEventView(filters: Form25StockEventFilters, originalRows: Row[], readers: Readers = defaults): Promise<
  { status: "available"; data: Row[] } | { status: "unavailable"; reason: string }
> {
  const ticker = filters.ticker.trim().toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9.-]{0,11}$/.test(ticker)) return { status: "available", data: originalRows };
  if (filters.sourceGroup && filters.sourceGroup !== "filings") return { status: "available", data: originalRows };
  const limit = Math.max(1, Math.min(filters.limit || 50, 100));
  try {
    const projection = await readers.projection?.(ticker);
    if (projection?.status === "unavailable") return { status: "unavailable", reason: "form25_stock_projection_unavailable" };
    const symbols = projection?.status === "available"
      ? [...new Set([ticker, projection.currentTicker, ...projection.historicalTickers ?? []].filter((value): value is string => typeof value === "string"))]
      : [ticker];
    let supplemental: Row[] = [];
    if (!filters.sourceGroup || filters.sourceGroup === "filings") {
      const evidenceRows: Row[] = [];
      for (const symbol of symbols) {
        const candidates = await readers.select("sec_form25_identity_evidence", {
          select: "raw_item_id", "evidence->candidates": `cs.${JSON.stringify([{ ticker: symbol }])}`,
          order: "sequence.desc", limit: "101",
        });
        if (!candidates.ok) return { status: "unavailable", reason: "form25_identity_candidates_unavailable" };
        evidenceRows.push(...rows(candidates.data));
        if (evidenceRows.length > 100) return { status: "unavailable", reason: "form25_identity_candidate_limit" };
      }
      const rawIds = [...new Set(evidenceRows.map(row => text(row.raw_item_id)))];
      if (rawIds.some(id => !uuid.test(id))) return { status: "unavailable", reason: "form25_identity_candidate_invalid" };
      if (rawIds.length) {
        const query: Record<string, string> = {
          select: "*", raw_item_id: `in.(${rawIds.join(",")})`, source_group: "eq.filings", order: "detected_at.desc", limit: "101",
          ...buildEventAlertScoreFilters(filters),
        };
        if (filters.impact) query.impact = `eq.${filters.impact}`;
        if (filters.eventType) query.event_type = `eq.${filters.eventType}`;
        if (filters.marketScope) query.market_scope = `eq.${filters.marketScope}`;
        if (filters.signal) query.signal = `eq.${filters.signal}`;
        if (!filters.deliveryLevel && filters.excludeDeliveryLevel) query.delivery_level = `neq.${filters.excludeDeliveryLevel}`;
        const result = await readers.select("events", query);
        if (!result.ok) return { status: "unavailable", reason: "form25_identity_events_unavailable" };
        supplemental = rows(result.data);
        if (supplemental.length > 100) return { status: "unavailable", reason: "form25_identity_event_limit" };
      }
    }
    const merged = new Map<string, Row>();
    const supplementalIds = new Set(supplemental.map(row => text(row.id)));
    for (const row of [...originalRows, ...supplemental]) {
      const id = text(row.id);
      if (!id || merged.has(id)) continue;
      const isForm25 = readStoredSecForm25EventIdentity(row).status !== "not_applicable";
      if (!isForm25) { if (!supplementalIds.has(id)) merged.set(id, row); continue; }
      const identity = await readers.identity(row);
      if (identity.status !== "available" || !identity.ticker || !symbols.includes(identity.ticker)) continue;
      if (identity.ticker !== ticker) {
        const security = classifySecurity(identity.security ?? "");
        const sourceSecurities = projection?.sourceFilings?.map(source => classifySecurity(source.securityTitle)) ?? [];
        if (!identity.subjectCik || identity.subjectCik !== projection?.issuerCik || !security || !sourceSecurities.length ||
          sourceSecurities.some(source => !source || source.type !== security.type || source.securityClass !== security.securityClass)) continue;
      }
      // Derived API view only. The historical event, links and AI output remain unchanged.
      merged.set(id, { ...row, ticker: identity.ticker, form25_identity_view: { storedTicker: row.ticker ?? null, ticker: identity.ticker, exchange: identity.exchange } });
    }
    return { status: "available", data: [...merged.values()]
      .sort((a, b) => text(b.detected_at).localeCompare(text(a.detected_at)))
      .slice(0, limit) };
  } catch { return { status: "unavailable", reason: "form25_identity_stock_read_failed" }; }
}
