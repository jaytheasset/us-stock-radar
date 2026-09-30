import { buildSecCoverObservationPayload } from "../sec-cover-observations/canonical.ts";
import type { DelistingScope } from "../sec-delisting-state/state.ts";
import { exact, type Row } from "./observation.ts";

// Only descriptive par-value text and a legal entity suffix are removable.
// Class A/B, ordinary shares, rights, warrants and distinct venues stay distinct.
export const coverClass = (s: string) => exact(s).replace(/,\s*(?:par value\s+\$[\d.]+|\$[\d.]+\s+par value)(?:\s+per share)?$/, "");
export const coverVenue = (s: string) => exact(s).replace(/\s+llc$/, "");

/** Bind a source-event subject only inside its own original filing cover.
 * No cross-filing alias, issuer-name match, or first-row fallback. */
export function selectListingCoverRow(raw: Row, scope: DelistingScope) {
  const built = buildSecCoverObservationPayload(String(raw.id), raw);
  if (!built || built.payload.identity.issuerCik !== scope.issuerCik) return null;
  const matches = built.payload.observations.filter(o =>
    [exact(o.securityTitle.parsedTextValue),coverClass(o.securityTitle.parsedTextValue ?? "")].includes(exact(scope.securityTitle))
    && [exact(o.exchange.parsedTextValue),coverVenue(o.exchange.parsedTextValue ?? "")].includes(exact(scope.exchange)));
  if (matches.length !== 1) return null;
  const o = matches[0];
  if ([o.securityTitle,o.exchange,o.tradingSymbol].some(f => !["observed","duplicate_equal"].includes(f.status) || !f.parsedTextValue)
    || /\b(rights?|warrants?|units?)\b/i.test(o.securityTitle.parsedTextValue!)
    || /^(none|n\/a)$/i.test(o.tradingSymbol.parsedTextValue!)
    || built.payload.observations.some(other => other !== o && (
      !other.securityTitle.parsedTextValue || !other.exchange.parsedTextValue || !other.tradingSymbol.parsedTextValue
      || exact(other.tradingSymbol.parsedTextValue) === exact(o.tradingSymbol.parsedTextValue)))) return null;
  return { resultId: String(built.result.id), observationKey: o.observationKey,
    sourceHash: built.payload.source.sha256!, securityTitle: o.securityTitle.parsedTextValue!,
    ticker: o.tradingSymbol.parsedTextValue!, exchange: o.exchange.parsedTextValue! };
}
