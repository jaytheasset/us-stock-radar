import { createHash } from "node:crypto";
import { parseSecForm25Filing, type SecForm25Field, type SecForm25ParserOutput } from "../sources/sec/forms/form25/parser.ts";
import { officialForm25Source, readStoredForm25Source } from "../sources/sec/forms/form25/storedSource.ts";
import type { CurrentListingRiskReadResult } from "../monitor/listingRiskPersistence.ts";
import { buildSecCoverObservationPayload } from "../sec-cover-observations/canonical.ts";

export const SEC_DELISTING_STATE_VERSION = "sec_delisting_state_v2";
export type DelistingScope = { issuerCik: string; securityTitle: string; exchange: string };
export type DelistingState = "confirmed_exchange_delisting" | "removal_pending" | "unresolved";
export type TradingState = "suspended" | "suspension_scheduled" | "unresolved";
type Row = Record<string, unknown>;
export type DelistingEvidence = {
  rawItemId: string; eventId: string | null; accession: string; sourceUrl: string;
  sourceSha256: string; parserVersion: string; issuerCik: string | null;
  securityTitle: string | null; exchange: string | null; filedByCik: string | null;
  listing: DelistingState; trading: TradingState; removalDate: string | null;
  suspensionDate: string | null; reasons: string[]; parser: SecForm25ParserOutput | null;
  analysis: Row | null; listingRisk: CurrentListingRiskReadResult | null;
  sourceDocuments: { url: string; sha256: string; text: string }[];
};

/** Exact issuer + declared class + venue scope; never a ticker or issuer-wide lifecycle. */
export function evaluateStoredForm25(input: {
  raw: Row; scope: DelistingScope; asOf: string; event?: Row | null;
}): DelistingEvidence {
  const { raw, scope, event } = input;
  const payload = record(raw.raw_payload);
  const accession = string(raw.source_unique_id);
  const result: DelistingEvidence = {
    rawItemId: string(raw.id), eventId: string(event?.id) || null, accession,
    sourceUrl: string(raw.source_url), sourceSha256: sha(JSON.stringify(raw)),
    parserVersion: SEC_DELISTING_STATE_VERSION, issuerCik: null, securityTitle: null,
    exchange: null, filedByCik: null, listing: "unresolved", trading: "unresolved",
    removalDate: null, suspensionDate: null, reasons: [], parser: null,
    analysis: event ? record(record(event.metadata).display_payload) : null,
    listingRisk: null, sourceDocuments: [],
  };
  const fail = (reason: string) => { result.listing = "unresolved"; result.trading = "unresolved"; result.reasons.push(reason); return result; };
  if (!validDate(input.asOf) || !validScope(scope)) return fail("invalid_scope_or_as_of");
  if (!string(raw.published_at) || !Number.isFinite(Date.parse(string(raw.published_at)))
    || string(raw.published_at).slice(0, 10) > input.asOf) return fail("filing_date_unavailable_or_after_as_of");
  if (raw.source_code !== "sec_edgar" || !officialSource(result.sourceUrl, accession)) return fail("unverified_sec_source");
  if (string(payload.accession_number) && string(payload.accession_number) !== accession) return fail("accession_mismatch");
  if (event && (event.raw_item_id !== raw.id || event.source_code !== "sec_edgar")) return fail("event_raw_mismatch");
  const source = readStoredForm25Source(raw);
  if (source.status !== "available") return fail(source.reason);
  if (!source.parser.isSupported) return fail("verified_form25_xml_unavailable");
  const xml = source.primaryText;
  const primaryUrl = source.primary.url;
  const attachments = source.attachments;
  result.parser = source.parser;
  result.parserVersion = source.parser.parserVersion;
  result.sourceDocuments = source.documents.map(doc => ({ url: doc.url, sha256: doc.sha256, text: doc.text }));
  result.sourceSha256 = sha(JSON.stringify(result.sourceDocuments));
  if (records(payload.documents).some((row) => row.textTruncated === true || row.rawHtmlTruncated === true
    || row.rawTextTruncated === true || Boolean(row.fetchError) || typeof row.fetchStatus === "number" && row.fetchStatus >= 400)) return fail("document_inventory_incomplete_or_truncated");
  if (payload.text_truncated === true || attachments.some((row) => row.truncated === true)) return fail("source_truncated");
  if (attachments.some((row) => !(source.original ? officialForm25Source : officialSource)(string(row.url), accession) || !string(row.text))) return fail("unverified_attachment_source");
  // Reuse the existing parser twice: authoritative XML identities independently
  // of legacy catalog metadata, then the same parser with the stored notices.
  const base = { rawItemId: result.rawItemId, sourceUniqueId: accession, sourceUrl: primaryUrl,
    publishedAt: string(raw.published_at), bodyText: xml, rawPayload: { form_type: payload.form_type } };
  const identity = source.identity;
  if (!source.isXml || !identity.isSupported || !identity.facts.subject_company_cik?.source.endsWith(".xml.issuer.cik")
    || !identity.facts.removed_security?.source.endsWith(".xml.description_class_security")
    || !identity.facts.exchange?.source.endsWith(".xml.exchange.entity_name")) return fail("xml_identity_unavailable");
  const parsed = source.parser;
  result.parser = parsed; result.parserVersion = parsed.parserVersion;
  result.issuerCik = cik(identity.facts.subject_company_cik.value);
  result.securityTitle = identity.facts.removed_security.value;
  result.exchange = identity.facts.exchange.value;
  result.filedByCik = identity.facts.filed_by_cik?.value || null;
  if (result.issuerCik !== cik(scope.issuerCik) || exact(result.securityTitle) !== exact(scope.securityTitle)
    || exact(result.exchange) !== exact(scope.exchange)) return fail("issuer_security_or_exchange_mismatch");
  if (/;|\b(?:and|plus)\b|\bclass\s+[ab]\b.*\bclass\s+[ab]\b/i.test(result.securityTitle)) return fail("multiple_or_ambiguous_security_classes");

  const sourceFor = (field: SecForm25Field<string> | null): string => {
    if (!field) return "";
    const prefix = field.source.split(":")[0];
    return prefix === "primary_filing_text" ? xml : string(attachments[Number(prefix.replace("notice_", ""))]?.text);
  };
  const removal = parsed.facts.delisting_or_removal_date;
  const suspension = parsed.facts.trading_suspension_date;
  const noticeDates = new Set(attachments.map((row) => parseSecForm25Filing({ ...base,
    rawPayload: { form_type: payload.form_type, attachment_texts: [{ ...row, source: "notice" }] },
  }).facts.delisting_or_removal_date?.value).filter(Boolean));
  if (noticeDates.size > 1) return fail("notice_removal_date_conflict");
  const removalSource = sourceFor(removal);
  const suspensionSource = sourceFor(suspension);
  const dateConflict = form25AnalysisConflict(result.analysis, identity, removal, suspension);
  if (dateConflict) return fail(dateConflict);
  if ([xml, ...attachments.map((row) => string(row.text))].some((text) =>
    /\b(?:delisting|removal|form\s*25)[^.]{0,100}\b(?:withdrawn|rescinded|stayed|cancelled|canceled)\b|\b(?:withdraw|rescind|stay|cancel)\w*[^.]{0,70}\b(?:delisting|removal|form\s*25)\b/i.test(flat(text)))) {
    return fail("withdrawal_stay_or_conflicting_source_requires_review");
  }
  if (removal && validDate(removal.value) && sourceSupportsField(removal, removalSource)) {
    result.removalDate = removal.value;
    result.listing = "removal_pending";
    const sourceText = flat(removalSource);
    const fieldAt = sourceText.indexOf(flat(removal.evidence).replace(/\.\.\.$/, ""));
    const text = sourceText.slice(Math.max(0, fieldAt - 260), fieldAt + 260);
    if (securityConflict(text, result.securityTitle)) return fail("notice_security_conflict");
    // A date returned by the parser is only a candidate. Require an explicit
    // operative exchange-removal clause; never use the SEC index effectiveness
    // field, signature/filing date, or filing+10/90-day arithmetic.
    const operative = /\b(?:determined to remove|will be removed|was removed|has been removed|removal.{0,80}(?:is|becomes|became))\b.{0,250}\b(?:from listing|effective)\b/i.test(text)
      || /\bremove\b.{0,180}\bfrom listing\b.{0,120}\beffective\b/i.test(text);
    const conditional = /\b(?:intention|intends|proposed|subject to|unless|if approved|conditional|may remove)\b/i.test(sourceText);
    if (operative && !conditional && removal.value <= input.asOf) {
      result.listing = "confirmed_exchange_delisting";
      result.reasons.push("source_stated_removal_effective_as_of");
    } else result.reasons.push(conditional ? "reported_plan_not_completion_confirmation" : "removal_not_yet_confirmed");
  } else result.reasons.push("removal_effective_evidence_unavailable");
  if (suspension && validDate(suspension.value) && sourceSupportsField(suspension, suspensionSource)
    && /\b(?:was|were|is|has been|will be)\s+suspended\b/i.test(flat(suspensionSource))) {
    result.suspensionDate = suspension.value;
    result.trading = suspension.value <= input.asOf ? "suspended" : "suspension_scheduled";
  } else result.reasons.push("suspension_evidence_unavailable");
  return result;
}

/** Existing 8-K/6-K typed facts use their current official reader. The existing
 * cover parser is only the exact filing/security identity proof, not the state
 * classifier. Unsupported/missing cover identity remains unresolved. */
export function evaluateStoredListingRiskFiling(input: {
  raw: Row; scope: DelistingScope; asOf: string; event: Row;
}): DelistingEvidence {
  const result = evaluateStoredForm25(input);
  const payload = record(input.raw.raw_payload);
  if (!/^(8-K|6-K)(\/A)?$/.test(string(payload.form_type))
    || result.reasons.some((reason) => !["verified_form25_xml_unavailable", "xml_identity_unavailable"].includes(reason))) return result;
  try {
    const built = buildSecCoverObservationPayload(string(input.raw.id), input.raw);
    if (!built || !["available", "partial"].includes(built.payload.extractionStatus)
      || built.payload.identity.issuerCik !== cik(input.scope.issuerCik)) return { ...result, reasons: ["listing_risk_issuer_evidence_unavailable"] };
    const matches = built.payload.observations.filter((item) =>
      ["observed", "duplicate_equal"].includes(item.securityTitle.status)
      && ["observed", "duplicate_equal"].includes(item.exchange.status)
      && exact(item.securityTitle.parsedTextValue) === exact(input.scope.securityTitle)
      && exact(item.exchange.parsedTextValue) === exact(input.scope.exchange));
    if (matches.length !== 1) return { ...result, reasons: ["listing_risk_security_evidence_unavailable_or_ambiguous"] };
    const primary = rawString(payload.primary_document_html);
    const attachments = records(payload.attachment_texts);
    if (payload.text_truncated === true || attachments.some((item) => item.textTruncated === true
      || !officialSource(string(item.url), result.accession))) return { ...result, reasons: ["listing_risk_source_unverified"] };
    if (records(payload.documents).some((item) => item.textTruncated === true || item.rawHtmlTruncated === true
      || item.rawTextTruncated === true || Boolean(item.fetchError) || typeof item.fetchStatus === "number" && item.fetchStatus >= 400)) {
      return { ...result, reasons: ["listing_risk_source_unverified"] };
    }
    result.issuerCik = built.payload.identity.issuerCik;
    result.securityTitle = matches[0].securityTitle.parsedTextValue;
    result.exchange = matches[0].exchange.parsedTextValue;
    result.parserVersion = built.payload.extractionMethod;
    result.sourceDocuments = [{ url: string(payload.primary_document_url), sha256: sha(primary), text: primary },
      ...attachments.map((item) => ({ url: string(item.url), sha256: sha(rawString(item.text)), text: rawString(item.text) }))];
    result.sourceSha256 = sha(JSON.stringify(result.sourceDocuments));
    result.reasons = ["current_typed_listing_risk_required"];
    return result;
  } catch { return { ...result, reasons: ["listing_risk_identity_read_failed"] }; }
}

/** Already validated/current Listing Risk facts can supplement a supplied filing.
 * They cannot repair Form 25 source/identity conflicts or supply guessed dates. */
export function applyCurrentListingRiskEvidence(result: DelistingEvidence, current: CurrentListingRiskReadResult,
  scope: DelistingScope, asOf: string): DelistingEvidence {
  result = { ...result, reasons: [...result.reasons], listingRisk: current };
  if (current.status !== "available") return result;
  if (result.reasons.some((reason) => /mismatch|unverified|conflict|withdrawal|ambiguous|invalid|truncated|incomplete|xml_identity|verified_form25|issuer_evidence|security_evidence|identity_read_failed|filing_date_unavailable/.test(reason))) {
    return { ...result, listing: "unresolved", trading: "unresolved" };
  }
  if (current.eventId !== result.eventId || current.rawItemId !== result.rawItemId
    || result.issuerCik !== cik(scope.issuerCik)
    || exact(current.facts.affected_security.title.value) !== exact(scope.securityTitle)
    || exact(current.facts.exchange.value) !== exact(scope.exchange)) {
    return { ...result, listing: "unresolved", trading: "unresolved", reasons: [...result.reasons, "listing_risk_identity_mismatch"] };
  }
  const facts = current.facts;
  const supported = (path: string, field: { value: string | null; availability: string; value_quality: string }) => {
    const provenance = facts.fact_provenance.find((item) => item.fact_path === path);
    const source = facts.sources.find((item) => item.source_ref === provenance?.source_ref);
    return field.availability === "available" && field.value_quality === "exact" && validDate(field.value)
      && provenance?.origin === "source_stated" && provenance.evidence_status === "available"
      && source?.source_family === "sec" && officialSource(source.source_url || "", result.accession)
      && Boolean(provenance.evidence && result.sourceDocuments.some((doc) => flat(doc.text).includes(flat(provenance.evidence!))));
  };
  const removal = facts.dates.removal_effective_date;
  const suspension = facts.dates.trading_suspension_date;
  if (removal.value && result.removalDate && removal.value !== result.removalDate) {
    return { ...result, listing: "unresolved", reasons: [...result.reasons, "removal_date_conflict"] };
  }
  if (result.listing === "confirmed_exchange_delisting" && removal.date_status === "conditional") {
    return { ...result, listing: "unresolved", reasons: [...result.reasons, "conditional_listing_risk_conflict"] };
  }
  if (facts.classification.event_kind === "listing_removal" && removal.date_status === "occurred"
    && supported("dates.removal_effective_date.value", removal) && removal.value! <= asOf
    && !result.reasons.some((reason) => /mismatch|unverified|conflict|withdrawal|ambiguous/.test(reason))) {
    result.listing = "confirmed_exchange_delisting"; result.removalDate = removal.value;
    result.reasons.push("current_listing_risk_source_stated_occurred_removal");
  }
  if (facts.classification.event_kind === "delisting_determination" || facts.classification.event_kind === "voluntary_withdrawal"
    || facts.classification.event_kind === "listing_removal" && removal.date_status !== "occurred") {
    if (result.listing !== "confirmed_exchange_delisting") result.listing = "removal_pending";
  }
  if (suspension.date_status === "occurred" && supported("dates.trading_suspension_date.value", suspension) && suspension.value! <= asOf) {
    result.trading = "suspended"; result.suspensionDate = suspension.value;
  }
  return result;
}

function form25AnalysisConflict(analysis: Row | null, parsed: SecForm25ParserOutput,
  removal: SecForm25Field<string> | null, suspension: SecForm25Field<string> | null) {
  const data = record(analysis?.data);
  if (!Object.keys(data).length) return null;
  if (string(data.subject_company_cik) && cik(string(data.subject_company_cik)) !== cik(parsed.facts.subject_company_cik?.value)
    || string(data.removed_security) && exact(string(data.removed_security)) !== exact(parsed.facts.removed_security?.value)
    || string(data.exchange) && exact(string(data.exchange)) !== exact(parsed.facts.exchange?.value)) return "analysis_identity_conflict";
  if (string(data.delisting_or_removal_date) && data.delisting_or_removal_date !== removal?.value
    || string(data.trading_suspension_date) && data.trading_suspension_date !== suspension?.value) return "analysis_date_conflict";
  return null;
}
function sourceSupportsField(field: SecForm25Field<string>, source: string) {
  const evidence = flat(field.evidence).replace(/\.\.\.$/, "");
  return field.confidence === "high" && evidence.length >= 15 && flat(source).includes(evidence);
}
function securityConflict(text: string, title: string) {
  const removalClause = flat(text);
  for (const kind of ["warrants?", "preferred", "debentures?", "notes?", "bonds?"]) {
    if (new RegExp(`\\b${kind}\\b`, "i").test(title)) continue;
    if (new RegExp(`\\b(?:remove\\w*|delist\\w*).{0,170}\\b${kind}\\b|\\b${kind}\\b.{0,100}\\b(?:removed|delisted)\\b`, "i").test(removalClause)) return true;
  }
  const declaredClass = title.match(/\bclass\s+([a-z0-9-]+)\b/i)?.[1]?.toLowerCase();
  const mentionedClass = removalClause.match(/\b(?:remove\w*|delist\w*).{0,170}\bclass\s+([a-z0-9-]+)\b/i)?.[1]?.toLowerCase();
  return Boolean(mentionedClass && mentionedClass !== declaredClass);
}
export function officialSource(url: string, accession: string) {
  try { const parsed = new URL(url); return parsed.protocol === "https:" && parsed.hostname === "www.sec.gov"
    && /^\d{10}-\d{2}-\d{6}$/.test(accession)
    && new RegExp(`^/Archives/edgar/data/\\d+/${accession.replaceAll("-", "")}/[^/]+$`, "i").test(parsed.pathname); }
  catch { return false; }
}
export function validScope(scope: DelistingScope) { return Boolean(cik(scope.issuerCik) && exact(scope.securityTitle) && exact(scope.exchange)); }
export function validDate(value: unknown): value is string { return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value; }
export function record(value: unknown): Row { return value && typeof value === "object" && !Array.isArray(value) ? value as Row : {}; }
function records(value: unknown): Row[] { return Array.isArray(value) ? value.map(record) : []; }
function cik(value: unknown) { return typeof value === "string" && /^\d{1,10}$/.test(value) && Number(value) > 0 ? value.padStart(10, "0") : null; }
function string(value: unknown) { return typeof value === "string" ? value.trim() : ""; }
function rawString(value: unknown) { return typeof value === "string" ? value : ""; }
function flat(value: string) { return value.replace(/\s+/g, " ").trim(); }
function exact(value: string | null | undefined) { return flat(value || "").toLowerCase(); }
function sha(value: string) { return createHash("sha256").update(value).digest("hex"); }
