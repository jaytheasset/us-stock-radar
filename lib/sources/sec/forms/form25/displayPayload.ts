import {
  SEC_FORM25_APPROVED_EVENT_TYPES,
  SEC_FORM25_DISPLAY_PAYLOAD_VERSION,
  SEC_FORM25_DISPLAY_TYPE_VALUES,
  type SecForm25ApprovedEventType,
  type SecForm25DisplayType,
  type SecForm25ParserOutput,
} from "./parser";

export type SecForm25SelectedClassification = {
  event_type: SecForm25ApprovedEventType;
  display_type: SecForm25DisplayType;
  display_version: typeof SEC_FORM25_DISPLAY_PAYLOAD_VERSION;
  classification_source: "parser_deterministic" | "router" | "fallback";
  routing_reason: string;
  analysis_llm_needed: boolean;
  needs_human_review: boolean;
};

export type SecForm25DisplayPayload = {
  display_type: SecForm25DisplayType;
  display_version: typeof SEC_FORM25_DISPLAY_PAYLOAD_VERSION;
  data: ReturnType<typeof summarizeForm25ForDisplay>;
  evidence: string[];
  notes: string[];
};

export function resolveSecForm25SelectedClassification(
  parserOutput: SecForm25ParserOutput,
  routerResult: Record<string, unknown>
): SecForm25SelectedClassification {
  const facts = parserOutput.facts;
  const routerEventType = approvedEventType(routerResult.event_type);
  const parserEventType = facts.routing.event_type;
  const eventType = routerEventType || parserEventType || facts.routing.suggested_event_types[0] || "other";
  const routerDisplayType = displayType(routerResult.display_type);
  const displayTypeValue = routerDisplayType || facts.routing.display_type || "sec_form25_listing_removal";
  const displayVersion =
    routerResult.display_version === SEC_FORM25_DISPLAY_PAYLOAD_VERSION
      ? SEC_FORM25_DISPLAY_PAYLOAD_VERSION
      : facts.routing.display_version || SEC_FORM25_DISPLAY_PAYLOAD_VERSION;
  const usedRouter = Boolean(routerEventType);
  const usedFallback = !usedRouter && !parserEventType;

  return {
    event_type: eventType,
    display_type: displayTypeValue,
    display_version: displayVersion,
    classification_source: usedRouter ? "router" : usedFallback ? "fallback" : "parser_deterministic",
    routing_reason:
      stringValue(routerResult.routing_reason) ||
      facts.routing.classification_reason ||
      "No router result was supplied; using parser suggested event type.",
    analysis_llm_needed: booleanValue(routerResult.analysis_llm_needed) ?? facts.routing.analysis_llm_required,
    needs_human_review: booleanValue(routerResult.needs_human_review) ?? facts.routing.router_required,
  };
}

export function buildSecForm25DisplayPayload(
  parserOutput: SecForm25ParserOutput,
  selectedClassification = resolveSecForm25SelectedClassification(parserOutput, {})
): SecForm25DisplayPayload {
  return {
    display_type: selectedClassification.display_type,
    display_version: selectedClassification.display_version,
    data: summarizeForm25ForDisplay(parserOutput),
    evidence: buildDisplayEvidence(parserOutput),
    notes: buildDisplayNotes(parserOutput, selectedClassification),
  };
}

export function summarizeForm25ForDisplay(parserOutput: SecForm25ParserOutput) {
  const facts = parserOutput.facts;
  return {
    accession_number: parserOutput.accessionNumber,
    source_url: facts.source_url,
    source_form_type: facts.source_form_type,
    filing_date: facts.filing_date?.value || null,
    effectiveness_date: facts.effectiveness_date?.value || null,
    issuer_name: facts.issuer_name?.value || null,
    subject_company_cik: facts.subject_company_cik?.value || null,
    filed_by_name: facts.filed_by_name?.value || null,
    filed_by_cik: facts.filed_by_cik?.value || null,
    primary_ticker: facts.primary_ticker?.value || null,
    primary_ticker_exchange: facts.primary_ticker_exchange?.value || null,
    removed_security: facts.removed_security?.value || null,
    security_category: facts.security_category.value,
    exchange: facts.exchange?.value || null,
    rule_provision: facts.rule_provision?.value || null,
    removal_reason: facts.removal_reason_category.value,
    removal_reason_text: facts.removal_reason_text?.value || null,
    common_equity_affected: facts.common_equity_affected.value,
    delisting_or_removal_date: facts.delisting_or_removal_date?.value || null,
    trading_suspension_date: facts.trading_suspension_date?.value || null,
    continued_listing_or_trading_venue: facts.continued_listing_or_trading_venue?.value || null,
    successor_or_acquirer: facts.successor_or_acquirer?.value || null,
    consideration_summary: facts.consideration_summary?.value || null,
    ipo_kind: null,
    deterministic_case: facts.filing_meaning.case,
    router_required: facts.routing.router_required,
  };
}

function buildDisplayEvidence(parserOutput: SecForm25ParserOutput) {
  const facts = parserOutput.facts;
  const snippets = [
    ...facts.filing_meaning.evidence,
    ...facts.routing.classification_evidence,
    ...parserOutput.raw.selectedEvidenceSnippets.map((snippet) => snippet.text),
  ];
  return [...new Set(snippets.map((snippet) => truncate(snippet, 260)).filter(Boolean))].slice(0, 8);
}

function buildDisplayNotes(parserOutput: SecForm25ParserOutput, selectedClassification: SecForm25SelectedClassification) {
  const notes = [
    `display_payload_version:${selectedClassification.display_version}`,
    `classification_source:${selectedClassification.classification_source}`,
    selectedClassification.analysis_llm_needed ? "analysis_llm_needed" : "analysis_llm_optional",
    parserOutput.facts.routing.router_required ? "router_required" : "router_not_required",
    ...parserOutput.warnings.map((warning) => `warning:${warning}`),
    `document_count:${parserOutput.raw.sourceInventory.documents.length}`,
    `attachment_count:${parserOutput.raw.sourceInventory.attachments.length}`,
  ];
  return [...new Set(notes)].slice(0, 12);
}

function approvedEventType(value: unknown): SecForm25ApprovedEventType | null {
  return typeof value === "string" && SEC_FORM25_APPROVED_EVENT_TYPES.includes(value as SecForm25ApprovedEventType)
    ? (value as SecForm25ApprovedEventType)
    : null;
}

function displayType(value: unknown): SecForm25DisplayType | null {
  return typeof value === "string" && SEC_FORM25_DISPLAY_TYPE_VALUES.includes(value as SecForm25DisplayType)
    ? (value as SecForm25DisplayType)
    : null;
}

function booleanValue(value: unknown) {
  return typeof value === "boolean" ? value : null;
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function truncate(value: string, max: number) {
  const text = value.replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 3).trim()}...` : text;
}
