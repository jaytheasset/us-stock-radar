import "server-only";
import { resolveListingAttachment } from "../sec-listing-status/identity.ts";
import { validScope, record } from "../sec-delisting-state/state.ts";
import { uuid } from "../sec-listing-status/observation.ts";
import type { SecTickerResolutionRepository } from "../sec-ticker-resolution/persistence.ts";

/** Caller establishes the current SEC catalog ticker/issuer pair. The stored
 * identity is only a candidate until its exact cover evidence is revalidated.
 * No Listing Status observation or historical event supplies the exchange. */
export async function readStockHeaderCanonicalExchange(ticker: string, issuerCik: string, deps: {
  repository?: SecTickerResolutionRepository;
  resolveAttachment?: typeof resolveListingAttachment;
  now?: Date;
} = {}): Promise<string> {
  if (!/^[A-Z0-9][A-Z0-9.-]{0,11}$/.test(ticker) || !/^\d{10}$/.test(issuerCik)) return "";
  try {
    const repo = deps.repository ?? await defaultRepository();
    const candidates = await repo.select("sec_ticker_security_identities", {
      select: "*", limit: "101", order: "created_at.asc,id.asc",
      or: `(identity_payload->before->>tradingSymbol.eq.${ticker},identity_payload->after->>tradingSymbol.eq.${ticker})`,
    });
    if (!candidates.ok || !Array.isArray(candidates.data) || candidates.data.length !== 1) return "";
    const identity = candidates.data[0];
    const payload = record(identity.identity_payload), before = record(payload.before), after = record(payload.after);
    if (identity.issuer_cik !== issuerCik || !uuid(String(identity.id)) || after.tradingSymbol !== ticker
      || before.tradingSymbol !== ticker) return "";
    // This fallback only handles stable identities. Changed-symbol identities
    // continue to require the existing change-continuity/current projection path.
    const scope = { issuerCik, securityTitle: String(after.securityTitle ?? ""), exchange: String(after.exchange ?? "") };
    if (!validScope(scope)) return "";
    const asOf = (deps.now ?? new Date()).toISOString().slice(0, 10);
    const attachment = await (deps.resolveAttachment ?? resolveListingAttachment)(scope, repo, asOf);
    // The stable reader also checks intervening cover rows through today; stale,
    // changed-class/exchange, competing revisions and ambiguity fail closed.
    if (attachment.status !== "attached" || attachment.reason !== "validated_stable_sec_security_exchange"
      || attachment.securityIdentityId !== identity.id || !attachment.knownAt
      || attachment.knownAt.slice(0, 10) > asOf) return "";
    return scope.exchange;
  } catch { return ""; }
}

async function defaultRepository(): Promise<SecTickerResolutionRepository> {
  const { supabaseSelect, supabaseRpc } = await import("../supabase.ts");
  return { select: supabaseSelect, rpc: supabaseRpc };
}
