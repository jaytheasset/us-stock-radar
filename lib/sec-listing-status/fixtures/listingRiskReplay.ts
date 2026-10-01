// Source-grounded analyzer-shaped TEST fixtures, not retained provider responses.
import { readFileSync } from "node:fs";
import { LISTING_RISK_EVENT_FACTS_VERSION, type ListingRiskEventFacts, type ListingFactPath } from "../../monitor/listingRiskFacts.ts";
const sources = JSON.parse(readFileSync(new URL("./follow-up.json", import.meta.url), "utf8"));
export function scpxListingRiskReplay(after: boolean): ListingRiskEventFacts {
  const source = sources[after ? "scpx-after" : "scpx-before"];
  const date = after ? "2024-07-29" : "2024-06-14";
  const source_ref = "source:block:1";
  const text = (value: string) => ({ value, availability: "available" as const, value_quality: "exact" as const, source_ref });
  const empty = { value: null, availability: "unavailable" as const, value_quality: "unknown" as const, source_ref: null };
  const emptyDate = { ...empty, date_status: "unknown" as const };
  const quote = source.quote as string;
  // Each provenance excerpt stays within the existing 520-character contract.
  const lead = after ? quote.slice(0, quote.indexOf(" The NYSE Regulation")) : quote;
  const rule = after ? quote.slice(quote.indexOf("The NYSE Regulation"), quote.indexOf(" The Company’s common stock is expected")) : quote;
  const paths: ListingFactPath[] = ["classification.event_kind", "classification.event_outcome", "exchange.value", "affected_security.title.value", "listing_rule.value", "dates.notice_date.value"];
  return {
    version: LISTING_RISK_EVENT_FACTS_VERSION,
    classification: { event_kind: after ? "other" : "delisting_determination", event_outcome: after ? "recovered" : "adverse", source_ref },
    exchange: text("NYSE American"), affected_security: { title: text("common stock"), ticker: { ...empty }, security_basis: { ...empty } },
    listing_rule: text("Section 1003(f)(v)"), listing_requirement: { ...empty }, compliance_period: { ...empty },
    proceeding: { kind: "unknown", status: "unknown", source_ref: null },
    dates: { notice_date: { ...text(date), date_status: "occurred" }, compliance_deadline: { ...emptyDate }, hearing_date: { ...emptyDate }, appeal_deadline: { ...emptyDate }, trading_suspension_date: { ...emptyDate }, removal_effective_date: { ...emptyDate } },
    continued_trading: { continues: { ...empty }, venue: { ...empty } }, as_of: { ...emptyDate }, confidence: null,
    sources: [{ source_family: "sec", source_id: after ? "0001079973-24-001121" : "0001079973-24-000891", source_url: source.url, source_ref, evidence: lead }],
    fact_provenance: paths.map(fact_path => ({ fact_path, origin: fact_path.startsWith("classification.") ? "domain_interpreted" : "source_stated", source_ref,
      evidence: fact_path === "listing_rule.value" ? rule : lead, evidence_status: "available", evidence_issue: null, confidence: "high", as_of: date, formula_id: null, input_fact_paths: [] })),
  };
}
