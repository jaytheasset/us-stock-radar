import { randomUUID } from "node:crypto";
import { evaluateCalendarItemPolicy } from "@/lib/calendarPolicy";
import { getCalendarEventGroup, normalizeCalendarEventType } from "@/lib/calendarEventRegistry";
import { SEC_INTEGRATION_EVENT_TYPES } from "@/lib/sources/sec/forms/common/secIntegrationContract";
import { SIGNAL_VALUES } from "@/lib/prompts/newsEventAnalysis";
import {
  persistOptionalMonitorFoundation,
  persistOwnershipAnalysisFacts,
} from "@/lib/monitor/persistence";
import { buildOwnershipParserFactRows } from "@/lib/monitor/ownershipParserFacts";
import {
  buildMinimalOfferingMarketSnapshot,
  prepareMinimalOfferingMonitorPersistence,
} from "@/lib/minimalOfferingMonitor";
import { buildSecFilingAlertCandidate, enqueueSecFilingAlertCandidate } from "@/lib/secStores/alertQueue";
import { buildSecValidationRepairTrace } from "@/lib/secValidationRepairTrace";
import {
  buildSecIssuerEventTickerRows,
  buildSecIssuerSecurityLinkageMetadata,
  buildSecFilingGroupDedupe,
  readSecAnalysisContextTickers,
  resolveSecIssuerProductTickerState,
  resolveSecIssuerSecurityEvidence,
  resolveSecIssuerSecurityLinkage,
  type SecIssuerSecurityEvidence,
  type SecIssuerSecurityLinkage,
} from "@/lib/secIssuerEventLinkage";
import { supabaseDelete, supabaseSelect, supabaseUpdate, supabaseUpsert } from "@/lib/supabase";

export {
  buildSecFilingGroupDedupe,
  buildSecFilingGroupDedupeKey,
  buildSecFilingLegacyGroupDedupeKey,
  isSecOwnershipFormType,
} from "@/lib/secIssuerEventLinkage";

type SourceGroup = "filings";
type MarketScope = "company" | "sector" | "theme" | "macro";
type Signal = (typeof SIGNAL_VALUES)[number];
type DeliveryLevel = "archive" | "feed" | "alert";
type Impact = "high" | "medium" | "low";
type AnalysisScope = "company" | "sector" | "theme" | "market";
type PersistedRow = Record<string, unknown>;

const allowedEventTypes = new Set<string>(SEC_INTEGRATION_EVENT_TYPES);
const allowedSignals = new Set<string>(SIGNAL_VALUES);
const allowedTickerRoles = new Set<string>([
  "primary",
  "related",
  "peer",
  "customer",
  "supplier",
  "counterparty",
  "mentioned",
  "sector_constituent",
  "theme_constituent",
]);
export async function saveAnalyzedSecFilingEvent({
  rawRow,
  input,
  analysis,
  model,
  openAiResponseId,
  promptKey,
  promptVersion,
}: {
  rawRow: PersistedRow;
  input?: Record<string, unknown>;
  analysis: Record<string, unknown>;
  model: string;
  openAiResponseId: string | null;
  promptKey: string;
  promptVersion: string;
  force: boolean;
}) {
  const rawPayload = toRecord(rawRow.raw_payload) || {};
  const filingPackage = toRecord(input?.filing_package) || {};
  const marketContext = toRecord(filingPackage.market_context);
  const dilutionMetrics = toRecord(filingPackage.dilution_metrics);
  const offeringSecurityAudit = toRecord(analysis.offering_security_audit) || toRecord(filingPackage.offering_security_audit);
  const resolvedMarketCap = toRecord(analysis.resolved_market_cap);
  const score = clampScore(numberValue(analysis.score));
  const eventType = normalizeEventType(stringValue(analysis.event_type));
  const signal = normalizeSignal(stringValue(analysis.signal));
  const marketScope = normalizeMarketScope(stringValue(analysis.market_scope));
  const issuerSecurityEvidence = resolveSecIssuerSecurityEvidence(rawPayload);
  const issuerSecurityLinkage = await resolveFmpValidatedIssuerSecurityLinkage(
    rawPayload,
    issuerSecurityEvidence,
  );
  const tickerState = resolveSecIssuerProductTickerState({
    evidence: issuerSecurityEvidence,
    fallback: readPrimaryTicker(analysis, rawPayload, filingPackage),
    linkage: issuerSecurityLinkage,
  });
  const primaryTicker = tickerState.primarySecurity;
  const groupDedupe = buildSecFilingGroupDedupe(rawRow);
  const groupDedupeKey = groupDedupe.groupDedupeKey;
  const existing = await findExistingEventByDedupeKeys(groupDedupe.lookupGroupDedupeKeys);
  const id = stringValue(existing?.id) || randomUUID();
  const ownershipRawItem = promptKey === "sec_ownership_analysis" ? rawRow : null;
  if (ownershipRawItem) {
    // Fail closed before the analyzed event is written. The parser is invoked
    // again by the strict persistence call so validation and row construction
    // remain one inseparable product boundary there as well.
    buildOwnershipParserFactRows({
      eventId: id,
      rawItem: ownershipRawItem,
      symbol: primaryTicker.ticker,
    });
  }
  const deliveryLevel = deliveryLevelFromScore(score);
  const displayPayload = toRecord(analysis.display_payload);
  const transactionFingerprint = toRecord(analysis.transaction_fingerprint);
  const archiveSummary = nullableString(analysis.archive_summary) || (deliveryLevel === "archive" ? nullableString(analysis.summary) : null);
  const analysisRuntimeSource =
    nullableString(analysis.analysis_runtime_source) || (openAiResponseId ? "llm" : "parser_deterministic");
  const archiveRoute =
    deliveryLevel === "archive"
      ? analysisRuntimeSource === "llm"
        ? "common_filing_detail"
        : "compact_archive"
      : null;
  const payload = {
    id,
    raw_item_id: stringValue(rawRow.id),
    source_code: "sec_edgar",
    source_group: "filings" satisfies SourceGroup,
    source_name: "SEC EDGAR",
    source_url: stringValue(rawRow.source_url),
    published_at: stringValue(rawRow.published_at) || null,
    ticker: primaryTicker.ticker,
    market: primaryTicker.exchange,
    event_type: eventType,
    score,
    delivery_level: deliveryLevel,
    impact: impactFromScore(score),
    signal,
    market_scope: marketScope,
    sector: nullableString(analysis.sector),
    industry_group: nullableString(analysis.industry_group),
    theme_group: nullableString(analysis.theme_group),
    sub_theme: nullableString(analysis.sub_theme),
    title: stringValue(analysis.event_title) || stringValue(rawRow.title) || "SEC filing event",
    quick_take: stringValue(analysis.quick_take),
    summary: stringValue(analysis.summary),
    reason: stringValue(analysis.score_reason),
    detected_at: new Date().toISOString(),
    group_dedupe_key: groupDedupeKey,
    cross_group_event_key: buildCrossGroupEventKey(primaryTicker.ticker, eventType, stringValue(analysis.event_title)),
    metadata: {
      issuer: nullableString(rawPayload.company_name),
      source_type: "SEC Filing",
      source_release_type: "Official Filing",
      accession_number: nullableString(rawPayload.accession_number) || nullableString(rawRow.source_unique_id),
      form_type: nullableString(rawPayload.form_type),
      cik: nullableString(rawPayload.cik),
      issuer_security_linkage: issuerSecurityLinkage
        ? buildSecIssuerSecurityLinkageMetadata(issuerSecurityLinkage)
        : null,
      primary_document_url: nullableString(rawPayload.primary_document_url),
      confidence: stringValue(analysis.confidence),
      needs_human_review: Boolean(analysis.needs_human_review),
      score_reason: stringValue(analysis.score_reason),
      openai_model: model,
      openai_response_id: openAiResponseId,
      analysis_runtime_source: analysisRuntimeSource,
      archive_route: archiveRoute,
      prompt_key: promptKey,
      prompt_version: promptVersion,
      analysis_action: nullableString(analysis.analysis_action),
      s3_case: nullableString(analysis.s3_case),
      sec_tender_route_case: nullableString(analysis.sec_tender_route_case),
      sec_tender_router_result: toRecord(analysis.sec_tender_router_result),
      archive_summary: archiveSummary,
      filing_context: toRecord(filingPackage.filing_context),
      parent_registration_context: toRecord(filingPackage.parent_registration_context),
      parent_filing_context: compactParentFilingContextForMetadata(filingPackage.parent_filing_context),
      related_filing_contexts: compactRelatedFilingContextsForMetadata(filingPackage.related_filing_contexts),
      display_payload: displayPayload,
      transaction_fingerprint: transactionFingerprint,
      display_payload_storage_target: nullableString(analysis.display_payload_storage_target),
      display_payload_storage_mode: nullableString(analysis.display_payload_storage_mode),
      candidate_special_metadata_only: Boolean(analysis.candidate_special_metadata_only),
      offering_display_model: toRecord(analysis.offering_display_model),
      offering_security_audit: offeringSecurityAudit,
      listing_status_snapshot: normalizeJsonArray(analysis.listing_status_snapshot),
      material_events: normalizeJsonArray(analysis.material_events),
      sec_8k_6k_amendment_delta: toRecord(analysis.sec_8k_6k_amendment_delta),
      sec_8k_6k_prompt_metadata: toRecord(analysis.sec_8k_6k_prompt_metadata),
      ...(resolvedMarketCap ? { resolved_market_cap: resolvedMarketCap } : {}),
      market_context: marketContext,
      dilution_metrics: dilutionMetrics,
      related_tickers: analysis.related_tickers || [],
      nt_validation_warnings: Array.isArray(analysis.nt_validation_warnings)
        ? analysis.nt_validation_warnings
        : [],
      nt_validation_repair: toRecord(analysis.nt_validation_repair),
      nt_post_repair_enforcement: toRecord(analysis.nt_post_repair_enforcement),
    },
  };

  const result = await supabaseUpsertSanitized("events", payload, { onConflict: "id" });
  await assertMutation(result, "upsert SEC filing event");
  const eventRow = firstRow(result.data) || payload;

  if (ownershipRawItem) {
    await persistOwnershipAnalysisFacts({
      eventId: stringValue(eventRow.id),
      eventTime: stringValue(eventRow.detected_at) || payload.detected_at,
      primaryTicker: primaryTicker.ticker
        ? {
            symbol: primaryTicker.ticker,
            exchange: primaryTicker.exchange,
            securityKey: "primary",
          }
        : null,
      ownershipRawItem,
      ownershipInputState: "known",
    });
  }

  await Promise.all([
    persistEventAnalysis(eventRow, analysis, marketScope),
    persistEventOfferingTerms({
      eventRow,
      rawRow,
      input,
      analysis,
      model,
      promptKey,
      promptVersion,
    }),
    replaceEventTickers(
      stringValue(eventRow.id),
      analysis,
      primaryTicker,
      issuerSecurityLinkage,
    ),
    replaceEventCalendarItems({
      eventRow,
      rawRow,
      analysis,
      primaryTicker,
      promptKey,
      promptVersion,
    }),
  ]);
  await persistOptionalMonitorFoundation({
    eventId: stringValue(eventRow.id),
    eventTime: stringValue(eventRow.detected_at) || payload.detected_at,
    primaryTicker: primaryTicker.ticker
      ? {
          symbol: primaryTicker.ticker,
          exchange: primaryTicker.exchange,
          securityKey: "primary",
        }
      : null,
    analysisMarketContext: marketContext,
    ownershipInputState: "not_applicable",
  });
  await enqueueSecFilingAlertCandidate(buildSecFilingAlertCandidate(eventRow, analysis));

  return eventRow;
}

export async function saveOwnershipParserDetailsEvent({
  rawRow,
  promptKey,
  promptVersion,
}: {
  rawRow: PersistedRow;
  promptKey: string;
  promptVersion: string;
}) {
  const rawPayload = toRecord(rawRow.raw_payload) || {};
  const groupDedupe = buildSecFilingGroupDedupe(rawRow);
  const existing = await findExistingEventByDedupeKeys(groupDedupe.lookupGroupDedupeKeys);
  const id = stringValue(existing?.id) || randomUUID();
  const prepared = buildOwnershipParserFactRows({
    eventId: id,
    rawItem: rawRow,
    symbol: nullableString(rawPayload.ticker),
  });
  const detectedAt = new Date().toISOString();
  const detailsMetadata = {
    issuer: nullableString(rawPayload.company_name),
    source_type: "SEC Filing",
    source_release_type: "Official Filing",
    accession_number: prepared.accessionNumber,
    form_type: prepared.formType,
    cik: nullableString(rawPayload.cik),
    primary_document_url: nullableString(rawPayload.primary_document_url),
    prompt_key: promptKey,
    prompt_version: promptVersion,
    analysis_status: "failed",
    summary_status: "failed",
    analysis_runtime_source: "ownership_parser_details_only",
    ownership_details_status: "pending",
    ownership_details_canonical_source: "sec_ownership_xml_parser",
    ownership_source_url: prepared.sourceUrl,
    ownership_parser_version: prepared.parserOutput.parserVersion,
  };
  const payload = {
    id,
    raw_item_id: stringValue(rawRow.id),
    source_code: "sec_edgar",
    source_group: "filings" satisfies SourceGroup,
    source_name: "SEC EDGAR",
    source_url: stringValue(rawRow.source_url),
    published_at: stringValue(rawRow.published_at) || null,
    ticker: prepared.symbol,
    market: nullableString(rawPayload.exchange),
    event_type: "insider_ownership",
    score: 0,
    delivery_level: "archive" satisfies DeliveryLevel,
    impact: "low" satisfies Impact,
    signal: "neutral" satisfies Signal,
    market_scope: "company" satisfies MarketScope,
    sector: null,
    industry_group: null,
    theme_group: null,
    sub_theme: null,
    title: stringValue(rawRow.title) || `SEC Form ${prepared.formType} filing (analysis unavailable)`,
    quick_take: null,
    summary: null,
    reason: null,
    detected_at: detectedAt,
    group_dedupe_key: groupDedupe.groupDedupeKey,
    cross_group_event_key: buildCrossGroupEventKey(
      prepared.symbol,
      "insider_ownership",
      `SEC Form ${prepared.formType} ${prepared.accessionNumber}`,
    ),
    metadata: detailsMetadata,
  };

  let eventRow = existing;
  if (!eventRow) {
    const result = await supabaseUpsertSanitized("events", payload, { onConflict: "id" });
    await assertMutation(result, "upsert SEC Ownership parser details event");
    eventRow = firstRow(result.data) || payload;
  }

  const persistence = await persistOwnershipAnalysisFacts({
    eventId: stringValue(eventRow.id),
    eventTime: stringValue(eventRow.detected_at) || detectedAt,
    primaryTicker: prepared.symbol
      ? {
          symbol: prepared.symbol,
          exchange: nullableString(eventRow.market),
          securityKey: "primary",
        }
      : null,
    ownershipRawItem: rawRow,
    ownershipInputState: "known",
  });

  const existingMetadata = toRecord(eventRow.metadata) || {};
  if (!existing || existingMetadata.analysis_runtime_source === "ownership_parser_details_only") {
    const completedMetadata = {
      ...existingMetadata,
      ...detailsMetadata,
      ownership_details_status: "available",
    };
    const result = await supabaseUpdate(
      "events",
      { id: `eq.${stringValue(eventRow.id)}` },
      { metadata: sanitizeForPostgresJson(completedMetadata) as Record<string, unknown> },
      { prefer: "return=representation" },
    );
    await assertMutation(result, "mark SEC Ownership parser details available");
    eventRow = firstRow(result.data) || { ...eventRow, metadata: completedMetadata };
  }

  return { event: eventRow, persistence };
}

async function resolveFmpValidatedIssuerSecurityLinkage(
  rawPayload: Record<string, unknown>,
  evidence: SecIssuerSecurityEvidence | null,
) {
  if (!evidence) return null;

  const symbols = evidence.candidateSecurities.map(
    (security) => security.ticker,
  );
  const fmpTickerResult = await supabaseSelect("tickers", {
    select: "symbol,name,exchange,asset_type,is_active,metadata",
    symbol: `in.(${symbols.join(",")})`,
    is_active: "eq.true",
    asset_type: "in.(stock,adr_or_class)",
    "metadata->>provider": "eq.fmp",
    limit: String(Math.max(20, symbols.length * 2)),
  });

  return resolveSecIssuerSecurityLinkage(
    rawPayload,
    fmpTickerResult.ok && Array.isArray(fmpTickerResult.data)
      ? fmpTickerResult.data
      : [],
  );
}

function compactParentFilingContextForMetadata(value: unknown) {
  const context = toRecord(value);
  if (!context) return null;
  const compact = { ...context };
  delete compact.source_blocks;
  delete compact.sourceBlocks;
  return compact;
}

function compactRelatedFilingContextsForMetadata(value: unknown) {
  return recordArray(value)
    .slice(0, 6)
    .map((context) => ({
      match_source: nullableString(context.match_source) || "explicit_related_filing_context",
      match_method: nullableString(context.match_method),
      match_confidence: nullableString(context.confidence),
      event_id: nullableString(context.event_id),
      raw_item_id: nullableString(context.raw_item_id),
      accession_number: nullableString(context.accession_number),
      form_type: nullableString(context.form_type) || nullableString(context.referenced_form_type),
      filed_at: nullableString(context.filed_at) || nullableString(context.referenced_filed_date),
      source_url: nullableString(context.source_url),
      company_name: nullableString(context.company_name),
      ticker: nullableString(context.ticker),
      event_type: nullableString(context.event_type),
      score: numberValue(context.score),
      delivery_level: nullableString(context.delivery_level),
      signal: nullableString(context.signal),
      event_title: nullableString(context.event_title),
      quick_take: nullableString(context.quick_take),
      summary: nullableString(context.summary),
      reference_evidence: nullableString(context.reference_evidence),
    }));
}

async function persistEventAnalysis(
  eventRow: PersistedRow,
  analysis: Record<string, unknown>,
  marketScope: MarketScope,
) {
  const payload = {
    event_id: stringValue(eventRow.id),
    analysis_scope: analysisScopeFromMarketScope(marketScope),
    why_it_matters: stringValue(analysis.why_it_matters),
    bullish_points: stringArray(analysis.bullish_points),
    bearish_points: stringArray(analysis.bearish_points),
    key_evidence: stringArray(analysis.key_evidence),
    watch_next: stringArray(analysis.what_to_watch_next),
    metadata: {
      confidence: stringValue(analysis.confidence),
      needs_human_review: Boolean(analysis.needs_human_review),
      score_explanation: toRecord(analysis.score_explanation),
      offering_display_model: toRecord(analysis.offering_display_model),
      offering_security_audit: toRecord(analysis.offering_security_audit),
      listing_status_snapshot: normalizeJsonArray(analysis.listing_status_snapshot),
      sec_8k_6k_amendment_delta: toRecord(analysis.sec_8k_6k_amendment_delta),
      sec_8k_6k_prompt_metadata: toRecord(analysis.sec_8k_6k_prompt_metadata),
    },
  };

  const result = await supabaseUpsertSanitized("event_analysis", payload, { onConflict: "event_id" });
  await assertMutation(result, "upsert SEC filing event analysis");
}

async function persistEventOfferingTerms({
  eventRow,
  rawRow,
  input,
  analysis,
  model,
  promptKey,
  promptVersion,
}: {
  eventRow: PersistedRow;
  rawRow: PersistedRow;
  input?: Record<string, unknown>;
  analysis: Record<string, unknown>;
  model: string;
  promptKey: string;
  promptVersion: string;
}) {
  if (!shouldPersistEventOfferingTerms(eventRow, analysis)) return;

  const rawPayload = toRecord(rawRow.raw_payload) || {};
  const filingPackage = toRecord(input?.filing_package) || {};
  const hardParsers = toRecord(filingPackage.hard_parsers);
  const s3 = toRecord(hardParsers?.s3);
  const offeringTerms = toRecord(s3?.offering_terms);
  const marketContext = toRecord(filingPackage.market_context);
  const dilutionMetrics = toRecord(filingPackage.dilution_metrics);
  const displayModel = toRecord(analysis.offering_display_model);
  const isLlmOfferingAnalysis =
    promptKey === "sec_424b_analysis" ||
    stringValue(analysis.sec_424b_analysis_mode) === "analysis_only" ||
    stringValue(analysis.sec_offering_analysis_mode) === "analysis_only";
  const registeredSecurityTotals = toRecord(displayModel?.registered_security_totals);
  const adsEquivalence = toRecord(displayModel?.ads_equivalence);
  const audit = toRecord(analysis.offering_security_audit) || toRecord(filingPackage.offering_security_audit);
  const securityStack = toRecord(audit?.security_stack);
  const proceedsStack = toRecord(audit?.proceeds_stack);
  const cashTerms = toRecord(displayModel?.key_cash_terms);

  const currentSharesFact = firstShareFact([
    isLlmOfferingAnalysis ? toRecord(registeredSecurityTotals?.current_shares_outstanding) : null,
    toRecord(displayModel?.current_shares),
    toRecord(securityStack?.current_shares_outstanding),
  ]);
  const totalSupplyFact = firstShareFact([
    isLlmOfferingAnalysis ? toRecord(registeredSecurityTotals?.ordinary_shares_represented) : null,
    isLlmOfferingAnalysis ? toRecord(adsEquivalence?.ordinary_shares_represented) : null,
    isLlmOfferingAnalysis ? toRecord(registeredSecurityTotals?.total_distinct_share_exposure) : null,
    toRecord(displayModel?.total_potential_supply),
    toRecord(securityStack?.max_registered_stack_share_equivalent),
    toRecord(securityStack?.registered_resale_supply),
    toRecord(securityStack?.resale_selling_stockholder_shares),
    toRecord(securityStack?.primary_common_shares_offered),
    toRecord(securityStack?.primary_common_shares_registered),
  ]);
  const resaleSupplyFact = firstShareFact([
    isLlmOfferingAnalysis ? toRecord(registeredSecurityTotals?.ordinary_shares_represented) : null,
    isLlmOfferingAnalysis ? toRecord(adsEquivalence?.ordinary_shares_represented) : null,
    isLlmOfferingAnalysis ? toRecord(registeredSecurityTotals?.resale_common_shares) : null,
    toRecord(securityStack?.registered_resale_supply),
    toRecord(securityStack?.resale_selling_stockholder_shares),
    toRecord(displayModel?.total_potential_supply),
  ]);
  const publicFloatFact = firstShareFact([
    toRecord(securityStack?.public_float),
  ]);
  const offeringAmountFact = firstMoneyFact([
    toRecord(cashTerms?.issuer_primary_or_closing_cash),
    toRecord(cashTerms?.private_placement_proceeds),
    toRecord(proceedsStack?.company_gross_proceeds),
    toRecord(proceedsStack?.company_net_proceeds),
    toRecord(proceedsStack?.primary_offering_proceeds),
    toRecord(proceedsStack?.private_placement_proceeds),
  ]);
  const offeringPriceFact = firstFact([toRecord(proceedsStack?.offering_price)]);
  const conversionPriceFact = firstFact([toRecord(proceedsStack?.conversion_price)]);
  const warrantExercisePriceFact = firstFact([
    isLlmOfferingAnalysis ? toRecord(registeredSecurityTotals?.warrant_exercise_price) : null,
    toRecord(proceedsStack?.warrant_exercise_price),
  ]);
  const notePrincipalFact = firstFact([toRecord(proceedsStack?.note_principal)]);
  const warrantCashFact = firstFact([
    toRecord(cashTerms?.common_warrant_cash_exercise_proceeds),
    toRecord(cashTerms?.conditional_warrant_cash),
    toRecord(proceedsStack?.common_warrant_cash_exercise_proceeds),
    toRecord(proceedsStack?.possible_warrant_exercise_proceeds),
  ]);

  const displaySegments = recordArray(displayModel?.supply_segments);
  const futureSegments = recordArray(displayModel?.future_or_excluded_overhang);
  const explicit424bPrimaryCommonShares = factShareNumber(toRecord(registeredSecurityTotals?.primary_common_shares));
  const explicit424bWarrantUnderlyingShares = factShareNumber(toRecord(registeredSecurityTotals?.warrant_underlying_shares));
  const commonShareExposure = isLlmOfferingAnalysis
    ? explicit424bPrimaryCommonShares
    : sumDisplaySegmentShares(displaySegments, /common|ordinary|ads/i);
  const prefundedWarrantShares = isLlmOfferingAnalysis ? 0 : sumDisplaySegmentShares(displaySegments, /pre[-_\s]?funded/i);
  const prefundedWarrantExercisePriceFact = firstFact([
    findDisplaySegmentFact(displaySegments, /pre[-_\s]?funded/i, "price"),
  ]);
  const commonWarrantExercisePriceFact = firstFact([
    isLlmOfferingAnalysis ? toRecord(registeredSecurityTotals?.warrant_exercise_price) : null,
    isLlmOfferingAnalysis ? null : findDisplaySegmentFact(displaySegments, /\bwarrant/i, "price", { exclude: /pre[-_\s]?funded/i }),
    prefundedWarrantShares ? null : warrantExercisePriceFact,
  ]);
  const displayCommonWarrantShares = isLlmOfferingAnalysis
    ? explicit424bWarrantUnderlyingShares
    : sumDisplaySegmentShares(displaySegments, /\bwarrant/i, {
        exclude: /pre[-_\s]?funded/i,
      });
  const auditCommonWarrantShares = factShareNumber(toRecord(securityStack?.common_warrant_max_registered_underlying_shares));
  const auditGenericWarrantShares = factShareNumber(toRecord(securityStack?.warrant_underlying_shares));
  const commonWarrantShares =
    displayCommonWarrantShares ||
    (isLlmOfferingAnalysis ? 0 : auditCommonWarrantShares) ||
    (isLlmOfferingAnalysis || prefundedWarrantShares ? 0 : auditGenericWarrantShares);
  const convertibleShareExposure =
    sumDisplaySegmentShares(displaySegments, /convertible|conversion|note/i) ||
    factShareNumber(toRecord(securityStack?.convertible_note_underlying_shares));
  const futureWarrantShares =
    sumDisplaySegmentShares(futureSegments, /\bwarrant/i, { exclude: /pre[-_\s]?funded/i }) ||
    factShareNumber(toRecord(securityStack?.additional_future_share_overhang));
  const immediateShareExposure = commonShareExposure + prefundedWarrantShares;
  const totalPotentialShareExposure = factShareNumber(totalSupplyFact);
  const currentShares = factShareNumber(currentSharesFact) || numberValue(dilutionMetrics?.current_shares_outstanding);
  const offeringTypeNormalization = normalizeOfferingTypeForDb({
    auditOfferingType: stringValue(audit?.offering_type),
    displayMode: stringValue(displayModel?.display_mode),
    parserOfferingType: stringValue(offeringTerms?.offering_type),
    securityType: stringValue(offeringTerms?.security_type) || inferSecurityTypeFromSegments(displaySegments),
    primaryOrResale: stringValue(offeringTerms?.primary_or_resale),
  });
  const isResaleLikeOffering =
    /resale|selling[_\s-]?stockholder|selling[_\s-]?shareholder/i.test(
      [
        stringValue(offeringTerms?.primary_or_resale),
        stringValue(offeringTerms?.offering_type),
        stringValue(audit?.offering_type),
        stringValue(displayModel?.display_mode),
      ].join(" "),
    );
  const parserOfferingAmount = isResaleLikeOffering ? null : nullableString(offeringTerms?.offering_amount);
  const existingOfferingTerms = await supabaseSelect("event_offering_terms", {
    select: "metadata",
    event_id: `eq.${stringValue(eventRow.id)}`,
    limit: "1",
  });
  const monitorProvenance = toRecord(analysis.offering_monitor_provenance);
  if (
    !existingOfferingTerms.ok &&
    ["transport_failed", "validation_failed"].includes(stringValue(monitorProvenance?.status))
  ) {
    // A failed Monitor generation must never overwrite a canonical value that
    // could not be read safely. The legacy event/analysis/display writes remain
    // independent and continue through their existing persistence paths.
    return;
  }
  const existingMetadata = existingOfferingTerms.ok
    ? toRecord(firstRow(existingOfferingTerms.data)?.metadata) || {}
    : {};
  const monitorPersistence = prepareMinimalOfferingMonitorPersistence({
    analysisOutput: analysis.offering_monitor,
    provenance: analysis.offering_monitor_provenance,
    existingMetadata: {
      ...existingMetadata,
      raw_offering_type: offeringTypeNormalization.rawOfferingType,
      offering_method: offeringTypeNormalization.offeringMethod,
      offering_display_model: displayModel,
      offering_security_audit: audit,
      dilution_metrics: dilutionMetrics,
      source_notes: stringArray(displayModel?.source_notes),
      review_reasons: [
        ...stringArray(displayModel?.review_reasons),
        ...stringArray(audit?.review_reasons),
      ].slice(0, 8),
    },
    marketSnapshot: buildMinimalOfferingMarketSnapshot(marketContext),
  });

  const payload = removeUndefined({
    event_id: stringValue(eventRow.id),
    raw_item_id: nullableString(rawRow.id),
    sec_form_type: nullableString(rawPayload.form_type) || nullableString(s3?.form_type),
    prospectus_type: normalizeOfferingProspectusType(stringValue(s3?.registration_statement_kind) || stringValue(offeringTerms?.registration_statement_kind)),
    offering_type: offeringTypeNormalization.offeringType,
    security_type: normalizeOfferingSecurityTypeForDb(
      stringValue(offeringTerms?.security_type) ||
        factRelationshipLabel(totalSupplyFact) ||
        inferSecurityTypeFromSegments(displaySegments),
    ),
    primary_or_resale: normalizePrimaryOrResaleForDb(
      stringValue(offeringTerms?.primary_or_resale) ||
        stringValue(audit?.offering_type) ||
        stringValue(displayModel?.display_mode),
    ),
    registration_status: normalizeRegistrationStatusForDb(stringValue(audit?.registration_status) || stringValue(s3?.registration_status)),

    offering_amount_text: factText(offeringAmountFact) || parserOfferingAmount,
    offering_amount: factMoneyNumber(offeringAmountFact) || null,
    offering_amount_currency: factCurrency(offeringAmountFact),
    shelf_capacity_text: nullableString(offeringTerms?.shelf_capacity),
    atm_program_size_text: nullableString(offeringTerms?.atm_program_size),
    shares_offered_text: factText(totalSupplyFact) || nullableString(offeringTerms?.shares_offered),
    shares_offered: totalPotentialShareExposure || null,
    resale_share_count_text: factText(resaleSupplyFact) || nullableString(offeringTerms?.resale_share_count),
    resale_share_count: factShareNumber(resaleSupplyFact) || null,
    current_shares_outstanding_text: factText(currentSharesFact) || nullableString(offeringTerms?.current_shares_outstanding),
    current_shares_outstanding: currentShares || null,
    public_float_text: factText(publicFloatFact),
    public_float: factShareNumber(publicFloatFact) || numberValue(dilutionMetrics?.public_float) || null,

    market_reference_price: numberValue(dilutionMetrics?.market_reference_price) || numberValue(marketContext?.price) || null,
    market_reference_price_source: nullableString(dilutionMetrics?.market_reference_price_source) || readFieldSource(marketContext, "price"),
    market_context_as_of: nullableString(marketContext?.as_of),
    market_cap: numberValue(dilutionMetrics?.market_cap) || numberValue(marketContext?.market_cap) || null,
    market_cap_source: nullableString(dilutionMetrics?.market_cap_source) || readFieldSource(marketContext, "market_cap"),
    shares_outstanding_market: numberValue(marketContext?.shares_outstanding) || null,
    shares_outstanding_market_source: readFieldSource(marketContext, "shares_outstanding"),
    public_float_market: numberValue(marketContext?.public_float) || null,
    public_float_market_source: readFieldSource(marketContext, "public_float"),
    public_float_percent: numberValue(marketContext?.public_float_percent) || null,
    volume: numberValue(marketContext?.volume) || null,
    avg_volume: numberValue(marketContext?.avg_volume) || null,
    market_context: marketContext || {},

    offering_price_text: factText(offeringPriceFact) || nullableString(offeringTerms?.offering_price),
    offering_price: factNumber(offeringPriceFact),
    offering_price_currency: factCurrency(offeringPriceFact),
    warrant_coverage_text: nullableString(offeringTerms?.warrant_coverage),
    warrant_exercise_price_text: factText(warrantExercisePriceFact) || nullableString(offeringTerms?.warrant_exercise_price),
    warrant_exercise_price: factNumber(warrantExercisePriceFact),
    warrant_exercise_price_currency: factCurrency(warrantExercisePriceFact),
    conversion_price_text: factText(conversionPriceFact) || nullableString(offeringTerms?.conversion_price),
    conversion_price: factNumber(conversionPriceFact),
    conversion_price_currency: factCurrency(conversionPriceFact),
    use_of_proceeds: nullableString(offeringTerms?.use_of_proceeds),
    sales_agent: nullableString(offeringTerms?.sales_agent),
    selling_shareholders: normalizeJsonArray(offeringTerms?.selling_shareholders),

    estimated_dilution_percent: numberValue(dilutionMetrics?.estimated_dilution_percent) || null,
    float_overhang_percent: numberValue(dilutionMetrics?.float_overhang_percent) || null,
    offering_amount_percent_of_market_cap: numberValue(dilutionMetrics?.offering_amount_percent_of_market_cap) || null,
    max_share_impact_percent: numberValue(dilutionMetrics?.max_share_impact_percent) || null,
    dilution_scale: normalizeDilutionScale(stringValue(dilutionMetrics?.dilution_scale)),
    preliminary_score_floor: numberOrNull(dilutionMetrics?.preliminary_score_floor),
    preliminary_score_cap: numberOrNull(dilutionMetrics?.preliminary_score_cap),
    delivery_hint: normalizeDeliveryHint(stringValue(dilutionMetrics?.delivery_hint)),
    score_policy_reasons: stringArray(dilutionMetrics?.score_policy_reasons),
    dilution_calculation_basis: {
      shares_offered_source: nullableString(dilutionMetrics?.shares_offered_source),
      current_shares_outstanding_source: nullableString(dilutionMetrics?.current_shares_outstanding_source),
      public_float_source: nullableString(dilutionMetrics?.public_float_source),
      market_cap_source: nullableString(dilutionMetrics?.market_cap_source),
      calculation_notes: stringArray(dilutionMetrics?.calculation_notes),
    },

    overhang_level: classifyShareOverhangLevel({
      currentShares,
      totalPotentialShareExposure,
      percent: numberValue(dilutionMetrics?.estimated_dilution_percent),
    }),
    dilution_risk_summary: nullableString(displayModel?.narrative_summary) || nullableString(analysis.summary),
    next_trigger: stringArray(displayModel?.watch_items)[0] || stringArray(analysis.what_to_watch_next)[0] || null,

    field_confidence: collectOfferingFieldConfidence(displayModel, audit),
    field_evidence: collectOfferingFieldEvidence(displayModel, audit),
    needs_human_review: Boolean(analysis.needs_human_review || displayModel?.needs_human_review || audit?.needs_human_review),
    extraction_model: nullableString(model),
    prompt_key: promptKey,
    prompt_version: promptVersion,
    metadata: monitorPersistence.metadata,

    common_shares_offered_text: commonShareExposure ? `${commonShareExposure.toLocaleString("en-US")} shares` : null,
    common_shares_offered: commonShareExposure || null,
    prefunded_warrant_shares_text: prefundedWarrantShares ? `${prefundedWarrantShares.toLocaleString("en-US")} shares` : null,
    prefunded_warrant_shares: prefundedWarrantShares || null,
    prefunded_warrant_exercise_price_text: factText(prefundedWarrantExercisePriceFact),
    prefunded_warrant_exercise_price: factNumber(prefundedWarrantExercisePriceFact) || null,
    prefunded_warrant_exercise_price_currency: factCurrency(prefundedWarrantExercisePriceFact),
    common_warrant_shares_text: commonWarrantShares ? `${commonWarrantShares.toLocaleString("en-US")} shares` : null,
    common_warrant_shares: commonWarrantShares || null,
    common_warrant_exercise_price_text: factText(commonWarrantExercisePriceFact),
    common_warrant_exercise_price: factNumber(commonWarrantExercisePriceFact) || null,
    common_warrant_exercise_price_currency: factCurrency(commonWarrantExercisePriceFact),
    convertible_principal_amount_text: factText(notePrincipalFact),
    convertible_principal_amount: factNumber(notePrincipalFact),
    convertible_principal_amount_currency: factCurrency(notePrincipalFact),
    convertible_share_exposure_text: convertibleShareExposure ? `${convertibleShareExposure.toLocaleString("en-US")} shares` : null,
    convertible_share_exposure: convertibleShareExposure || null,
    total_potential_share_exposure_text: factText(totalSupplyFact),
    total_potential_share_exposure: totalPotentialShareExposure || null,
    immediate_share_exposure: immediateShareExposure || null,
    future_warrant_overhang_shares: futureWarrantShares || null,
    total_potential_dilution_percent: numberValue(dilutionMetrics?.estimated_dilution_percent) || null,
    total_potential_float_overhang_percent: numberValue(dilutionMetrics?.float_overhang_percent) || null,
  });

  const result = await upsertEventOfferingTerms(payload);
  await assertMutation(result, "upsert SEC filing offering terms");
}

async function replaceEventTickers(
  eventId: string,
  analysis: Record<string, unknown>,
  primaryTicker: { ticker: string | null; exchange: string | null },
  issuerSecurityLinkage: SecIssuerSecurityLinkage | null,
) {
  await assertMutation(supabaseDelete("event_tickers", { event_id: `eq.${eventId}` }), "delete event tickers");
  const rows = buildTickerRows(
    eventId,
    analysis,
    primaryTicker,
    issuerSecurityLinkage,
  );
  if (!rows.length) return;

  const result = await supabaseUpsertSanitized("event_tickers", rows, {
    onConflict: "event_id,symbol,role",
  });
  await assertMutation(result, "upsert SEC filing event tickers");
}

async function replaceEventCalendarItems({
  eventRow,
  rawRow,
  analysis,
  primaryTicker,
  promptKey,
  promptVersion,
}: {
  eventRow: PersistedRow;
  rawRow: PersistedRow;
  analysis: Record<string, unknown>;
  primaryTicker: { ticker: string | null; exchange: string | null };
  promptKey: string;
  promptVersion: string;
}) {
  const eventId = stringValue(eventRow.id);
  await assertMutation(
    supabaseDelete("event_calendar_items", { source_event_id: `eq.${eventId}` }),
    "delete SEC filing event calendar items",
  );

  const rows = buildCalendarRows({ eventRow, rawRow, analysis, primaryTicker, promptKey, promptVersion });
  if (!rows.length) return;

  const result = await supabaseUpsertSanitized("event_calendar_items", rows, { onConflict: "id" });
  await assertMutation(result, "upsert SEC filing event calendar items");
}

function buildTickerRows(
  eventId: string,
  analysis: Record<string, unknown>,
  primaryTicker: { ticker: string | null; exchange: string | null },
  issuerSecurityLinkage: SecIssuerSecurityLinkage | null,
) {
  const rows: Array<Record<string, unknown>> = [];
  const seen = new Set<string>();
  const excludedIssuerSymbols = new Set(
    issuerSecurityLinkage?.excludedSecurities.map(
      (security) => security.ticker,
    ) || [],
  );
  const push = (input: {
    symbol: string | null;
    exchange?: string | null;
    role?: string | null;
    reason?: string | null;
    sortOrder?: number;
    metadata?: Record<string, unknown>;
  }) => {
    const symbol = stringValue(input.symbol).toUpperCase();
    if (!symbol || excludedIssuerSymbols.has(symbol)) return;
    const role = normalizeTickerRole(input.role || "related");
    if (seen.has(symbol)) return;
    seen.add(symbol);
    rows.push({
      event_id: eventId,
      symbol,
      exchange: nullableString(input.exchange),
      role,
      sort_order: input.sortOrder ?? rows.length + 1,
      reason: nullableString(input.reason),
      metadata: input.metadata || {},
    });
  };

  if (issuerSecurityLinkage) {
    for (const row of buildSecIssuerEventTickerRows(
      eventId,
      issuerSecurityLinkage,
    )) {
      push({
        symbol: row.symbol,
        exchange: row.exchange,
        role: row.role,
        reason: row.reason,
        sortOrder: row.sort_order,
        metadata: row.metadata,
      });
    }
  } else {
    push({
      symbol: primaryTicker.ticker,
      exchange: primaryTicker.exchange,
      role: "primary",
      reason: "Primary ticker from trusted SEC filing package",
      sortOrder: 1,
    });
  }

  for (const item of readSecAnalysisContextTickers(analysis)) {
    push({
      symbol: item.ticker,
      exchange: item.exchange,
      role: item.role,
      reason: item.reason,
    });
  }

  return rows.map((row, index) => ({ ...row, sort_order: index + 1 }));
}

function buildCalendarRows({
  eventRow,
  rawRow,
  analysis,
  primaryTicker,
  promptKey,
  promptVersion,
}: {
  eventRow: PersistedRow;
  rawRow: PersistedRow;
  analysis: Record<string, unknown>;
  primaryTicker: { ticker: string | null; exchange: string | null };
  promptKey: string;
  promptVersion: string;
}) {
  const eventId = stringValue(eventRow.id);
  const rawPayload = toRecord(rawRow.raw_payload) || {};
  const ticker = primaryTicker.ticker || null;
  const companyName = nullableString(rawPayload.company_name) || ticker;
  const secEventType = normalizeEventType(stringValue(analysis.event_type));
  const rows: Record<string, unknown>[] = [];

  for (const item of recordArray(analysis.calendar_items)) {
    const eventDate = normalizeDateString(item.event_date);
    const estimatedStartDate = normalizeDateString(item.estimated_start_date);
    const estimatedEndDate = normalizeDateString(item.estimated_end_date);

    if (!eventDate && !estimatedStartDate && !estimatedEndDate) continue;

    const calendarEventType = normalizeCalendarEventTypeForItem(stringValue(item.calendar_event_type), item, secEventType);
    if (shouldSkipCalendarItem(item, calendarEventType)) continue;

    const datePrecision = normalizeDatePrecision(stringValue(item.date_precision), eventDate);
    const isEstimated = Boolean(item.is_estimated) || datePrecision !== "exact";
    const calendarPolicy = evaluateCalendarItemPolicy({
      sourceGroup: "filings",
      calendarEventType,
      calendarTitle: nullableString(item.calendar_title),
      evidence: nullableString(item.evidence),
      datePrecision,
      eventDate,
      estimatedStartDate,
      estimatedEndDate,
    });
    if (!calendarPolicy.keep) continue;

    const calendarStatus = calendarStatusForFiling(datePrecision, isEstimated, Boolean(eventDate));
    const eventTime = normalizeTimeString(item.event_time);
    const calendarTitle =
      stringValue(item.calendar_title) || stringValue(eventRow.title) || stringValue(rawRow.title) || "Scheduled SEC filing event";

    rows.push({
      id: randomUUID(),
      source_event_id: eventId,
      raw_item_id: stringValue(rawRow.id),
      source_code: "sec_edgar",
      source_group: "filings",
      ticker,
      company_name: companyName,
      calendar_event_key: buildCalendarEventKey({
        ticker,
        calendarEventType,
        eventDate,
        eventTime,
        estimatedStartDate,
        estimatedEndDate,
        title: calendarTitle,
      }),
      calendar_event_type: calendarEventType,
      calendar_group: getCalendarEventGroup(calendarEventType),
      calendar_title: calendarTitle,
      event_date: eventDate,
      event_time: eventTime,
      event_timezone: nullableString(item.event_timezone),
      date_precision: datePrecision,
      estimated_start_date: estimatedStartDate,
      estimated_end_date: estimatedEndDate,
      is_estimated: isEstimated,
      confidence: normalizeConfidence(stringValue(item.confidence)),
      calendar_status: calendarStatus,
      confirmation_source: "filings",
      confirmed_at: calendarStatus === "confirmed" ? new Date().toISOString() : null,
      confirmed_by_event_id: calendarStatus === "confirmed" ? eventId : null,
      superseded_by_item_id: null,
      source_url: stringValue(eventRow.source_url) || stringValue(rawRow.source_url),
      evidence: nullableString(item.evidence),
      metadata: {
        raw_calendar_item: item,
        prompt_key: promptKey,
        prompt_version: promptVersion,
      },
    });
  }

  return rows;
}

export async function saveSecFilingAiTrace({
  rawItemId,
  eventId,
  analysis,
  outputText,
  usage,
  costEstimate,
  model,
  openAiResponseId,
  promptKey,
  promptVersion,
  prompt,
  repairOutputText,
  repairUsage,
  repairOpenAiResponseId,
  validationRepair,
  error,
}: {
  rawItemId: string;
  eventId: string | null;
  analysis: Record<string, unknown> | null;
  outputText: string;
  usage: Record<string, unknown> | null;
  costEstimate: Record<string, unknown> | null;
  model: string;
  openAiResponseId: string | null;
  promptKey: string;
  promptVersion: string;
  prompt: Record<string, unknown> | null;
  repairOutputText?: string;
  repairUsage?: Record<string, unknown> | null;
  repairOpenAiResponseId?: string | null;
  validationRepair: Record<string, unknown> | null;
  error?: string | null;
}) {
  const aiRunId = randomUUID();
  const now = new Date().toISOString();
  const repairTrace = buildSecValidationRepairTrace({
    analysis,
    outputText,
    repairOutputText,
    usage,
    repairUsage,
    model,
    openAiResponseId,
    repairOpenAiResponseId,
    prompt,
    validationRepair,
    error,
  });
  await assertMutation(
    supabaseUpsertSanitized(
      "ai_runs",
      {
        id: aiRunId,
        event_id: eventId,
        raw_item_id: rawItemId,
        prompt_key: promptKey,
        prompt_version: promptVersion,
        model,
        status: error ? "failed" : "completed",
        started_at: now,
        finished_at: now,
        usage: usage || {},
        error_message: error || null,
        metadata: {
          openai_response_id: openAiResponseId,
          cost_estimate: costEstimate,
          validation_repair: {
            schema_version: repairTrace.schema_version,
            attempted: repairTrace.attempted,
            status: repairTrace.status,
            warning_count: repairTrace.warnings.length,
            applied_change_count: repairTrace.applied_changes.length,
            repair_prompt_key: repairTrace.repair_prompt?.key || null,
            repair_prompt_version: repairTrace.repair_prompt?.version || null,
            repair_response_id: repairOpenAiResponseId || null,
            repair_usage: repairUsage || null,
            error_summary: repairTrace.error_summary,
          },
        },
      },
      { onConflict: "id" },
    ),
    "insert SEC filing ai run",
  );

  await assertMutation(
    supabaseUpsertSanitized(
      "ai_outputs",
      {
        id: randomUUID(),
        ai_run_id: aiRunId,
        event_id: eventId,
        output_type: promptKey,
        payload: {
          analysis,
          output_text: outputText,
          usage,
          cost_estimate: costEstimate,
          validation_repair_trace: repairTrace,
        },
      },
      { onConflict: "id" },
    ),
    "insert SEC filing ai output",
  );

  return {
    aiRunId,
    repairTrace,
  };
}

async function findExistingEvent(groupDedupeKey: string) {
  const result = await supabaseSelect("events", {
    select: "*",
    source_group: "eq.filings",
    group_dedupe_key: `eq.${groupDedupeKey}`,
    limit: "1",
  });
  return firstRow(result.data);
}

async function findExistingEventByDedupeKeys(groupDedupeKeys: string[]) {
  for (const groupDedupeKey of groupDedupeKeys) {
    const existing = await findExistingEvent(groupDedupeKey);
    if (existing) return existing;
  }

  return null;
}

export async function fetchSecFilingCalendarItemsForEvent(eventId: string) {
  const result = await supabaseSelect("event_calendar_items", {
    select: "*",
    source_event_id: `eq.${eventId}`,
    order: "event_date.asc",
    limit: "20",
  });
  return Array.isArray(result.data) ? result.data : [];
}

function shouldPersistEventOfferingTerms(eventRow: PersistedRow, analysis: Record<string, unknown>) {
  if (toRecord(analysis.offering_monitor) || toRecord(analysis.offering_monitor_provenance)) return true;
  if (stringValue(eventRow.event_type) === "dilution_risk") return true;
  if (toRecord(analysis.offering_display_model)) return true;
  if (toRecord(analysis.offering_security_audit)) return true;
  return false;
}

async function upsertEventOfferingTerms(payload: Record<string, unknown>) {
  const fullResult = await supabaseUpsertSanitized("event_offering_terms", payload, { onConflict: "event_id" });
  if (fullResult.ok || !isUnknownOfferingTermsColumnError(fullResult.error)) return fullResult;

  return supabaseUpsertSanitized("event_offering_terms", omitComplexOfferingTermColumns(payload), { onConflict: "event_id" });
}

function isUnknownOfferingTermsColumnError(error: string | undefined) {
  return /\b(?:column|schema cache)\b/i.test(error || "") && /\bevent_offering_terms\b/i.test(error || "");
}

const complexOfferingTermColumns = new Set([
  "common_shares_offered_text",
  "common_shares_offered",
  "prefunded_warrant_shares_text",
  "prefunded_warrant_shares",
  "prefunded_warrant_exercise_price_text",
  "prefunded_warrant_exercise_price",
  "prefunded_warrant_exercise_price_currency",
  "common_warrant_shares_text",
  "common_warrant_shares",
  "common_warrant_exercise_price_text",
  "common_warrant_exercise_price",
  "common_warrant_exercise_price_currency",
  "convertible_principal_amount_text",
  "convertible_principal_amount",
  "convertible_principal_amount_currency",
  "convertible_share_exposure_text",
  "convertible_share_exposure",
  "total_potential_share_exposure_text",
  "total_potential_share_exposure",
  "immediate_share_exposure",
  "future_warrant_overhang_shares",
  "immediate_float_impact_percent",
  "total_potential_dilution_percent",
  "total_potential_float_overhang_percent",
]);

function omitComplexOfferingTermColumns(payload: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(payload).filter(([key]) => !complexOfferingTermColumns.has(key)));
}

function removeUndefined(payload: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(payload).filter(([, value]) => value !== undefined));
}

function firstFact(facts: Array<Record<string, unknown> | null>) {
  return facts.find((fact) => Boolean(fact && (factText(fact) || factNumber(fact)))) || null;
}

function firstShareFact(facts: Array<Record<string, unknown> | null>) {
  return facts.find((fact) => Boolean(fact && isShareFact(fact) && (factText(fact) || factNumber(fact)))) || null;
}

function firstMoneyFact(facts: Array<Record<string, unknown> | null>) {
  return facts.find((fact) => Boolean(fact && isMoneyFact(fact) && (factText(fact) || factNumber(fact)))) || null;
}

function factText(fact: Record<string, unknown> | null | undefined) {
  return nullableString(fact?.value_text);
}

function factNumber(fact: Record<string, unknown> | null | undefined) {
  const value = numberValue(fact?.numeric_value);
  return value > 0 ? value : 0;
}

function factShareNumber(fact: Record<string, unknown> | null | undefined) {
  return isShareFact(fact) ? factNumber(fact) : 0;
}

function factMoneyNumber(fact: Record<string, unknown> | null | undefined) {
  return isMoneyFact(fact) ? factNumber(fact) : 0;
}

function isShareFact(fact: Record<string, unknown> | null | undefined) {
  const unit = stringValue(fact?.unit).toLowerCase();
  const meaning = stringValue(fact?.meaning).toLowerCase();
  const text = `${unit} ${meaning} ${stringValue(fact?.label)} ${stringValue(fact?.relationship)}`.toLowerCase();
  return unit === "shares" || /\bshare(s)?\b|share[_ -]?equivalent|resale[_ -]?supply|registered[_ -]?supply/.test(text);
}

function isMoneyFact(fact: Record<string, unknown> | null | undefined) {
  const unit = stringValue(fact?.unit).toLowerCase();
  const meaning = stringValue(fact?.meaning).toLowerCase();
  const text = `${unit} ${meaning} ${stringValue(fact?.label)} ${stringValue(fact?.relationship)}`.toLowerCase();
  return unit === "usd" || /\b(amount|proceeds|principal|fee[_ -]?table|shelf[_ -]?capacity|atm[_ -]?program)\b/.test(text);
}

function factCurrency(fact: Record<string, unknown> | null | undefined) {
  const unit = stringValue(fact?.unit);
  return unit === "usd" || unit === "usd_per_share" ? "USD" : null;
}

function factRelationshipLabel(fact: Record<string, unknown> | null | undefined) {
  return stringValue(fact?.relationship);
}

function numberOrNull(value: unknown) {
  const numericValue = numberValue(value);
  return numericValue || null;
}

function normalizeJsonArray(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function readFieldSource(marketContext: Record<string, unknown> | null, key: string) {
  const fieldSources = toRecord(marketContext?.field_sources);
  return nullableString(fieldSources?.[key]);
}

function findDisplaySegmentFact(
  segments: Record<string, unknown>[],
  pattern: RegExp,
  field: string,
  options: { exclude?: RegExp } = {},
) {
  const segment = segments.find((item) => segmentMatches(item, pattern, options));
  return toRecord(segment?.[field]);
}

function sumDisplaySegmentShares(
  segments: Record<string, unknown>[],
  pattern: RegExp,
  options: { exclude?: RegExp } = {},
) {
  return segments
    .filter((segment) => segmentMatches(segment, pattern, options))
    .map((segment) => factShareNumber(toRecord(segment.shares)))
    .reduce((sum, value) => sum + value, 0);
}

function segmentMatches(segment: Record<string, unknown>, pattern: RegExp, options: { exclude?: RegExp } = {}) {
  const text = `${stringValue(segment.instrument_type)} ${stringValue(segment.label)}`;
  if (options.exclude?.test(text)) return false;
  return pattern.test(text);
}

function inferSecurityTypeFromSegments(segments: Record<string, unknown>[]) {
  const text = segments.map((segment) => `${stringValue(segment.instrument_type)} ${stringValue(segment.label)}`).join(" ");
  if (/\bwarrant/i.test(text) && /\b(?:convertible|note|conversion)/i.test(text)) return "mixed";
  if (/\bwarrant/i.test(text)) return "warrants";
  if (/\b(?:convertible|note|conversion)/i.test(text)) return "convertible_notes";
  if (/\b(?:common|ordinary)/i.test(text)) return "common_stock";
  return "";
}

function normalizeOfferingProspectusType(value: string) {
  const normalized = value.trim().toLowerCase();
  if (normalized.includes("base")) return "base";
  if (normalized.includes("supplement")) return "supplement";
  if (normalized.includes("current")) return "current_report";
  if (normalized.includes("registration")) return "registration_statement";
  if (normalized === "warrant_indenture") return "warrant_indenture";
  return "unknown";
}

function normalizeOfferingTypeForDb({
  auditOfferingType,
  displayMode,
  parserOfferingType,
  securityType,
  primaryOrResale,
}: {
  auditOfferingType: string;
  displayMode: string;
  parserOfferingType: string;
  securityType: string;
  primaryOrResale: string;
}) {
  const rawOfferingType = firstNonEmptyString([parserOfferingType, auditOfferingType, displayMode]);
  const text = `${auditOfferingType} ${displayMode} ${parserOfferingType} ${securityType} ${primaryOrResale}`.toLowerCase();
  const offeringMethod = inferOfferingMethod(text);
  const hasMixedSecurity = /mixed|unit|warrant|pre[-_\s]?funded|preferred|convertible|note/.test(text);
  let offeringType = "other";

  if (/\batm|at[_ -]?the[_ -]?market/.test(text)) {
    offeringType = "atm";
  } else if (/convertible|convertible_warrant|\bnotes?\b/.test(text)) {
    offeringType = "convertible_financing";
  } else if (/warrant[_ -]?exercise/.test(text)) {
    offeringType = "warrant_exercise";
  } else if (/rights?[_ -]?offering/.test(text)) {
    offeringType = "rights_offering";
  } else if (/registered[_ -]?direct/.test(text)) {
    offeringType = "registered_direct";
  } else if (/resale|selling[_ -]?holder|selling[_ -]?stockholder/.test(text)) {
    offeringType = "resale_registration";
  } else if (/shelf|base_shelf|automatic_shelf|shelf_registration/.test(text)) {
    offeringType = "shelf_registration";
  } else if (/private[_ -]?placement/.test(text)) {
    offeringType = "private_placement";
  } else if (/mixed/.test(text) || (isPublicOfferingMethod(offeringMethod) && hasMixedSecurity)) {
    offeringType = "mixed";
  } else if (/public[_ -]?offering|underwritten[_ -]?public[_ -]?offering|common[_ -]?stock[_ -]?public[_ -]?offering|primary/.test(text)) {
    offeringType = "other";
  }

  return {
    offeringType,
    rawOfferingType: rawOfferingType || null,
    offeringMethod,
  };
}

function firstNonEmptyString(values: string[]) {
  return values.map((value) => value.trim()).find(Boolean) || "";
}

function inferOfferingMethod(text: string) {
  if (/underwritten[_ -]?public[_ -]?offering/.test(text)) return "underwritten_public_offering";
  if (/public[_ -]?offering|common[_ -]?stock[_ -]?public[_ -]?offering/.test(text)) return "public_offering";
  if (/private[_ -]?placement/.test(text)) return "private_placement";
  if (/shelf[_ -]?takedown|prospectus[_ -]?supplement/.test(text)) return "shelf_takedown";
  if (/\batm|at[_ -]?the[_ -]?market/.test(text)) return "atm";
  return null;
}

function isPublicOfferingMethod(value: string | null) {
  return value === "public_offering" || value === "underwritten_public_offering";
}

function normalizeOfferingSecurityTypeForDb(value: string) {
  const text = value.trim().toLowerCase();
  if (/ordinary/.test(text)) return "ordinary_shares";
  if (/\bads\b|depositary/.test(text)) return "ads";
  if (/pre[-_\s]?funded/.test(text)) return "prefunded_warrants";
  if (/warrant/.test(text) && /convertible|note|mixed/.test(text)) return "mixed";
  if (/warrant/.test(text)) return "warrants";
  if (/convertible|note/.test(text)) return "convertible_notes";
  if (/unit/.test(text)) return "units";
  if (/debt/.test(text)) return "debt";
  if (/common/.test(text)) return "common_stock";
  if (/mixed/.test(text)) return "mixed";
  return "unknown";
}

function normalizePrimaryOrResaleForDb(value: string) {
  const text = value.trim().toLowerCase();
  if (/mixed|primary_and_resale/.test(text)) return "mixed";
  if (/resale|selling[_ -]?holder|selling[_ -]?stockholder/.test(text)) return "resale";
  if (/primary|company[_ -]?cash|gross[_ -]?proceeds/.test(text)) return "primary";
  return "not_disclosed";
}

function normalizeRegistrationStatusForDb(value: string) {
  const text = value.trim().toLowerCase();
  if (/withdraw/.test(text)) return "withdrawn";
  if (/effective|closed/.test(text)) return "effective";
  if (/not[_ -]?effective|filed[_ -]?not[_ -]?effective/.test(text)) return "not_effective";
  if (/prospectus[_ -]?supplement/.test(text)) return "prospectus_supplement";
  if (/preliminary|filed|amended/.test(text)) return "filed";
  return "not_disclosed";
}

function normalizeDilutionScale(value: string) {
  const text = value.trim().toLowerCase();
  if (text === "low" || text === "moderate" || text === "elevated" || text === "high" || text === "severe") {
    return text;
  }
  return "unknown";
}

function classifyShareOverhangLevel({
  currentShares,
  totalPotentialShareExposure,
  percent,
}: {
  currentShares: number;
  totalPotentialShareExposure: number;
  percent: number;
}) {
  const sharePercent =
    percent ||
    (currentShares > 0 && totalPotentialShareExposure > 0
      ? (totalPotentialShareExposure / currentShares) * 100
      : 0);
  if (!sharePercent) return "unknown";
  if (sharePercent >= 100) return "severe";
  if (sharePercent >= 50) return "high";
  if (sharePercent >= 10) return "elevated";
  if (sharePercent >= 5) return "moderate";
  return "low";
}

function normalizeDeliveryHint(value: string) {
  const text = value.trim().toLowerCase();
  if (text === "skip" || text === "archive" || text === "feed" || text === "alert" || text === "urgent") return text;
  return null;
}

function collectOfferingFieldConfidence(
  displayModel: Record<string, unknown> | null,
  audit: Record<string, unknown> | null,
) {
  return {
    current_shares: nullableString(toRecord(displayModel?.current_shares)?.confidence),
    total_potential_supply: nullableString(toRecord(displayModel?.total_potential_supply)?.confidence),
    display_model: nullableString(displayModel?.needs_human_review) ? "low" : nullableString(displayModel?.risk_label) ? "medium" : null,
    audit: nullableString(audit?.confidence),
  };
}

function collectOfferingFieldEvidence(
  displayModel: Record<string, unknown> | null,
  audit: Record<string, unknown> | null,
) {
  const securityStack = toRecord(audit?.security_stack);
  const proceedsStack = toRecord(audit?.proceeds_stack);
  return {
    current_shares: nullableString(toRecord(displayModel?.current_shares)?.evidence) || nullableString(toRecord(securityStack?.current_shares_outstanding)?.evidence),
    total_potential_supply: nullableString(toRecord(displayModel?.total_potential_supply)?.evidence) || nullableString(toRecord(securityStack?.max_registered_stack_share_equivalent)?.evidence),
    warrant_exercise_price: nullableString(toRecord(proceedsStack?.warrant_exercise_price)?.evidence),
    conversion_price: nullableString(toRecord(proceedsStack?.conversion_price)?.evidence),
  };
}

async function assertMutation(
  promise:
    | Promise<{ ok: boolean; status: number; error?: string; data?: unknown }>
    | { ok: boolean; status: number; error?: string; data?: unknown },
  label: string,
) {
  const result = await promise;
  if (!result.ok) {
    throw new Error(`${label} failed: ${result.error || `HTTP ${result.status}`}`);
  }
  return result;
}

function supabaseUpsertSanitized(
  table: string,
  payload: Record<string, unknown> | Array<Record<string, unknown>>,
  options: Parameters<typeof supabaseUpsert>[2] = {},
) {
  return supabaseUpsert(table, sanitizeForPostgresJson(payload) as Record<string, unknown> | Array<Record<string, unknown>>, options);
}

function sanitizeForPostgresJson(value: unknown): unknown {
  if (typeof value === "string") return sanitizePostgresString(value);
  if (Array.isArray(value)) return value.map(sanitizeForPostgresJson);
  if (!value || typeof value !== "object") return value;

  const sanitized: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (item === undefined) continue;
    sanitized[sanitizePostgresString(key)] = sanitizeForPostgresJson(item);
  }
  return sanitized;
}

function sanitizePostgresString(value: string) {
  let sanitized = "";
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code === 0) continue;
    if (code >= 0xd800 && code <= 0xdbff) {
      const nextCode = value.charCodeAt(index + 1);
      if (nextCode >= 0xdc00 && nextCode <= 0xdfff) {
        sanitized += value[index] + value[index + 1];
        index += 1;
      }
      continue;
    }
    if (code >= 0xdc00 && code <= 0xdfff) continue;
    sanitized += value[index];
  }
  return sanitized;
}

function readPrimaryTicker(
  analysis: Record<string, unknown>,
  rawPayload: Record<string, unknown>,
  filingPackage: Record<string, unknown>,
) {
  const packagePrimary = toRecord(filingPackage.primary_ticker);
  const primary = toRecord(analysis.primary_ticker);
  const ticker =
    nullableString(rawPayload.ticker) ||
    nullableString(packagePrimary?.ticker) ||
    nullableString(primary?.ticker);
  const exchange =
    nullableString(rawPayload.exchange) ||
    nullableString(packagePrimary?.exchange) ||
    nullableString(primary?.exchange);
  return {
    ticker: ticker ? ticker.toUpperCase() : null,
    exchange,
  };
}

function buildCrossGroupEventKey(ticker: string | null, eventType: string, title: string | null) {
  if (!ticker) return null;
  return `${ticker}:${eventType}:${slugify(title || "")}`.slice(0, 180);
}

function buildCalendarEventKey({
  ticker,
  calendarEventType,
  eventDate,
  eventTime,
  estimatedStartDate,
  estimatedEndDate,
  title,
}: {
  ticker: string | null;
  calendarEventType: string;
  eventDate: string | null;
  eventTime: string | null;
  estimatedStartDate: string | null;
  estimatedEndDate: string | null;
  title: string;
}) {
  const datePart = eventDate || estimatedStartDate || estimatedEndDate || "unknown";
  const timePart = eventTime || "all_day";
  return `${(ticker || "market").toLowerCase()}:${calendarEventType}:${datePart}:${timePart}:${slugify(title)}`.slice(
    0,
    220,
  );
}

function normalizeEventType(value: string) {
  const normalized = value.trim().toLowerCase();
  return allowedEventTypes.has(normalized) ? normalized : "other";
}

function normalizeCalendarEventTypeForItem(
  value: string,
  item: Record<string, unknown>,
  secEventType: string,
) {
  const normalized = normalizeCalendarEventType(value);
  const text = [value, item.calendar_title, item.evidence].map((part) => stringValue(part).toLowerCase()).join("\n");

  if (
    secEventType === "dividends" &&
    (normalized === "shareholder_record_date" || text.includes("record date") || text.includes("shareholding position"))
  ) {
    return "dividend_record_date";
  }

  if (
    text.includes("warrant") &&
    /\b(expiration|expires|expire|exercisable|exercise|redemption|redeem)\b/.test(text)
  ) {
    return "warrant_redemption_deadline";
  }

  if (/\bregistration\b/.test(text) && /\beffective(?:ness)?\b/.test(text)) {
    return "registration_effective_date";
  }

  if (
    /\bshareholder\b/.test(text) &&
    /\bapproval\b/.test(text) &&
    /\b(deadline|by|before|prior to|no later than|date)\b/.test(text)
  ) {
    return "shareholder_approval_deadline";
  }

  return normalized;
}

function shouldSkipCalendarItem(item: Record<string, unknown>, calendarEventType: string) {
  const text = [item.calendar_title, item.evidence].map((part) => stringValue(part).toLowerCase()).join("\n");
  if (calendarEventType !== "other_scheduled_event") return false;

  return [
    /\b(rsu|restricted stock|stock unit|option|equity award|grant)\b.*\bvesting\b/,
    /\bvesting\b.*\b(rsu|restricted stock|stock unit|option|equity award|grant)\b/,
    /first anniversary of grant/,
    /tax[-\s]?(status|exemption|exempt)/,
    /withholding (income )?tax/,
    /provide .*evidence/,
    /submit .*evidence/,
    /proxy (mailing|distribution|distributed|statement will be distributed)/,
    /board response/,
    /position statement/,
  ].some((pattern) => pattern.test(text));
}

function normalizeSignal(value: string): Signal {
  const normalized = value.trim().toLowerCase();
  return allowedSignals.has(normalized) ? (normalized as Signal) : "neutral";
}

function normalizeMarketScope(value: string): MarketScope {
  const normalized = value.trim().toLowerCase();
  if (normalized === "sector" || normalized === "theme" || normalized === "macro") return normalized;
  return "company";
}

function normalizeTickerRole(value: string) {
  const normalized = value.trim().toLowerCase();
  return allowedTickerRoles.has(normalized) ? normalized : "related";
}

function deliveryLevelFromScore(score: number): DeliveryLevel {
  if (score >= 75) return "alert";
  if (score >= 50) return "feed";
  return "archive";
}

function impactFromScore(score: number): Impact {
  if (score >= 75) return "high";
  if (score >= 50) return "medium";
  return "low";
}

function analysisScopeFromMarketScope(value: MarketScope): AnalysisScope {
  return value === "macro" ? "market" : value;
}

function calendarStatusForFiling(datePrecision: string, isEstimated: boolean, hasExactDate: boolean) {
  return hasExactDate && !isEstimated && datePrecision === "exact" ? "confirmed" : "tentative";
}

function normalizeDateString(value: unknown) {
  const text = stringValue(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const date = new Date(`${text}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;
  return text;
}

function normalizeTimeString(value: unknown) {
  const text = stringValue(value);
  if (!text) return null;
  const match = text.match(/^([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?$/);
  if (!match) return null;
  return `${match[1]}:${match[2]}:00`;
}

function normalizeDatePrecision(value: string, eventDate: string | null) {
  const normalized = value.trim().toLowerCase();
  if (
    normalized === "exact" ||
    normalized === "month" ||
    normalized === "quarter" ||
    normalized === "year" ||
    normalized === "unknown"
  ) {
    return normalized;
  }
  return eventDate ? "exact" : "unknown";
}

function normalizeConfidence(value: string) {
  const normalized = value.trim().toLowerCase();
  if (normalized === "high" || normalized === "medium" || normalized === "low") return normalized;
  return "medium";
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.map((item) => stringValue(item)).filter(Boolean) : [];
}

function recordArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item))
    : [];
}

function firstRow(value: unknown): PersistedRow | null {
  return Array.isArray(value) && value[0] && typeof value[0] === "object"
    ? (value[0] as PersistedRow)
    : null;
}

function toRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function nullableString(value: unknown) {
  const text = stringValue(value);
  return text || null;
}

function stringValue(value: unknown) {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function numberValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && Number.isFinite(Number(value))) return Number(value);
  return 0;
}

function clampScore(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}
