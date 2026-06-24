export const SEC_INTEGRATION_EVENT_TYPES = [
  "listing_risk",
  "dilution_risk",
  "earnings",
  "sales_performance",
  "product_update",
  "leadership_governance",
  "insider_ownership",
  "ipo_listing",
  "shareholder_vote",
  "strategic_transaction",
  "financial_risk",
  "legal_risk",
  "dividends",
  "capital_return",
  "fda_clinical",
  "other",
] as const;

export const SEC_DISPLAY_PAYLOAD_TYPES = [
  "generic",
  "offering_terms",
  "candidate_special",
  "ipo_listing",
  "spac_transaction_status",
  "listing_risk",
  "earnings",
  "fda_clinical",
] as const;
export const SEC_DELIVERY_LEVELS = ["archive", "feed", "alert"] as const;
export const SEC_MARKET_SCOPES = ["company", "sector", "theme", "macro"] as const;
export const SEC_SIGNALS = ["bullish", "bearish", "volatile", "neutral"] as const;
export const SEC_CONFIDENCE_LEVELS = ["high", "medium", "low"] as const;
export const SEC_IMPACTS = ["low", "medium", "high"] as const;

export type SecIntegrationEventType = (typeof SEC_INTEGRATION_EVENT_TYPES)[number];
export type SecDisplayPayloadType = (typeof SEC_DISPLAY_PAYLOAD_TYPES)[number];
export type SecDeliveryLevel = (typeof SEC_DELIVERY_LEVELS)[number];
export type SecMarketScope = (typeof SEC_MARKET_SCOPES)[number];
export type SecSignal = (typeof SEC_SIGNALS)[number];
export type SecConfidence = (typeof SEC_CONFIDENCE_LEVELS)[number];
export type SecImpact = (typeof SEC_IMPACTS)[number];

export type SecIntegrationTicker = {
  ticker: string | null;
  exchange?: string | null;
};

export type SecOwnershipFilingContext = {
  same_insider_12m_trades: unknown[];
  company_90d_insider_flow: Record<string, unknown> | null;
  recent_30d_cluster: Record<string, unknown> | null;
  related_form144_candidates?: unknown[];
  related_form4_execution_candidates?: unknown[];
  amendment_parent_candidate?: Record<string, unknown> | null;
  [key: string]: unknown;
};

export type SecFilingContext = {
  ownership?: SecOwnershipFilingContext | null;
  context_as_of?: string | null;
  source_notes?: unknown[];
  [key: string]: unknown;
};

export type SecParserOutputForIntegration = {
  parserVersion: string;
  parserGroup: string;
  formType: string;
  accessionNumber?: string | null;
  isSupported: boolean;
  summary?: string | null;
  facts: Record<string, unknown>;
  signals?: unknown[];
  calendarItems?: unknown[];
  warnings?: unknown[];
  raw?: Record<string, unknown>;
  [key: string]: unknown;
};

export type SecAnalysisOutput = {
  source_group: "filings";
  market_scope: SecMarketScope;
  event_type: SecIntegrationEventType;
  event_title: string;
  primary_ticker: SecIntegrationTicker | null;
  tickers: unknown[];
  sector: string | null;
  industry_group: string | null;
  theme_group: string | null;
  sub_theme: string | null;
  score: number;
  score_reason: string;
  signal: SecSignal;
  quick_take: string;
  summary: string;
  why_it_matters: string;
  bullish_points: unknown[];
  bearish_points: unknown[];
  key_evidence: unknown[];
  what_to_watch_next: unknown[];
  related_tickers: unknown[];
  calendar_items: unknown[];
  confidence: SecConfidence;
  needs_human_review: boolean;
  [key: string]: unknown;
};

export type SecDisplayPayload = {
  display_type: SecDisplayPayloadType;
  data: Record<string, unknown>;
  evidence: unknown[];
  notes: unknown[];
  [key: string]: unknown;
};

export type SecTransactionFingerprint = Record<string, unknown>;

export type SecRequiredOutputJson = {
  parser_output: SecParserOutputForIntegration;
  analysis_output: SecAnalysisOutput;
  display_payload: SecDisplayPayload;
  transaction_fingerprint?: SecTransactionFingerprint | null;
  filing_context?: SecFilingContext | null;
};

export type SecIntegrationValidationResult<T> =
  | {
      ok: true;
      value: T;
      errors: [];
      warnings: string[];
    }
  | {
      ok: false;
      errors: string[];
      warnings: string[];
      value?: undefined;
    };

const eventTypeSet = new Set<string>(SEC_INTEGRATION_EVENT_TYPES);
const displayTypeSet = new Set<string>(SEC_DISPLAY_PAYLOAD_TYPES);
const deliveryLevelSet = new Set<string>(SEC_DELIVERY_LEVELS);
const marketScopeSet = new Set<string>(SEC_MARKET_SCOPES);
const signalSet = new Set<string>(SEC_SIGNALS);
const confidenceSet = new Set<string>(SEC_CONFIDENCE_LEVELS);

export const SEC_IPO_SPAC_SCORING_POLICY = {
  scoreMeaning: "investor_attention_urgency",
  deliveryBands: {
    archive: "score < 50",
    feed: "50 <= score < 75",
    alert: "score >= 75",
  },
  traditionalIpo: {
    ranges: {
      initialRegistration: "35-50",
      amendedTerms: "50-65",
      effectNotice: "55-70",
      finalProspectusPricing: "65-78",
      firstTradeImminent: "75-88",
      postponedWithdrawnRepriced: "75-90",
      lockupExpiryApproaching: "60-80",
    },
    alertConditions: [
      "first_trade_imminent",
      "final_pricing_outside_filed_range",
      "ipo_postponed_or_withdrawn",
      "very_low_float_or_high_volatility_setup",
      "high_profile_near_term_trading_catalyst",
    ],
    modifiers: [
      "underwriter_quality_context_only",
      "low_float_plus_5_to_10",
      "no_revenue_speculative_biotech_or_high_cash_burn_plus_3_to_8",
      "pricing_below_range_plus_8_to_15",
      "pricing_above_range_plus_5_to_10",
      "lockup_large_insider_overhang_plus_8_to_15",
    ],
  },
  spacDeSpac: {
    ranges: {
      plainSpacIpo: "25-45",
      targetAnnouncedOrDaSigned: "50-65",
      s4OrF4Filed: "50-65",
      proxyOrVoteDateSet: "55-70",
      voteApproved: "60-72",
      redemptionResultsDisclosed: "65-78",
      redemptionRateVeryHigh: "75-88",
      minimumCashAtRiskOrWaiverNeeded: "75-90",
      closingOrTickerChangeImminent: "70-85",
      terminationOrVoteFailure: "85-95",
    },
    alertConditions: [
      "redemption_rate_80_plus",
      "minimum_cash_not_satisfied_or_waiver_backstop_needed",
      "closing_or_ticker_change_imminent",
      "deal_termination",
      "merger_vote_failed",
      "explicit_nasdaq_or_listing_condition_risk",
    ],
  },
  underwriterHandling: {
    traditionalIpoFields: ["underwriters", "lead_underwriters"],
    spacFields: ["ipo_underwriter"],
    underwriterAloneMustNotForceAlert: true,
  },
} as const;

export const SEC_SHAREHOLDER_VOTE_SCORING_POLICY = {
  scoreMeaning: "investor_attention_urgency",
  deliveryBands: {
    archive: "score < 50",
    feed: "50 <= score < 75",
    alert: "score >= 75",
  },
  guidance: {
    doNotOverScore: true,
    mostEventsArchiveOrFeed: true,
    typicalAlertBand: "75-84",
    ninetyPlus: "extremely_rare_source_backed_extreme_outcome_only",
  },
  archiveRanges: {
    routineAnnualMeeting: "25-38",
    sayOnPayOrOrdinaryCompensation: "30-42",
    proceduralProxyOrMeetingLogistics: "20-35",
    ordinaryVoteResultsNoUnusualIssue: "35-45",
  },
  feedRanges: {
    reverseSplitProposal: "52-68",
    authorizedShareIncreaseProposal: "52-68",
    equityIncentivePlanIncrease: "50-62",
    governanceDisputeOrBoardChangeVote: "55-70",
    mergerDealVoteScheduled: "58-72",
    spacExtensionVote: "52-68",
    capitalPolicyOrStrategyShareholderProposal: "50-64",
    expectedApprovalNoMajorSurprise: "55-70",
  },
  alertRanges: {
    reverseSplitNasdaqListingRisk: "75-82",
    authorizedShareIncreaseFinancingDilutionPurpose: "75-82",
    largeIssuanceOrConvertibleApproval: "75-83",
    mergerDealVoteFailedDelayedAdjournedUnexpected: "78-85",
    proxyContestOrActivistControlFight: "76-84",
    spacMergerVoteRedemptionCashRisk: "75-84",
    voteFailedAdjournedDelayedUnexpectedly: "78-86",
  },
  ninetyPlusAllowedOnlyFor: [
    "deal_effectively_breaks_from_vote_failure",
    "reverse_split_failure_makes_delisting_risk_immediate",
    "major_financing_approval_failure_creates_liquidity_crisis",
    "proxy_contest_result_actually_changes_control",
  ],
  modifiers: {
    nasdaqComplianceDelistingLanguage: "+4_to_+8",
    wideReverseSplitRatioRange: "+3_to_+6",
    authorizedSharesIncreaseTwoTimesOrMore: "+3_to_+7",
    financingConvertibleWarrantIssuanceConnection: "+5_to_+9",
    voteDateWithinSevenDays: "+2_to_+5",
    voteResultFiled: "+3_to_+6",
    voteFailedAdjournedDelayedUnexpectedly: "+8_to_+12",
  },
  caps: {
    routineProposal: 49,
    simpleVoteScheduleDisclosure: 72,
    approvalRequestStageUsually: 82,
    exceed85OnlyFor: "actual_failed_unexpected_or_control_change_outcomes",
  },
  signals: {
    routineAnnualMeeting: "neutral",
    reverseSplitDilutionFailedVote: "bearish",
    mergerApprovalOrCapitalReturnApproval: "neutral_or_bullish_depending_on_facts",
    proxyContestOrActivistFight: "volatile",
    spacVoteWithRedemptionCashPressure: "volatile_or_bearish",
  },
} as const;

export function isSecIntegrationEventType(value: unknown): value is SecIntegrationEventType {
  return typeof value === "string" && eventTypeSet.has(value);
}

export function isSecDisplayPayloadType(value: unknown): value is SecDisplayPayloadType {
  return typeof value === "string" && displayTypeSet.has(value);
}

export function isSecDeliveryLevel(value: unknown): value is SecDeliveryLevel {
  return typeof value === "string" && deliveryLevelSet.has(value);
}

export function deriveSecDeliveryLevel(score: number): SecDeliveryLevel {
  const normalizedScore = Math.max(0, Math.min(100, Math.round(score)));
  if (normalizedScore < 50) return "archive";
  if (normalizedScore < 75) return "feed";
  return "alert";
}

export function validateSecRequiredOutputJson(value: unknown): SecIntegrationValidationResult<SecRequiredOutputJson> {
  const errors: string[] = [];
  const warnings: string[] = [];
  const root = expectPlainObject(value, "$", errors);

  if (!root) return validationFailure(errors, warnings);

  const parserOutput = expectPlainObject(root.parser_output, "parser_output", errors);
  const analysisOutput = expectPlainObject(root.analysis_output, "analysis_output", errors);
  const displayPayload = expectPlainObject(root.display_payload, "display_payload", errors);
  const transactionFingerprint = validateOptionalObject(
    root.transaction_fingerprint,
    "transaction_fingerprint",
    errors,
  );
  const filingContext = validateOptionalObject(root.filing_context, "filing_context", errors);

  if (parserOutput) validateParserOutput(parserOutput, errors);
  if (analysisOutput) validateAnalysisOutput(analysisOutput, errors);
  if (displayPayload) validateDisplayPayload(displayPayload, errors);
  if (analysisOutput && displayPayload) validateIpoListingPayload(analysisOutput, displayPayload, warnings);
  if (filingContext) validateFilingContext(filingContext, errors);

  if (errors.length > 0 || !parserOutput || !analysisOutput || !displayPayload) {
    return validationFailure(errors, warnings);
  }

  const score = normalizeSecScore(analysisOutput.score);
  const normalized: SecRequiredOutputJson = {
    parser_output: parserOutput as SecParserOutputForIntegration,
    analysis_output: {
      ...(analysisOutput as Record<string, unknown>),
      source_group: "filings",
      market_scope: analysisOutput.market_scope as SecMarketScope,
      event_type: analysisOutput.event_type as SecIntegrationEventType,
      score: score ?? 0,
      signal: analysisOutput.signal as SecSignal,
      confidence: analysisOutput.confidence as SecConfidence,
    } as SecAnalysisOutput,
    display_payload: {
      ...(displayPayload as Record<string, unknown>),
      display_type: displayPayload.display_type as SecDisplayPayloadType,
      data: displayPayload.data as Record<string, unknown>,
      evidence: displayPayload.evidence as unknown[],
      notes: displayPayload.notes as unknown[],
    },
  };

  if (root.filing_context !== undefined) {
    normalized.filing_context = root.filing_context === null ? null : (filingContext as SecFilingContext);
  }
  if (root.transaction_fingerprint !== undefined) {
    normalized.transaction_fingerprint =
      root.transaction_fingerprint === null ? null : (transactionFingerprint as SecTransactionFingerprint);
  }

  return {
    ok: true,
    value: normalized,
    errors: [],
    warnings,
  };
}

function validateParserOutput(value: Record<string, unknown>, errors: string[]) {
  if ("filing_context" in value) {
    errors.push("parser_output.filing_context is not allowed; filing_context is supplied by ingest/common outside parser_output.");
  }
  requireString(value, "parserVersion", "parser_output.parserVersion", errors);
  requireString(value, "parserGroup", "parser_output.parserGroup", errors);
  requireString(value, "formType", "parser_output.formType", errors);
  requireBoolean(value, "isSupported", "parser_output.isSupported", errors);
  requireObject(value, "facts", "parser_output.facts", errors);
  optionalArray(value, "signals", "parser_output.signals", errors);
  optionalArray(value, "calendarItems", "parser_output.calendarItems", errors);
  optionalArray(value, "warnings", "parser_output.warnings", errors);
  optionalObject(value, "raw", "parser_output.raw", errors);
}

function validateAnalysisOutput(value: Record<string, unknown>, errors: string[]) {
  if (value.source_group !== "filings") {
    errors.push('analysis_output.source_group must be "filings".');
  }
  if (!marketScopeSet.has(String(value.market_scope || ""))) {
    errors.push(`analysis_output.market_scope must be one of: ${SEC_MARKET_SCOPES.join(", ")}.`);
  }
  if (!isSecIntegrationEventType(value.event_type)) {
    errors.push(`analysis_output.event_type must be one of the approved SEC event types: ${SEC_INTEGRATION_EVENT_TYPES.join(", ")}.`);
  }
  if (normalizeSecScore(value.score) === null) {
    errors.push("analysis_output.score must be a finite number from 0 to 100.");
  }
  if (!signalSet.has(String(value.signal || ""))) {
    errors.push(`analysis_output.signal must be one of: ${SEC_SIGNALS.join(", ")}.`);
  }
  if (!confidenceSet.has(String(value.confidence || ""))) {
    errors.push(`analysis_output.confidence must be one of: ${SEC_CONFIDENCE_LEVELS.join(", ")}.`);
  }

  for (const field of ["event_title", "score_reason", "quick_take", "summary", "why_it_matters"]) {
    requireString(value, field, `analysis_output.${field}`, errors);
  }

  requireTickerOrNull(value.primary_ticker, "analysis_output.primary_ticker", errors);

  for (const field of ["tickers", "bullish_points", "bearish_points", "key_evidence", "what_to_watch_next", "related_tickers", "calendar_items"]) {
    requireArray(value, field, `analysis_output.${field}`, errors);
  }

  for (const field of ["sector", "industry_group", "theme_group", "sub_theme"]) {
    optionalNullableString(value, field, `analysis_output.${field}`, errors);
  }

  requireBoolean(value, "needs_human_review", "analysis_output.needs_human_review", errors);
}

function validateDisplayPayload(value: Record<string, unknown>, errors: string[]) {
  if (!isSecDisplayPayloadType(value.display_type)) {
    errors.push(`display_payload.display_type must be one of: ${SEC_DISPLAY_PAYLOAD_TYPES.join(", ")}.`);
  }
  requireObject(value, "data", "display_payload.data", errors);
  requireArray(value, "evidence", "display_payload.evidence", errors);
  requireArray(value, "notes", "display_payload.notes", errors);

  if (value.display_type === "spac_transaction_status") {
    const data = expectPlainObject(value.data, "display_payload.data", errors);
    if (data) validateSpacTransactionStatusPayload(data, errors);
  }
  if (value.display_type === "ipo_listing") {
    const data = expectPlainObject(value.data, "display_payload.data", errors);
    if (data) validateTraditionalIpoListingPayload(data, errors);
  }
  if (value.display_type === "listing_risk") {
    const data = expectPlainObject(value.data, "display_payload.data", errors);
    if (data) validateListingRiskPayload(data, errors);
  }
  if (value.display_type === "earnings") {
    const data = expectPlainObject(value.data, "display_payload.data", errors);
    if (data) validateEarningsPayload(data, errors);
  }
  if (value.display_type === "fda_clinical") {
    const data = expectPlainObject(value.data, "display_payload.data", errors);
    if (data) validateFdaClinicalPayload(data, errors);
  }
}

function validateIpoListingPayload(
  analysisOutput: Record<string, unknown>,
  displayPayload: Record<string, unknown>,
  warnings: string[],
) {
  const data = isPlainObject(displayPayload.data) ? displayPayload.data : null;
  const ipoKind = data?.ipo_kind;
  const normalizedIpoKind = normalizeIpoKind(ipoKind);

  if (ipoKind !== undefined && ipoKind !== null && normalizedIpoKind === null) {
    warnings.push('display_payload.data.ipo_kind is outside the usual IPO label set.');
  }

  if (analysisOutput.event_type === "ipo_listing" && ipoKind === undefined) {
    warnings.push('display_payload.data.ipo_kind is usually useful when analysis_output.event_type is "ipo_listing".');
  }

  if (displayPayload.display_type === "ipo_listing" && analysisOutput.event_type !== "ipo_listing") {
    warnings.push('display_payload.display_type "ipo_listing" is usually paired with analysis_output.event_type "ipo_listing".');
  }
}

function validateSpacTransactionStatusPayload(value: Record<string, unknown>, errors: string[]) {
  const currentStage = value.current_stage;
  if (currentStage !== undefined && !isValidSpacTransactionStage(currentStage)) {
    errors.push(
      'display_payload.data.current_stage must be one of: target, proxy, vote, redemption, cash, closing.',
    );
  }

  optionalArray(value, "stages", "display_payload.data.stages", errors);
  optionalArray(value, "risk_flags", "display_payload.data.risk_flags", errors);
  optionalArray(value, "watch_next", "display_payload.data.watch_next", errors);
  optionalArray(value, "sources", "display_payload.data.sources", errors);
  optionalArray(value, "event_history", "display_payload.data.event_history", errors);
}

function validateTraditionalIpoListingPayload(value: Record<string, unknown>, errors: string[]) {
  const currentStage = value.current_stage;
  if (currentStage !== undefined && !isValidIpoListingStage(currentStage)) {
    errors.push(
      'display_payload.data.current_stage must be one of: s1_filed, terms_set, effect, pricing, listing, lockup.',
    );
  }

  optionalArray(value, "use_of_proceeds", "display_payload.data.use_of_proceeds", errors);
  optionalArray(value, "stages", "display_payload.data.stages", errors);
  optionalArray(value, "risk_flags", "display_payload.data.risk_flags", errors);
  optionalArray(value, "watch_next", "display_payload.data.watch_next", errors);
  optionalArray(value, "sources", "display_payload.data.sources", errors);
}

function validateListingRiskPayload(value: Record<string, unknown>, errors: string[]) {
  optionalArray(value, "checks", "display_payload.data.checks", errors);
  optionalArray(value, "timeline", "display_payload.data.timeline", errors);
  optionalArray(value, "risk_flags", "display_payload.data.risk_flags", errors);
  optionalArray(value, "watch_next", "display_payload.data.watch_next", errors);
  optionalArray(value, "sources", "display_payload.data.sources", errors);
}

function validateEarningsPayload(value: Record<string, unknown>, errors: string[]) {
  optionalArray(value, "actuals", "display_payload.data.actuals", errors);
  optionalArray(value, "guidance", "display_payload.data.guidance", errors);
  optionalArray(value, "segments", "display_payload.data.segments", errors);
  optionalArray(value, "surprises", "display_payload.data.surprises", errors);
  optionalArray(value, "risk_flags", "display_payload.data.risk_flags", errors);
  optionalArray(value, "watch_next", "display_payload.data.watch_next", errors);
  optionalArray(value, "sources", "display_payload.data.sources", errors);
}

function validateFdaClinicalPayload(value: Record<string, unknown>, errors: string[]) {
  optionalArray(value, "fda_timeline", "display_payload.data.fda_timeline", errors);
  optionalArray(value, "timeline", "display_payload.data.timeline", errors);
  optionalArray(value, "key_takeaways", "display_payload.data.key_takeaways", errors);
  optionalArray(value, "data_highlights", "display_payload.data.data_highlights", errors);
  optionalArray(value, "risks", "display_payload.data.risks", errors);
  optionalArray(value, "watch_next", "display_payload.data.watch_next", errors);
  optionalArray(value, "sources", "display_payload.data.sources", errors);
}

function normalizeIpoKind(value: unknown): "traditional" | "spac" | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
  if (normalized === "traditional" || normalized === "traditional ipo") return "traditional";
  if (normalized === "spac" || normalized === "spac ipo") return "spac";
  return null;
}

function isValidIpoListingStage(value: unknown) {
  return (
    typeof value === "string" &&
    ["s1_filed", "terms_set", "effect", "pricing", "listing", "lockup"].includes(value)
  );
}

function isValidSpacTransactionStage(value: unknown) {
  return (
    typeof value === "string" &&
    ["target", "proxy", "vote", "redemption", "cash", "closing"].includes(value)
  );
}

function validateFilingContext(value: Record<string, unknown>, errors: string[]) {
  optionalNullableString(value, "context_as_of", "filing_context.context_as_of", errors);
  optionalArray(value, "source_notes", "filing_context.source_notes", errors);

  if (value.ownership !== undefined && value.ownership !== null) {
    const ownership = expectPlainObject(value.ownership, "filing_context.ownership", errors);
    if (ownership) validateOwnershipFilingContext(ownership, errors);
  }
}

function validateOwnershipFilingContext(value: Record<string, unknown>, errors: string[]) {
  requireArray(value, "same_insider_12m_trades", "filing_context.ownership.same_insider_12m_trades", errors);
  requireObjectOrNull(value, "company_90d_insider_flow", "filing_context.ownership.company_90d_insider_flow", errors);
  requireObjectOrNull(value, "recent_30d_cluster", "filing_context.ownership.recent_30d_cluster", errors);
}

function normalizeSecScore(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  if (value < 0 || value > 100) return null;
  return Math.round(value);
}

function validationFailure(errors: string[], warnings: string[]): SecIntegrationValidationResult<never> {
  return {
    ok: false,
    errors: errors.length ? errors : ["Required SEC output JSON must be an object."],
    warnings,
  };
}

function expectPlainObject(value: unknown, path: string, errors: string[]) {
  if (!isPlainObject(value)) {
    errors.push(`${path} must be an object.`);
    return null;
  }
  return value;
}

function validateOptionalObject(value: unknown, path: string, errors: string[]) {
  if (value === undefined || value === null) return null;
  return expectPlainObject(value, path, errors);
}

function requireString(value: Record<string, unknown>, key: string, path: string, errors: string[]) {
  if (typeof value[key] !== "string") errors.push(`${path} must be a string.`);
}

function requireBoolean(value: Record<string, unknown>, key: string, path: string, errors: string[]) {
  if (typeof value[key] !== "boolean") errors.push(`${path} must be a boolean.`);
}

function requireArray(value: Record<string, unknown>, key: string, path: string, errors: string[]) {
  if (!Array.isArray(value[key])) errors.push(`${path} must be an array.`);
}

function requireObject(value: Record<string, unknown>, key: string, path: string, errors: string[]) {
  if (!isPlainObject(value[key])) errors.push(`${path} must be an object.`);
}

function requireObjectOrNull(value: Record<string, unknown>, key: string, path: string, errors: string[]) {
  if (!(key in value) || (value[key] !== null && !isPlainObject(value[key]))) {
    errors.push(`${path} must be an object or null.`);
  }
}

function optionalArray(value: Record<string, unknown>, key: string, path: string, errors: string[]) {
  if (value[key] !== undefined && !Array.isArray(value[key])) errors.push(`${path} must be an array when provided.`);
}

function optionalObject(value: Record<string, unknown>, key: string, path: string, errors: string[]) {
  if (value[key] !== undefined && value[key] !== null && !isPlainObject(value[key])) {
    errors.push(`${path} must be an object when provided.`);
  }
}

function optionalNullableString(value: Record<string, unknown>, key: string, path: string, errors: string[]) {
  if (value[key] !== undefined && value[key] !== null && typeof value[key] !== "string") {
    errors.push(`${path} must be a string or null when provided.`);
  }
}

function requireTickerOrNull(value: unknown, path: string, errors: string[]) {
  if (value === null) return;
  if (!isPlainObject(value)) {
    errors.push(`${path} must be an object or null.`);
    return;
  }
  optionalNullableString(value, "ticker", `${path}.ticker`, errors);
  optionalNullableString(value, "exchange", `${path}.exchange`, errors);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
