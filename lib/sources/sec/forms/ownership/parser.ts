export const OWNERSHIP_FORM_SCOPE = "Form 4 / 4/A, Form 144 / 144/A";
export const OWNERSHIP_PARSER_GROUP = "ownership";
export const OWNERSHIP_PARSER_VERSION = "ownership-parser-v1";
export const APPROVED_EVENT_TYPES = [
  "listing_risk",
  "dilution_risk",
  "earnings",
  "sales_performance",
  "product_update",
  "leadership_governance",
  "insider_ownership",
  "shareholder_vote",
  "strategic_transaction",
  "financial_risk",
  "legal_risk",
  "ipo_listing",
  "dividends",
  "capital_return",
  "fda_clinical",
  "other",
] as const;

export type ApprovedEventType = (typeof APPROVED_EVENT_TYPES)[number];
export type DeliveryLevel = "archive" | "feed" | "alert";
export type OwnershipSignal =
  | "form_4_transaction"
  | "form_144_proposed_sale"
  | "insider_purchase"
  | "insider_sale"
  | "insider_gift"
  | "routine_grant_or_award"
  | "derivative_transaction"
  | "conversion_transaction"
  | "rule_10b5_1_plan"
  | "routine_form_144"
  | "large_form_144_sale"
  | "form_144_no_prior_sales"
  | "section_16_exit"
  | "multi_reporting_owner"
  | "legacy_format"
  | "unsupported_or_empty_document"
  | "administrative_amendment"
  | "material_amendment"
  | "deterministic_archive";

export interface OwnershipFixtureInput {
  id?: string;
  formType: string;
  accessionNumber?: string | null;
  filingText?: string;
  text?: string;
  primaryDocumentText?: string | null;
  attachments?: Array<{
    type?: string | null;
    description?: string | null;
    filename?: string | null;
    url?: string | null;
    text?: string | null;
  }>;
  metadata?: Record<string, unknown> | null;
  rawPayload?: Record<string, unknown> | null;
  originalFiling?: OwnershipFixtureInput | null;
  ownership_original_filing?: OwnershipFixtureInput | Record<string, unknown> | string | null;
  ownershipOriginalFiling?: OwnershipFixtureInput | Record<string, unknown> | string | null;
  issuer?: {
    name?: string | null;
    ticker?: string | null;
    exchange?: string | null;
    cik?: string | null;
  };
  reportingOwner?: {
    name?: string | null;
    title?: string | null;
    roles?: string[];
  };
  market_context?: Record<string, unknown> | null;
  marketContext?: Record<string, unknown> | null;
  source?: {
    url?: string | null;
    retrieved_at?: string | null;
    sha256?: string | null;
  };
  expected_event_type?: ApprovedEventType;
  [key: string]: unknown;
}

export interface OwnershipParserOutput {
  parserVersion: string;
  parserGroup: "ownership";
  formType: string;
  accessionNumber: string | null;
  isSupported: boolean;
  summary: string | null;
  facts: Record<string, unknown>;
  signals: OwnershipSignal[];
  calendarItems: Array<Record<string, unknown>>;
  warnings: string[];
  raw: Record<string, unknown>;
}

interface ParsedTransaction {
  transaction_kind: "non_derivative" | "derivative";
  security_title: string | null;
  transaction_date: string | null;
  deemed_execution_date: string | null;
  transaction_code: string | null;
  transaction_code_meaning: string | null;
  transaction_category: string | null;
  voluntary_early_report: boolean;
  transaction_timeliness: string | null;
  equity_swap_involved: boolean | null;
  acquired_disposed_code: "A" | "D" | null;
  shares: number | null;
  shares_text: string | null;
  shares_status: string;
  price_per_share: number | null;
  price_per_share_text: string | null;
  price_per_share_status: string;
  transaction_value: number | null;
  conversion_or_exercise_price: number | null;
  conversion_or_exercise_price_text: string | null;
  conversion_or_exercise_price_status: string;
  exercise_date: string | null;
  date_exercisable: string | null;
  expiration_date: string | null;
  underlying_security_title: string | null;
  underlying_security_shares: number | null;
  underlying_security_shares_text: string | null;
  underlying_security_shares_status: string;
  shares_owned_following: number | null;
  shares_owned_following_text: string | null;
  shares_owned_following_status: string;
  direct_or_indirect_ownership: "D" | "I" | null;
  nature_of_ownership: string | null;
  ownership_percent_of_shares_outstanding: number | null;
  footnote_ids: string[];
  field_footnote_ids: Record<string, string[]>;
  row_issues: string[];
  evidence: string[];
}

type OwnershipSourceFormat = "structured_xml" | "legacy_html" | "text_excerpt";
type OwnershipSourceConfidence = "high" | "medium" | "low";

type Form144Facts = {
  source_format: string;
  structured_xml: boolean;
  submission_type: string | null;
  previous_accession_number: string | null;
  seller_name: string | null;
  account_person_name: string | null;
  seller_address: Record<string, unknown> | null;
  issuer_relationships: string[];
  broker_name: string | null;
  market_maker_name: string | null;
  broker_or_market_maker: Record<string, unknown> | null;
  broker_dealer_file_number: string | null;
  securities_class_title: string | null;
  securities_to_be_sold: number | null;
  securities_to_be_sold_text: string | null;
  securities_to_be_sold_status: string;
  aggregate_market_value: number | null;
  aggregate_market_value_text: string | null;
  aggregate_market_value_status: string;
  approximate_sale_date: string | null;
  approximate_sale_date_text: string | null;
  approximate_sale_date_status: string;
  securities_exchange_name: string | null;
  shares_outstanding: number | null;
  shares_outstanding_text: string | null;
  shares_outstanding_status: string;
  proposed_sale_percent_of_shares_outstanding: number | null;
  past_three_months_sales: number | null;
  past_three_months_sales_status: string;
  original_securities_to_be_sold: number | null;
  amendment_increase_multiple: number | null;
  rule_144_notice: boolean;
  notice_type: string;
  sale_status: string;
  sale_date_kind: string;
  no_prior_sales_in_past_three_months: boolean | null;
  proposed_sale_rows: Array<Record<string, unknown>>;
  acquisition_lots: Array<Record<string, unknown>>;
  prior_sales: Array<Record<string, unknown>>;
  notice_date: string | null;
  plan_adoption_dates: string[];
  plan_instruction_dates: string[];
  remarks: string | null;
  evidence_keywords: string[];
  row_issues: string[];
};

type OwnershipSourceCandidate = {
  text: string;
  role: string;
  source_format: OwnershipSourceFormat;
  confidence: OwnershipSourceConfidence;
  has_xml_root: boolean;
  has_malformed_xml: boolean;
  url: string | null;
  description: string | null;
  filename: string | null;
};

type OwnershipSourceSelection = {
  text: string;
  source_format: OwnershipSourceFormat;
  status: string;
  confidence: OwnershipSourceConfidence;
  selected_source_role: string | null;
  warnings: string[];
  inventory: Record<string, unknown>;
};

export function parseOwnershipFiling(input: OwnershipFixtureInput): OwnershipParserOutput {
  const rawPayload = isRecord(input.rawPayload) ? input.rawPayload : {};
  const metadata = isRecord(input.metadata) ? input.metadata : {};
  const sourceSelection = selectOwnershipSource(input);
  const text = sourceSelection.text;
  const formType = normalizeFormType(input.formType);
  const isSupported = isSupportedOwnershipForm(formType);
  const isAmendment = /\/A$/i.test(formType);
  const sourceFormat = sourceSelection.source_format;
  const issuer = parseIssuer(input, text);
  const reportingOwners = parseReportingOwners(input, text);
  const reportingOwner = reportingOwners[0] ?? parseReportingOwner(input, text);
  const footnoteEntries = parseFootnoteEntries(text);
  const footnotes = Object.fromEntries(footnoteEntries.map((footnote) => [footnote.id, footnote.text]));
  const transactions = formType.startsWith("4") ? parseForm4Transactions(text, sourceFormat) : [];
  const holdings = formType.startsWith("4") ? parseForm4Holdings(text) : [];
  const form144 = formType.startsWith("144") ? parseForm144Facts(text, sourceFormat) : null;
  const amendment = parseAmendmentFacts(text, isAmendment, form144);
  const remarks = parseRemarks(text);
  const footnoteDiagnostics = buildFootnoteDiagnostics(footnoteEntries, transactions, holdings, form144);
  const evidenceKeywords = detectEvidenceKeywords([
    remarks,
    amendment.reason,
    ...footnoteEntries.map((footnote) => footnote.text),
    ...form144EvidenceTexts(form144),
  ]);
  const tradingPlan = parseTradingPlanFacts(text, footnoteEntries, remarks);
  const signatures = parseSignatures(text);
  const localAmendmentComparison = compareLocalAmendmentIfAvailable(input, formType, {
    issuer,
    reportingOwners,
    transactions,
    holdings,
    form144,
    amendment,
    remarks,
    signatures,
  });
  const localForm4Connection = compareLocalForm144Form4IfAvailable(input, formType, {
    issuer,
    form144,
  });
  const warnings = buildWarnings(
    isSupported,
    text,
    reportingOwners,
    transactions,
    holdings,
    form144,
    amendment,
    sourceSelection,
    footnoteDiagnostics,
    tradingPlan,
    localAmendmentComparison,
    localForm4Connection,
  );
  const signals = buildSignals(formType, text, reportingOwners, transactions, holdings, form144, amendment);
  const calendarItems = buildCalendarItems(transactions, form144);
  const sourceInventory = buildSourceInventory(text, sourceFormat, transactions, holdings, form144, footnotes, signatures);
  const selectedEvidence = buildSelectedEvidence(formType, issuer, reportingOwner, transactions, form144, amendment);
  const marketContext = normalizeSuppliedOwnershipMarketContext(
    input.market_context ??
      input.marketContext ??
      rawPayload.market_context ??
      rawPayload.marketContext ??
      metadata.market_context ??
      metadata.marketContext,
  );
  const parserSafetyClassification = classifyParserSafety({
    formType,
    sourceSelection,
    reportingOwners,
    transactions,
    holdings,
    form144,
    amendment,
    footnoteDiagnostics,
    evidenceKeywords,
    evidenceTexts: [
      remarks,
      amendment.reason,
      ...footnoteEntries.map((footnote) => footnote.text),
    ],
    localAmendmentComparison,
    localForm4Connection,
  });
  const parserCompletion = classifyForm4ParserCompletion({
    formType,
    sourceSelection,
    reportingOwners,
    transactions,
    holdings,
    amendment,
    footnoteDiagnostics,
    evidenceKeywords,
    evidenceTexts: [
      remarks,
      amendment.reason,
      ...footnoteEntries.map((footnote) => footnote.text),
    ],
  });
  const ownershipHandoff = classifyOwnershipHandoff({
    formType,
    sourceSelection,
    transactions,
    holdings,
    form144,
    amendment,
    evidenceKeywords,
    parserSafetyClassification,
    parserCompletion,
    localAmendmentComparison,
    localForm4Connection,
  });
  const facts = {
    issuer,
    reporting_owner: reportingOwner,
    reporting_owners: reportingOwners,
    filing: {
      form_type: formType,
      accession_number: input.accessionNumber ?? null,
      is_amendment: isAmendment,
      source_format: sourceFormat,
      source_status: sourceSelection.status,
      source_confidence: sourceSelection.confidence,
      parser_source_role: sourceSelection.selected_source_role,
      schema_version: firstXmlValue(text, "schemaVersion"),
      document_type: firstXmlValue(text, "documentType") ?? firstXmlValue(text, "submissionType"),
      period_of_report: firstXmlValue(text, "periodOfReport"),
      date_of_original_submission: firstXmlValue(text, "dateOfOriginalSubmission"),
      previous_accession_number: firstXmlValue(text, "previousAccessionNumber"),
      not_subject_to_section_16: parseXmlBool(firstXmlValue(text, "notSubjectToSection16")),
      aff_10b5_1: parseXmlBool(firstXmlValue(text, "aff10b5One")),
    },
    form4: transactions.length > 0 || holdings.length > 0
      ? {
          ...summarizeForm4Transactions(transactions),
          holdings,
        }
      : null,
    form144: form144
      ? {
          ...form144,
          ...(localForm4Connection ? { local_form4_connection: localForm4Connection } : {}),
        }
      : null,
    amendment: {
      ...amendment,
      local_comparison: localAmendmentComparison,
    },
    footnotes,
    footnote_order: footnoteEntries.map((footnote) => footnote.id),
    footnote_diagnostics: footnoteDiagnostics,
    evidence_keywords: evidenceKeywords,
    trading_plan: tradingPlan,
    parser_safety_classification: parserSafetyClassification,
    parser_completion: parserCompletion,
    ownership_handoff: ownershipHandoff,
    remarks,
    signatures,
    source_inventory: sourceInventory,
    ...(marketContext ? { market_context: marketContext } : {}),
  };

  return {
    parserVersion: OWNERSHIP_PARSER_VERSION,
    parserGroup: OWNERSHIP_PARSER_GROUP,
    formType: OWNERSHIP_FORM_SCOPE,
    accessionNumber: input.accessionNumber ?? null,
    isSupported,
    summary: buildSummary(formType, issuer, reportingOwner, transactions, form144, amendment, signals),
    facts,
    signals,
    calendarItems,
    warnings,
    raw: {
      fixture_id: input.id ?? null,
      source_excerpt: truncate(text, 1200),
      source_reference: normalizeSourceReference(input.source),
      source_selection: sourceSelection.inventory,
      source_inventory: sourceInventory,
      selected_evidence: selectedEvidence,
      deterministic_result_available:
        hasDeterministicArchiveSignal(signals) ||
        parserCompletion.can_finish_without_llm ||
        isCleanLocalAmendmentArchiveCandidate({
          amendment: {
            local_comparison: localAmendmentComparison,
          },
        }),
    },
  };
}

export function deriveDeliveryLevel(score: number): DeliveryLevel {
  if (score >= 75) {
    return "alert";
  }
  if (score >= 50) {
    return "feed";
  }
  return "archive";
}

export function isApprovedEventType(eventType: string): eventType is ApprovedEventType {
  return APPROVED_EVENT_TYPES.includes(eventType as ApprovedEventType);
}

export function buildOwnershipRoutingDecision(parserOutput: OwnershipParserOutput) {
  const facts = isRecord(parserOutput.facts) ? parserOutput.facts : {};
  const form4 = isRecord(facts.form4) ? facts.form4 : null;
  const form144 = isRecord(facts.form144) ? facts.form144 : null;
  const safety = isRecord(facts.parser_safety_classification) ? facts.parser_safety_classification : {};
  const handoff = isRecord(facts.ownership_handoff) ? facts.ownership_handoff : {};
  const isUnsupported = !parserOutput.isSupported || parserOutput.signals.includes("unsupported_or_empty_document");
  const eventType = isUnsupported
    ? "other"
    : isApprovedEventType(String(handoff.event_type))
    ? (handoff.event_type as ApprovedEventType)
    : "insider_ownership";
  const displayType: "generic" | "offering_terms" | "candidate_special" =
    handoff.display_type === "candidate_special" || handoff.display_type === "generic" || handoff.display_type === "offering_terms"
      ? handoff.display_type
      : form4 && (form4.has_purchase || form4.has_sale || form4.has_derivative_transaction)
        ? "candidate_special"
        : form144 && (parserOutput.signals.includes("large_form_144_sale") || isRecord(form144.local_form4_connection))
          ? "candidate_special"
          : "generic";
  const parserCompletion = isRecord(facts.parser_completion) ? facts.parser_completion : {};
  const deterministicAvailable =
    hasDeterministicArchiveSignal(parserOutput.signals) || Boolean(parserCompletion.can_finish_without_llm);

  return {
    router_used: false,
    router_needed: Boolean(handoff.router_needed),
    classifier_source: isUnsupported ? "parser_supported-form_classifier" : "parser_ownership_default",
    event_type: eventType,
    event_type_confidence: handoff.event_type_confidence ?? (isUnsupported ? "high" : "high"),
    display_type: displayType,
    display_type_confidence: handoff.display_type_confidence ?? "high",
    display_version: "ownership_v1",
    analysis_llm_needed: Boolean(handoff.analysis_llm_needed ?? !deterministicAvailable),
    deterministic_parser_resolution_safe: Boolean(handoff.deterministic_parser_resolution_safe ?? deterministicAvailable),
    reason: typeof handoff.reason === "string" ? handoff.reason : isUnsupported
      ? "Parser did not extract supported ownership facts, so event_type is other."
      : "Ownership form family defaults to insider_ownership; no router is needed unless parser facts prove ambiguity.",
    router_needed_reasons: Array.isArray(handoff.router_needed_reasons) ? handoff.router_needed_reasons : [],
    analysis_needed_reasons: Array.isArray(handoff.analysis_needed_reasons) ? handoff.analysis_needed_reasons : [],
    parser_safety_status: safety.status ?? null,
  };
}

export function buildOwnershipDisplayPayload(parserOutput: OwnershipParserOutput) {
  const facts = isRecord(parserOutput.facts) ? parserOutput.facts : {};
  const form4 = isRecord(facts.form4) ? facts.form4 : null;
  const form144 = isRecord(facts.form144) ? facts.form144 : null;
  const raw = isRecord(parserOutput.raw) ? parserOutput.raw : {};
  const routing = buildOwnershipRoutingDecision(parserOutput);

  return {
    display_type: routing.display_type,
    data: {
      display_version: routing.display_version,
      event_type: routing.event_type,
      routing,
      issuer: facts.issuer ?? null,
      reporting_owner: facts.reporting_owner ?? null,
      reporting_owners: facts.reporting_owners ?? [],
      filing: facts.filing ?? null,
      parser_safety_classification: facts.parser_safety_classification ?? null,
      parser_completion: facts.parser_completion ?? null,
      ownership_handoff: facts.ownership_handoff ?? null,
      form4: form4
        ? {
            acquired_shares: form4.acquired_shares ?? null,
            disposed_shares: form4.disposed_shares ?? null,
            total_reported_value: form4.total_reported_value ?? null,
            has_purchase: form4.has_purchase ?? false,
            has_sale: form4.has_sale ?? false,
            has_derivative_transaction: form4.has_derivative_transaction ?? false,
            non_derivative_transactions: compactDisplayRows(form4.non_derivative_transactions),
            derivative_transactions: compactDisplayRows(form4.derivative_transactions),
            holdings: compactDisplayRows(form4.holdings),
            transaction_count: Array.isArray(form4.transactions) ? form4.transactions.length : 0,
            holding_count: Array.isArray(form4.holdings) ? form4.holdings.length : 0,
          }
        : null,
      form144: form144
        ? {
            notice_type: form144.notice_type ?? null,
            sale_status: form144.sale_status ?? null,
            securities_class_title: form144.securities_class_title ?? null,
            securities_to_be_sold: form144.securities_to_be_sold ?? null,
            aggregate_market_value: form144.aggregate_market_value ?? null,
            approximate_sale_date: form144.approximate_sale_date ?? null,
            proposed_sale_rows: compactDisplayRows(form144.proposed_sale_rows),
            acquisition_lots: compactDisplayRows(form144.acquisition_lots),
            prior_sales: compactDisplayRows(form144.prior_sales),
            plan_adoption_dates: form144.plan_adoption_dates ?? [],
            plan_instruction_dates: form144.plan_instruction_dates ?? [],
            proposed_sale_row_count: Array.isArray(form144.proposed_sale_rows) ? form144.proposed_sale_rows.length : 0,
            local_form4_connection: form144.local_form4_connection ?? null,
          }
        : null,
      amendment: facts.amendment ?? null,
      footnotes: facts.footnotes ?? {},
      remarks: facts.remarks ?? null,
      warnings: parserOutput.warnings,
      source_inventory: facts.source_inventory ?? raw.source_inventory ?? null,
      ...(facts.market_context ? { market_context: facts.market_context } : {}),
    },
    evidence: compactDisplayEvidence(raw.selected_evidence),
    notes: [
      "Display payload was built from parser facts; analysis LLM must not invent UI fields.",
      `Routing classifier source: ${routing.classifier_source}.`,
    ],
  };
}

function scoreParserCompleteForm4Trade(
  side: "buy" | "sale",
  totalValue: number | null,
  ownershipPercent: number | null,
  ownerProfile: Record<string, unknown> | null | undefined,
) {
  const value = totalValue ?? 0;
  const percent = ownershipPercent ?? 0;
  const roleText = ownerRoleText(ownerProfile);
  const isCeoOrCfo = /\bchief executive officer\b|\bceo\b|\bchief financial officer\b|\bcfo\b/.test(roleText);
  const isTenPercentOwner = /\b10[_\s-]*percent[_\s-]*owner\b|\b10%\s*owner\b/.test(roleText);
  const drivers: string[] = [];
  let score = side === "buy" ? 32 : 28;

  if (value >= 25_000) {
    score += 4;
    drivers.push("transaction_value_25k_plus");
  }
  if (value >= 100_000) {
    score += side === "buy" ? 7 : 8;
    drivers.push("transaction_value_100k_plus");
  }
  if (value >= 250_000) {
    score = Math.max(score, side === "buy" ? 46 : 44);
    drivers.push("transaction_value_250k_plus");
  }
  if (percent >= 10) {
    score = Math.max(score, 55);
    drivers.push("pre_holding_10pct_plus");
  }
  if (value >= 500_000) {
    score = Math.max(score, 49);
    drivers.push("transaction_value_500k_plus");
  }
  if (isCeoOrCfo && value >= 500_000) {
    score = Math.max(score, 55);
    drivers.push("ceo_cfo_transaction_500k_plus");
  }
  if (isTenPercentOwner && value >= 500_000) {
    score = Math.max(score, 58);
    drivers.push("ten_percent_owner_transaction_500k_plus");
  }
  if (value >= 1_000_000) {
    score = Math.max(score, 55);
    drivers.push("transaction_value_1m_plus");
  }
  if (value < 1_000_000 && percent < 10 && !(isCeoOrCfo && value >= 500_000) && !(isTenPercentOwner && value >= 500_000)) {
    score = Math.min(score, 49);
    drivers.push("parser_archive_cap_under_form4_llm_threshold");
  }

  score = Math.max(side === "buy" ? 30 : 25, Math.min(100, score));
  const requiresLlm =
    value >= 1_000_000 ||
    percent >= 10 ||
    (isCeoOrCfo && value >= 500_000) ||
    (isTenPercentOwner && value >= 500_000);
  return {
    score,
    requires_llm: requiresLlm,
    score_reason: requiresLlm
      ? "Form 4 open-market transaction meets the strict ownership LLM threshold by value, role, or holdings percentage."
      : "Form 4 open-market transaction stayed below strict ownership LLM thresholds.",
    drivers,
  };
}

function scoreParserCompleteForm4MixedTrade(
  metrics: Record<string, unknown>,
  ownerProfile: Record<string, unknown> | null | undefined,
) {
  const buyValue = numberOrNull(metrics.total_buy_value) ?? 0;
  const sellValue = numberOrNull(metrics.total_sale_value) ?? 0;
  const grossValue = Math.max(buyValue, sellValue);
  const roleText = ownerRoleText(ownerProfile);
  const isTenPercentOwner = /\b10[_\s-]*percent[_\s-]*owner\b|\b10%\s*owner\b/.test(roleText);
  const positionExit = metrics.position_exit === true;
  const drivers: string[] = ["mixed_open_market_purchase_sale"];
  let score = 36;

  if (grossValue >= 25_000) {
    score = Math.max(score, 40);
    drivers.push("gross_leg_value_25k_plus");
  }
  if (grossValue >= 100_000) {
    score = Math.max(score, 44);
    drivers.push("gross_leg_value_100k_plus");
  }
  if (grossValue >= 250_000) {
    score = Math.max(score, 46);
    drivers.push("gross_leg_value_250k_plus");
  }
  if (positionExit) {
    score = Math.max(score, 48);
    drivers.push("reported_position_exit");
  }
  if (isTenPercentOwner) {
    score = Math.max(score, 48);
    drivers.push("ten_percent_owner_mixed_trade");
  }

  const requiresLlm = grossValue >= 2_500_000;
  if (requiresLlm) {
    score = Math.max(score, 52);
    drivers.push("gross_leg_value_2_5m_plus");
  }

  return {
    score: Math.max(30, Math.min(58, score)),
    requires_llm: requiresLlm,
    signal: positionExit || isTenPercentOwner || grossValue >= 250_000 ? "volatile" : "neutral",
    position_exit: positionExit,
    score_reason: requiresLlm
      ? "Mixed Form 4 P/S activity crossed the large-gross-leg threshold for downstream review."
      : "Mixed Form 4 P/S activity stayed within parser-complete thresholds; rows were not netted.",
    drivers,
  };
}

function form4EffectiveBlockersForSmallCleanTrade(blockers: string[], totalValue: number | null, lowerEvidence: string) {
  if (totalValue === null || totalValue >= 1_000_000 || form4CompletionBlockedByComplexOwnershipTradeText(lowerEvidence)) {
    return blockers;
  }
  return blockers.filter((blocker) => !isForm4ContextNoiseBlockerForSmallTrade(blocker));
}

function isForm4ContextNoiseBlockerForSmallTrade(blocker: string) {
  return (
    blocker === "Trust, family, estate, or entity ownership context requires downstream interpretation."
  );
}

function form4CompletionBlockedByComplexOwnershipTradeText(lowerEvidence: string) {
  return /private placement|purchase agreement|tender|merger|cash-out|equity swap|prepaid forward|collar|reported in error|should not have been reported|incorrectly|inadvertently|correct(?:ed|ion)?|amend(?:ed|ment)?|void|rescind|cancel|replace|revise/.test(
    lowerEvidence,
  );
}

function ownerRoleText(ownerProfile: Record<string, unknown> | null | undefined) {
  if (!ownerProfile) return "";
  return [
    ...stringArray(ownerProfile.roles),
    nullableString(ownerProfile.title),
    ownerProfile.is_director === true ? "director" : null,
    ownerProfile.is_officer === true ? "officer" : null,
    ownerProfile.is_ten_percent_owner === true ? "10_percent_owner" : null,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function normalizeFormType(formType: string): string {
  const normalized = formType.trim().toUpperCase().replace(/^FORM\s+/, "");
  if (normalized === "4/A") {
    return "4/A";
  }
  if (normalized === "144/A") {
    return "144/A";
  }
  if (normalized === "4") {
    return "4";
  }
  if (normalized === "144") {
    return "144";
  }
  return normalized;
}

function isSupportedOwnershipForm(formType: string): boolean {
  return formType === "4" || formType === "4/A" || formType === "144" || formType === "144/A";
}

function parseIssuer(input: OwnershipFixtureInput, text: string) {
  return {
    name:
      firstXmlValue(text, "issuerName") ??
      input.issuer?.name ??
      firstMatch(text, /Issuer(?: Name)?:\s*([^\n;]+)/i),
    ticker:
      firstXmlValue(text, "issuerTradingSymbol") ??
      input.issuer?.ticker ??
      firstMatch(text, /(?:Ticker|Trading Symbol):\s*([A-Z.\-]+)/i),
    exchange:
      input.issuer?.exchange ??
      firstMatch(text, /(?:Exchange|Primary Exchange):\s*([A-Z.\- ]+)/i),
    cik:
      firstXmlValue(text, "issuerCik") ??
      input.issuer?.cik ??
      firstMatch(text, /Issuer CIK:\s*([0-9]+)/i),
  };
}

function parseReportingOwner(input: OwnershipFixtureInput, text: string) {
  return parseReportingOwners(input, text)[0] ?? {
    name: null,
    title: null,
    roles: [],
  };
}

function parseReportingOwners(input: OwnershipFixtureInput, text: string) {
  const ownerBlocks = findXmlBlocks(text, "reportingOwner");
  const owners = ownerBlocks.map((block) => parseReportingOwnerBlock(block));

  if (owners.length > 0) {
    return owners;
  }

  const form144Seller = firstXmlValue(text, "nameOfPersonForWhoseAccountTheSecuritiesAreToBeSold");
  if (form144Seller) {
    return [
      {
        name: form144Seller,
        title: null,
        roles: xmlValues(text, "relationshipToIssuer").map(normalizeRoleLabel).filter(Boolean),
      },
    ];
  }

  const roles = new Set(input.reportingOwner?.roles ?? []);
  if (/(<isDirector>\s*(1|true)\s*<\/isDirector>|Director:\s*(true|yes|1))/i.test(text)) {
    roles.add("director");
  }
  if (/(<isOfficer>\s*(1|true)\s*<\/isOfficer>|Officer:\s*(true|yes|1))/i.test(text)) {
    roles.add("officer");
  }
  if (/(<isTenPercentOwner>\s*(1|true)\s*<\/isTenPercentOwner>|10%\s*Owner:\s*(true|yes|1))/i.test(text)) {
    roles.add("10_percent_owner");
  }

  const fallbackOwner = {
    name:
    input.reportingOwner?.name ??
    firstXmlValue(text, "rptOwnerName") ??
    firstMatch(text, /(?:Reporting Owner|Seller|Owner):\s*([^\n;]+)/i),
    title:
    input.reportingOwner?.title ??
    firstXmlValue(text, "officerTitle") ??
    firstMatch(text, /(?:Title|Officer Title):\s*([^\n;]+)/i),
    roles: Array.from(roles),
  };

  return fallbackOwner.name || fallbackOwner.title || fallbackOwner.roles.length > 0 ? [fallbackOwner] : [];
}

function parseReportingOwnerBlock(block: string) {
  const roles = new Set<string>();
  const isDirector = parseXmlBool(firstXmlValue(block, "isDirector"));
  const isOfficer = parseXmlBool(firstXmlValue(block, "isOfficer"));
  const isTenPercentOwner = parseXmlBool(firstXmlValue(block, "isTenPercentOwner"));
  const isOther = parseXmlBool(firstXmlValue(block, "isOther"));
  if (isDirector) {
    roles.add("director");
  }
  if (isOfficer) {
    roles.add("officer");
  }
  if (isTenPercentOwner) {
    roles.add("10_percent_owner");
  }
  if (isOther) {
    roles.add("other");
  }

  return {
    cik: firstXmlValue(block, "rptOwnerCik"),
    name: firstXmlValue(block, "rptOwnerName"),
    title: firstXmlValue(block, "officerTitle"),
    is_director: isDirector,
    is_officer: isOfficer,
    is_ten_percent_owner: isTenPercentOwner,
    is_other: isOther,
    other_text: firstXmlValue(block, "otherText"),
    roles: Array.from(roles),
    address: {
      street1: firstXmlValue(block, "rptOwnerStreet1"),
      street2: firstXmlValue(block, "rptOwnerStreet2"),
      city: firstXmlValue(block, "rptOwnerCity"),
      state: firstXmlValue(block, "rptOwnerState"),
      zip: firstXmlValue(block, "rptOwnerZipCode"),
      non_us: parseXmlBool(firstXmlValue(block, "rptOwnerNonUSAddressFlag")),
    },
  };
}

function parseForm4Transactions(text: string, sourceFormat: string): ParsedTransaction[] {
  const blocks = [
    ...findXmlBlocks(text, "nonDerivativeTransaction").map((block) => ({
      block,
      kind: "non_derivative" as const,
    })),
    ...findXmlBlocks(text, "derivativeTransaction").map((block) => ({
      block,
      kind: "derivative" as const,
    })),
  ];
  const transactionBlocks =
    blocks.length > 0
      ? blocks
      : sourceFormat === "structured_xml"
      ? []
      : [{ block: text, kind: "non_derivative" as const }];

  return transactionBlocks
    .map(({ block, kind }) => {
      const transactionCode =
        firstXmlValue(block, "transactionCode") ?? firstMatch(block, /Transaction Code:\s*([A-Z])/i);
      const sharesField = parseNumericField(block, "transactionShares", ["Transaction shares", "Shares"]);
      const priceField = parseNumericField(block, "transactionPricePerShare", ["Price per share", "Price"]);
      const conversionField = parseNumericField(block, "conversionOrExercisePrice");
      const underlyingSharesField = parseNumericField(block, "underlyingSecurityShares");
      const followingSharesField = parseNumericField(block, "sharesOwnedFollowingTransaction", [
        "Shares owned following",
        "Post-transaction holdings",
      ]);
      const acquiredDisposed = normalizeAcquiredDisposed(
        firstXmlValue(block, "transactionAcquiredDisposedCode") ??
          firstMatch(block, /Acquired\/Disposed:\s*([AD])/i),
      );
      const transactionTimeliness = firstXmlValue(block, "transactionTimeliness");
      const exerciseDate = firstXmlValue(block, "exerciseDate");
      const transaction: ParsedTransaction = {
        transaction_kind: kind,
        security_title:
          firstXmlValue(block, "securityTitle") ?? firstMatch(block, /Security(?: Title)?:\s*([^\n;]+)/i),
        transaction_date:
          firstXmlValue(block, "transactionDate") ?? firstMatch(block, /Transaction Date:\s*([0-9-]+)/i),
        deemed_execution_date: firstXmlValue(block, "deemedExecutionDate"),
        transaction_code: transactionCode,
        transaction_code_meaning: transactionCodeMeaning(transactionCode),
        transaction_category: transactionCategory(transactionCode),
        voluntary_early_report: transactionCode?.toUpperCase() === "V" || /voluntar|early/i.test(transactionTimeliness ?? ""),
        transaction_timeliness: transactionTimeliness,
        equity_swap_involved: parseXmlBool(firstXmlValue(block, "equitySwapInvolved")),
        acquired_disposed_code: acquiredDisposed,
        shares: sharesField.value,
        shares_text: sharesField.text,
        shares_status: sharesField.status,
        price_per_share: priceField.value,
        price_per_share_text: priceField.text,
        price_per_share_status: priceField.status,
        transaction_value:
          sharesField.value !== null && priceField.value !== null ? roundMoney(sharesField.value * priceField.value) : null,
        conversion_or_exercise_price: conversionField.value,
        conversion_or_exercise_price_text: conversionField.text,
        conversion_or_exercise_price_status: conversionField.status,
        exercise_date: exerciseDate,
        date_exercisable: exerciseDate,
        expiration_date: firstXmlValue(block, "expirationDate"),
        underlying_security_title: firstXmlValue(block, "underlyingSecurityTitle"),
        underlying_security_shares: underlyingSharesField.value,
        underlying_security_shares_text: underlyingSharesField.text,
        underlying_security_shares_status: underlyingSharesField.status,
        shares_owned_following: followingSharesField.value,
        shares_owned_following_text: followingSharesField.text,
        shares_owned_following_status: followingSharesField.status,
        direct_or_indirect_ownership: normalizeDirectIndirect(firstXmlValue(block, "directOrIndirectOwnership")),
        nature_of_ownership: firstXmlValue(block, "natureOfOwnership"),
        ownership_percent_of_shares_outstanding: null,
        footnote_ids: footnoteIds(block),
        field_footnote_ids: transactionFieldFootnoteIds(block),
        row_issues: buildTransactionRowIssues(transactionCode, acquiredDisposed, kind, {
          shares: sharesField,
          price: priceField,
        }),
        evidence: [truncate(block, 400)],
      };
      return transaction.transaction_code || transaction.shares ? transaction : null;
    })
    .filter((transaction): transaction is ParsedTransaction => Boolean(transaction));
}

function parseForm4Holdings(text: string) {
  return [
    ...findXmlBlocks(text, "nonDerivativeHolding").map((block) => parseHoldingBlock(block, "non_derivative")),
    ...findXmlBlocks(text, "derivativeHolding").map((block) => parseHoldingBlock(block, "derivative")),
  ];
}

function parseHoldingBlock(block: string, holdingKind: "non_derivative" | "derivative") {
  const conversionField = parseNumericField(block, "conversionOrExercisePrice");
  const underlyingSharesField = parseNumericField(block, "underlyingSecurityShares");
  const followingSharesField = parseNumericField(block, "sharesOwnedFollowingTransaction");
  const exerciseDate = firstXmlValue(block, "exerciseDate");

  return {
    holding_kind: holdingKind,
    security_title: firstXmlValue(block, "securityTitle"),
    conversion_or_exercise_price: conversionField.value,
    conversion_or_exercise_price_text: conversionField.text,
    conversion_or_exercise_price_status: conversionField.status,
    exercise_date: exerciseDate,
    date_exercisable: exerciseDate,
    expiration_date: firstXmlValue(block, "expirationDate"),
    underlying_security_title: firstXmlValue(block, "underlyingSecurityTitle"),
    underlying_security_shares: underlyingSharesField.value,
    underlying_security_shares_text: underlyingSharesField.text,
    underlying_security_shares_status: underlyingSharesField.status,
    shares_owned_following: followingSharesField.value,
    shares_owned_following_text: followingSharesField.text,
    shares_owned_following_status: followingSharesField.status,
    direct_or_indirect_ownership: normalizeDirectIndirect(firstXmlValue(block, "directOrIndirectOwnership")),
    nature_of_ownership: firstXmlValue(block, "natureOfOwnership"),
    footnote_ids: footnoteIds(block),
    field_footnote_ids: holdingFieldFootnoteIds(block),
  };
}

function summarizeForm4Transactions(transactions: ParsedTransaction[]) {
  const nonDerivativeTransactions = transactions.filter((transaction) => transaction.transaction_kind === "non_derivative");
  const derivativeTransactions = transactions.filter((transaction) => transaction.transaction_kind === "derivative");
  const acquiredShares = sumTransactions(nonDerivativeTransactions, "A");
  const disposedShares = sumTransactions(nonDerivativeTransactions, "D");
  const derivativeAcquiredUnits = sumTransactions(derivativeTransactions, "A");
  const derivativeDisposedUnits = sumTransactions(derivativeTransactions, "D");
  const totalValue = roundMoney(
    transactions.reduce((sum, transaction) => sum + (transaction.transaction_value ?? 0), 0),
  );

  return {
    transactions,
    non_derivative_transactions: nonDerivativeTransactions,
    derivative_transactions: derivativeTransactions,
    acquired_shares: acquiredShares,
    disposed_shares: disposedShares,
    derivative_acquired_units: derivativeAcquiredUnits,
    derivative_disposed_units: derivativeDisposedUnits,
    total_reported_value: totalValue || null,
    has_purchase: transactions.some((transaction) => transaction.transaction_code === "P"),
    has_sale: transactions.some((transaction) => transaction.transaction_code === "S"),
    has_gift: transactions.some((transaction) => transaction.transaction_code === "G"),
    has_conversion: transactions.some((transaction) => transaction.transaction_code === "C"),
    has_derivative_transaction: transactions.some(
      (transaction) => transaction.transaction_kind === "derivative",
    ),
  };
}

function classifyForm4ParserCompletion(input: {
  formType: string;
  sourceSelection: OwnershipSourceSelection;
  reportingOwners: Array<Record<string, unknown>>;
  transactions: ParsedTransaction[];
  holdings: Array<Record<string, unknown>>;
  amendment: ReturnType<typeof parseAmendmentFacts>;
  footnoteDiagnostics: ReturnType<typeof buildFootnoteDiagnostics>;
  evidenceKeywords: string[];
  evidenceTexts: Array<string | null>;
}) {
  const labels = new Set<string>();
  const blockers: string[] = [];
  const reasons: string[] = [];

  if (input.formType !== "4") {
    blockers.push("Parser-complete Form 4 handling is limited to original Form 4 filings; amendments require original filing comparison.");
  }
  if (input.sourceSelection.confidence !== "high" || input.sourceSelection.source_format !== "structured_xml") {
    blockers.push("Parser-complete handling requires high-confidence structured XML.");
  }
  if (input.reportingOwners.length > 1) {
    blockers.push("Multiple reporting owners require downstream review before parser-complete treatment.");
  }
  if (input.amendment.is_amendment || input.amendment.correction_or_error_language) {
    blockers.push("Amendment or correction wording prevents parser-complete original Form 4 treatment.");
  }
  if (input.footnoteDiagnostics.unresolved_references.length > 0) {
    blockers.push("Unresolved footnotes prevent parser-complete treatment.");
  }

  const rows = input.transactions;
  const codes = rows.map((transaction) => transaction.transaction_code?.toUpperCase()).filter(Boolean) as string[];
  const codeSet = new Set(codes);
  const joinedEvidence = rows
    .flatMap((transaction) => [
      transaction.security_title,
      transaction.transaction_code_meaning,
      transaction.nature_of_ownership,
      ...transaction.evidence,
    ])
    .concat(input.evidenceTexts)
    .filter(Boolean)
    .join(" ");
  const lowerEvidence = joinedEvidence.toLowerCase();
  const hasUnknownCode = rows.some((transaction) => transaction.transaction_code_meaning === "unmapped_transaction_code");
  const hasConflict = rows.some((transaction) => transaction.row_issues.some((issue) => /conflict/i.test(issue)));
  const hasDerivative = rows.some((transaction) => transaction.transaction_kind === "derivative");
  const riskContextKeywords = input.evidenceKeywords.filter((keyword) =>
    [
      "equity swap",
      "collar",
      "prepaid forward",
      "merger",
      "tender",
      "correction",
      "amendment",
      "inadvertently",
      "previously reported",
      "reported in error",
      "should not have been reported",
      "void",
      "rescind",
      "cancel",
      "replace",
      "revise",
    ].includes(keyword.toLowerCase()),
  );
  const hasRiskContext = riskContextKeywords.length > 0;
  const hasEntityOrFamilyContext = input.evidenceKeywords.some((keyword) =>
    isEntityOrFamilyContextKeyword(keyword),
  );
  const cleanGiftArchiveCandidate = isForm4GiftArchiveCandidate(rows, codeSet, lowerEvidence, hasEntityOrFamilyContext);
  const cleanJNoConsiderationArchiveCandidate = isForm4JNoConsiderationArchiveCandidate(rows, codeSet, lowerEvidence);
  const cleanSellToCoverArchiveCandidate = isForm4SmallSellToCoverArchiveCandidate(rows, codeSet, lowerEvidence);
  const lowNoiseEntityContextAllowed = isForm4LowNoiseEntityContextArchiveAllowed(
    rows,
    input.holdings,
    codeSet,
    lowerEvidence,
    cleanGiftArchiveCandidate,
    cleanJNoConsiderationArchiveCandidate,
  );
  const routinePreviouslyReportedContext = isRoutinePreviouslyReportedForm4Context(
    rows,
    codeSet,
    lowerEvidence,
    cleanSellToCoverArchiveCandidate,
  );

  if (hasUnknownCode) blockers.push("Unknown transaction code prevents parser-complete treatment.");
  if (hasConflict) blockers.push("Transaction code and acquired/disposed direction conflict prevents parser-complete treatment.");
  const onlyPreviouslyReportedRiskContext =
    routinePreviouslyReportedContext &&
    riskContextKeywords.length > 0 &&
    riskContextKeywords.every((keyword) => keyword.toLowerCase() === "previously reported");
  if (hasRiskContext && !onlyPreviouslyReportedRiskContext) {
    blockers.push("Strategic, correction, or unusual derivative evidence prevents parser-complete treatment.");
  }
  if (hasEntityOrFamilyContext && !lowNoiseEntityContextAllowed) {
    blockers.push("Trust, family, estate, or entity ownership context requires downstream interpretation.");
  }

  if (rows.length === 0 && input.holdings.length > 0 && blockers.length === 0) {
    labels.add("HOLDING_ONLY_NON_TRANSACTION");
    return parserCompletionResult("limited_archive", true, "Holding-only rows are not Form 4 transactions.", labels, blockers, reasons);
  }

  if (rows.length === 0) {
    blockers.push("No Form 4 transaction rows were extracted.");
  }

  if (hasDerivative && codeSet.has("S")) {
    blockers.push("Derivative plus sale rows require downstream review to avoid double-counting.");
  }

  if (codes.length > 0 && codes.every((code) => code === "A")) {
    labels.add("A_ONLY_NOT_OPEN_MARKET_PURCHASE");
    if (form4CompletionBlockedByEconomicSaleText(lowerEvidence)) {
      blockers.push("A-only filing has sale-like explanatory text; parser-complete archive is unsafe.");
    }
    if (blockers.length === 0) {
      return parserCompletionResult("limited_archive", true, "A-only grant or award rows are not open-market purchases.", labels, blockers, reasons);
    }
  }

  if (codes.length > 0 && codes.every((code) => code === "F")) {
    labels.add("F_ONLY_NOT_ORDINARY_SALE");
    if (blockers.length === 0) {
      return parserCompletionResult("limited_archive", true, "F-only rows are tax withholding or exercise-price payment rows, not ordinary open-market sales.", labels, blockers, reasons);
    }
  }

  if (codes.length > 0 && codes.every((code) => code === "M")) {
    labels.add("M_ONLY_NOT_ORDINARY_PURCHASE_OR_SALE");
    if (form4CompletionBlockedByEconomicSaleText(lowerEvidence)) {
      blockers.push("M-only filing has sale-like explanatory text; parser-complete archive is unsafe.");
    }
    if (blockers.length === 0) {
      return parserCompletionResult("limited_archive", true, "M-only derivative exercise or conversion rows are not ordinary purchases or sales.", labels, blockers, reasons);
    }
  }

  if (codes.length > 0 && codes.every((code) => code === "V")) {
    labels.add("V_ONLY_NON_ECONOMIC_MARKER");
    if (blockers.length === 0) {
      return parserCompletionResult("limited_archive", true, "V-only rows are voluntary early-reporting markers, not economic transaction direction.", labels, blockers, reasons);
    }
  }

  const nonMarketArchiveCodes = new Set(["A", "F", "M", "V"]);
  const hasMixedNonMarketArchiveCodes =
    codes.length > 0 &&
    new Set(codes).size > 1 &&
    codes.every((code) => nonMarketArchiveCodes.has(code));
  if (hasMixedNonMarketArchiveCodes) {
    labels.add("MIXED_NON_MARKET_FORM4");
    if (codeSet.has("A")) labels.add("A_ONLY_NOT_OPEN_MARKET_PURCHASE");
    if (codeSet.has("F")) labels.add("F_ONLY_NOT_ORDINARY_SALE");
    if (codeSet.has("M")) labels.add("M_ONLY_NOT_ORDINARY_PURCHASE_OR_SALE");
    if (codeSet.has("V")) labels.add("V_ONLY_NON_ECONOMIC_MARKER");
    if ((codeSet.has("A") || codeSet.has("M")) && form4CompletionBlockedByEconomicSaleText(lowerEvidence)) {
      blockers.push("Mixed non-market Form 4 rows include sale-like or private-placement explanatory text; parser-complete archive is unsafe.");
    }
    if (blockers.length === 0) {
      return parserCompletionResult(
        "limited_archive",
        true,
        "Form 4 contains only non-market award, withholding, exercise, conversion, or voluntary marker rows with no open-market purchase or sale row.",
        labels,
        blockers,
        reasons,
      );
    }
  }

  if (isEquityPlanAdminAdjustmentCandidate(rows, codeSet, lowerEvidence)) {
    labels.add("EQUITY_PLAN_ADMIN_ADJUSTMENT");
    labels.add("D_ONLY_EQUITY_PLAN_ADJUSTMENT");
    if (codeSet.has("A")) labels.add("A_ONLY_NOT_OPEN_MARKET_PURCHASE");
    if (codeSet.has("F")) labels.add("F_ONLY_NOT_ORDINARY_SALE");
    if (blockers.length === 0) {
      return parserCompletionResult(
        "limited_archive",
        true,
        "Form 4 contains source-backed equity-plan forfeiture, withholding, or deferred-share reinvestment rows with no open-market purchase or sale row.",
        labels,
        blockers,
        reasons,
      );
    }
  }

  if (cleanGiftArchiveCandidate) {
    labels.add("G_ONLY_GIFT_NON_MARKET");
    if (blockers.length === 0) {
      return parserCompletionResult(
        "limited_archive",
        true,
        "Form 4 contains only source-backed gift rows with no open-market purchase or sale row.",
        labels,
        blockers,
        reasons,
      );
    }
  }

  if (cleanJNoConsiderationArchiveCandidate) {
    labels.add("J_ONLY_NO_CONSIDERATION_EXCHANGE");
    if (blockers.length === 0) {
      return parserCompletionResult(
        "limited_archive",
        true,
        "Form 4 contains only source-backed no-consideration code J exchange or distribution rows with no open-market purchase or sale row.",
        labels,
        blockers,
        reasons,
      );
    }
  }

  if (cleanSellToCoverArchiveCandidate) {
    labels.add("S_ONLY_SELL_TO_COVER_TAX");
    if (blockers.length === 0) {
      return parserCompletionResult(
        "limited_archive",
        true,
        "Form 4 contains only a small source-backed S-code tax withholding or sell-to-cover row tied to equity vesting.",
        labels,
        blockers,
        reasons,
      );
    }
  }

  if (codeSet.has("P") && codeSet.has("S") && codes.every((code) => code === "P" || code === "S")) {
    labels.add("MIXED_OPEN_MARKET_PURCHASE_SALE");
    if (form4CompletionBlockedByComplexOwnershipTradeText(lowerEvidence)) {
      blockers.push("Complex ownership transaction wording prevents parser-complete mixed buy/sell treatment.");
    }
    const metrics = form4MixedBuySellMetrics(rows);
    if (metrics.blockers.length) blockers.push(...metrics.blockers);
    if (blockers.length === 0) {
      const scorePolicy = scoreParserCompleteForm4MixedTrade(metrics, input.reportingOwners[0]);
      if (scorePolicy.signal === "volatile") labels.add("VOLATILE_MIXED_FORM4");
      const metricsWithScore = {
        ...metrics,
        deterministic_score: scorePolicy.score,
        requires_llm: scorePolicy.requires_llm,
        signal: scorePolicy.signal,
        position_exit: scorePolicy.position_exit,
        score_reason: scorePolicy.score_reason,
        score_drivers: scorePolicy.drivers,
      };
      if (scorePolicy.requires_llm) {
        reasons.push("Mixed Form 4 P/S activity crossed the conservative downstream-review threshold.");
        return parserCompletionResult("mixed_buy_sell", false, scorePolicy.score_reason, labels, blockers, reasons, metricsWithScore);
      }
      return parserCompletionResult(
        "mixed_buy_sell",
        true,
        "Mixed Form 4 P/S rows can be completed from parser facts without netting the reported buy and sale rows.",
        labels,
        blockers,
        reasons,
        metricsWithScore,
      );
    }
  }

  if (codeSet.has("M") && codeSet.has("S")) {
    blockers.push("M plus S in the same filing requires downstream review; only S rows are sale-like and derivative rows must not be double-counted.");
  }

  if (codes.length > 0 && codes.every((code) => code === "P")) {
    labels.add("CLEAN_FORM4_OPEN_MARKET_PURCHASE");
    if (form4CompletionBlockedByComplexOwnershipTradeText(lowerEvidence)) {
      blockers.push("Complex ownership transaction wording prevents parser-complete trade treatment.");
    }
    const metrics = form4TradeMetrics(rows, "P", "A");
    if (metrics.blockers.length) blockers.push(...metrics.blockers);
    const effectiveBlockers = form4EffectiveBlockersForSmallCleanTrade(blockers, metrics.total_value, lowerEvidence);
    if (effectiveBlockers.length !== blockers.length) labels.add("SMALL_CLEAN_FORM4_TRADE_CONTEXT_NOISE_ARCHIVE");
    if (effectiveBlockers.length === 0) {
      const scorePolicy = scoreParserCompleteForm4Trade("buy", metrics.total_value, metrics.percent_of_estimated_pre_transaction_holdings, input.reportingOwners[0]);
      const metricsWithScore = {
        ...metrics,
        deterministic_score: scorePolicy.score,
        requires_llm: scorePolicy.requires_llm,
        score_reason: scorePolicy.score_reason,
        score_drivers: scorePolicy.drivers,
      };
      if (scorePolicy.requires_llm) {
        reasons.push("Clean Form 4 P-code purchase meets the conservative ownership LLM threshold.");
        return parserCompletionResult("insider_buy", false, scorePolicy.score_reason, labels, effectiveBlockers, reasons, metricsWithScore);
      }
      return parserCompletionResult("insider_buy", true, "Clean low-score Form 4 P-code acquisition rows can be completed from parser facts.", labels, effectiveBlockers, reasons, metricsWithScore);
    }
  }

  if (codes.length > 0 && codes.every((code) => code === "S")) {
    labels.add("CLEAN_FORM4_OPEN_MARKET_SALE");
    if (form4CompletionBlockedByComplexOwnershipTradeText(lowerEvidence)) {
      blockers.push("Complex ownership transaction wording prevents parser-complete trade treatment.");
    }
    const metrics = form4TradeMetrics(rows, "S", "D");
    if (metrics.blockers.length) blockers.push(...metrics.blockers);
    const effectiveBlockers = form4EffectiveBlockersForSmallCleanTrade(blockers, metrics.total_value, lowerEvidence);
    if (effectiveBlockers.length !== blockers.length) labels.add("SMALL_CLEAN_FORM4_TRADE_CONTEXT_NOISE_ARCHIVE");
    if (effectiveBlockers.length === 0) {
      const scorePolicy = scoreParserCompleteForm4Trade("sale", metrics.total_value, metrics.percent_of_estimated_pre_transaction_holdings, input.reportingOwners[0]);
      const metricsWithScore = {
        ...metrics,
        deterministic_score: scorePolicy.score,
        requires_llm: scorePolicy.requires_llm,
        score_reason: scorePolicy.score_reason,
        score_drivers: scorePolicy.drivers,
      };
      if (scorePolicy.requires_llm) {
        reasons.push("Clean Form 4 S-code sale meets the conservative ownership LLM threshold.");
        return parserCompletionResult("insider_sale", false, scorePolicy.score_reason, labels, effectiveBlockers, reasons, metricsWithScore);
      }
      return parserCompletionResult("insider_sale", true, "Clean low-score Form 4 S-code disposition rows can be completed from parser facts.", labels, effectiveBlockers, reasons, metricsWithScore);
    }
  }

  if (codeSet.has("P") || codeSet.has("S")) {
    reasons.push("Form 4 contains purchase or sale rows, but parser-complete conditions were not clean.");
  }
  const unresolvedSpecialCodes = ["J", "K", "U", "G"].filter(
    (code) =>
      codeSet.has(code) &&
      !(code === "G" && cleanGiftArchiveCandidate) &&
      !(code === "J" && cleanJNoConsiderationArchiveCandidate),
  );
  if (unresolvedSpecialCodes.length > 0) {
    blockers.push("J/K/U/G transaction codes require downstream interpretation in the current parser-complete policy.");
  }
  if (hasDerivative) {
    reasons.push("Derivative transaction rows are preserved but not completed as ordinary buy/sale output.");
  }

  return parserCompletionResult(null, false, null, labels, blockers, reasons);
}

function parserCompletionResult(
  completionKind: string | null,
  canFinishWithoutLlm: boolean,
  reason: string | null,
  labels: Set<string>,
  blockers: string[],
  reasons: string[],
  metrics: Record<string, unknown> | null = null,
) {
  return {
    completion_kind: completionKind,
    can_finish_without_llm: canFinishWithoutLlm,
    reason,
    labels: Array.from(labels),
    blockers: uniqueStrings(blockers),
    downstream_reasons: uniqueStrings(reasons),
    metrics,
  };
}

function form4TradeMetrics(transactions: ParsedTransaction[], expectedCode: "P" | "S", expectedDirection: "A" | "D") {
  const blockers: string[] = [];
  const cleanRows = transactions.filter(
    (transaction) =>
      transaction.transaction_kind === "non_derivative" &&
      transaction.transaction_code === expectedCode &&
      transaction.acquired_disposed_code === expectedDirection,
  );
  if (cleanRows.length !== transactions.length) {
    blockers.push("Parser-complete Form 4 buy/sale requires all rows to match the same non-derivative transaction code and direction.");
  }
  if (transactions.some((transaction) => transaction.shares === null || transaction.price_per_share === null)) {
    blockers.push("Parser-complete Form 4 buy/sale requires source-backed shares and price fields.");
  }
  const totalShares = sumNumbers(cleanRows.map((transaction) => transaction.shares));
  const totalValue = sumNumbers(cleanRows.map((transaction) => transaction.transaction_value));
  const followingHoldings = cleanRows
    .map((transaction) => transaction.shares_owned_following)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  const finalFollowing = followingHoldings.length ? followingHoldings[followingHoldings.length - 1] : null;
  const preTransactionHoldings =
    totalShares !== null && finalFollowing !== null
      ? expectedDirection === "A"
        ? finalFollowing - totalShares
        : finalFollowing + totalShares
      : null;
  const percentOfPre =
    totalShares !== null && preTransactionHoldings !== null && preTransactionHoldings > 0
      ? roundPercent((totalShares / preTransactionHoldings) * 100)
      : null;

  return {
    blockers,
    total_shares: totalShares,
    total_value: totalValue,
    average_price: totalShares && totalValue ? roundMoney(totalValue / totalShares) : null,
    shares_owned_following: finalFollowing,
    estimated_pre_transaction_holdings: preTransactionHoldings,
    percent_of_estimated_pre_transaction_holdings: percentOfPre,
  };
}

function form4MixedBuySellMetrics(transactions: ParsedTransaction[]) {
  const blockers: string[] = [];
  const buyRows = transactions.filter(
    (transaction) =>
      transaction.transaction_kind === "non_derivative" &&
      transaction.transaction_code === "P" &&
      transaction.acquired_disposed_code === "A",
  );
  const saleRows = transactions.filter(
    (transaction) =>
      transaction.transaction_kind === "non_derivative" &&
      transaction.transaction_code === "S" &&
      transaction.acquired_disposed_code === "D",
  );
  const cleanRows = [...buyRows, ...saleRows];

  if (buyRows.length === 0 || saleRows.length === 0 || cleanRows.length !== transactions.length) {
    blockers.push("Parser-complete mixed Form 4 handling requires only non-derivative P/A and S/D rows.");
  }
  if (transactions.some((transaction) => transaction.shares === null || transaction.price_per_share === null)) {
    blockers.push("Parser-complete mixed Form 4 handling requires source-backed shares and price fields.");
  }

  const totalBuyShares = sumNumbers(buyRows.map((transaction) => transaction.shares));
  const totalSaleShares = sumNumbers(saleRows.map((transaction) => transaction.shares));
  const totalBuyValue = sumNumbers(buyRows.map((transaction) => transaction.transaction_value));
  const totalSaleValue = sumNumbers(saleRows.map((transaction) => transaction.transaction_value));
  const followingHoldings = cleanRows
    .map((transaction) => transaction.shares_owned_following)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  const finalFollowing = followingHoldings.length ? followingHoldings[followingHoldings.length - 1] : null;

  return {
    blockers,
    total_buy_shares: totalBuyShares,
    total_sale_shares: totalSaleShares,
    total_buy_value: totalBuyValue,
    total_sale_value: totalSaleValue,
    average_buy_price: totalBuyShares && totalBuyValue ? roundMoney(totalBuyValue / totalBuyShares) : null,
    average_sale_price: totalSaleShares && totalSaleValue ? roundMoney(totalSaleValue / totalSaleShares) : null,
    shares_owned_following: finalFollowing,
    position_exit: finalFollowing === 0 && (totalSaleShares ?? 0) > 0,
  };
}

function form4CompletionBlockedByEconomicSaleText(lowerEvidence: string) {
  return /weighted average sale price|shares? (?:were )?sold|open-market sale|sell-to-cover|sale pursuant|sold pursuant|purchase agreement|private placement|warrant/.test(
    lowerEvidence,
  );
}

function form4CompletionBlockedBySaleOrStrategicText(lowerEvidence: string) {
  return /weighted average sale price|shares? (?:were )?sold|open-market sale|sell-to-cover|sale pursuant|sold pursuant|sold in multiple transactions|proceeds|cash consideration|purchase agreement|private placement|tender|merger|cash-out/.test(
    lowerEvidence,
  );
}

function isRoutinePreviouslyReportedForm4Context(
  rows: ParsedTransaction[],
  codeSet: Set<string>,
  lowerEvidence: string,
  cleanSellToCoverArchiveCandidate: boolean,
) {
  if (!/previously reported/.test(lowerEvidence)) {
    return false;
  }
  if (/previously reported in error|reported in error|should not have been reported|incorrectly|inadvertently|correct(?:ed|ion)?|amend(?:ed|ment)?|void|rescind|cancel|replace|revise/.test(lowerEvidence)) {
    return false;
  }
  if (/private placement|purchase agreement|prepaid forward|collar|equity swap|tender|merger|cash-out/.test(lowerEvidence)) {
    return false;
  }
  if (cleanSellToCoverArchiveCandidate) {
    return true;
  }
  const routineNonMarketCodes = new Set(["A", "F", "M", "V"]);
  return rows.length > 0 && [...codeSet].every((code) => routineNonMarketCodes.has(code));
}

function isForm4GiftArchiveCandidate(
  rows: ParsedTransaction[],
  codeSet: Set<string>,
  lowerEvidence: string,
  hasEntityOrFamilyContext: boolean,
) {
  void hasEntityOrFamilyContext;
  return (
    rows.length > 0 &&
    codeSet.size === 1 &&
    codeSet.has("G") &&
    rows.every((row) => row.transaction_kind === "non_derivative" && row.transaction_code === "G" && row.row_issues.length === 0) &&
    !form4CompletionBlockedBySaleOrStrategicText(lowerEvidence)
  );
}

function isForm4JNoConsiderationArchiveCandidate(
  rows: ParsedTransaction[],
  codeSet: Set<string>,
  lowerEvidence: string,
) {
  if (rows.length === 0 || codeSet.size !== 1 || !codeSet.has("J")) {
    return false;
  }
  if (rows.every((row) => row.transaction_kind !== "non_derivative")) {
    return false;
  }
  if (rows.some((row) => row.transaction_code !== "J" || row.row_issues.length > 0)) {
    return false;
  }
  if (rows.some((row) => (row.price_per_share ?? 0) !== 0 || (row.transaction_value ?? 0) !== 0)) {
    return false;
  }
  if (!/no consideration|without consideration|for no consideration|exchang|distribut|reclassif|conversion|converted|surrender/i.test(lowerEvidence)) {
    return false;
  }
  return !form4CompletionBlockedBySaleOrStrategicText(lowerEvidence);
}

function isForm4SmallSellToCoverArchiveCandidate(
  rows: ParsedTransaction[],
  codeSet: Set<string>,
  lowerEvidence: string,
) {
  if (rows.length !== 1 || codeSet.size !== 1 || !codeSet.has("S")) {
    return false;
  }
  const row = rows[0];
  if (
    row.transaction_kind !== "non_derivative" ||
    row.transaction_code !== "S" ||
    row.acquired_disposed_code !== "D" ||
    row.row_issues.length > 0 ||
    row.shares === null ||
    row.price_per_share === null ||
    row.transaction_value === null ||
    row.transaction_value >= 50000
  ) {
    return false;
  }
  if (
    !/sell-to-cover|cover(?:ed)? tax|tax withholding|withholding obligation|tax obligation|tax liability|payment of taxes|satisfy(?:ing)? tax|vesting and settlement of restricted stock|restricted stock units/i.test(
      lowerEvidence,
    )
  ) {
    return false;
  }
  return !/10b5-1|trading plan|adopted|instruction date|trust|spouse|family|estate|foundation|grat|llc|partnership|beneficial ownership|pecuniary interest|weighted average|sold in multiple transactions|private placement|purchase agreement|tender|merger|proceeds/i.test(
    lowerEvidence,
  );
}

function isEquityPlanAdminAdjustmentCandidate(rows: ParsedTransaction[], codeSet: Set<string>, lowerEvidence: string) {
  const allowedCodes = new Set(["A", "D", "F"]);
  if (!codeSet.has("D") || !codeSet.has("A")) {
    return false;
  }
  if ([...codeSet].some((code) => !allowedCodes.has(code))) {
    return false;
  }
  if (form4CompletionBlockedByEconomicSaleText(lowerEvidence)) {
    return false;
  }
  const dRows = rows.filter((row) => row.transaction_code === "D");
  const aRows = rows.filter((row) => row.transaction_code === "A");
  const fRows = rows.filter((row) => row.transaction_code === "F");
  const hasCleanD = dRows.length > 0 && dRows.every((row) => {
    return (
      row.acquired_disposed_code === "D" &&
      (row.price_per_share === null || row.price_per_share === 0) &&
      /forfeiture|forfeit|cancel(?:led|lation)?|recalculat|performance metric|psu|restricted stock unit|equity grant|prior equity grant|rule 16b-3/i.test(lowerEvidence)
    );
  });
  const hasCleanA = aRows.length > 0 && aRows.every((row) => {
    return (
      row.acquired_disposed_code === "A" &&
      /deferred share|dividend reinvest|reinvestment|equity grant|rule 16b-3|restricted stock unit|rsu|psu|grant/i.test(lowerEvidence)
    );
  });
  const hasCleanF = fRows.every((row) => {
    return row.acquired_disposed_code === "D" && /tax|withheld|withholding|exercise-price payment|liability/i.test(lowerEvidence);
  });
  return hasCleanD && hasCleanA && hasCleanF;
}

function isEntityOrFamilyContextKeyword(keyword: string) {
  return ["trust", "spouse", "family", "estate", "foundation", "grat", "llc", "partnership"].includes(keyword.toLowerCase());
}

function isForm4LowNoiseEntityContextArchiveAllowed(
  rows: ParsedTransaction[],
  holdings: Array<Record<string, unknown>>,
  codeSet: Set<string>,
  lowerEvidence: string,
  cleanGiftArchiveCandidate: boolean,
  cleanJNoConsiderationArchiveCandidate: boolean,
) {
  if (form4CompletionBlockedBySaleOrStrategicText(lowerEvidence)) {
    return false;
  }
  if (rows.length === 0) {
    return holdings.length > 0;
  }
  if (cleanGiftArchiveCandidate || cleanJNoConsiderationArchiveCandidate) {
    return true;
  }
  const routineNonMarketCodes = new Set(["A", "F", "M", "V"]);
  if ([...codeSet].every((code) => routineNonMarketCodes.has(code))) {
    return true;
  }
  return isEquityPlanAdminAdjustmentCandidate(rows, codeSet, lowerEvidence);
}

function transactionEvidenceText(row: ParsedTransaction) {
  return [
    row.security_title,
    row.transaction_code_meaning,
    row.transaction_category,
    row.nature_of_ownership,
    ...row.evidence,
  ]
    .filter(Boolean)
    .join(" ");
}

function parseForm144Facts(
  text: string,
  sourceFormat: string,
): Form144Facts {
  if (sourceFormat === "legacy_html") {
    return {
      source_format: sourceFormat,
      structured_xml: false,
      submission_type: "144",
      previous_accession_number: null,
      seller_name: null,
      account_person_name: null,
      seller_address: null,
      issuer_relationships: [],
      broker_name: null,
      market_maker_name: null,
      broker_or_market_maker: null,
      broker_dealer_file_number: null,
      securities_class_title: null,
      securities_to_be_sold: null,
      securities_to_be_sold_text: null,
      securities_to_be_sold_status: "missing",
      aggregate_market_value: null,
      aggregate_market_value_text: null,
      aggregate_market_value_status: "missing",
      approximate_sale_date: null,
      approximate_sale_date_text: null,
      approximate_sale_date_status: "missing",
      securities_exchange_name: null,
      shares_outstanding: null,
      shares_outstanding_text: null,
      shares_outstanding_status: "missing",
      proposed_sale_percent_of_shares_outstanding: null,
      past_three_months_sales: null,
      past_three_months_sales_status: "missing_or_blank",
      original_securities_to_be_sold: null,
      amendment_increase_multiple: null,
      rule_144_notice: true,
      no_prior_sales_in_past_three_months: null,
      acquisition_lots: [],
      prior_sales: [],
      plan_adoption_dates: [],
      plan_instruction_dates: [],
      notice_date: null,
      remarks: firstMatch(text, /REMARKS:\s*([^<]+)/i),
      notice_type: "proposed_sale_notice",
      sale_status: "proposed_not_executed",
      sale_date_kind: "approximate_proposed_sale_date",
      proposed_sale_rows: [],
      evidence_keywords: [],
      row_issues: ["Legacy HTML Form 144 fallback did not normalize structured proposed-sale rows."],
    };
  }

  const proposedSaleRows = parseForm144ProposedSaleRows(text);
  const primarySaleRow = proposedSaleRows[0] ?? null;
  const issuerInfoBlock = findXmlBlocks(text, "issuerInfo")[0] ?? "";
  const noticeSignatureBlock = findXmlBlocks(text, "noticeSignature")[0] ?? "";
  const brokerOrMarketMaker = primarySaleRow?.broker_or_market_maker ?? null;
  const securitiesToBeSold =
    primarySaleRow?.securities_to_be_sold ??
    numberAfterLabel(text, ["Securities to be sold", "Shares to be sold", "Number of shares to be sold"]) ??
    firstXmlNumber(text, "securitiesToBeSold");
  const aggregateMarketValue =
    primarySaleRow?.aggregate_market_value ?? numberAfterLabel(text, ["Aggregate market value", "Market value"]);
  const sharesOutstanding =
    primarySaleRow?.shares_outstanding ?? numberAfterLabel(text, ["Shares outstanding", "Total shares outstanding"]);
  const priorSales = parseForm144PriorSales(text);
  const priorSalesTotal = priorSales.reduce(
    (total, sale) => total + (sale.amount_of_securities_sold ?? 0),
    0,
  );
  const noPriorSales = parseYesNo(firstXmlValue(text, "nothingToReportFlagOnSecuritiesSoldInPast3Months"));
  const pastThreeMonthsSales =
    noPriorSales === true
      ? 0
      : priorSales.length > 0
      ? priorSalesTotal
      : numberAfterLabel(text, ["Shares sold in past 3 months", "Securities sold in past 3 months"]) ??
        null;
  const originalSecuritiesToBeSold = parseOriginalSecuritiesFromAmendmentReason(text);
  const proposedSalePercent =
    securitiesToBeSold !== null && sharesOutstanding
      ? roundPercent((securitiesToBeSold / sharesOutstanding) * 100)
      : null;
  const acquisitionLots = parseForm144AcquisitionLots(text);
  const remarks = parseRemarks(text);
  const evidenceKeywords = detectEvidenceKeywords([
    remarks,
    ...acquisitionLots.flatMap((lot) => [
      lot.nature_of_acquisition_transaction,
      lot.acquired_from,
      lot.nature_of_payment,
    ]),
    ...priorSales.flatMap((sale) => [sale.seller_name, sale.securities_class_title]),
  ]);
  const planInstructionDates = extractDatesAfterLabel([remarks ?? ""], /instruction date|instruct(?:ed|ion)/i);

  return {
    source_format: sourceFormat,
    structured_xml: sourceFormat === "structured_xml",
    submission_type: firstXmlValue(text, "submissionType"),
    previous_accession_number: firstXmlValue(text, "previousAccessionNumber"),
    seller_name:
      firstXmlValue(text, "nameOfPersonForWhoseAccountTheSecuritiesAreToBeSold") ??
      firstMatch(text, /Seller:\s*([^\n;]+)/i) ??
      firstMatch(text, /Name of Seller:\s*([^\n;]+)/i),
    account_person_name: firstXmlValue(text, "nameOfPersonForWhoseAccountTheSecuritiesAreToBeSold"),
    seller_address: parseForm144SellerAddress(issuerInfoBlock),
    issuer_relationships: xmlValues(text, "relationshipToIssuer"),
    broker_name:
      brokerOrMarketMaker?.broker_name ??
      firstMatch(text, /Broker:\s*([^\n;]+)/i) ??
      firstMatch(text, /Name of Broker:\s*([^\n;]+)/i),
    market_maker_name: brokerOrMarketMaker?.market_maker_name ?? null,
    broker_or_market_maker: brokerOrMarketMaker,
    broker_dealer_file_number: brokerOrMarketMaker?.broker_dealer_file_number ?? null,
    securities_class_title: primarySaleRow?.securities_class_title ?? null,
    securities_to_be_sold: securitiesToBeSold,
    securities_to_be_sold_text: primarySaleRow?.securities_to_be_sold_text ?? null,
    securities_to_be_sold_status: primarySaleRow?.securities_to_be_sold_status ?? "missing",
    aggregate_market_value: aggregateMarketValue,
    aggregate_market_value_text: primarySaleRow?.aggregate_market_value_text ?? null,
    aggregate_market_value_status: primarySaleRow?.aggregate_market_value_status ?? "missing",
    approximate_sale_date:
      primarySaleRow?.approximate_sale_date ??
      firstMatch(text, /Approx(?:imate)? Sale Date:\s*([0-9-]+)/i) ??
      firstMatch(text, /Date of Sale:\s*([0-9-]+)/i),
    approximate_sale_date_text: primarySaleRow?.approximate_sale_date_text ?? null,
    approximate_sale_date_status: primarySaleRow?.approximate_sale_date_status ?? "missing",
    securities_exchange_name: primarySaleRow?.securities_exchange_name ?? null,
    shares_outstanding: sharesOutstanding,
    shares_outstanding_text: primarySaleRow?.shares_outstanding_text ?? null,
    shares_outstanding_status: primarySaleRow?.shares_outstanding_status ?? "missing",
    proposed_sale_percent_of_shares_outstanding: proposedSalePercent,
    past_three_months_sales: pastThreeMonthsSales,
    past_three_months_sales_status:
      noPriorSales === true ? "none_reported" : priorSales.length > 0 ? "reported_rows" : "missing_or_blank",
    original_securities_to_be_sold: originalSecuritiesToBeSold,
    amendment_increase_multiple:
      originalSecuritiesToBeSold && securitiesToBeSold !== null
        ? roundPercent(securitiesToBeSold / originalSecuritiesToBeSold)
        : null,
    rule_144_notice: true,
    notice_type: "proposed_sale_notice",
    sale_status: "proposed_not_executed",
    sale_date_kind: "approximate_proposed_sale_date",
    no_prior_sales_in_past_three_months: noPriorSales,
    proposed_sale_rows: proposedSaleRows,
    acquisition_lots: acquisitionLots,
    prior_sales: priorSales,
    notice_date: firstXmlValue(noticeSignatureBlock, "noticeDate"),
    plan_adoption_dates: xmlValues(text, "planAdoptionDate"),
    plan_instruction_dates: planInstructionDates,
    remarks,
    evidence_keywords: evidenceKeywords,
    row_issues: buildForm144RowIssues(proposedSaleRows, acquisitionLots, priorSales),
  };
}

function parseForm144ProposedSaleRows(text: string) {
  return findXmlBlocks(text, "securitiesInformation").map((block) => {
    const brokerBlock = findXmlBlocks(block, "brokerOrMarketmakerDetails")[0] ?? "";
    const marketMakerBlock = findXmlBlocks(block, "marketMakerDetails")[0] ?? "";
    const unitsSoldField = parseNumericField(block, "noOfUnitsSold");
    const aggregateMarketValueField = parseNumericField(block, "aggregateMarketValue");
    const unitsOutstandingField = parseNumericField(block, "noOfUnitsOutstanding");
    const approxSaleDateField = firstXmlField(block, "approxSaleDate");

    return {
      securities_class_title: firstXmlValue(block, "securitiesClassTitle"),
      broker_or_market_maker: parseBrokerOrMarketMakerDetails(brokerBlock, marketMakerBlock),
      securities_to_be_sold: unitsSoldField.value,
      securities_to_be_sold_text: unitsSoldField.text,
      securities_to_be_sold_status: unitsSoldField.status,
      aggregate_market_value: aggregateMarketValueField.value,
      aggregate_market_value_text: aggregateMarketValueField.text,
      aggregate_market_value_status: aggregateMarketValueField.status,
      shares_outstanding: unitsOutstandingField.value,
      shares_outstanding_text: unitsOutstandingField.text,
      shares_outstanding_status: unitsOutstandingField.status,
      approximate_sale_date: approxSaleDateField.text,
      approximate_sale_date_text: approxSaleDateField.text,
      approximate_sale_date_status: dateFieldStatus(approxSaleDateField.text, approxSaleDateField.footnote_ids),
      securities_exchange_name: firstXmlValue(block, "securitiesExchangeName"),
      footnote_ids: footnoteIds(block),
      field_footnote_ids: form144ProposedSaleFieldFootnoteIds(block),
      evidence: [truncate(block, 400)],
    };
  });
}

function parseBrokerOrMarketMakerDetails(brokerBlock: string, marketMakerBlock: string) {
  if (!brokerBlock && !marketMakerBlock) {
    return null;
  }

  const brokerFileNumber =
    firstXmlValue(brokerBlock, "brokerDealerFileNumber") ??
    firstXmlValue(brokerBlock, "brokerFileNumber") ??
    firstXmlValue(brokerBlock, "secFileNumber");
  const marketMakerFileNumber =
    firstXmlValue(marketMakerBlock, "brokerDealerFileNumber") ??
    firstXmlValue(marketMakerBlock, "marketMakerFileNumber") ??
    firstXmlValue(marketMakerBlock, "secFileNumber");

  return {
    broker_name: firstXmlValue(brokerBlock, "name"),
    broker_address: parseForm144Address(brokerBlock),
    market_maker_name: firstXmlValue(marketMakerBlock, "name"),
    market_maker_address: parseForm144Address(marketMakerBlock),
    broker_dealer_file_number: brokerFileNumber ?? marketMakerFileNumber,
    footnote_ids: [...footnoteIds(brokerBlock), ...footnoteIds(marketMakerBlock)],
  };
}

function parseForm144SellerAddress(issuerInfoBlock: string) {
  return parseForm144Address(findXmlBlocks(issuerInfoBlock, "personAddress")[0] ?? findXmlBlocks(issuerInfoBlock, "address")[0] ?? "");
}

function parseForm144Address(block: string) {
  if (!block) {
    return null;
  }
  const address = {
    street1: firstXmlValue(block, "street1"),
    street2: firstXmlValue(block, "street2"),
    city: firstXmlValue(block, "city"),
    state_or_country: firstXmlValue(block, "stateOrCountry") ?? firstXmlValue(block, "state"),
    zip: firstXmlValue(block, "zipCode") ?? firstXmlValue(block, "zip"),
  };
  return Object.values(address).some(Boolean) ? address : null;
}

function parseForm144AcquisitionLots(text: string) {
  return findXmlBlocks(text, "securitiesToBeSold").map((block) => {
    const acquiredDateField = firstXmlField(block, "acquiredDate");
    const amountField = parseNumericField(block, "amountOfSecuritiesAcquired");
    const paymentDateField = firstXmlField(block, "paymentDate");
    const evidenceText = [
      firstXmlValue(block, "natureOfAcquisitionTransaction"),
      firstXmlValue(block, "nameOfPersonfromWhomAcquired"),
      firstXmlValue(block, "natureOfPayment"),
    ].filter(Boolean).join(" ");

    return {
      securities_class_title: firstXmlValue(block, "securitiesClassTitle"),
      acquired_date: acquiredDateField.text,
      acquired_date_status: dateFieldStatus(acquiredDateField.text, acquiredDateField.footnote_ids),
      nature_of_acquisition_transaction: firstXmlValue(block, "natureOfAcquisitionTransaction"),
      acquired_from: firstXmlValue(block, "nameOfPersonfromWhomAcquired"),
      is_gift_transaction: parseYesNo(firstXmlValue(block, "isGiftTransaction")),
      amount_of_securities_acquired: amountField.value,
      amount_of_securities_acquired_text: amountField.text,
      amount_of_securities_acquired_status: amountField.status,
      payment_date: paymentDateField.text,
      payment_date_status: dateFieldStatus(paymentDateField.text, paymentDateField.footnote_ids),
      nature_of_payment: normalizeXmlFieldText(firstXmlValue(block, "natureOfPayment")),
      evidence_terms: detectAcquisitionEvidenceTerms(evidenceText),
      footnote_ids: footnoteIds(block),
      field_footnote_ids: form144AcquisitionFieldFootnoteIds(block),
      evidence: [truncate(block, 400)],
    };
  });
}

function parseForm144PriorSales(text: string) {
  return findXmlBlocks(text, "securitiesSoldInPast3Months").map((block) => {
    const sellerBlock = findXmlBlocks(block, "sellerDetails")[0] ?? "";
    const saleDateField = firstXmlField(block, "saleDate");
    const amountField = parseNumericField(block, "amountOfSecuritiesSold");
    const proceedsField = parseNumericField(block, "grossProceeds");
    return {
      seller_name: firstXmlValue(sellerBlock, "name"),
      securities_class_title: normalizeXmlFieldText(firstXmlValue(block, "securitiesClassTitle")),
      sale_date: saleDateField.text,
      sale_date_status: dateFieldStatus(saleDateField.text, saleDateField.footnote_ids),
      amount_of_securities_sold: amountField.value,
      amount_of_securities_sold_text: amountField.text,
      amount_of_securities_sold_status: amountField.status,
      gross_proceeds: proceedsField.value,
      gross_proceeds_text: proceedsField.text,
      gross_proceeds_status: proceedsField.status,
      footnote_ids: footnoteIds(block),
      field_footnote_ids: form144PriorSaleFieldFootnoteIds(block),
    };
  });
}

function form144EvidenceTexts(form144: ReturnType<typeof parseForm144Facts> | null) {
  if (!form144) {
    return [];
  }
  return [
    form144.remarks,
    ...recordArray(form144.acquisition_lots).flatMap((lot) => [
      nullableString(lot.nature_of_acquisition_transaction),
      nullableString(lot.acquired_from),
      nullableString(lot.nature_of_payment),
    ]),
    ...recordArray(form144.prior_sales).flatMap((sale) => [
      nullableString(sale.seller_name),
      nullableString(sale.securities_class_title),
    ]),
  ].filter((value): value is string => Boolean(value));
}

function parseOriginalSecuritiesFromAmendmentReason(text: string) {
  const reason =
    firstMatch(text, /Amendment Reason:\s*([^\n]+)/i) ??
    firstMatch(text, /Explanation of Amendment:\s*([^\n]+)/i) ??
    firstXmlValue(text, "remarks") ??
    "";
  const match = reason.match(/from\s+([0-9,.]+)\s+(?:shares|securities|units)?\s+to\s+[0-9,.]+/i);
  return getNumeric(match?.[1]);
}

function buildForm144RowIssues(
  proposedSaleRows: Array<Record<string, unknown>>,
  acquisitionLots: Array<Record<string, unknown>>,
  priorSales: Array<Record<string, unknown>>,
) {
  const issues: string[] = [];
  if (proposedSaleRows.length > 1) {
    issues.push("Multiple Form 144 proposed sale rows detected; parser preserved rows and kept first row as compatibility summary.");
    const classes = uniqueStrings(proposedSaleRows.map((row) => nullableString(row.securities_class_title)));
    if (classes.length > 1) {
      issues.push("Multiple Form 144 securities classes detected; parser did not collapse them into one class.");
    }
  }
  for (const row of proposedSaleRows) {
    const broker = isRecord(row.broker_or_market_maker) ? row.broker_or_market_maker : null;
    if (!broker?.broker_name && !broker?.market_maker_name) {
      issues.push("Form 144 proposed sale row is missing broker or market maker name.");
    }
    if (broker?.broker_name && broker?.market_maker_name) {
      issues.push("Form 144 proposed sale row includes both broker and market maker; parser preserved both.");
    }
    if (row.approximate_sale_date_status !== "date" && row.approximate_sale_date_status !== "missing") {
      issues.push("Form 144 approximate sale date is ambiguous or footnote-only; parser did not normalize it.");
    }
  }
  for (const lot of acquisitionLots) {
    if (lot.acquired_date_status !== "date" && lot.acquired_date_status !== "missing") {
      issues.push("Form 144 acquisition date is ambiguous or footnote-only; parser did not normalize it.");
    }
  }
  for (const sale of priorSales) {
    if (sale.sale_date_status !== "date" && sale.sale_date_status !== "missing") {
      issues.push("Form 144 prior sale date is ambiguous or footnote-only; parser did not normalize it.");
    }
    if (sale.amount_of_securities_sold_status !== "numeric" && sale.amount_of_securities_sold_status !== "zero") {
      issues.push("Form 144 prior sale amount is missing or ambiguous; parser preserved source status.");
    }
  }
  return uniqueStrings(issues);
}

function detectAcquisitionEvidenceTerms(value: string) {
  const terms = [
    "option exercise",
    "restricted stock",
    "grant",
    "gift",
    "conversion",
    "merger",
    "purchase",
    "private placement",
    "issuer",
    "spouse",
    "trust",
    "estate",
    "affiliate",
  ];
  return terms.filter((term) => new RegExp(escapeRegExp(term), "i").test(value));
}

function parseAmendmentFacts(
  text: string,
  isAmendment: boolean,
  form144: ReturnType<typeof parseForm144Facts> | null,
) {
  if (!isAmendment) {
    return {
      is_amendment: false,
      reason: null,
      previous_accession_number: null,
      appears_administrative: false,
      appears_material: false,
      correction_or_error_language: false,
      needs_parent_context: false,
      needs_reconciliation: false,
      original_filing_match_status: null,
    };
  }

  const reason =
    firstMatch(text, /Amendment Reason:\s*([^\n]+)/i) ??
    firstMatch(text, /Explanation of Amendment:\s*([^\n]+)/i) ??
    firstXmlValue(text, "remarks");
  const administrative = reason
    ? /(administrative|typographical|signature|contact|address|footnote typo|no change to transaction|no change in shares)/i.test(
        reason,
      )
    : false;
  const material =
    !administrative &&
    /(increase|decrease|corrects shares|price|ownership|transaction|omitted|supersedes)/i.test(
      reason ?? text,
    );
  const correctionOrErrorLanguage = hasCorrectionOrErrorLanguage(`${reason ?? ""} ${firstXmlValue(text, "remarks") ?? ""}`);
  const previousAccessionNumber = firstXmlValue(text, "previousAccessionNumber") ?? form144?.previous_accession_number ?? null;

  return {
    is_amendment: true,
    reason,
    previous_accession_number: previousAccessionNumber,
    appears_administrative: administrative,
    appears_material: material,
    correction_or_error_language: correctionOrErrorLanguage,
    needs_parent_context: Boolean(!administrative && (previousAccessionNumber || !reason || material)),
    needs_reconciliation: true,
    original_filing_match_status: previousAccessionNumber ? "not_matched_in_parser" : "not_available_to_parser",
  };
}

function compareLocalAmendmentIfAvailable(
  input: OwnershipFixtureInput,
  formType: string,
  current: {
    issuer: Record<string, unknown>;
    reportingOwners: Array<Record<string, unknown>>;
    transactions: ParsedTransaction[];
    holdings: Array<Record<string, unknown>>;
    form144: ReturnType<typeof parseForm144Facts> | null;
    amendment: ReturnType<typeof parseAmendmentFacts>;
    remarks: string | null;
    signatures: Array<Record<string, unknown>>;
  },
) {
  if (!current.amendment.is_amendment) {
    return {
      local_parent_available: false,
      status: "not_amendment",
      labels: [] as string[],
      changed_fields: [] as string[],
      row_matches: [] as Array<Record<string, unknown>>,
      warnings: [] as string[],
    };
  }

  const originalFiling = resolveOwnershipOriginalFilingInput(input);
  if (!originalFiling) {
    return {
      local_parent_available: false,
      status: "parent_unavailable",
      labels: ["UNKNOWN_AMENDMENT"],
      changed_fields: [] as string[],
      row_matches: [] as Array<Record<string, unknown>>,
      warnings: ["Local amendment comparison unavailable; original filing was not supplied for comparison."],
    };
  }

  const original = parseOwnershipFiling({ ...originalFiling });
  const originalFacts = isRecord(original.facts) ? original.facts : {};

  if (formType.startsWith("4")) {
    return compareForm4Amendment(originalFacts, current);
  }
  if (formType.startsWith("144")) {
    return compareForm144Amendment(originalFacts, current);
  }

  return {
    local_parent_available: true,
    status: "unsupported_amendment_comparison",
    labels: ["UNKNOWN_AMENDMENT"],
    changed_fields: [] as string[],
    row_matches: [] as Array<Record<string, unknown>>,
    warnings: ["Local amendment comparison does not support this ownership form type."],
  };
}

function resolveOwnershipOriginalFilingInput(input: OwnershipFixtureInput): OwnershipFixtureInput | null {
  const rawPayload = isRecord(input.rawPayload) ? input.rawPayload : {};
  const metadata = isRecord(input.metadata) ? input.metadata : {};
  const candidates = [
    input.originalFiling,
    input.ownership_original_filing,
    input.ownershipOriginalFiling,
    rawPayload.ownership_original_filing,
    rawPayload.ownershipOriginalFiling,
    rawPayload.originalFiling,
    metadata.ownership_original_filing,
    metadata.ownershipOriginalFiling,
    metadata.originalFiling,
  ];

  for (const candidate of candidates) {
    const normalized = normalizeOwnershipOriginalFilingCandidate(candidate, input.formType);
    if (normalized) {
      return normalized;
    }
  }
  return null;
}

function normalizeOwnershipOriginalFilingCandidate(candidate: unknown, amendmentFormType: string): OwnershipFixtureInput | null {
  const parentFormType = parentOwnershipFormType(amendmentFormType);
  if (typeof candidate === "string") {
    const filingText = candidate.trim();
    return filingText
      ? {
          formType: parentFormType,
          filingText,
        }
      : null;
  }
  if (!isRecord(candidate)) {
    return null;
  }

  const rawPayload = isRecord(candidate.rawPayload) ? candidate.rawPayload : {};
  const metadata = isRecord(candidate.metadata) ? candidate.metadata : {};
  const attachmentRecords = attachmentRecordArray(candidate.attachments).length
    ? attachmentRecordArray(candidate.attachments)
    : attachmentRecordArray(candidate.attachment_texts ?? rawPayload.attachment_texts);
  const attachmentTexts = attachmentRecords.map((attachment) => nullableString(attachment.text)).filter(Boolean) as string[];
  const filingText = [
    nullableString(candidate.filingText),
    nullableString(candidate.filing_text),
    nullableString(candidate.text),
    nullableString(candidate.source_text),
    nullableString(candidate.xml),
    nullableString(candidate.ownership_source_text),
    nullableString(candidate.primaryDocumentText),
    nullableString(candidate.body_text),
    nullableString(candidate.analysis_text),
    nullableString(rawPayload.ownership_source_text),
    nullableString(rawPayload.body_text),
    nullableString(metadata.ownership_source_text),
    ...attachmentTexts,
  ]
    .filter(Boolean)
    .join("\n\n");

  if (!filingText.trim()) {
    return null;
  }
  const id = nullableString(candidate.id) ?? nullableString(candidate.raw_item_id);
  const issuer = isRecord(candidate.issuer) ? candidate.issuer : null;
  const source = isRecord(candidate.source) ? candidate.source : null;

  return {
    ...(id ? { id } : {}),
    formType:
      nullableString(candidate.formType) ??
      nullableString(candidate.form_type) ??
      nullableString(candidate.source_code) ??
      nullableString(candidate.documentType) ??
      nullableString(rawPayload.form_type) ??
      parentFormType,
    accessionNumber:
      nullableString(candidate.accessionNumber) ??
      nullableString(candidate.accession_number) ??
      nullableString(candidate.source_unique_id) ??
      nullableString(rawPayload.accession_number) ??
      nullableString(metadata.accession_number) ??
      null,
    filingText,
    attachments: attachmentRecords.map((attachment) => ({
      type: nullableString(attachment.type) ?? nullableString(attachment.documentType),
      description: nullableString(attachment.description),
      filename: nullableString(attachment.filename) ?? nullableString(attachment.name),
      url: nullableString(attachment.url),
      text: nullableString(attachment.text),
    })),
    rawPayload,
    metadata,
    issuer: issuer
      ? {
          name: nullableString(issuer.name),
          ticker: nullableString(issuer.ticker),
          exchange: nullableString(issuer.exchange),
          cik: nullableString(issuer.cik),
        }
      : undefined,
    source: source
      ? {
          url: nullableString(source.url),
          retrieved_at: nullableString(source.retrieved_at),
          sha256: nullableString(source.sha256),
        }
      : undefined,
  };
}

function parentOwnershipFormType(formType: string) {
  const normalized = normalizeFormType(formType);
  if (normalized === "4/A") return "4";
  if (normalized === "144/A") return "144";
  return normalized.replace(/\/A$/i, "");
}

function attachmentRecordArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => isRecord(item)) : [];
}

function compareForm4Amendment(
  originalFacts: Record<string, unknown>,
  current: {
    issuer: Record<string, unknown>;
    reportingOwners: Array<Record<string, unknown>>;
    transactions: ParsedTransaction[];
    holdings: Array<Record<string, unknown>>;
    amendment: ReturnType<typeof parseAmendmentFacts>;
    remarks: string | null;
    signatures: Array<Record<string, unknown>>;
  },
) {
  const originalForm4 = isRecord(originalFacts.form4) ? originalFacts.form4 : {};
  const originalTransactions = recordArray(originalForm4.transactions) as Array<Record<string, unknown>>;
  const currentTransactions = current.transactions as unknown as Array<Record<string, unknown>>;
  const comparison = compareRowSets(originalTransactions, currentTransactions, FORM4_COMPARE_FIELDS, form4RowMatchScore);
  const labels = new Set<string>();
  const warnings: string[] = [];

  for (const match of comparison.row_matches) {
    if (match.status === "added") labels.add("ADD_LINE");
    if (match.status === "amended") labels.add("AMEND_LINE");
    if (match.status === "footnote_only") labels.add("FOOTNOTE_ONLY");
    if (match.status === "ambiguous") labels.add("UNKNOWN_AMENDMENT");
  }

  if (current.amendment.correction_or_error_language) {
    labels.add("VOID_OR_ERROR_CANDIDATE");
  }

  if (currentTransactions.length < originalTransactions.length) {
    warnings.push("Form 4/A omits one or more original rows; parser did not treat omission alone as deletion.");
  }
  if (comparison.ambiguous) {
    warnings.push("Local Form 4/A row comparison is ambiguous; parser did not guess row mapping.");
  }

  if (labels.size === 0) {
    if (form4MetadataChanged(originalFacts, current)) {
      labels.add("METADATA_ONLY");
    } else {
      labels.add("UNKNOWN_AMENDMENT");
    }
  }

  return {
    local_parent_available: true,
    status: comparison.ambiguous ? "ambiguous" : "compared",
    labels: Array.from(labels),
    changed_fields: comparison.changed_fields,
    row_matches: comparison.row_matches,
    warnings,
  };
}

function compareForm144Amendment(
  originalFacts: Record<string, unknown>,
  current: {
    issuer: Record<string, unknown>;
    form144: ReturnType<typeof parseForm144Facts> | null;
    amendment: ReturnType<typeof parseAmendmentFacts>;
    remarks: string | null;
  },
) {
  const originalForm144 = (isRecord(originalFacts.form144) ? originalFacts.form144 : {}) as Partial<Form144Facts>;
  const currentForm144 = (current.form144 ?? {}) as Partial<Form144Facts>;
  const labels = new Set<string>();
  const warnings: string[] = [];
  const changedFields: string[] = [];
  const proposedComparison = compareRowSets(
    recordArray(originalForm144.proposed_sale_rows),
    recordArray(currentForm144.proposed_sale_rows),
    FORM144_PROPOSED_COMPARE_FIELDS,
    form144ProposedRowMatchScore,
  );
  const acquisitionComparison = compareRowSets(
    recordArray(originalForm144.acquisition_lots),
    recordArray(currentForm144.acquisition_lots),
    FORM144_ACQUISITION_COMPARE_FIELDS,
    form144AcquisitionRowMatchScore,
  );
  const priorSalesComparison = compareRowSets(
    recordArray(originalForm144.prior_sales),
    recordArray(currentForm144.prior_sales),
    FORM144_PRIOR_SALES_COMPARE_FIELDS,
    form144PriorSaleRowMatchScore,
  );

  changedFields.push(...proposedComparison.changed_fields, ...acquisitionComparison.changed_fields, ...priorSalesComparison.changed_fields);
  for (const field of proposedComparison.changed_fields) {
    if (["securities_to_be_sold", "aggregate_market_value"].includes(field)) labels.add("PROPOSED_SALE_AMOUNT_CHANGED");
    if (field === "approximate_sale_date") labels.add("PROPOSED_SALE_DATE_CHANGED");
    if (field === "securities_class_title") labels.add("SECURITY_CLASS_CHANGED");
    if (field.startsWith("broker_or_market_maker") || field === "broker_dealer_file_number") labels.add("BROKER_CHANGED");
  }
  if (acquisitionComparison.changed_fields.length > 0) labels.add("ACQUISITION_HISTORY_CHANGED");
  if (priorSalesComparison.changed_fields.length > 0) labels.add("PAST_SALES_CHANGED");
  if (arrayComparableChanged(originalForm144.plan_adoption_dates, currentForm144.plan_adoption_dates) || arrayComparableChanged(originalForm144.plan_instruction_dates, currentForm144.plan_instruction_dates)) {
    labels.add("PLAN_DATE_CHANGED");
    changedFields.push("plan_dates");
  }
  if (comparableValue(originalForm144.remarks) !== comparableValue(currentForm144.remarks)) {
    changedFields.push("remarks");
  }
  if (current.amendment.correction_or_error_language) {
    labels.add("VOID_OR_ERROR_CANDIDATE");
  }
  if (labels.size === 0 && changedFields.length === 1 && changedFields[0] === "remarks") {
    labels.add("REMARKS_ONLY");
  }
  if (labels.size === 0 && form144MetadataChanged(originalFacts, current)) {
    labels.add("METADATA_ONLY");
  }
  if (labels.size === 0) {
    labels.add("UNKNOWN_AMENDMENT");
  }

  if (proposedComparison.ambiguous || acquisitionComparison.ambiguous || priorSalesComparison.ambiguous) {
    labels.add("UNKNOWN_AMENDMENT");
    warnings.push("Local Form 144/A row comparison is ambiguous; parser did not guess row mapping.");
  }
  if (recordArray(currentForm144.proposed_sale_rows).length < recordArray(originalForm144.proposed_sale_rows).length) {
    warnings.push("Form 144/A omits one or more original proposed-sale rows; parser did not treat omission alone as cancellation.");
  }

  return {
    local_parent_available: true,
    status: warnings.length ? "ambiguous" : "compared",
    labels: Array.from(labels),
    changed_fields: uniqueStrings(changedFields),
    row_matches: [
      ...proposedComparison.row_matches.map((row) => ({ ...row, table: "proposed_sale_rows" })),
      ...acquisitionComparison.row_matches.map((row) => ({ ...row, table: "acquisition_lots" })),
      ...priorSalesComparison.row_matches.map((row) => ({ ...row, table: "prior_sales" })),
    ],
    warnings,
  };
}

function parseRemarks(text: string) {
  return (
    firstXmlValue(text, "remarks") ??
    firstXmlValue(text, "explanationOfResponses") ??
    firstMatch(text, /(?:Remarks|Explanation of Responses|Explanation):\s*([^\n]+)/i)
  );
}

function detectEvidenceKeywords(values: Array<string | null>) {
  const source = values.filter(Boolean).join("\n");
  const keywords = [
    "10b5-1",
    "trading plan",
    "adopted",
    "instruction date",
    "withholding",
    "tax",
    "sell-to-cover",
    "net exercise",
    "gift",
    "charitable",
    "trust",
    "spouse",
    "family",
    "estate",
    "foundation",
    "affiliate",
    "control securities",
    "restricted securities",
    "GRAT",
    "LLC",
    "partnership",
    "merger",
    "tender",
    "equity swap",
    "collar",
    "prepaid forward",
    "inadvertently",
    "previously reported",
    "reported in error",
    "should not have been reported",
  ];

  return keywords.filter((keyword) => new RegExp(escapeRegExp(keyword), "i").test(source));
}

function parseTradingPlanFacts(
  text: string,
  footnotes: ReturnType<typeof parseFootnoteEntries>,
  remarks: string | null,
) {
  const sourceTexts = [remarks, ...footnotes.map((footnote) => footnote.text)].filter(
    (value): value is string => Boolean(value),
  );
  const evidence = sourceTexts.filter((value) => /10b5-?1|trading plan/i.test(value));
  const structuredAffirmed = parseXmlBool(firstXmlValue(text, "aff10b5One"));
  const planAdoptionDates = uniqueStrings([
    ...xmlValues(text, "planAdoptionDate"),
    ...extractDatesAfterLabel(evidence, /\badopt(?:ed|ion)\b/i),
  ]);
  const instructionDates = uniqueStrings(extractDatesAfterLabel(sourceTexts, /instruction date|instruct(?:ed|ion)/i));
  const uncertainDateEvidence = sourceTexts.filter(
    (value) => /(adopt|instruction date|instruct)/i.test(value) && !DATE_PATTERN.test(value),
  );

  return {
    structured_aff_10b5_1: structuredAffirmed,
    has_10b5_1_mention: structuredAffirmed === true || evidence.length > 0,
    plan_adoption_dates: planAdoptionDates,
    instruction_dates: instructionDates,
    evidence_snippets: evidence.map((value) => truncate(value, 280)),
    uncertain_date_evidence: uncertainDateEvidence.map((value) => truncate(value, 280)),
  };
}

const DATE_PATTERN =
  /\b(?:\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{2,4}|(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\s+\d{1,2},\s+\d{4})\b/i;

function extractNearbyDates(values: string[], pattern: RegExp) {
  const dates: string[] = [];
  for (const value of values) {
    if (!pattern.test(value)) {
      continue;
    }
    for (const match of value.matchAll(new RegExp(DATE_PATTERN.source, "gi"))) {
      dates.push(match[0]);
    }
  }
  return dates;
}

function extractDatesAfterLabel(values: string[], pattern: RegExp) {
  const dates: string[] = [];
  for (const value of values) {
    const labelMatch = value.match(pattern);
    if (!labelMatch || labelMatch.index === undefined) {
      continue;
    }
    const afterLabel = value.slice(labelMatch.index);
    const match = afterLabel.match(DATE_PATTERN);
    if (match?.[0]) {
      dates.push(match[0]);
    }
  }
  return dates;
}

function compareDateStrings(left: string, right: string) {
  const leftTime = Date.parse(left);
  const rightTime = Date.parse(right);
  if (!Number.isFinite(leftTime) || !Number.isFinite(rightTime)) {
    return 0;
  }
  return leftTime === rightTime ? 0 : leftTime > rightTime ? 1 : -1;
}

const FORM4_COMPARE_FIELDS = [
  "transaction_kind",
  "security_title",
  "transaction_date",
  "deemed_execution_date",
  "transaction_code",
  "acquired_disposed_code",
  "shares",
  "shares_text",
  "price_per_share",
  "price_per_share_text",
  "shares_owned_following",
  "shares_owned_following_text",
  "direct_or_indirect_ownership",
  "nature_of_ownership",
  "conversion_or_exercise_price",
  "conversion_or_exercise_price_text",
  "exercise_date",
  "expiration_date",
  "underlying_security_title",
  "underlying_security_shares",
  "underlying_security_shares_text",
  "footnote_ids",
  "field_footnote_ids",
];

const FORM144_PROPOSED_COMPARE_FIELDS = [
  "securities_class_title",
  "broker_or_market_maker.broker_name",
  "broker_or_market_maker.broker_address.street1",
  "broker_or_market_maker.broker_address.city",
  "broker_or_market_maker.market_maker_name",
  "broker_or_market_maker.broker_dealer_file_number",
  "securities_to_be_sold",
  "securities_to_be_sold_text",
  "aggregate_market_value",
  "aggregate_market_value_text",
  "shares_outstanding",
  "shares_outstanding_text",
  "approximate_sale_date",
  "securities_exchange_name",
  "footnote_ids",
  "field_footnote_ids",
];

const FORM144_ACQUISITION_COMPARE_FIELDS = [
  "securities_class_title",
  "acquired_date",
  "nature_of_acquisition_transaction",
  "acquired_from",
  "amount_of_securities_acquired",
  "amount_of_securities_acquired_text",
  "payment_date",
  "nature_of_payment",
  "footnote_ids",
  "field_footnote_ids",
];

const FORM144_PRIOR_SALES_COMPARE_FIELDS = [
  "seller_name",
  "securities_class_title",
  "sale_date",
  "amount_of_securities_sold",
  "amount_of_securities_sold_text",
  "gross_proceeds",
  "gross_proceeds_text",
  "footnote_ids",
  "field_footnote_ids",
];

function compareLocalForm144Form4IfAvailable(
  input: OwnershipFixtureInput,
  formType: string,
  current: {
    issuer: Record<string, unknown>;
    form144: ReturnType<typeof parseForm144Facts> | null;
  },
) {
  if (!formType.startsWith("144") || !current.form144) return null;
  const localForm4Filings = (input as OwnershipFixtureInput & { localForm4Filings?: OwnershipParserOutput[] }).localForm4Filings;
  if (!Array.isArray(localForm4Filings)) return null;
  if (localForm4Filings.length === 0) {
    return {
      local_form4_available: false,
      status: "no_match_yet",
      labels: ["NO_MATCH_YET"],
      candidates: [] as Array<Record<string, unknown>>,
      warnings: [] as string[],
    };
  }

  const proposedRows = recordArray(current.form144.proposed_sale_rows);
  const proposedRow = proposedRows[0] ?? {};
  const plannedAmount = numericValue(proposedRow.securities_to_be_sold) ?? numericValue(current.form144.securities_to_be_sold);
  const proposedDate = normalizeNullableText(proposedRow.approximate_sale_date) ?? normalizeNullableText(current.form144.approximate_sale_date);
  const proposedSecurity = normalizeNullableText(proposedRow.securities_class_title) ?? normalizeNullableText(current.form144.securities_class_title);
  const proposedIssuer = issuerComparable(current.issuer);
  const proposedSeller = normalizePersonName(current.form144.seller_name ?? current.form144.account_person_name);
  const planDates = [
    ...stringArray(current.form144.plan_adoption_dates),
    ...stringArray(current.form144.plan_instruction_dates),
  ];
  const labels = new Set<string>();
  const warnings = ["Form 144 remains a proposed-sale notice; local Form 4 candidates are not execution confirmation."];
  const candidates: Array<Record<string, unknown>> = [];
  let nonExecutionRows = 0;
  let eligibleRows = 0;

  for (const filing of localForm4Filings) {
    const facts = isRecord(filing?.facts) ? filing.facts : {};
    const form4 = isRecord(facts.form4) ? facts.form4 : {};
    const form4Issuer = isRecord(facts.issuer) ? facts.issuer : {};
    const owners = recordArray(facts.reporting_owners);
    const owner = owners[0] ?? (isRecord(facts.reporting_owner) ? facts.reporting_owner : {});
    const issuerMatch = issuerMatchStatus(proposedIssuer, issuerComparable(form4Issuer));
    const personMatch = personMatchStatus(proposedSeller, normalizePersonName(owner.name), current.form144.seller_name, owner.name);

    for (const [rowIndex, row] of recordArray(form4.transactions).entries()) {
      const eligibility = form4ExecutionEligibility(row);
      if (!eligibility.eligible) {
        nonExecutionRows += 1;
        candidates.push({
          status_labels: ["NOT_EXECUTION_RELATED"],
          confidence: "none",
          form4_accession_number: filing.accessionNumber ?? null,
          row_index: rowIndex,
          transaction_code: row.transaction_code ?? null,
          transaction_kind: row.transaction_kind ?? null,
          reason: eligibility.reason,
        });
        continue;
      }
      eligibleRows += 1;
      const rowSecurity = normalizeNullableText(row.security_title);
      const rowAmount = numericValue(row.shares);
      const rowDate = normalizeNullableText(row.transaction_date);
      const securityMatch = securityMatchStatus(proposedSecurity, rowSecurity);
      const dateMatch = dateWindowStatus(proposedDate, rowDate, 5);
      const amountMatch = amountMatchStatus(plannedAmount, rowAmount);
      const candidateLabels = classifyConnectionCandidate({
        issuerMatch,
        personMatch,
        securityMatch,
        dateMatch,
        amountMatch,
      });
      for (const label of candidateLabels) labels.add(label);
      candidates.push({
        status_labels: candidateLabels,
        confidence: connectionConfidence(candidateLabels, issuerMatch, personMatch),
        form4_accession_number: filing.accessionNumber ?? null,
        row_index: rowIndex,
        transaction_code: row.transaction_code ?? null,
        transaction_date: rowDate,
        security_title: rowSecurity,
        amount: rowAmount,
        price_per_share: numericValue(row.price_per_share),
        match_factors: {
          issuer: issuerMatch,
          person: personMatch,
          security: securityMatch,
          date_window: dateMatch,
          amount: amountMatch,
          plan_date_overlap: planDates.some((date) => date && date === rowDate),
        },
      });
    }
  }

  const saleCandidates = candidates.filter((candidate) => !stringArray(candidate.status_labels).includes("NOT_EXECUTION_RELATED"));
  const saleAmountTotal = saleCandidates.reduce((sum, candidate) => sum + (numericValue(candidate.amount) ?? 0), 0);
  if (saleCandidates.length > 1) {
    labels.add("MULTIPLE_MATCH_CANDIDATE");
    warnings.push("Multiple local Form 4 sale rows may relate to the same Form 144 notice; parser did not choose one row.");
  }
  if (plannedAmount !== null && saleCandidates.length > 1 && nearEqualAmount(saleAmountTotal, plannedAmount)) {
    labels.add("FULL_MATCH_CANDIDATE");
  }
  if (eligibleRows === 0 && nonExecutionRows > 0) {
    labels.add("NOT_EXECUTION_RELATED");
    warnings.push("Local Form 4 rows were present, but no row was eligible as a Form 144 sale-execution candidate.");
  }
  if (saleCandidates.some((candidate) => isAmbiguousCandidate(candidate))) {
    labels.add("AMBIGUOUS_CANDIDATE");
    warnings.push("Local Form 144 to Form 4 candidate generation is ambiguous; parser did not infer execution.");
  }
  if (labels.size === 0) labels.add("NO_MATCH_YET");

  return {
    local_form4_available: true,
    status: labels.has("NO_MATCH_YET") ? "no_match_yet" : "candidate_generated",
    labels: Array.from(labels),
    candidates,
    aggregate: {
      local_form4_filing_count: localForm4Filings.length,
      eligible_sale_row_count: eligibleRows,
      non_execution_row_count: nonExecutionRows,
      candidate_sale_amount_total: saleAmountTotal || null,
      planned_amount: plannedAmount,
    },
    warnings: uniqueStrings(warnings),
  };
}

function compareRowSets(
  originalRows: Array<Record<string, unknown>>,
  amendmentRows: Array<Record<string, unknown>>,
  fields: string[],
  scoreFn: (original: Record<string, unknown>, amendment: Record<string, unknown>) => number,
) {
  const rowMatches: Array<Record<string, unknown>> = [];
  const changedFields: string[] = [];
  let ambiguous = false;
  const usedOriginal = new Set<number>();

  amendmentRows.forEach((row, amendmentIndex) => {
    const exactIndex = originalRows.findIndex((original, index) => !usedOriginal.has(index) && rowsEqual(original, row, fields));
    if (exactIndex >= 0) {
      usedOriginal.add(exactIndex);
      rowMatches.push({ amendment_index: amendmentIndex, original_index: exactIndex, status: "unchanged", changed_fields: [] });
      return;
    }

    const candidates = originalRows
      .map((original, index) => ({ original, index, score: usedOriginal.has(index) ? -1 : scoreFn(original, row) }))
      .filter((candidate) => candidate.score > 0)
      .sort((left, right) => right.score - left.score);
    const best = candidates[0];
    if (!best || best.score < 3) {
      rowMatches.push({ amendment_index: amendmentIndex, original_index: null, status: "added", changed_fields: [] });
      return;
    }
    if (candidates[1] && candidates[1].score === best.score) {
      ambiguous = true;
      rowMatches.push({ amendment_index: amendmentIndex, original_index: null, status: "ambiguous", changed_fields: [] });
      return;
    }

    usedOriginal.add(best.index);
    const fieldChanges = changedComparableFields(best.original, row, fields);
    changedFields.push(...fieldChanges);
    rowMatches.push({
      amendment_index: amendmentIndex,
      original_index: best.index,
      status: nonFootnoteFieldsChanged(fieldChanges) ? "amended" : "footnote_only",
      changed_fields: fieldChanges,
    });
  });

  return {
    row_matches: rowMatches,
    changed_fields: uniqueStrings(changedFields),
    ambiguous,
  };
}

function rowsEqual(left: Record<string, unknown>, right: Record<string, unknown>, fields: string[]) {
  return changedComparableFields(left, right, fields).length === 0;
}

function changedComparableFields(left: Record<string, unknown>, right: Record<string, unknown>, fields: string[]) {
  return fields.filter((field) => comparableValue(getPathValue(left, field)) !== comparableValue(getPathValue(right, field)));
}

function form4ExecutionEligibility(row: Record<string, unknown>) {
  const code = normalizeNullableText(row.transaction_code)?.toUpperCase() ?? null;
  const disposed = normalizeNullableText(row.acquired_disposed_code);
  const kind = normalizeNullableText(row.transaction_kind);
  if (kind !== "non_derivative") {
    return { eligible: false, reason: "Derivative rows are not treated as ordinary Form 144 sale execution candidates." };
  }
  if (code === "S" && disposed === "D") {
    return { eligible: true, reason: "Non-derivative S row with disposed marker." };
  }
  if (code === "J" && disposed === "D" && /sale/i.test(`${row.evidence ?? ""} ${row.nature_of_ownership ?? ""}`)) {
    return { eligible: true, reason: "J row contains source text indicating sale/disposition." };
  }
  return { eligible: false, reason: `Transaction code ${code ?? "missing"} is not an eligible Form 144 execution-sale candidate.` };
}

function classifyConnectionCandidate(input: {
  issuerMatch: string;
  personMatch: string;
  securityMatch: string;
  dateMatch: string;
  amountMatch: string;
}) {
  const labels = new Set<string>();
  if (
    input.issuerMatch === "mismatch" ||
    input.securityMatch === "mismatch" ||
    input.dateMatch === "outside_window" ||
    input.amountMatch === "material_mismatch"
  ) {
    labels.add("CONFLICT_CANDIDATE");
  }
  if (
    input.issuerMatch === "ambiguous" ||
    input.personMatch === "ambiguous" ||
    input.securityMatch === "ambiguous" ||
    input.dateMatch === "ambiguous" ||
    input.amountMatch === "ambiguous"
  ) {
    labels.add("AMBIGUOUS_CANDIDATE");
  }
  const strongIdentity =
    input.issuerMatch === "match" &&
    (input.personMatch === "match" || input.personMatch === "missing") &&
    input.securityMatch === "match" &&
    input.dateMatch === "within_window";
  if (strongIdentity && input.amountMatch === "near_exact") {
    labels.add("FULL_MATCH_CANDIDATE");
  } else if (strongIdentity && input.amountMatch === "partial_less_than_planned") {
    labels.add("PARTIAL_MATCH_CANDIDATE");
  }
  if (labels.size === 0) labels.add("NO_MATCH_YET");
  return Array.from(labels);
}

function nonFootnoteFieldsChanged(fields: string[]) {
  return fields.some((field) => !field.includes("footnote"));
}

function form4RowMatchScore(original: Record<string, unknown>, amendment: Record<string, unknown>) {
  return scoreMatchingFields(original, amendment, [
    "transaction_kind",
    "security_title",
    "transaction_date",
    "transaction_code",
    "acquired_disposed_code",
    "shares",
    "price_per_share",
    "direct_or_indirect_ownership",
    "underlying_security_title",
    "underlying_security_shares",
  ]);
}

function form144ProposedRowMatchScore(original: Record<string, unknown>, amendment: Record<string, unknown>) {
  return scoreMatchingFields(original, amendment, [
    "securities_class_title",
    "broker_or_market_maker.broker_name",
    "broker_or_market_maker.market_maker_name",
    "securities_to_be_sold",
    "approximate_sale_date",
    "securities_exchange_name",
  ]);
}

function form144AcquisitionRowMatchScore(original: Record<string, unknown>, amendment: Record<string, unknown>) {
  return scoreMatchingFields(original, amendment, [
    "securities_class_title",
    "acquired_date",
    "nature_of_acquisition_transaction",
    "acquired_from",
    "amount_of_securities_acquired",
  ]);
}

function form144PriorSaleRowMatchScore(original: Record<string, unknown>, amendment: Record<string, unknown>) {
  return scoreMatchingFields(original, amendment, [
    "seller_name",
    "securities_class_title",
    "sale_date",
    "amount_of_securities_sold",
    "gross_proceeds",
  ]);
}

function scoreMatchingFields(original: Record<string, unknown>, amendment: Record<string, unknown>, fields: string[]) {
  return fields.reduce((score, field) => {
    const left = comparableValue(getPathValue(original, field));
    const right = comparableValue(getPathValue(amendment, field));
    return left && right && left === right ? score + 1 : score;
  }, 0);
}

function form4MetadataChanged(originalFacts: Record<string, unknown>, current: { issuer: Record<string, unknown>; reportingOwners: Array<Record<string, unknown>>; signatures: Array<Record<string, unknown>> }) {
  return (
    comparableValue(originalFacts.issuer) !== comparableValue(current.issuer) ||
    comparableValue(originalFacts.reporting_owners) !== comparableValue(current.reportingOwners) ||
    comparableValue(originalFacts.signatures) !== comparableValue(current.signatures)
  );
}

function form144MetadataChanged(originalFacts: Record<string, unknown>, current: { issuer: Record<string, unknown>; form144: ReturnType<typeof parseForm144Facts> | null }) {
  const originalForm144 = isRecord(originalFacts.form144) ? originalFacts.form144 : {};
  return (
    comparableValue(originalFacts.issuer) !== comparableValue(current.issuer) ||
    comparableValue(originalForm144.seller_name) !== comparableValue(current.form144?.seller_name) ||
    comparableValue(originalForm144.issuer_relationships) !== comparableValue(current.form144?.issuer_relationships)
  );
}

function arrayComparableChanged(left: unknown, right: unknown) {
  return comparableValue(left) !== comparableValue(right);
}

function getPathValue(source: Record<string, unknown>, path: string): unknown {
  return path.split(".").reduce<unknown>((value, segment) => {
    if (!isRecord(value)) return undefined;
    return value[segment];
  }, source);
}

function comparableValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return JSON.stringify(value.map((item) => comparableValue(item)));
  if (isRecord(value)) {
    return JSON.stringify(
      Object.keys(value)
        .sort()
        .reduce<Record<string, string>>((acc, key) => {
          acc[key] = comparableValue(value[key]);
          return acc;
        }, {}),
    );
  }
  return String(value).replace(/\s+/g, " ").trim().toLowerCase();
}

function classifyParserSafety(input: {
  formType: string;
  sourceSelection: OwnershipSourceSelection;
  reportingOwners: Array<Record<string, unknown>>;
  transactions: ParsedTransaction[];
  holdings: Array<Record<string, unknown>>;
  form144: ReturnType<typeof parseForm144Facts> | null;
  amendment: ReturnType<typeof parseAmendmentFacts>;
  footnoteDiagnostics: ReturnType<typeof buildFootnoteDiagnostics>;
  evidenceKeywords: string[];
  evidenceTexts: Array<string | null>;
  localAmendmentComparison: ReturnType<typeof compareLocalAmendmentIfAvailable>;
  localForm4Connection: ReturnType<typeof compareLocalForm144Form4IfAvailable>;
}) {
  const statements: string[] = [];
  const reasons: string[] = [];
  const blockers: string[] = [];
  const labels = new Set<string>();
  let status: "parser_resolvable_low_noise" | "downstream_analysis_required" | "ambiguous_or_unsafe" =
    "downstream_analysis_required";

  if (input.sourceSelection.confidence !== "high" || input.sourceSelection.source_format !== "structured_xml") {
    blockers.push("Source is fallback or low-confidence; parser-only low-noise resolution is disabled.");
  }
  if (input.footnoteDiagnostics.unresolved_references.length > 0) {
    blockers.push("Unresolved footnote references prevent clean parser-only resolution.");
  }
  if (input.reportingOwners.length > 1) {
    blockers.push("Multiple reporting owners require downstream interpretation before row ownership is assumed.");
  }
  const keywordBlockers = input.evidenceKeywords.filter((keyword) => PARSER_SAFETY_BLOCKING_KEYWORDS.has(keyword.toLowerCase()));

  if (input.formType.startsWith("4")) {
    const codes = input.transactions.map((transaction) => transaction.transaction_code?.toUpperCase()).filter(Boolean) as string[];
    const codeSet = new Set(codes);
    const lowerEvidence = [
      ...input.transactions.flatMap((transaction) => [
        transaction.security_title,
        transaction.transaction_code_meaning,
        transaction.transaction_category,
        transaction.nature_of_ownership,
        ...transaction.evidence,
      ]),
      ...input.evidenceTexts,
    ].filter(Boolean).join(" ").toLowerCase();
    const hasEntityOrFamilyContext = input.evidenceKeywords.some((keyword) =>
      isEntityOrFamilyContextKeyword(keyword),
    );
    const cleanGiftArchiveCandidate = isForm4GiftArchiveCandidate(input.transactions, codeSet, lowerEvidence, hasEntityOrFamilyContext);
    const cleanJNoConsiderationArchiveCandidate = isForm4JNoConsiderationArchiveCandidate(input.transactions, codeSet, lowerEvidence);
    const cleanSellToCoverArchiveCandidate = isForm4SmallSellToCoverArchiveCandidate(input.transactions, codeSet, lowerEvidence);
    const lowNoiseEntityContextAllowed = isForm4LowNoiseEntityContextArchiveAllowed(
      input.transactions,
      input.holdings,
      codeSet,
      lowerEvidence,
      cleanGiftArchiveCandidate,
      cleanJNoConsiderationArchiveCandidate,
    );
    const routinePreviouslyReportedContext = isRoutinePreviouslyReportedForm4Context(
      input.transactions,
      codeSet,
      lowerEvidence,
      cleanSellToCoverArchiveCandidate,
    );
    const onlyPreviouslyReportedSellToCoverBlocker =
      routinePreviouslyReportedContext &&
      keywordBlockers.length > 0 &&
      keywordBlockers.every((keyword) => keyword.toLowerCase() === "previously reported");
    const onlyLowNoiseEntityOrRoutinePreviouslyReportedBlockers =
      keywordBlockers.length > 0 &&
      lowNoiseEntityContextAllowed &&
      keywordBlockers.every((keyword) =>
        isEntityOrFamilyContextKeyword(keyword) ||
        (routinePreviouslyReportedContext && keyword.toLowerCase() === "previously reported"),
      );
    if (
      keywordBlockers.length > 0 &&
      !cleanJNoConsiderationArchiveCandidate &&
      !onlyPreviouslyReportedSellToCoverBlocker &&
      !onlyLowNoiseEntityOrRoutinePreviouslyReportedBlockers
    ) {
      blockers.push(`Evidence keywords require downstream review: ${uniqueStrings(keywordBlockers).join(", ")}.`);
    }
    const unknownCodes = input.transactions.filter((transaction) => transaction.transaction_code_meaning === "unmapped_transaction_code");
    const hasConflict = input.transactions.some((transaction) => transaction.row_issues.some((issue) => /conflict/i.test(issue)));
    const hasRiskCode = [...codeSet].some((code) => ["P", "S", "J", "K", "U"].includes(code));
    const hasEquitySwap = input.transactions.some((transaction) => transaction.equity_swap_involved);
    const hasGift = input.transactions.some((transaction) => transaction.transaction_category === "gift" || transaction.transaction_code?.toUpperCase() === "G");
    const hasNonRoutineDerivative = input.transactions.some((transaction) => {
      const code = transaction.transaction_code?.toUpperCase();
      return transaction.transaction_kind === "derivative" && !["A", "F", "M", "V"].includes(code ?? "");
    });
    const hasCorrection = Boolean(input.amendment.correction_or_error_language);
    const amendmentLabels = stringArray(input.localAmendmentComparison?.labels);

    if (input.holdings.length > 0 && input.transactions.length === 0) {
      labels.add("HOLDING_ONLY_NON_TRANSACTION");
      statements.push("Holding-only rows are not Form 4 transaction rows.");
      status = blockers.length ? "ambiguous_or_unsafe" : "parser_resolvable_low_noise";
    }
    if (input.transactions.length > 0 && codes.every((code) => code === "A")) {
      labels.add("A_ONLY_NOT_OPEN_MARKET_PURCHASE");
      statements.push("A-only Form 4 rows are not open-market purchase rows.");
      status = blockers.length ? "ambiguous_or_unsafe" : "parser_resolvable_low_noise";
    }
    if (input.transactions.length > 0 && codes.every((code) => code === "F")) {
      labels.add("F_ONLY_NOT_ORDINARY_SALE");
      statements.push("F-only Form 4 rows are tax withholding or exercise-price payment rows, not ordinary open-market sales.");
      status = blockers.length ? "ambiguous_or_unsafe" : "parser_resolvable_low_noise";
    }
    if (input.transactions.length > 0 && codes.every((code) => code === "M")) {
      labels.add("M_ONLY_NOT_ORDINARY_PURCHASE_OR_SALE");
      statements.push("M-only Form 4 rows are derivative exercise or conversion rows, not ordinary open-market purchases or sales.");
      status = blockers.length ? "ambiguous_or_unsafe" : "parser_resolvable_low_noise";
    }
    if (input.transactions.length > 0 && codes.every((code) => code === "V")) {
      labels.add("V_ONLY_NON_ECONOMIC_MARKER");
      statements.push("V is a voluntary early-reporting marker, not an economic transaction direction.");
      status = blockers.length ? "ambiguous_or_unsafe" : "parser_resolvable_low_noise";
    }
    const nonMarketArchiveCodes = new Set(["A", "F", "M", "V"]);
    if (input.transactions.length > 0 && new Set(codes).size > 1 && codes.every((code) => nonMarketArchiveCodes.has(code))) {
      labels.add("MIXED_NON_MARKET_FORM4");
      statements.push("Mixed Form 4 A/F/M/V rows are non-market ownership activity when no open-market purchase or sale row is present.");
      status = blockers.length ? "ambiguous_or_unsafe" : "parser_resolvable_low_noise";
    }
    if (isEquityPlanAdminAdjustmentCandidate(input.transactions, codeSet, [
      ...input.transactions.flatMap((transaction) => [
        transaction.security_title,
        transaction.transaction_code_meaning,
        transaction.transaction_category,
        transaction.nature_of_ownership,
        ...transaction.evidence,
      ]),
      ...input.evidenceTexts,
    ].filter(Boolean).join(" ").toLowerCase())) {
      labels.add("EQUITY_PLAN_ADMIN_ADJUSTMENT");
      statements.push("Source-backed equity-plan forfeiture, withholding, or deferred-share reinvestment rows are not ordinary open-market purchases or sales.");
      status = blockers.length ? "ambiguous_or_unsafe" : "parser_resolvable_low_noise";
    }
    if (cleanGiftArchiveCandidate) {
      labels.add("G_ONLY_GIFT_NON_MARKET");
      statements.push("G-only Form 4 gift rows are not open-market purchase or sale rows.");
      status = blockers.length ? "ambiguous_or_unsafe" : "parser_resolvable_low_noise";
    }
    if (cleanJNoConsiderationArchiveCandidate) {
      labels.add("J_ONLY_NO_CONSIDERATION_EXCHANGE");
      statements.push("Clean no-consideration code J exchange or distribution rows are not ordinary open-market purchase or sale rows.");
      status = blockers.length ? "ambiguous_or_unsafe" : "parser_resolvable_low_noise";
    }
    if (cleanSellToCoverArchiveCandidate) {
      labels.add("S_ONLY_SELL_TO_COVER_TAX");
      statements.push("Small S-code sell-to-cover or tax withholding rows tied to equity vesting are parser-resolvable low-noise facts.");
      status = blockers.length ? "ambiguous_or_unsafe" : "parser_resolvable_low_noise";
    }
    if (codeSet.has("M") && codeSet.has("S")) {
      labels.add("M_PLUS_S_REQUIRES_ANALYSIS");
      statements.push("Derivative exercise/conversion rows must not be double-counted as ordinary common stock sale rows.");
      reasons.push("M plus S in the same filing requires downstream analysis; only the S row may be sale-like.");
      status = "downstream_analysis_required";
    }
    if ((hasRiskCode && !cleanJNoConsiderationArchiveCandidate && !cleanSellToCoverArchiveCandidate) || unknownCodes.length || hasConflict || hasEquitySwap) {
      reasons.push("Form 4 contains purchase, sale, J/K/U, unknown-code, equity-swap, or code/direction conflict facts.");
      status = "downstream_analysis_required";
    }
    if ((hasGift || hasNonRoutineDerivative) && !cleanGiftArchiveCandidate && !cleanJNoConsiderationArchiveCandidate) {
      reasons.push("Form 4 contains gift or non-routine derivative transaction facts that require downstream analysis.");
      status = "downstream_analysis_required";
    }
    if (hasCorrection || amendmentLabels.includes("ADD_LINE") || amendmentLabels.includes("AMEND_LINE") || amendmentLabels.includes("VOID_OR_ERROR_CANDIDATE")) {
      reasons.push("Form 4/A change or correction/error wording requires downstream analysis.");
      status = "downstream_analysis_required";
    } else if (
      amendmentLabels.includes("METADATA_ONLY") ||
      amendmentLabels.includes("FOOTNOTE_ONLY")
    ) {
      labels.add("AMENDMENT_CLEAN_METADATA_OR_FOOTNOTE_ONLY");
      statements.push("Clean metadata-only or footnote-only Form 4/A amendments are not fresh duplicate trade signals.");
      status = blockers.length ? "ambiguous_or_unsafe" : "parser_resolvable_low_noise";
    }
    if (amendmentLabels.includes("UNKNOWN_AMENDMENT")) {
      reasons.push("Form 4/A comparison is unavailable or ambiguous.");
      status = "ambiguous_or_unsafe";
    }
  } else if (input.formType.startsWith("144") && input.form144) {
    const form144 = input.form144;
    const form144KeywordBlockers = keywordBlockers.filter((keyword) =>
      isMaterialForm144SafetyKeyword(keyword, form144),
    );
    if (form144KeywordBlockers.length > 0) {
      blockers.push(`Evidence keywords require downstream review: ${uniqueStrings(form144KeywordBlockers).join(", ")}.`);
    }
    statements.push("Form 144 is a proposed-sale notice, not proof of an executed sale.");
    statements.push("Approximate sale date and planned amount remain proposed facts, not actual execution facts.");
    labels.add("FORM_144_PROPOSED_ONLY");
    const amendmentLabels = stringArray(input.localAmendmentComparison?.labels);
    const connectionLabels = stringArray(input.localForm4Connection?.labels);

    if (connectionLabels.includes("NOT_EXECUTION_RELATED")) {
      statements.push("Local Form 4 F/M/A/G-style rows are not normal execution-sale matches for Form 144.");
    }
    if (connectionLabels.includes("NO_MATCH_YET")) {
      statements.push("No local Form 4 candidate means no local execution candidate was supplied or found, not proof of no execution.");
    }
    if (connectionLabels.some((label) => ["FULL_MATCH_CANDIDATE", "PARTIAL_MATCH_CANDIDATE", "MULTIPLE_MATCH_CANDIDATE", "CONFLICT_CANDIDATE", "AMBIGUOUS_CANDIDATE"].includes(label))) {
      reasons.push("Local Form 144 to Form 4 relationship remains candidate-only and requires downstream analysis.");
      status = "downstream_analysis_required";
    } else if (amendmentLabels.includes("METADATA_ONLY") || amendmentLabels.includes("REMARKS_ONLY")) {
      labels.add("FORM_144A_METADATA_ONLY");
      statements.push("Clean metadata-only or remarks-only Form 144/A amendments remain proposed-sale amendments only.");
      status = blockers.length ? "ambiguous_or_unsafe" : "parser_resolvable_low_noise";
    } else if (
      amendmentLabels.some((label) =>
        [
          "PROPOSED_SALE_AMOUNT_CHANGED",
          "PROPOSED_SALE_DATE_CHANGED",
          "SECURITY_CLASS_CHANGED",
          "BROKER_CHANGED",
          "ACQUISITION_HISTORY_CHANGED",
          "PAST_SALES_CHANGED",
          "PLAN_DATE_CHANGED",
          "VOID_OR_ERROR_CANDIDATE",
          "UNKNOWN_AMENDMENT",
        ].includes(label),
      )
    ) {
      reasons.push("Form 144/A proposed-sale amendment changes or ambiguity require downstream analysis.");
      status = amendmentLabels.includes("UNKNOWN_AMENDMENT") ? "ambiguous_or_unsafe" : "downstream_analysis_required";
    } else if (recordArray(form144.proposed_sale_rows).length > 0) {
      reasons.push("Ordinary Form 144 proposed sale facts may need interpretation and are not parser-resolved as harmless.");
      status = "downstream_analysis_required";
    } else {
      status = blockers.length ? "ambiguous_or_unsafe" : "parser_resolvable_low_noise";
    }
  }

  if (blockers.length && status === "parser_resolvable_low_noise") {
    status = "ambiguous_or_unsafe";
  }
  return {
    status,
    parser_resolvable: status === "parser_resolvable_low_noise",
    downstream_analysis_required: status === "downstream_analysis_required",
    labels: Array.from(labels),
    deterministic_statements: uniqueStrings(statements),
    reasons: uniqueStrings(reasons),
    blockers: uniqueStrings(blockers),
  };
}

function classifyOwnershipHandoff(input: {
  formType: string;
  sourceSelection: OwnershipSourceSelection;
  transactions: ParsedTransaction[];
  holdings: Array<Record<string, unknown>>;
  form144: ReturnType<typeof parseForm144Facts> | null;
  amendment: ReturnType<typeof parseAmendmentFacts>;
  evidenceKeywords: string[];
  parserSafetyClassification: ReturnType<typeof classifyParserSafety>;
  parserCompletion: ReturnType<typeof classifyForm4ParserCompletion>;
  localAmendmentComparison: ReturnType<typeof compareLocalAmendmentIfAvailable>;
  localForm4Connection: ReturnType<typeof compareLocalForm144Form4IfAvailable>;
}) {
  const routerNeededReasons: string[] = [];
  const analysisNeededReasons: string[] = [];
  const labels = new Set<string>();
  const isOwnershipForm = input.formType.startsWith("4") || input.formType.startsWith("144");
  const eventType: ApprovedEventType = isOwnershipForm ? "insider_ownership" : "other";
  const lowConfidenceSource =
    input.sourceSelection.confidence !== "high" || input.sourceSelection.source_format !== "structured_xml";
  const amendmentLabels = stringArray(input.localAmendmentComparison?.labels);
  const connectionLabels = stringArray(input.localForm4Connection?.labels);
  const hasStrategicAmbiguity = input.evidenceKeywords.some((keyword) =>
    ["merger", "tender", "equity swap", "collar", "prepaid forward"].includes(keyword.toLowerCase()),
  );

  if (!isOwnershipForm) {
    routerNeededReasons.push("Form type is outside the ownership room scope, so event/display classification is ambiguous.");
  }
  if (
    !isOwnershipForm &&
    lowConfidenceSource &&
    (input.parserSafetyClassification.status === "ambiguous_or_unsafe" ||
      (!input.transactions.length && !input.holdings.length && !input.form144))
  ) {
    routerNeededReasons.push("Source confidence is low and parser safety classification is ambiguous; event/display defaults may be unsafe.");
  }
  if (hasStrategicAmbiguity && (input.transactions.some((transaction) => ["K", "U", "J"].includes(transaction.transaction_code ?? "")) || input.form144)) {
    analysisNeededReasons.push("Ownership filing includes strategic, tender, or derivative evidence; analyze within insider_ownership instead of routing.");
  }
  if (input.parserSafetyClassification.downstream_analysis_required) {
    analysisNeededReasons.push(...stringArray(input.parserSafetyClassification.reasons));
  }
  if (input.parserSafetyClassification.downstream_analysis_required && !analysisNeededReasons.length) {
    analysisNeededReasons.push("Parser safety classification requires downstream analysis for this ownership filing.");
  }
  if (input.parserCompletion.can_finish_without_llm) {
    analysisNeededReasons.length = 0;
  }
  if (input.parserSafetyClassification.status === "ambiguous_or_unsafe" && !routerNeededReasons.length) {
    analysisNeededReasons.push("Parser facts are ambiguous or unsafe for deterministic resolution, but ownership event/display defaults remain usable.");
  }
  if (connectionLabels.some((label) => ["FULL_MATCH_CANDIDATE", "PARTIAL_MATCH_CANDIDATE", "MULTIPLE_MATCH_CANDIDATE", "CONFLICT_CANDIDATE", "AMBIGUOUS_CANDIDATE"].includes(label))) {
    analysisNeededReasons.push("Form 144 to Form 4 local connection remains candidate-only.");
  }
  if (amendmentLabels.some((label) => ["ADD_LINE", "AMEND_LINE", "VOID_OR_ERROR_CANDIDATE", "PROPOSED_SALE_AMOUNT_CHANGED", "PROPOSED_SALE_DATE_CHANGED", "SECURITY_CLASS_CHANGED", "BROKER_CHANGED", "ACQUISITION_HISTORY_CHANGED", "PAST_SALES_CHANGED", "PLAN_DATE_CHANGED"].includes(label))) {
    analysisNeededReasons.push("Amendment comparison changed source-backed filing facts.");
  }

  if (input.parserSafetyClassification.parser_resolvable) labels.add("PARSER_RESOLVABLE_LOW_NOISE");
  if (input.parserCompletion.can_finish_without_llm) labels.add("PARSER_COMPLETE_WITHOUT_LLM");
  if (analysisNeededReasons.length) labels.add("ANALYSIS_LLM_NEEDED");
  if (routerNeededReasons.length) labels.add("ROUTER_CLASSIFIER_NEEDED");
  if (!routerNeededReasons.length) labels.add("OWNERSHIP_DEFAULT_EVENT_TYPE");

  const displayType: "generic" | "offering_terms" | "candidate_special" =
    input.transactions.some((transaction) => ["P", "S"].includes(transaction.transaction_code ?? "")) ||
    input.transactions.some((transaction) => transaction.transaction_kind === "derivative") ||
    connectionLabels.some((label) => label.endsWith("_CANDIDATE")) ||
    recordArray(input.form144?.proposed_sale_rows).length > 1
      ? "candidate_special"
      : "generic";

  return {
    event_type: eventType,
    event_type_confidence: routerNeededReasons.length ? "low" : "high",
    display_type: displayType,
    display_type_confidence: routerNeededReasons.length ? "low" : "high",
    display_version: "ownership_v1",
    deterministic_parser_resolution_safe: Boolean(
      input.parserSafetyClassification.parser_resolvable || input.parserCompletion.can_finish_without_llm,
    ),
    analysis_llm_needed: !(input.parserSafetyClassification.parser_resolvable || input.parserCompletion.can_finish_without_llm),
    router_needed: routerNeededReasons.length > 0,
    labels: Array.from(labels),
    reason: routerNeededReasons.length
      ? "Ownership parser detected event/display ambiguity; optional router/classifier should review compact facts."
      : "Ownership parser can safely default event_type/display_type for this ownership filing family.",
    analysis_needed_reasons: uniqueStrings(analysisNeededReasons),
    router_needed_reasons: uniqueStrings(routerNeededReasons),
    ui_handoff_fact_groups: [
      "issuer",
      "reporting_owner_or_seller",
      "relationships",
      "form4_transactions_and_holdings",
      "form144_proposed_sales_acquisition_lots_prior_sales",
      "amendment_local_comparison",
      "form144_form4_connection_candidates",
      "footnotes_remarks_10b5_1",
      "source_inventory_and_warnings",
      "parser_safety_classification",
      "parser_completion",
    ],
  };
}

function compactDisplayEvidence(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!isRecord(item)) return item;
      return Object.fromEntries(
        Object.entries(item).map(([key, entry]) => {
          if (typeof entry !== "string") return [key, entry];
          return [key, truncate(entry.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(), 300)];
        }),
      );
    })
    .slice(0, 12);
}

function compactDisplayRows(value: unknown) {
  return recordArray(value).map((row) => {
    const compact: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(row)) {
      if (key === "evidence") continue;
      if (typeof entry === "string") {
        compact[key] = truncate(entry.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(), 300);
      } else {
        compact[key] = entry;
      }
    }
    return compact;
  });
}

const PARSER_SAFETY_BLOCKING_KEYWORDS = new Set([
  "10b5-1",
  "trading plan",
  "adopted",
  "instruction date",
  "equity swap",
  "collar",
  "prepaid forward",
  "trust",
  "spouse",
  "family",
  "estate",
  "foundation",
  "grat",
  "llc",
  "partnership",
  "merger",
  "tender",
  "correction",
  "amendment",
  "inadvertently",
  "previously reported",
  "reported in error",
  "should not have been reported",
  "void",
  "rescind",
  "cancel",
  "replace",
  "revise",
]);

function isMaterialForm144SafetyKeyword(
  keyword: string,
  form144: NonNullable<ReturnType<typeof parseForm144Facts>>,
) {
  const normalized = keyword.toLowerCase();
  if (normalized === "llc" || normalized === "partnership") {
    const relationshipText = stringArray(form144.issuer_relationships).join(" ").toLowerCase();
    const remarksText = nullableString(form144.remarks)?.toLowerCase() ?? "";
    return relationshipText.includes(normalized) || remarksText.includes(normalized);
  }
  return true;
}

function issuerComparable(issuer: Record<string, unknown>) {
  return normalizeNullableText(issuer.cik) ?? normalizeNullableText(issuer.ticker) ?? normalizeNullableText(issuer.name);
}

function issuerMatchStatus(left: string | null, right: string | null) {
  if (!left || !right) return "ambiguous";
  return comparableValue(left) === comparableValue(right) ? "match" : "mismatch";
}

function personMatchStatus(left: string | null, right: string | null, leftRaw: unknown, rightRaw: unknown) {
  if (!left || !right) return "missing";
  if (left === right) return "match";
  return entityLikeName(leftRaw) !== entityLikeName(rightRaw) ? "ambiguous" : "mismatch";
}

function securityMatchStatus(left: string | null, right: string | null) {
  if (!left || !right) return "ambiguous";
  const normalizedLeft = normalizeSecurityTitle(left);
  const normalizedRight = normalizeSecurityTitle(right);
  if (normalizedLeft === normalizedRight) return "match";
  if (/\bclass\s+[a-z0-9]+\b/i.test(left) || /\bclass\s+[a-z0-9]+\b/i.test(right)) return "mismatch";
  return "ambiguous";
}

function dateWindowStatus(proposedDate: string | null, transactionDate: string | null, windowDays: number) {
  if (!proposedDate || !transactionDate) return "ambiguous";
  const diff = daysBetween(proposedDate, transactionDate);
  if (diff === null) return "ambiguous";
  return Math.abs(diff) <= windowDays ? "within_window" : "outside_window";
}

function amountMatchStatus(plannedAmount: number | null, rowAmount: number | null) {
  if (plannedAmount === null || rowAmount === null) return "ambiguous";
  if (nearEqualAmount(rowAmount, plannedAmount)) return "near_exact";
  if (rowAmount > 0 && rowAmount < plannedAmount) return "partial_less_than_planned";
  return "material_mismatch";
}

function connectionConfidence(labels: string[], issuerMatch: string, personMatch: string) {
  if (labels.includes("FULL_MATCH_CANDIDATE") && issuerMatch === "match" && personMatch === "match") return "medium";
  if (labels.includes("FULL_MATCH_CANDIDATE") || labels.includes("PARTIAL_MATCH_CANDIDATE")) return "low";
  if (labels.includes("CONFLICT_CANDIDATE")) return "conflict";
  return "limited";
}

function isAmbiguousCandidate(candidate: Record<string, unknown>) {
  return stringArray(candidate.status_labels).includes("AMBIGUOUS_CANDIDATE");
}

function numericValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function nearEqualAmount(left: number, right: number) {
  if (!Number.isFinite(left) || !Number.isFinite(right)) return false;
  return Math.abs(left - right) <= Math.max(1, Math.abs(right) * 0.01);
}

function daysBetween(left: string, right: string) {
  const leftTime = Date.parse(left);
  const rightTime = Date.parse(right);
  if (!Number.isFinite(leftTime) || !Number.isFinite(rightTime)) return null;
  return Math.round((rightTime - leftTime) / 86_400_000);
}

function normalizePersonName(value: unknown) {
  const text = normalizeNullableText(value);
  if (!text) return null;
  return text
    .toLowerCase()
    .replace(/\b(as trustee|trustee|beneficial owner|jr|sr|ii|iii|iv)\b\.?/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function entityLikeName(value: unknown) {
  return /\b(trust|llc|l\.l\.c|lp|l\.p|inc|corp|foundation|estate|partnership|fund)\b/i.test(String(value ?? ""));
}

function normalizeSecurityTitle(value: string) {
  return value
    .toLowerCase()
    .replace(/,\s*par value.*$/i, "")
    .replace(/\bshares\b/g, "stock")
    .replace(/\bcommon stock\b/g, "common")
    .replace(/\s+/g, " ")
    .trim();
}

function hasCorrectionOrErrorLanguage(value: string) {
  return /inadvertently|previously reported|reported in error|should not have been reported|correct(?:ed|ion)?|error/i.test(
    value,
  );
}

function isRoutineForm144ArchiveCandidate(
  form144: NonNullable<ReturnType<typeof parseForm144Facts>>,
  amendment: ReturnType<typeof parseAmendmentFacts>,
) {
  if (amendment.appears_material || form144.source_format === "legacy_html") {
    return false;
  }
  const aggregateMarketValue = form144.aggregate_market_value;
  const proposedSaleOutstandingPercent = form144.proposed_sale_percent_of_shares_outstanding;
  if (
    form144.securities_to_be_sold === null ||
    aggregateMarketValue === null ||
    !form144.approximate_sale_date
  ) {
    return false;
  }
  const priorSalesRows = recordArray(form144.prior_sales);
  const priorGrossProceeds = form144PriorSalesGrossProceeds(form144);
  const priorGrossOrZero = priorGrossProceeds ?? 0;
  const proposedAndPriorValue = aggregateMarketValue + priorGrossOrZero;

  if (
    aggregateMarketValue >= 5_000_000 ||
    proposedAndPriorValue >= 10_000_000 ||
    priorSalesRows.length > 3 ||
    proposedSaleOutstandingPercent === null ||
    proposedSaleOutstandingPercent >= 0.5
  ) {
    return false;
  }

  const complexKeywords = new Set([
    "trust",
    "spouse",
    "family",
    "estate",
    "foundation",
    "grat",
    "affiliate",
    "control securities",
    "restricted securities",
    "merger",
    "tender",
    "prepaid forward",
    "collar",
    "equity swap",
    "conversion",
    "correction",
    "amendment",
    "inadvertently",
    "previously reported",
    "reported in error",
    "should not have been reported",
  ]);
  const hasComplexKeyword = stringArray(form144.evidence_keywords).some((keyword) =>
    complexKeywords.has(keyword.toLowerCase()),
  );
  const relationshipText = stringArray(form144.issuer_relationships).join(" ").toLowerCase();
  const remarksText = nullableString(form144.remarks)?.toLowerCase() ?? "";
  const hasComplexRelationship = /\b10\s*%|\bten\s+percent\b|affiliate|control|trust|fund|llc|partnership/.test(
    relationshipText,
  );
  const hasComplexRemarks = /prepaid forward|collar|equity swap|affiliate|control securities|control person|correct|amend|previously reported|reported in error|trust|spouse|family|estate|foundation|grat|llc|partnership|fund|merger|tender|conversion/.test(
    remarksText,
  );
  if (hasComplexKeyword || hasComplexRelationship || hasComplexRemarks) {
    return false;
  }

  return true;
}

function isSmallForm144PlanDateArchiveCandidate(
  form144: NonNullable<ReturnType<typeof parseForm144Facts>>,
  hasPriorSales: boolean,
  priorSaleRowCount: number,
  proposedAndPriorValue: number,
) {
  const aggregateMarketValue = form144.aggregate_market_value;
  if (aggregateMarketValue === null) {
    return false;
  }
  if (!hasPriorSales) {
    return (
      (
        aggregateMarketValue < 250000 ||
        (
        aggregateMarketValue < 1000000 &&
        form144.proposed_sale_percent_of_shares_outstanding !== null &&
        form144.proposed_sale_percent_of_shares_outstanding < 0.025
      ) ||
      (
        aggregateMarketValue < 1500000 &&
        form144.proposed_sale_percent_of_shares_outstanding !== null &&
        form144.proposed_sale_percent_of_shares_outstanding < 0.05
      )
    )
  );
  }
  return (
    priorSaleRowCount <= 1 && proposedAndPriorValue < 250000
  ) || (
    priorSaleRowCount <= 3 &&
    proposedAndPriorValue < 1000000 &&
    aggregateMarketValue < 500000 &&
    form144.proposed_sale_percent_of_shares_outstanding !== null &&
    form144.proposed_sale_percent_of_shares_outstanding < 0.05
  );
}

function hasRoutineForm144EquityCompText(form144: Record<string, unknown> | null | undefined) {
  const lots = recordArray(form144?.acquisition_lots);
  const priorRows = recordArray(form144?.prior_sales);
  const text = [
    nullableString(form144?.remarks),
    ...lots.flatMap((lot) => [
      nullableString(lot.nature_of_acquisition),
      nullableString(lot.person_from_whom_acquired),
      nullableString(lot.nature_of_payment),
    ]),
    ...priorRows.flatMap((row) => [
      nullableString(row.securities_class_title),
      nullableString(row.seller_name),
    ]),
  ]
    .filter(Boolean)
    .join(" ");
  return /restricted stock|rsu|stock unit|performance share|equity award|equity compensation|vesting|vested|tax obligation|tax withholding|sell-to-cover|compensation|services rendered/i.test(
    text,
  );
}

function form144PriorSalesGrossProceeds(form144: Record<string, unknown> | null | undefined) {
  const priorRows = recordArray(form144?.prior_sales);
  return sumNumbers(priorRows.map((row) => numberOrNull(row.gross_proceeds)));
}

function isRoutineGrantOrAwardArchiveCandidate(
  transactions: ParsedTransaction[],
  amendment: ReturnType<typeof parseAmendmentFacts>,
) {
  if (amendment.is_amendment || amendment.appears_material || amendment.needs_parent_context) return false;
  if (!transactions.length || transactions.length > 4) return false;
  if (transactions.some((transaction) => transaction.transaction_kind !== "non_derivative")) return false;
  if (transactions.some((transaction) => transaction.transaction_code !== "A")) return false;
  if (transactions.some((transaction) => transaction.acquired_disposed_code !== "A")) return false;
  if (transactions.some((transaction) => (transaction.price_per_share ?? 0) > 0)) return false;
  if (transactions.some((transaction) => (transaction.transaction_value ?? 0) > 0)) return false;
  const totalShares = sumNumbers(transactions.map((transaction) => transaction.shares));
  if (totalShares === null || totalShares > 250000) return false;
  return transactions.some((transaction) =>
    /restricted stock|rsu|stock unit|award|grant/i.test(
      `${transaction.security_title ?? ""} ${transaction.evidence.join(" ")}`,
    ),
  );
}

function buildSignals(
  formType: string,
  text: string,
  reportingOwners: Array<Record<string, unknown>>,
  transactions: ParsedTransaction[],
  holdings: Array<Record<string, unknown>>,
  form144: ReturnType<typeof parseForm144Facts> | null,
  amendment: ReturnType<typeof parseAmendmentFacts>,
): OwnershipSignal[] {
  const signals = new Set<OwnershipSignal>();

  if (!text.trim() || (!transactions.length && !holdings.length && !form144 && !amendment.is_amendment)) {
    signals.add("unsupported_or_empty_document");
    signals.add("deterministic_archive");
  }
  if (detectSourceFormat(text) === "legacy_html") {
    signals.add("legacy_format");
  }
  if (parseXmlBool(firstXmlValue(text, "notSubjectToSection16"))) {
    signals.add("section_16_exit");
  }
  if (reportingOwners.length > 1) {
    signals.add("multi_reporting_owner");
  }
  if (transactions.length > 0) {
    signals.add("form_4_transaction");
  }
  if (!amendment.needs_reconciliation && transactions.some((transaction) => transaction.transaction_code === "P")) {
    signals.add("insider_purchase");
  }
  if (!amendment.needs_reconciliation && transactions.some((transaction) => transaction.transaction_code === "S")) {
    signals.add("insider_sale");
  }
  if (!amendment.needs_reconciliation && transactions.some((transaction) => transaction.transaction_code === "G")) {
    signals.add("insider_gift");
  }
  if (isRoutineGrantOrAwardArchiveCandidate(transactions, amendment)) {
    signals.add("routine_grant_or_award");
    signals.add("deterministic_archive");
  }
  if (transactions.some((transaction) => transaction.transaction_code === "C")) {
    signals.add("conversion_transaction");
  }
  if (transactions.some((transaction) => transaction.transaction_kind === "derivative")) {
    signals.add("derivative_transaction");
  }
  if (/10b5-?1/i.test(text) || parseXmlBool(firstXmlValue(text, "aff10b5One"))) {
    signals.add("rule_10b5_1_plan");
  }
  if (formType.startsWith("144") && form144) {
    if (form144.source_format !== "legacy_html") {
      signals.add("form_144_proposed_sale");
    }
    if (form144.no_prior_sales_in_past_three_months === true) {
      signals.add("form_144_no_prior_sales");
    }
    if (isRoutineForm144ArchiveCandidate(form144, amendment)) {
      signals.add("routine_form_144");
      signals.add("deterministic_archive");
    }
    if (
      (form144.proposed_sale_percent_of_shares_outstanding !== null &&
        form144.proposed_sale_percent_of_shares_outstanding >= 1) ||
      (form144.aggregate_market_value !== null && form144.aggregate_market_value >= 25000000)
    ) {
      signals.add("large_form_144_sale");
    }
  }
  if (amendment.appears_administrative) {
    signals.add("administrative_amendment");
    signals.add("deterministic_archive");
  }
  if (amendment.appears_material) {
    signals.add("material_amendment");
  }

  return Array.from(signals);
}

function buildWarnings(
  isSupported: boolean,
  text: string,
  reportingOwners: Array<Record<string, unknown>>,
  transactions: ParsedTransaction[],
  holdings: Array<Record<string, unknown>>,
  form144: ReturnType<typeof parseForm144Facts> | null,
  amendment: ReturnType<typeof parseAmendmentFacts>,
  sourceSelection: OwnershipSourceSelection,
  footnoteDiagnostics: ReturnType<typeof buildFootnoteDiagnostics>,
  tradingPlan: ReturnType<typeof parseTradingPlanFacts>,
  localAmendmentComparison: ReturnType<typeof compareLocalAmendmentIfAvailable>,
  localForm4Connection: ReturnType<typeof compareLocalForm144Form4IfAvailable>,
) {
  const warnings: string[] = [];
  warnings.push(...sourceSelection.warnings);
  if (!isSupported) {
    warnings.push("Unsupported ownership form type.");
  }
  if (!text) {
    warnings.push("No filing text was provided.");
  }
  if (sourceSelection.source_format === "legacy_html") {
    warnings.push("Legacy HTML Form 144 detected; structured XML parser intentionally did not normalize table fields.");
  }
  if (reportingOwners.length > 1) {
    warnings.push("Multiple reporting owners detected; parser preserved all owners but primary owner remains the first owner for compatibility.");
  }
  if (text && transactions.length === 0 && !form144) {
    warnings.push("No Form 4 transaction or Form 144 proposed sale facts were extracted.");
  }
  if (form144 && form144.securities_to_be_sold === null) {
    warnings.push("Form 144 proposed shares to be sold were not extracted.");
  }
  if (form144) {
    for (const issue of form144.row_issues ?? []) {
      warnings.push(issue);
    }
    if (form144.plan_adoption_dates?.length && form144.notice_date) {
      for (const date of form144.plan_adoption_dates) {
        if (compareDateStrings(date, form144.notice_date) > 0) {
          warnings.push("Form 144 10b5-1 plan adoption date appears after notice date; parser preserved both dates without interpretation.");
        }
      }
    }
    if (form144.plan_instruction_dates?.length && form144.notice_date) {
      for (const date of form144.plan_instruction_dates) {
        if (compareDateStrings(date, form144.notice_date) > 0) {
          warnings.push("Form 144 10b5-1 instruction date appears after notice date; parser preserved both dates without interpretation.");
        }
      }
    }
  }
  if (form144?.submission_type === "144/A" && form144.previous_accession_number && !form144.remarks) {
    if (!localAmendmentComparison?.local_parent_available) {
      warnings.push("Form 144/A has previous accession but no amendment remarks; parent filing comparison is needed.");
    }
  }
  if (amendment.needs_parent_context && !localAmendmentComparison?.local_parent_available) {
    warnings.push("Amendment references a prior filing; parent comparison is needed before assuming amendment materiality.");
  }
  if (amendment.needs_reconciliation && !localAmendmentComparison?.local_parent_available) {
    warnings.push("Amended ownership filing needs original filing comparison before treating rows as new transactions.");
  }
  if (localAmendmentComparison?.warnings) {
    warnings.push(...localAmendmentComparison.warnings);
  }
  if (localForm4Connection?.warnings) {
    warnings.push(...localForm4Connection.warnings);
  }
  if (amendment.correction_or_error_language) {
    warnings.push("Amendment or remarks contain correction/error language; parser preserved wording and requires original filing comparison before interpretation.");
  }
  if (form144?.submission_type === "144/A") {
    warnings.push("Form 144/A is an amendment to a proposed sale notice, not proof of executed sale.");
  }
  if (form144 && form144.sale_status === "proposed_not_executed") {
    warnings.push("Form 144 is a proposed sale notice; parser did not classify it as an executed insider sale.");
  }
  if (parseXmlBool(firstXmlValue(text, "notSubjectToSection16"))) {
    warnings.push("notSubjectToSection16 is checked; downstream should not assume ongoing Section 16 status.");
  }
  if (transactions.some((transaction) => transaction.price_per_share === null && transaction.footnote_ids.length > 0)) {
    warnings.push("One or more transaction prices are footnote-only; parser did not infer a numeric price.");
  }
  for (const transaction of transactions) {
    for (const issue of transaction.row_issues) {
      warnings.push(issue);
    }
    if (transaction.direct_or_indirect_ownership === "I" && !transaction.nature_of_ownership) {
      warnings.push("Indirect ownership transaction is missing natureOfOwnership text; parser did not infer beneficial ownership meaning.");
    }
  }
  for (const holding of holdings) {
    if (holding.direct_or_indirect_ownership === "I" && !holding.nature_of_ownership) {
      warnings.push("Indirect ownership holding is missing natureOfOwnership text; parser did not infer beneficial ownership meaning.");
    }
  }
  if (footnoteDiagnostics.unresolved_references.length > 0) {
    warnings.push(`Unresolved ownership footnote references: ${footnoteDiagnostics.unresolved_references.join(", ")}.`);
  }
  if (footnoteDiagnostics.orphan_footnote_ids.length > 0) {
    warnings.push(`Ownership footnotes not linked to parsed rows or fields: ${footnoteDiagnostics.orphan_footnote_ids.join(", ")}.`);
  }
  if (tradingPlan.uncertain_date_evidence.length > 0) {
    warnings.push("10b5-1 or trading plan language was detected, but parser did not infer an uncertain plan date.");
  }
  if (
    transactions.some((transaction) => transaction.transaction_code === "C") &&
    transactions.some((transaction) => transaction.transaction_kind === "derivative")
  ) {
    warnings.push("Conversion rows may link derivative and non-derivative entries; parser did not net or merge them.");
  }
  return uniqueStrings(warnings);
}

function buildCalendarItems(transactions: ParsedTransaction[], form144: ReturnType<typeof parseForm144Facts> | null) {
  const items: Array<Record<string, unknown>> = [];
  for (const transaction of transactions) {
    if (transaction.transaction_date) {
      items.push({
        date: transaction.transaction_date,
        label: "Insider transaction date",
        source: "Form 4",
      });
    }
  }
  if (form144?.approximate_sale_date) {
    items.push({
      date: form144.approximate_sale_date,
      label: "Approximate Form 144 sale date",
      source: "Form 144",
    });
  }
  return items;
}

function buildSummary(
  formType: string,
  issuer: ReturnType<typeof parseIssuer>,
  owner: ReturnType<typeof parseReportingOwner>,
  transactions: ParsedTransaction[],
  form144: ReturnType<typeof parseForm144Facts> | null,
  amendment: ReturnType<typeof parseAmendmentFacts>,
  signals: OwnershipSignal[],
) {
  const ticker = issuer.ticker ? ` (${issuer.ticker})` : "";
  if (signals.includes("administrative_amendment")) {
    return `${formType} administrative amendment for ${issuer.name ?? "issuer"}${ticker}.`;
  }
  if (amendment.is_amendment && !signals.includes("administrative_amendment")) {
    const amendmentReasonSummary = summarizeAmendmentReasonForInvestors(amendment.reason);
    if (amendmentReasonSummary) {
      return amendmentReasonSummary;
    }
    return `${formType} amendment for ${issuer.name ?? "issuer"}${ticker}; original filing was not available for comparison.`;
  }
  if (form144) {
    return `${formType} proposed sale by ${form144.seller_name ?? owner.name ?? "reporting person"} of ${formatNumber(
      form144.securities_to_be_sold,
    )} shares of ${issuer.name ?? "issuer"}${ticker}.`;
  }
  if (transactions.length > 0) {
    const form4 = summarizeForm4Transactions(transactions);
    const action = form4.has_purchase ? "purchase" : form4.has_sale ? "sale" : "transaction";
    return `${formType} insider ${action} filing for ${owner.name ?? "reporting owner"} at ${
      issuer.name ?? "issuer"
    }${ticker}.`;
  }
  return `${formType} ownership filing for ${issuer.name ?? "issuer"}${ticker}.`;
}

function summarizeAmendmentReasonForInvestors(reason: string | null | undefined) {
  const text = normalizeNullableText(reason);
  if (!text) {
    return null;
  }
  const priceCorrection = text.match(
    /correct(?:s|ed|ing)?\s+(?:the\s+)?share price of the\s+([0-9/.-]+)\s+purchase of\s+([0-9,.]+)\s+shares?\.?\s+The correct share price is\s+\$?([0-9,.]+)/i,
  );
  if (priceCorrection) {
    return `The amendment corrects the reported price for a ${priceCorrection[1]} purchase of ${priceCorrection[2]} shares to $${priceCorrection[3]} per share. No new purchase or sale is reported in the amendment.`;
  }
  if (/correct|amend|update|clarif/i.test(text)) {
    return text.replace(/\s+/g, " ").trim();
  }
  return null;
}

function hasDeterministicArchiveSignal(signals: OwnershipSignal[]) {
  return signals.includes("deterministic_archive");
}

function isCleanLocalAmendmentArchiveCandidate(parserFacts: Record<string, unknown>) {
  const amendment = isRecord(parserFacts.amendment) ? parserFacts.amendment : {};
  const comparison = isRecord(amendment.local_comparison) ? amendment.local_comparison : {};
  if (comparison.local_parent_available !== true) {
    return false;
  }
  const labels = stringArray(comparison.labels);
  const warnings = stringArray(comparison.warnings);
  const hasCleanLabel = labels.includes("METADATA_ONLY") || labels.includes("FOOTNOTE_ONLY") || labels.includes("REMARKS_ONLY");
  if (!hasCleanLabel) {
    return false;
  }
  if (warnings.some((warning) => /omits one or more original rows/i.test(warning))) {
    return false;
  }
  return !labels.some((label) =>
    [
      "ADD_LINE",
      "AMEND_LINE",
      "VOID_OR_ERROR_CANDIDATE",
      "UNKNOWN_AMENDMENT",
      "PROPOSED_SALE_AMOUNT_CHANGED",
      "PROPOSED_SALE_DATE_CHANGED",
      "SECURITY_CLASS_CHANGED",
      "BROKER_CHANGED",
      "ACQUISITION_HISTORY_CHANGED",
      "PAST_SALES_CHANGED",
      "PLAN_DATE_CHANGED",
    ].includes(label),
  );
}

function hasUnsafeLocalAmendmentComparison(parserFacts: Record<string, unknown>) {
  const amendment = isRecord(parserFacts.amendment) ? parserFacts.amendment : {};
  const comparison = isRecord(amendment.local_comparison) ? amendment.local_comparison : {};
  if (amendment.is_amendment !== true || comparison.local_parent_available !== true) {
    return false;
  }
  const labels = stringArray(comparison.labels);
  if (
    labels.some((label) =>
      [
        "ADD_LINE",
        "AMEND_LINE",
        "VOID_OR_ERROR_CANDIDATE",
        "UNKNOWN_AMENDMENT",
        "PROPOSED_SALE_AMOUNT_CHANGED",
        "PROPOSED_SALE_DATE_CHANGED",
        "SECURITY_CLASS_CHANGED",
        "BROKER_CHANGED",
        "ACQUISITION_HISTORY_CHANGED",
        "PAST_SALES_CHANGED",
        "PLAN_DATE_CHANGED",
      ].includes(label),
    )
  ) {
    return true;
  }
  return stringArray(comparison.warnings).some((warning) => /omits one or more original rows/i.test(warning));
}

function buildSourceInventory(
  text: string,
  sourceFormat: string,
  transactions: ParsedTransaction[],
  holdings: Array<Record<string, unknown>>,
  form144: ReturnType<typeof parseForm144Facts> | null,
  footnotes: Record<string, string | null>,
  signatures: Array<Record<string, unknown>>,
) {
  return {
    source_format: sourceFormat,
    has_ownership_xml: xmlTagOpenRegex("ownershipDocument").test(text),
    has_edgar_submission_xml: xmlTagOpenRegex("edgarSubmission").test(text),
    non_derivative_transaction_count: findXmlBlocks(text, "nonDerivativeTransaction").length,
    derivative_transaction_count: findXmlBlocks(text, "derivativeTransaction").length,
    holding_count: holdings.length,
    form144_acquisition_lot_count: form144?.acquisition_lots.length ?? 0,
    form144_prior_sale_count: form144?.prior_sales.length ?? 0,
    footnote_count: Object.keys(footnotes).length,
    signature_count: signatures.length,
    source_excerpt_available: text.length > 0,
    source_excerpt_char_count: Math.min(text.length, 1200),
    attachment_inventory: [],
    selected_table_count:
      transactions.length > 0 || form144 ? Number(transactions.length > 0) + Number(Boolean(form144)) : 0,
  };
}

function buildSelectedEvidence(
  formType: string,
  issuer: ReturnType<typeof parseIssuer>,
  owner: ReturnType<typeof parseReportingOwner>,
  transactions: ParsedTransaction[],
  form144: ReturnType<typeof parseForm144Facts> | null,
  amendment: ReturnType<typeof parseAmendmentFacts>,
) {
  const evidence: Array<Record<string, unknown>> = [
    {
      label: "form_type",
      value: formType,
      source: "filing cover fields",
    },
  ];

  if (issuer.name || issuer.ticker) {
    evidence.push({
      label: "issuer",
      value: [issuer.name, issuer.ticker].filter(Boolean).join(" / "),
      source: "issuer fields",
    });
  }
  if (owner.name || owner.title) {
    evidence.push({
      label: "reporting_owner",
      value: [owner.name, owner.title].filter(Boolean).join(" / "),
      source: "reporting owner fields",
    });
  }
  for (const transaction of transactions.slice(0, 6)) {
    evidence.push({
      label: "form4_transaction",
      value: [
        transaction.transaction_code ? `code ${transaction.transaction_code}` : null,
        transaction.acquired_disposed_code ? `${transaction.acquired_disposed_code}` : null,
        transaction.shares !== null ? `${formatNumber(transaction.shares)} shares` : null,
        transaction.price_per_share !== null ? `$${transaction.price_per_share}` : null,
        transaction.transaction_date,
      ]
        .filter(Boolean)
        .join("; "),
      source: `${transaction.transaction_kind} transaction table`,
      footnote_ids: transaction.footnote_ids,
    });
  }
  if (form144) {
    evidence.push({
      label: "form144_proposed_sale",
      value: [
        form144.securities_to_be_sold !== null ? `${formatNumber(form144.securities_to_be_sold)} shares` : null,
        form144.aggregate_market_value !== null ? `$${formatNumber(form144.aggregate_market_value)}` : null,
        form144.approximate_sale_date,
      ]
        .filter(Boolean)
        .join("; "),
      source: "Form 144 securities information",
    });
  }
  if (amendment.is_amendment) {
    evidence.push({
      label: "amendment",
      value: amendment.reason ?? "Amendment reason not supplied in current source.",
      source: "amendment remarks or cover fields",
    });
  }

  return evidence;
}

function normalizeSourceReference(source: OwnershipFixtureInput["source"] | undefined) {
  if (!source) {
    return null;
  }
  return {
    url: source.url ?? null,
    retrieved_at: source.retrieved_at ?? null,
    sha256: source.sha256 ?? null,
  };
}

function selectOwnershipSource(input: OwnershipFixtureInput): OwnershipSourceSelection {
  const candidates = collectOwnershipSourceCandidates(input);
  const structuredXml = candidates.find((candidate) => candidate.source_format === "structured_xml");
  const malformedXmlCandidates = candidates.filter((candidate) => candidate.has_malformed_xml);
  const fallback = candidates.find(
    (candidate) => candidate.source_format !== "structured_xml" && !candidate.has_malformed_xml,
  );
  const selected = structuredXml ?? fallback ?? malformedXmlCandidates[0] ?? null;
  const warnings: string[] = [];

  if (malformedXmlCandidates.length > 0 && selected?.has_malformed_xml) {
    warnings.push("Structured ownership XML appears malformed or incomplete; parser used limited lower-confidence extraction from that source.");
  } else if (malformedXmlCandidates.length > 0 && selected && selected.source_format !== "structured_xml") {
    warnings.push("Structured ownership XML candidate was malformed or incomplete; parser used lower-confidence fallback source.");
  }

  if (selected && selected.source_format !== "structured_xml" && malformedXmlCandidates.length === 0) {
    warnings.push("Structured ownership XML was not available; parser used lower-confidence HTML/text fallback.");
  }

  return {
    text: selected?.text ?? "",
    source_format: selected?.source_format ?? "text_excerpt",
    status: selected
      ? selected.source_format === "structured_xml"
        ? "structured_xml_selected"
        : selected.has_malformed_xml
        ? "malformed_xml_limited_extraction"
        : malformedXmlCandidates.length > 0
        ? "fallback_after_malformed_xml"
        : "fallback_missing_xml"
      : "empty",
    confidence: selected?.confidence ?? "low",
    selected_source_role: selected?.role ?? null,
    warnings,
    inventory: {
      candidate_count: candidates.length,
      selected_source_role: selected?.role ?? null,
      selected_source_format: selected?.source_format ?? "text_excerpt",
      selected_source_confidence: selected?.confidence ?? "low",
      selected_source_url: selected?.url ?? null,
      selected_source_description: selected?.description ?? null,
      selected_source_filename: selected?.filename ?? null,
      structured_xml_available: Boolean(structuredXml),
      fallback_used: Boolean(selected && selected.source_format !== "structured_xml"),
      malformed_xml_candidate_count: malformedXmlCandidates.length,
      available_source_roles: candidates.map((candidate) => candidate.role),
    },
  };
}

function collectOwnershipSourceCandidates(input: OwnershipFixtureInput): OwnershipSourceCandidate[] {
  const rawPayload = isRecord(input.rawPayload) ? input.rawPayload : {};
  const metadata = isRecord(input.metadata) ? input.metadata : {};
  const candidates: OwnershipSourceCandidate[] = [];

  addOwnershipSourceCandidate(candidates, rawPayload.ownership_source_text, {
    role: "raw_payload.ownership_source_text",
    url: nullableString(rawPayload.ownership_source_url),
  });
  addOwnershipSourceCandidate(candidates, metadata.ownership_source_text, {
    role: "metadata.ownership_source_text",
    url: nullableString(metadata.ownership_source_url),
  });

  for (const attachment of input.attachments ?? []) {
    addOwnershipSourceCandidate(candidates, attachment.text, {
      role: "attachment",
      url: attachment.url ?? null,
      description: attachment.description ?? attachment.type ?? null,
      filename: attachment.filename ?? null,
    });
  }

  addOwnershipSourceCandidate(candidates, input.filingText, {
    role: "filingText",
    url: input.source?.url ?? null,
  });
  addOwnershipSourceCandidate(candidates, input.primaryDocumentText, {
    role: "primaryDocumentText",
    url: input.source?.url ?? null,
  });
  addOwnershipSourceCandidate(candidates, input.text, {
    role: "text",
    url: input.source?.url ?? null,
  });

  return candidates;
}

function addOwnershipSourceCandidate(
  candidates: OwnershipSourceCandidate[],
  value: unknown,
  metadata: {
    role: string;
    url?: string | null;
    description?: string | null;
    filename?: string | null;
  },
) {
  const text = normalizeWhitespace(nullableString(value) ?? "");
  if (!text) {
    return;
  }

  const hasXmlRoot = hasOwnershipXmlRoot(text);
  const hasMalformedXml = hasXmlRoot && !isWellFormedXml(text);
  const sourceFormat = detectSourceFormat(text);
  candidates.push({
    text,
    role: metadata.role,
    source_format: hasMalformedXml ? "text_excerpt" : sourceFormat,
    confidence: sourceFormat === "structured_xml" && !hasMalformedXml ? "high" : sourceFormat === "legacy_html" ? "low" : "low",
    has_xml_root: hasXmlRoot,
    has_malformed_xml: hasMalformedXml,
    url: metadata.url ?? null,
    description: metadata.description ?? null,
    filename: metadata.filename ?? null,
  });
}

function normalizeWhitespace(value: string) {
  return value.replace(/\r/g, "").trim();
}

function detectSourceFormat(text: string) {
  if (hasOwnershipXmlRoot(text) && isWellFormedXml(text)) {
    return "structured_xml";
  }
  if (/<DOCUMENT\b/i.test(text) || /<html\b/i.test(text)) {
    return "legacy_html";
  }
  return "text_excerpt";
}

function hasOwnershipXmlRoot(text: string) {
  return xmlTagOpenRegex("ownershipDocument").test(text) || xmlTagOpenRegex("edgarSubmission").test(text);
}

function isWellFormedXml(text: string) {
  if (/<[^>]*$/i.test(text)) {
    return false;
  }
  const roots = ["ownershipDocument", "edgarSubmission"].filter((tag) => xmlTagOpenRegex(tag).test(text));
  if (roots.length === 0) {
    return false;
  }
  return roots.every((tag) => new RegExp(xmlTagClosePattern(tag), "i").test(text));
}

function firstXmlValue(text: string, tag: string): string | null {
  const match = text.match(
    new RegExp(
      `${xmlTagOpenPattern(tag)}\\s*(?:${xmlTagOpenPattern("value")})?\\s*([\\s\\S]*?)\\s*(?:${xmlTagClosePattern(
        "value",
      )})?\\s*${xmlTagClosePattern(tag)}`,
      "i",
    ),
  );
  return normalizeNullableText(stripTags(match?.[1] ?? null));
}

function firstXmlNumber(text: string, tag: string): number | null {
  return getNumeric(firstXmlValue(text, tag));
}

function parseNumericField(text: string, tag: string, fallbackLabels: string[] = []) {
  const field = firstXmlField(text, tag);
  const fallbackValue = field.present ? null : numberAfterLabel(text, fallbackLabels);
  const value = getNumeric(field.text) ?? fallbackValue;
  const status = field.present
    ? numericFieldStatus(field.text, field.footnote_ids, value)
    : fallbackValue !== null
    ? "numeric"
    : "missing";

  return {
    value,
    text: field.text,
    status,
    footnote_ids: field.footnote_ids,
  };
}

function firstXmlField(text: string, tag: string) {
  const block = findXmlBlocks(text, tag)[0] ?? null;
  if (!block) {
    return {
      present: false,
      text: null,
      footnote_ids: [] as string[],
    };
  }

  const valueBlock = findXmlBlocks(block, "value")[0] ?? null;
  const raw = valueBlock ? stripTags(valueBlock) : stripTags(block.replace(/<[^>]*footnoteId\b[^>]*\/?>/gi, " "));
  return {
    present: true,
    text: normalizeXmlFieldText(raw),
    footnote_ids: footnoteIds(block),
  };
}

function numericFieldStatus(text: string | null, ids: string[], numericValue: number | null) {
  if (text === null) {
    return ids.length > 0 ? "footnote_only" : "blank";
  }
  if (/^N\/?A$/i.test(text)) {
    return "not_applicable";
  }
  if (/^none$/i.test(text)) {
    return "none";
  }
  if (/^various$/i.test(text)) {
    return "various";
  }
  if (/^see footnote$/i.test(text)) {
    return "see_footnote";
  }
  if (numericValue === 0) {
    return "zero";
  }
  if (numericValue !== null) {
    return "numeric";
  }
  return ids.length > 0 ? "text_with_footnote" : "text";
}

function dateFieldStatus(text: string | null, ids: string[]) {
  if (text === null) {
    return ids.length > 0 ? "footnote_only" : "missing";
  }
  if (/^N\/?A$/i.test(text)) {
    return "not_applicable";
  }
  if (/^none$/i.test(text)) {
    return "none";
  }
  if (/^various$/i.test(text)) {
    return "various";
  }
  if (/^see footnote$/i.test(text)) {
    return "see_footnote";
  }
  return DATE_PATTERN.test(text) ? "date" : ids.length > 0 ? "text_with_footnote" : "text";
}

function xmlValues(text: string, tag: string): string[] {
  return Array.from(
    text.matchAll(
      new RegExp(
        `${xmlTagOpenPattern(tag)}\\s*(?:${xmlTagOpenPattern("value")})?\\s*([\\s\\S]*?)\\s*(?:${xmlTagClosePattern(
          "value",
        )})?\\s*${xmlTagClosePattern(tag)}`,
        "gi",
      ),
    ),
  )
    .map((match) => normalizeNullableText(stripTags(match[1])))
    .filter((value): value is string => Boolean(value));
}

function findXmlBlocks(text: string, tag: string): string[] {
  return Array.from(text.matchAll(new RegExp(`${xmlTagOpenPattern(tag)}[\\s\\S]*?${xmlTagClosePattern(tag)}`, "gi"))).map(
    (match) => match[0],
  );
}

function firstMatch(text: string, pattern: RegExp): string | null {
  const match = text.match(pattern);
  return match?.[1]?.trim() ?? null;
}

function numberAfterLabel(text: string, labels: string[]): number | null {
  for (const label of labels) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = text.match(new RegExp(`${escaped}:\\s*\\$?([0-9,.]+)`, "i"));
    const value = getNumeric(match?.[1]);
    if (value !== null) {
      return value;
    }
  }
  return null;
}

function getNumeric(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value !== "string") {
    return null;
  }
  const cleaned = value.replace(/[$,%]/g, "").replace(/,/g, "").trim();
  if (!cleaned) {
    return null;
  }
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function nullableString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function normalizeNullableText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const decoded = decodeXmlEntities(value).replace(/\s+/g, " ").trim();
  if (!decoded || /^(NA|N\/A|null)$/i.test(decoded)) {
    return null;
  }
  return decoded;
}

function normalizeXmlFieldText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const decoded = decodeXmlEntities(value).replace(/\s+/g, " ").trim();
  return decoded ? decoded : null;
}

function stripTags(value: string | null) {
  return value ? value.replace(/<[^>]*>/g, " ") : null;
}

function decodeXmlEntities(value: string) {
  return value
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#160;/g, " ");
}

function parseXmlBool(value: string | null): boolean | null {
  if (value === null) {
    return null;
  }
  if (/^(1|true|yes|y)$/i.test(value)) {
    return true;
  }
  if (/^(0|false|no|n)$/i.test(value)) {
    return false;
  }
  return null;
}

function parseYesNo(value: string | null): boolean | null {
  if (value === null) {
    return null;
  }
  if (/^Y$/i.test(value)) {
    return true;
  }
  if (/^N$/i.test(value)) {
    return false;
  }
  return parseXmlBool(value);
}

function normalizeRoleLabel(value: string | null): string | null {
  if (!value) {
    return null;
  }
  const normalized = value.toLowerCase();
  if (normalized.includes("director")) {
    return "director";
  }
  if (normalized.includes("officer") || normalized.includes("ceo") || normalized.includes("cfo")) {
    return "officer";
  }
  if (normalized.includes("10")) {
    return "10_percent_owner";
  }
  return value;
}

function normalizeDirectIndirect(value: string | null): "D" | "I" | null {
  if (value === "D" || value === "I") {
    return value;
  }
  return null;
}

function transactionCodeMeaning(code: string | null) {
  const normalized = code?.trim().toUpperCase();
  const meanings: Record<string, string> = {
    P: "open_market_or_private_purchase",
    S: "open_market_or_private_sale",
    A: "grant_award_or_other_acquisition",
    D: "disposition_to_issuer_or_other_disposition",
    F: "tax_withholding_or_payment_of_exercise_price",
    M: "derivative_exercise_or_conversion",
    C: "conversion_of_derivative_security",
    G: "bona_fide_gift",
    J: "other_acquisition_or_disposition",
    V: "voluntarily_reported_earlier_than_required",
  };
  return normalized ? meanings[normalized] ?? "unmapped_transaction_code" : null;
}

function transactionCategory(code: string | null) {
  const normalized = code?.trim().toUpperCase();
  const categories: Record<string, string> = {
    P: "open_market_purchase",
    S: "open_market_sale",
    A: "award_or_grant",
    F: "tax_withholding_or_exercise_price_payment",
    M: "option_exercise_or_conversion",
    C: "conversion",
    G: "gift",
    V: "non_economic_reporting_code",
  };
  return normalized ? categories[normalized] ?? "other_transaction_code" : null;
}

function buildTransactionRowIssues(
  code: string | null,
  acquiredDisposed: "A" | "D" | null,
  kind: "non_derivative" | "derivative",
  fields: { shares: ReturnType<typeof parseNumericField>; price: ReturnType<typeof parseNumericField> },
) {
  const issues: string[] = [];
  const normalized = code?.trim().toUpperCase() ?? null;

  if (!normalized) {
    issues.push("Form 4 transaction row is missing transactionCode; parser preserved the row but did not infer a code.");
  } else if (!KNOWN_TRANSACTION_CODES.has(normalized)) {
    issues.push(`Unknown Form 4 transaction code preserved without interpretation: ${normalized}.`);
  }

  if (normalized && acquiredDisposed && transactionCodeConflictsWithDirection(normalized, acquiredDisposed)) {
    issues.push(`Transaction code ${normalized} conflicts with acquired/disposed marker ${acquiredDisposed}; parser preserved both values.`);
  }

  if (kind === "derivative" && (normalized === "M" || normalized === "C")) {
    issues.push(`Derivative transaction code ${normalized} preserved separately from ordinary open-market purchase/sale rows.`);
  }

  if (fields.shares.status === "missing" && normalized) {
    issues.push(`Form 4 transaction code ${normalized} has no parsed transactionShares value.`);
  }
  if (fields.price.status === "footnote_only" || fields.price.status === "see_footnote") {
    issues.push(`Form 4 transaction code ${normalized ?? "unknown"} has footnote-only price; parser did not infer a numeric price.`);
  }

  return issues;
}

const KNOWN_TRANSACTION_CODES = new Set([
  "P",
  "S",
  "V",
  "A",
  "D",
  "F",
  "I",
  "M",
  "C",
  "E",
  "H",
  "O",
  "X",
  "G",
  "L",
  "W",
  "Z",
  "J",
  "K",
  "U",
]);

function transactionCodeConflictsWithDirection(code: string, acquiredDisposed: "A" | "D") {
  if (code === "P" && acquiredDisposed !== "A") {
    return true;
  }
  if ((code === "S" || code === "F") && acquiredDisposed !== "D") {
    return true;
  }
  return false;
}

function footnoteIds(text: string) {
  return Array.from(
    text.matchAll(new RegExp(`${xmlTagOpenPattern("footnoteId", true)}[^>]*\\bid=["']([^"']+)["'][^>]*\\/?>`, "gi")),
  ).map(
    (match) => match[1],
  );
}

function transactionFieldFootnoteIds(block: string) {
  const fields = [
    "securityTitle",
    "transactionDate",
    "deemedExecutionDate",
    "transactionCode",
    "transactionShares",
    "transactionPricePerShare",
    "transactionAcquiredDisposedCode",
    "conversionOrExercisePrice",
    "exerciseDate",
    "expirationDate",
    "underlyingSecurityTitle",
    "underlyingSecurityShares",
    "sharesOwnedFollowingTransaction",
    "directOrIndirectOwnership",
    "natureOfOwnership",
  ];

  return Object.fromEntries(
    fields
      .map((field) => [field, footnoteIds(findXmlBlocks(block, field)[0] ?? "")])
      .filter(([, ids]) => Array.isArray(ids) && ids.length > 0),
  ) as Record<string, string[]>;
}

function holdingFieldFootnoteIds(block: string) {
  const fields = [
    "securityTitle",
    "conversionOrExercisePrice",
    "exerciseDate",
    "expirationDate",
    "underlyingSecurityTitle",
    "underlyingSecurityShares",
    "sharesOwnedFollowingTransaction",
    "directOrIndirectOwnership",
    "natureOfOwnership",
  ];

  return Object.fromEntries(
    fields
      .map((field) => [field, footnoteIds(findXmlBlocks(block, field)[0] ?? "")])
      .filter(([, ids]) => Array.isArray(ids) && ids.length > 0),
  ) as Record<string, string[]>;
}

function form144ProposedSaleFieldFootnoteIds(block: string) {
  return fieldFootnoteIds(block, [
    "securitiesClassTitle",
    "name",
    "brokerDealerFileNumber",
    "noOfUnitsSold",
    "aggregateMarketValue",
    "noOfUnitsOutstanding",
    "approxSaleDate",
    "securitiesExchangeName",
  ]);
}

function form144AcquisitionFieldFootnoteIds(block: string) {
  return fieldFootnoteIds(block, [
    "securitiesClassTitle",
    "acquiredDate",
    "natureOfAcquisitionTransaction",
    "nameOfPersonfromWhomAcquired",
    "isGiftTransaction",
    "amountOfSecuritiesAcquired",
    "paymentDate",
    "natureOfPayment",
  ]);
}

function form144PriorSaleFieldFootnoteIds(block: string) {
  return fieldFootnoteIds(block, [
    "name",
    "securitiesClassTitle",
    "saleDate",
    "amountOfSecuritiesSold",
    "grossProceeds",
  ]);
}

function fieldFootnoteIds(block: string, fields: string[]) {
  return Object.fromEntries(
    fields
      .map((field) => [field, footnoteIds(findXmlBlocks(block, field)[0] ?? "")])
      .filter(([, ids]) => Array.isArray(ids) && ids.length > 0),
  ) as Record<string, string[]>;
}

function parseFootnoteEntries(text: string) {
  return Array.from(
    text.matchAll(
      new RegExp(
        `${xmlTagOpenPattern("footnote", true)}[^>]*\\bid=["']([^"']+)["'][^>]*>([\\s\\S]*?)${xmlTagClosePattern(
          "footnote",
        )}`,
        "gi",
      ),
    ),
  ).map((match) => ({
    id: match[1],
    text: normalizeXmlFieldText(stripTags(match[2])),
  }));
}

function parseFootnotes(text: string) {
  return Object.fromEntries(parseFootnoteEntries(text).map((footnote) => [footnote.id, footnote.text]));
}

function buildFootnoteDiagnostics(
  footnotes: ReturnType<typeof parseFootnoteEntries>,
  transactions: ParsedTransaction[],
  holdings: Array<Record<string, unknown>>,
  form144: ReturnType<typeof parseForm144Facts> | null,
) {
  const footnoteIdsInSource = new Set(footnotes.map((footnote) => footnote.id));
  const linkedIds = new Set<string>();

  for (const transaction of transactions) {
    for (const id of transaction.footnote_ids) linkedIds.add(id);
    for (const ids of Object.values(transaction.field_footnote_ids)) {
      for (const id of ids) linkedIds.add(id);
    }
  }
  for (const holding of holdings) {
    for (const id of stringArray(holding.footnote_ids)) linkedIds.add(id);
    const fieldFootnoteIds = isRecord(holding.field_footnote_ids) ? holding.field_footnote_ids : {};
    for (const ids of Object.values(fieldFootnoteIds)) {
      for (const id of stringArray(ids)) linkedIds.add(id);
    }
  }
  for (const row of recordArray(form144?.proposed_sale_rows)) {
    collectFootnoteIdsFromRecord(row, linkedIds);
  }
  for (const row of recordArray(form144?.acquisition_lots)) {
    collectFootnoteIdsFromRecord(row, linkedIds);
  }
  for (const row of recordArray(form144?.prior_sales)) {
    collectFootnoteIdsFromRecord(row, linkedIds);
  }
  if (isRecord(form144?.broker_or_market_maker)) {
    collectFootnoteIdsFromRecord(form144.broker_or_market_maker, linkedIds);
  }

  return {
    footnote_order: footnotes.map((footnote) => footnote.id),
    linked_footnote_ids: Array.from(linkedIds),
    unresolved_references: Array.from(linkedIds).filter((id) => !footnoteIdsInSource.has(id)),
    orphan_footnote_ids: Array.from(footnoteIdsInSource).filter((id) => !linkedIds.has(id)),
  };
}

function collectFootnoteIdsFromRecord(record: Record<string, unknown>, linkedIds: Set<string>) {
  for (const id of stringArray(record.footnote_ids)) linkedIds.add(id);
  const fieldFootnoteIds = isRecord(record.field_footnote_ids) ? record.field_footnote_ids : {};
  for (const ids of Object.values(fieldFootnoteIds)) {
    for (const id of stringArray(ids)) linkedIds.add(id);
  }
}

function recordArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => isRecord(item)) : [];
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function parseSignatures(text: string) {
  const ownerSignatures = findXmlBlocks(text, "ownerSignature").map((block) => ({
    signature_name: firstXmlValue(block, "signatureName"),
    signature_date: firstXmlValue(block, "signatureDate"),
    signature_type: "owner",
  }));
  const noticeSignature = findXmlBlocks(text, "noticeSignature").map((block) => ({
    signature_name: firstXmlValue(block, "signature"),
    signature_date: firstXmlValue(block, "noticeDate"),
    signature_type: "notice",
  }));

  return [...ownerSignatures, ...noticeSignature];
}

function normalizeAcquiredDisposed(value: string | null): "A" | "D" | null {
  if (!value) {
    return null;
  }
  const normalized = value.trim().toUpperCase();
  return normalized === "A" || normalized === "D" ? normalized : null;
}

function sumTransactions(transactions: ParsedTransaction[], code: "A" | "D") {
  const sum = transactions
    .filter((transaction) => transaction.acquired_disposed_code === code && transaction.transaction_code !== "V")
    .reduce((total, transaction) => total + (transaction.shares ?? 0), 0);
  return sum || null;
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

function roundPercent(value: number) {
  return Math.round(value * 10000) / 10000;
}

function formatNumber(value: number | null | undefined) {
  return value === null || value === undefined ? "unknown" : value.toLocaleString("en-US");
}

function formatCurrency(value: number | null | undefined) {
  return value === null || value === undefined
    ? "unknown"
    : value.toLocaleString("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: value >= 1000 ? 0 : 2,
      });
}

function formatCompactCurrency(value: number | null | undefined) {
  if (value === null || value === undefined) return "unknown";
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) return `$${roundMoney(value / 1_000_000_000).toLocaleString("en-US")}B`;
  if (abs >= 1_000_000) return `$${roundMoney(value / 1_000_000).toLocaleString("en-US")}M`;
  if (abs >= 1_000) return `$${Math.round(value / 1_000).toLocaleString("en-US")}K`;
  return formatCurrency(value);
}

function formatPercent(value: number | null | undefined) {
  return value === null || value === undefined ? "unknown" : `${value.toFixed(4)}%`;
}

function formatNarrativePercent(value: number | null | undefined) {
  if (value === null || value === undefined) return "unknown";
  return `${value.toLocaleString("en-US", {
    maximumFractionDigits: value < 1 ? 2 : 1,
    minimumFractionDigits: 0,
  })}%`;
}

function normalizeSuppliedOwnershipMarketContext(value: unknown) {
  if (!isRecord(value)) {
    return null;
  }
  const normalized = {
    symbol: nullableString(value.symbol) ?? nullableString(value.ticker),
    source: nullableString(value.source),
    retrieved_at: nullableString(value.retrieved_at) ?? nullableString(value.retrievedAt),
    market_cap: numberLikeOrNull(value.market_cap ?? value.marketCap),
    shares_outstanding: numberLikeOrNull(value.shares_outstanding ?? value.sharesOutstanding),
    float: numberLikeOrNull(value.float ?? value.public_float ?? value.floatShares),
    public_float: numberLikeOrNull(value.public_float ?? value.float ?? value.floatShares),
    average_volume: numberLikeOrNull(value.average_volume ?? value.averageVolume ?? value.avgVolume),
    average_daily_volume: numberLikeOrNull(value.average_daily_volume ?? value.averageDailyVolume ?? value.average_volume ?? value.averageVolume ?? value.avgVolume),
    average_daily_dollar_volume: numberLikeOrNull(value.average_daily_dollar_volume ?? value.averageDailyDollarVolume),
    last_price: numberLikeOrNull(value.last_price ?? value.lastPrice ?? value.price),
    currency: nullableString(value.currency),
    source_notes: stringArray(value.source_notes ?? value.sourceNotes).slice(0, 5),
  };

  const hasValue = Object.entries(normalized).some(([key, entry]) => {
    if (key === "source_notes") {
      return Array.isArray(entry) && entry.length > 0;
    }
    return entry !== null && entry !== undefined && entry !== "";
  });
  return hasValue ? normalized : null;
}

function joinWithAnd(values: string[]) {
  if (values.length <= 1) {
    return values[0] ?? "";
  }
  if (values.length === 2) {
    return `${values[0]} and ${values[1]}`;
  }
  return `${values.slice(0, -1).join(", ")}, and ${values[values.length - 1]}`;
}

function numberOrNull(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function numberLikeOrNull(value: unknown) {
  return getNumeric(value);
}

function sumNumbers(values: Array<number | null | undefined>) {
  const numbers = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  return numbers.length ? numbers.reduce((sum, value) => sum + value, 0) : null;
}

function uniqueStrings(values: Array<string | null | undefined>) {
  return Array.from(
    new Set(
      values
        .map((value) => (typeof value === "string" ? value.trim() : ""))
        .filter(Boolean),
    ),
  );
}

function truncate(value: string, maxLength: number) {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 3)}...`;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function xmlTagOpenRegex(tag: string) {
  return new RegExp(xmlTagOpenPattern(tag), "i");
}

function xmlTagOpenPattern(tag: string, bareOpen = false) {
  const name = xmlTagNamePattern(tag);
  return bareOpen ? `<${name}\\b` : `<${name}\\b[^>]*>`;
}

function xmlTagClosePattern(tag: string) {
  return `<\\/${xmlTagNamePattern(tag)}>`;
}

function xmlTagNamePattern(tag: string) {
  const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return `(?:[A-Za-z_][\\w.-]*:)?${escaped}`;
}
