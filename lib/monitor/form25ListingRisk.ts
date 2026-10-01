import { readStoredForm25Source } from "../sources/sec/forms/form25/storedSource.ts";
import { evaluateStoredForm25, type DelistingEvidence } from "../sec-delisting-state/state.ts";
import { validateListingRiskAnalyzerResult, type ListingRiskAnalyzerResult } from "./listingRiskAnalyzer.ts";
import { LISTING_RISK_EVENT_FACTS_VERSION, type ListingRiskEventFacts, type ListingDateFact, type ListingTextFact, type ListingFactPath } from "./listingRiskFacts.ts";
import type { SecForm25Field } from "../sources/sec/forms/form25/parser.ts";

export const FORM25_LISTING_CONTRACT_VERSION = "listing_risk_form25_state_v1";
export const FORM25_LISTING_STATE_OUTPUT = "form25_listing_state";
export const FORM25_LISTING_FORMS = ["25", "25-NSE", "25/A", "25-NSE/A"] as const;
type Row = Record<string, unknown>;

/** Binds a deterministic run to exactly the stored evidence, not mutable catalog or prose. */
export function form25ListingSourceSnapshot(raw: Row) {
  return { source_code: raw.source_code, source_unique_id: raw.source_unique_id,
    source_url: raw.source_url, published_at: raw.published_at, raw_payload: raw.raw_payload };
}

/** No new classifier: project only states established by the existing Form25 reader.
 * A pending removal cannot be the Registry's completed `listing_removal` event.
 * Unrepresented pending/unresolved states remain in the trace, without eligible facts. */
export function buildForm25ListingResult(raw: Row, asOf: string) {
  const source = readStoredForm25Source(raw);
  let state: DelistingEvidence | null = null;
  if (source.status === "available" && source.scopeVerified) {
    const fields = source.identity.facts;
    state = evaluateStoredForm25({ raw, asOf, scope: {
      issuerCik: fields.subject_company_cik?.value ?? "",
      securityTitle: fields.removed_security?.value ?? "", exchange: fields.exchange?.value ?? "",
    } });
  }
  const result: ListingRiskAnalyzerResult = state && source.status === "available"
    && (state.listing === "confirmed_exchange_delisting" || ["suspended", "suspension_scheduled"].includes(state.trading))
    ? { status: "applicable", facts: projectFacts(state, source, raw, asOf) }
    : { status: "not_applicable" };
  const errors = validateListingRiskAnalyzerResult(result);
  if (errors.length) throw new Error(`Form25 Listing projection invalid: ${errors.join("; ")}`);
  return {
    version: FORM25_LISTING_CONTRACT_VERSION,
    source_snapshot: form25ListingSourceSnapshot(raw), as_of: asOf, result,
    state: state ? {
      listing: state.listing, trading: state.trading, removalDate: state.removalDate,
      suspensionDate: state.suspensionDate, reasons: state.reasons,
      issuerCik: state.issuerCik, securityTitle: state.securityTitle, exchange: state.exchange,
      sourceSha256: state.sourceSha256, parserVersion: state.parserVersion,
      sourceDocuments: state.sourceDocuments.map(({url,sha256}) => ({url,sha256})),
    } : { listing: "unresolved", trading: "unresolved", reasons: [source.status === "unavailable" ? source.reason : "source_scope_unavailable"] },
  };
}

function projectFacts(state: DelistingEvidence, source: Extract<ReturnType<typeof readStoredForm25Source>, {status:"available"}>, raw: Row, asOf: string): ListingRiskEventFacts {
  const absent = (): ListingTextFact => ({value:null,availability:"unavailable",value_quality:"unknown",source_ref:null});
  const dateAbsent = (): ListingDateFact => ({...absent(),date_status:"unknown"});
  const facts: ListingRiskEventFacts = {
    version: LISTING_RISK_EVENT_FACTS_VERSION,
    classification:{event_kind:state.listing === "confirmed_exchange_delisting" ? "listing_removal" : "trading_suspension",event_outcome:"unknown",source_ref:""},
    exchange:absent(),affected_security:{title:absent(),ticker:absent(),security_basis:absent()},
    listing_rule:absent(),listing_requirement:absent(),compliance_period:absent(),
    proceeding:{kind:"unknown",status:"unknown",source_ref:null},
    dates:{notice_date:dateAbsent(),compliance_deadline:dateAbsent(),hearing_date:dateAbsent(),appeal_deadline:dateAbsent(),trading_suspension_date:dateAbsent(),removal_effective_date:dateAbsent()},
    continued_trading:{continues:{...absent(),value:null},venue:absent()},
    as_of:dateAbsent(),confidence:null,sources:[],fact_provenance:[],
  };
  const add = (field: SecForm25Field<string> | null, path: ListingFactPath): ListingTextFact => {
    if (!field) return absent();
    const prefix=field.source.split(":")[0];
    const doc=prefix.startsWith("primary_filing_text") ? source.primary : source.attachments[Number(prefix.replace("notice_",""))];
    if (!doc) throw new Error(`Form25 fact source missing: ${field.source}`);
    const ref=field.source;
    const evidence=field.evidence.replace(/\.\.\.$/, "");
    if (!facts.sources.some(s=>s.source_ref===ref)) facts.sources.push({source_family:"sec",source_id:String(raw.source_unique_id),source_url:doc.url,source_ref:ref,evidence});
    facts.fact_provenance.push({fact_path:path,origin:"source_stated",source_ref:ref,evidence,evidence_status:"available",evidence_issue:null,confidence:"high",as_of:asOf,formula_id:null,input_fact_paths:[]});
    return {value:field.value,availability:"available",value_quality:"exact",source_ref:ref};
  };
  const fields=state.parser!.facts;
  facts.exchange=add(source.identity.facts.exchange,"exchange.value");
  facts.affected_security.title=add(source.identity.facts.removed_security,"affected_security.title.value");
  facts.listing_rule=add(fields.rule_provision,"listing_rule.value");
  if (state.removalDate && state.listing !== "unresolved") facts.dates.removal_effective_date={
    ...add(fields.delisting_or_removal_date,"dates.removal_effective_date.value"),
    date_status:state.listing === "confirmed_exchange_delisting" ? "occurred" : state.reasons.includes("reported_plan_not_completion_confirmation") ? "conditional" : "scheduled",
  };
  if (state.suspensionDate && state.trading !== "unresolved") facts.dates.trading_suspension_date={
    ...add(fields.trading_suspension_date,"dates.trading_suspension_date.value"),
    date_status:state.trading === "suspended" ? "occurred" : "scheduled",
  };
  const path: ListingFactPath=state.listing === "confirmed_exchange_delisting" ? "dates.removal_effective_date.value" : "dates.trading_suspension_date.value";
  facts.classification.source_ref=facts.fact_provenance.find(p=>p.fact_path===path)!.source_ref!;
  for (const fact_path of ["classification.event_kind","classification.event_outcome"] as const) facts.fact_provenance.push({fact_path,origin:"deterministic_derived",source_ref:null,evidence:null,evidence_status:"unavailable",evidence_issue:"not_provided",confidence:fact_path.endsWith("event_outcome")?"low":"high",as_of:asOf,formula_id:fact_path.endsWith("event_outcome")?"form25_outcome_not_classified":"sec_delisting_state_v3_to_listing_event",input_fact_paths:[path]});
  return facts;
}
