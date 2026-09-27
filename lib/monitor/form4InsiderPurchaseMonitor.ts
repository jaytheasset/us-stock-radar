import type { MonitorConditionOperator } from "./conditionRegistry.ts";
import type { CurrentOwnershipReadResult } from "./ownershipMonitorPersistence.ts";

export const FORM4_INSIDER_PURCHASE_MONITOR_KIND = "form4_insider_purchase" as const;
export const FORM4_INSIDER_PURCHASE_MATCH_VERSION = "form4_insider_purchase_match_v1" as const;

export type Form4InsiderRole = "officer" | "director" | "officer_or_director";

export type Form4InsiderPurchaseSettings = Readonly<{
  target:
    | Readonly<{ scope: "watchlist" }>
    | Readonly<{ scope: "ticker"; ticker: string }>;
  role: Form4InsiderRole;
  minimumShares: number | null;
}>;

export type Form4PurchaseCondition = Readonly<{
  key: string;
  operator: MonitorConditionOperator;
  value: unknown;
}>;

export type Form4PurchaseRelationEvidence = Readonly<{
  kind: "xml_field" | "footnote";
  ref: string;
  text: string;
}>;

export type Form4PurchaseMatchRow = Readonly<{
  transactionIndex: number;
  ownerName: string;
  ownerRoles: readonly string[];
  officerTitle: string | null;
  securityTitle: string;
  shares: number;
  sharesRaw: string;
  pricePerShare: number | null;
  pricePerShareRaw: string | null;
  transactionDate: string;
  ownershipRelation: "direct" | "indirect";
  relationEvidence: readonly Form4PurchaseRelationEvidence[];
}>;

export type Form4PurchaseMatchEvidence = Readonly<{
  version: typeof FORM4_INSIDER_PURCHASE_MATCH_VERSION;
  kind: typeof FORM4_INSIDER_PURCHASE_MONITOR_KIND;
  ticker: string;
  accessionNumber: string;
  filedAt: string;
  sourceUrl: string;
  reason: string;
  matches: readonly Form4PurchaseMatchRow[];
}>;

export const FORM4_PURCHASE_EVALUATION_TRACE_VERSION = "form4_purchase_evaluation_trace_v1" as const;

export type Form4PurchaseEvaluationReasonCode =
  | "all_conditions_match"
  | "condition_not_met"
  | "minimum_shares_not_met"
  | "reporting_owner_role_not_met"
  | "nonpurchase_transaction"
  | "ownership_form_mismatch"
  | "ownership_form4_purchase_unavailable"
  | "ownership_reporter_attribution_unavailable";

export type Form4PurchaseRowDecisionReasonCode =
  | "matched"
  | "source_fields_unavailable"
  | "transaction_kind_not_supported"
  | "transaction_code_not_purchase"
  | "acquisition_disposition_not_acquired"
  | "security_not_common_stock"
  | "shares_unavailable"
  | "minimum_shares_not_met"
  | "transaction_date_unavailable"
  | "price_invalid"
  | "reporting_owner_unavailable"
  | "reporting_owner_role_not_met"
  | "owner_row_relation_unavailable";

export type Form4PurchaseConditionDecision = Readonly<{
  key: string;
  status: "match" | "no_match" | "unavailable" | "not_evaluated";
  expected: string;
  actual: string | null;
}>;

export type Form4PurchaseOwnerDecision = Readonly<{
  ownerIndex: number;
  name: string;
  roles: readonly string[];
  officerTitle: string | null;
  roleStatus: "match" | "no_match" | "unavailable" | "not_evaluated";
  relationStatus: "validated" | "unavailable" | "not_evaluated";
  relation: "direct" | "indirect" | null;
  relationEvidence: readonly Form4PurchaseRelationEvidence[];
}>;

export type Form4PurchaseRowEvaluationTrace = Readonly<{
  transactionIndex: number;
  status: "match" | "no_match" | "ineligible";
  reasonCode: Form4PurchaseRowDecisionReasonCode;
  transactionKind: string | null;
  transactionCode: string | null;
  acquisitionDispositionCode: string | null;
  securityTitle: string | null;
  shares: number | null;
  sharesRaw: string | null;
  pricePerShare: number | null;
  pricePerShareRaw: string | null;
  transactionDate: string | null;
  directOrIndirectOwnership: string | null;
  conditions: readonly Form4PurchaseConditionDecision[];
  owners: readonly Form4PurchaseOwnerDecision[];
}>;

export type Form4PurchaseEvaluationTrace = Readonly<{
  version: typeof FORM4_PURCHASE_EVALUATION_TRACE_VERSION;
  settings: Form4InsiderPurchaseSettings;
  filing: Readonly<{
    status: "available" | "unavailable";
    eventId: string | null;
    accessionNumber: string | null;
    filingForm: string | null;
    filedAt: string | null;
    ticker: string | null;
    sourceUrl: string | null;
  }>;
  status: "match" | "no_match" | "ineligible";
  reasonCode: Form4PurchaseEvaluationReasonCode;
  rows: readonly Form4PurchaseRowEvaluationTrace[];
}>;

export type Form4PurchaseEvaluation = Readonly<{
  status: "match" | "no_match" | "ineligible";
  reasonCode: Form4PurchaseEvaluationReasonCode;
  trace: Form4PurchaseEvaluationTrace;
  evidence?: Form4PurchaseMatchEvidence;
}>;

type OwnerProfile = Readonly<{
  name: string;
  roles: readonly string[];
  officerTitle: string | null;
  isOfficer: boolean | null;
  isDirector: boolean | null;
}>;

type OwnerCandidate = Readonly<{
  profile: OwnerProfile;
  relation: "direct" | "indirect";
  relationEvidence: readonly Form4PurchaseRelationEvidence[];
}>;

type RowOutcome = Readonly<{
  status: "match" | "no_match" | "ineligible";
  reasonCode: Form4PurchaseRowDecisionReasonCode;
  matches: readonly Form4PurchaseMatchRow[];
  trace: Form4PurchaseRowEvaluationTrace;
}>;

export function parseForm4InsiderPurchaseSettings(value: unknown):
  | Readonly<{ ok: true; value: Form4InsiderPurchaseSettings }>
  | Readonly<{ ok: false; errors: readonly string[] }> {
  if (!recordValue(value)) return { ok: false, errors: ["form4_purchase_invalid"] };
  const input = value;
  const keys = Object.keys(input).sort();
  if (keys.length !== 3 || keys[0] !== "minimumShares" || keys[1] !== "role" || keys[2] !== "target") {
    return { ok: false, errors: ["form4_purchase_shape_invalid"] };
  }
  const role = input.role;
  if (role !== "officer" && role !== "director" && role !== "officer_or_director") {
    return { ok: false, errors: ["form4_purchase_role_invalid"] };
  }
  const minimumShares = input.minimumShares;
  if (
    minimumShares !== null
    && (typeof minimumShares !== "number" || !Number.isSafeInteger(minimumShares) || minimumShares <= 0)
  ) {
    return { ok: false, errors: ["form4_purchase_minimum_shares_invalid"] };
  }
  const target = parseTarget(input.target);
  if (!target.ok) return target;
  return {
    ok: true,
    value: Object.freeze({
      target: target.value,
      role,
      minimumShares,
    }),
  };
}

export function buildForm4InsiderPurchaseConditions(
  settings: Form4InsiderPurchaseSettings,
): readonly Form4PurchaseCondition[] {
  const roleCondition: Form4PurchaseCondition = settings.role === "officer_or_director"
    ? { key: "ownership.form4.reporting_owner_role", operator: "in", value: ["officer", "director"] }
    : { key: "ownership.form4.reporting_owner_role", operator: "eq", value: settings.role };
  return Object.freeze([
    Object.freeze({ key: "ownership.form4.transaction_kind", operator: "eq", value: "non_derivative" }),
    Object.freeze({ key: "ownership.form4.transaction_code", operator: "eq", value: "P" }),
    Object.freeze({ key: "ownership.form4.acquisition_disposition", operator: "eq", value: "A" }),
    Object.freeze(roleCondition),
    ...(settings.minimumShares === null
      ? []
      : [Object.freeze({ key: "ownership.form4.shares", operator: "gte", value: settings.minimumShares })]),
  ]);
}

export function form4InsiderPurchaseSettingsEqual(
  left: Form4InsiderPurchaseSettings,
  right: Form4InsiderPurchaseSettings,
) {
  return left.role === right.role
    && left.minimumShares === right.minimumShares
    && left.target.scope === right.target.scope
    && (left.target.scope !== "ticker"
      || (right.target.scope === "ticker" && left.target.ticker === right.target.ticker));
}

export function evaluateForm4InsiderPurchase(
  current: CurrentOwnershipReadResult,
  settings: Form4InsiderPurchaseSettings,
): Form4PurchaseEvaluation {
  if (current.status !== "available") {
    return terminal("ineligible", "ownership_form4_purchase_unavailable", current, settings);
  }
  if (current.form !== "form4" || current.filingForm !== "4") {
    return terminal("no_match", "ownership_form_mismatch", current, settings);
  }
  const filedAt = timestamp(current.filedAt);
  if (!filedAt) return terminal("ineligible", "ownership_form4_purchase_unavailable", current, settings);

  const outcomes = current.rows.map((row) => evaluateRow(current, row, settings));
  const matches = outcomes.flatMap((outcome) => outcome.matches);
  const traces = Object.freeze(outcomes.map((outcome) => outcome.trace));
  if (matches.length > 0) {
    const firstRow = current.rows[0] as Record<string, unknown> | undefined;
    const ticker = normalizedTicker(firstRow?.symbol);
    const sourceUrl = stringValue(record(firstRow?.provenance).source_url);
    if (!ticker || !officialSecUrl(sourceUrl, current.accessionNumber)) {
      return terminal(
        "ineligible",
        "ownership_form4_purchase_unavailable",
        current,
        settings,
        traces,
      );
    }
    return {
      status: "match",
      reasonCode: "all_conditions_match",
      trace: evaluationTrace(current, settings, "match", "all_conditions_match", traces),
      evidence: Object.freeze({
        version: FORM4_INSIDER_PURCHASE_MATCH_VERSION,
        kind: FORM4_INSIDER_PURCHASE_MONITOR_KIND,
        ticker,
        accessionNumber: current.accessionNumber,
        filedAt,
        sourceUrl,
        reason: form4PurchaseMatchReason(settings, matches.length),
        matches: Object.freeze(matches),
      }),
    };
  }
  if (outcomes.some((outcome) => outcome.status === "ineligible")) {
    return terminal(
      "ineligible",
      "ownership_reporter_attribution_unavailable",
      current,
      settings,
      traces,
    );
  }
  const reasonCode = aggregateNoMatchReason(outcomes);
  return terminal("no_match", reasonCode, current, settings, traces);
}

function form4PurchaseMatchReason(
  settings: Form4InsiderPurchaseSettings,
  matchCount: number,
) {
  const target = settings.target.scope === "watchlist"
    ? "관심종목"
    : `직접 선택 종목 ${settings.target.ticker}`;
  const role = settings.role === "officer"
    ? "임원"
    : settings.role === "director"
      ? "이사"
      : "임원 또는 이사";
  const minimum = settings.minimumShares === null
    ? "최소 수량 조건 없음"
    : `각 거래 행이 최소 ${settings.minimumShares}주 조건 충족`;
  return `매수 신고: SEC Form 4의 P 코드 비파생 보통주 취득 ${matchCount}건이 설정 조건을 충족했습니다. 대상: ${target}. 신고인 직책: ${role}. ${minimum}. 소유 관계는 해당 신고인을 매수 주문자 또는 유일한 주체로 식별하지 않습니다.`;
}

export function parseStoredForm4PurchaseMatchEvidence(value: unknown): Form4PurchaseMatchEvidence | null {
  if (!recordValue(value)) return null;
  if (
    value.version !== FORM4_INSIDER_PURCHASE_MATCH_VERSION
    || value.kind !== FORM4_INSIDER_PURCHASE_MONITOR_KIND
    || !normalizedTicker(value.ticker)
    || !/^\d{10}-\d{2}-\d{6}$/.test(stringValue(value.accessionNumber))
    || !timestamp(value.filedAt)
    || !officialSecUrl(stringValue(value.sourceUrl), stringValue(value.accessionNumber))
    || !nullableString(value.reason)
    || !Array.isArray(value.matches)
    || value.matches.length === 0
    || value.matches.length > 1000
  ) return null;
  const matches = value.matches.flatMap((candidate) => parseStoredMatchRow(candidate));
  if (matches.length !== value.matches.length) return null;
  return Object.freeze({
    version: FORM4_INSIDER_PURCHASE_MATCH_VERSION,
    kind: FORM4_INSIDER_PURCHASE_MONITOR_KIND,
    ticker: normalizedTicker(value.ticker),
    accessionNumber: stringValue(value.accessionNumber),
    filedAt: stringValue(value.filedAt),
    sourceUrl: stringValue(value.sourceUrl),
    reason: stringValue(value.reason),
    matches: Object.freeze(matches),
  });
}

function parseStoredMatchRow(value: unknown): Form4PurchaseMatchRow[] {
  if (!recordValue(value)) return [];
  const transactionIndex = value.transactionIndex;
  const ownerName = nullableString(value.ownerName);
  const ownerRoles = stringArray(value.ownerRoles);
  const officerTitle = value.officerTitle === null ? null : nullableString(value.officerTitle);
  const securityTitle = nullableString(value.securityTitle);
  const shares = value.shares;
  const sharesRaw = nullableString(value.sharesRaw);
  const pricePerShare = value.pricePerShare;
  const pricePerShareRaw = value.pricePerShareRaw === null ? null : nullableString(value.pricePerShareRaw);
  const transactionDate = isoDate(value.transactionDate);
  const ownershipRelation = value.ownershipRelation;
  if (
    !Number.isInteger(transactionIndex) || Number(transactionIndex) < 0
    || !ownerName
    || !Array.isArray(value.ownerRoles) || ownerRoles.length !== value.ownerRoles.length
    || (value.officerTitle !== null && !officerTitle)
    || !securityTitle
    || typeof shares !== "number" || !Number.isFinite(shares) || shares < 0
    || !sharesRaw
    || (pricePerShare !== null && (typeof pricePerShare !== "number" || !Number.isFinite(pricePerShare) || pricePerShare < 0))
    || (pricePerShare === null ? pricePerShareRaw !== null : !pricePerShareRaw)
    || !transactionDate
    || (ownershipRelation !== "direct" && ownershipRelation !== "indirect")
    || !Array.isArray(value.relationEvidence) || value.relationEvidence.length === 0
  ) return [];
  const relationEvidence = value.relationEvidence.flatMap((candidate) => {
    if (!recordValue(candidate)) return [];
    const kind = candidate.kind;
    const ref = nullableString(candidate.ref);
    const text = nullableString(candidate.text);
    return (kind === "xml_field" || kind === "footnote") && ref && text
      ? [Object.freeze({ kind, ref, text })]
      : [];
  });
  if (relationEvidence.length !== value.relationEvidence.length) return [];
  return [Object.freeze({
    transactionIndex: Number(transactionIndex),
    ownerName,
    ownerRoles: Object.freeze(ownerRoles),
    officerTitle,
    securityTitle,
    shares,
    sharesRaw,
    pricePerShare: pricePerShare as number | null,
    pricePerShareRaw,
    transactionDate,
    ownershipRelation,
    relationEvidence: Object.freeze(relationEvidence),
  })];
}

function evaluateRow(
  current: Extract<CurrentOwnershipReadResult, { status: "available"; form: "form4" }>,
  row: Readonly<Record<string, unknown>>,
  settings: Form4InsiderPurchaseSettings,
): RowOutcome {
  const transactionIndex = Number.isInteger(row.transaction_index) ? Number(row.transaction_index) : -1;
  const transactionKind = nullableString(row.transaction_kind);
  const transactionCode = nullableString(row.transaction_code);
  const acquiredDisposed = nullableString(row.acquired_disposed_code);
  const security = commonStockClassification(row.security_title);
  const shares = exactNumeric(row, "shares");
  const transactionDate = isoDate(row.transaction_date);
  const price = optionalExactNumeric(row, "price_per_share");
  const calculation = record(row.calculation_basis);
  const sharesRaw = sourceText(calculation, "shares") ?? nullableString(row.shares);
  const priceRaw = sourceText(calculation, "price_per_share") ?? nullableString(row.price_per_share);
  const directOrIndirectOwnership = nullableString(row.direct_or_indirect_ownership);
  const profiles = ownerProfiles(row);
  const unevaluatedOwners = profiles.map((profile, ownerIndex) => Object.freeze({
    ownerIndex,
    name: profile.name,
    roles: Object.freeze([...profile.roles]),
    officerTitle: profile.officerTitle,
    roleStatus: "not_evaluated" as const,
    relationStatus: "not_evaluated" as const,
    relation: null,
    relationEvidence: Object.freeze([]),
  }));
  const baseConditions: Form4PurchaseConditionDecision[] = [
    conditionDecision("transaction_kind", transactionKind ? (transactionKind === "non_derivative" ? "match" : "no_match") : "unavailable", "non_derivative", transactionKind),
    conditionDecision("transaction_code", transactionCode ? (transactionCode === "P" ? "match" : "no_match") : "unavailable", "P", transactionCode),
    conditionDecision("acquisition_disposition", acquiredDisposed ? (acquiredDisposed === "A" ? "match" : "no_match") : "unavailable", "A", acquiredDisposed),
    conditionDecision(
      "security_type",
      security.status === "unavailable" ? "unavailable" : security.status === "common" ? "match" : "no_match",
      "non-derivative common stock",
      security.title || null,
    ),
    conditionDecision(
      "minimum_shares",
      shares
        ? settings.minimumShares === null || shares.value >= settings.minimumShares ? "match" : "no_match"
        : "unavailable",
      settings.minimumShares === null ? "no minimum" : `at least ${settings.minimumShares}`,
      sharesRaw,
    ),
    conditionDecision("reporting_owner_role", "not_evaluated", expectedRole(settings.role), ownerRoleSummary(profiles)),
    conditionDecision("ownership_relation", "not_evaluated", "validated direct or indirect relation", directOrIndirectOwnership),
  ];
  const finish = (
    status: RowOutcome["status"],
    reasonCode: Form4PurchaseRowDecisionReasonCode,
    conditions: readonly Form4PurchaseConditionDecision[] = baseConditions,
    owners: readonly Form4PurchaseOwnerDecision[] = unevaluatedOwners,
    matches: readonly Form4PurchaseMatchRow[] = [],
  ): RowOutcome => ({
    status,
    reasonCode,
    matches: Object.freeze([...matches]),
    trace: Object.freeze({
      transactionIndex,
      status,
      reasonCode,
      transactionKind,
      transactionCode,
      acquisitionDispositionCode: acquiredDisposed,
      securityTitle: security.title || null,
      shares: shares?.value ?? null,
      sharesRaw,
      pricePerShare: price.status === "available" ? price.value : null,
      pricePerShareRaw: price.status === "available" ? priceRaw : null,
      transactionDate,
      directOrIndirectOwnership,
      conditions: Object.freeze([...conditions]),
      owners: Object.freeze([...owners]),
    }),
  });

  if (!transactionKind || !transactionCode || !acquiredDisposed || security.status === "unavailable") {
    return finish("ineligible", "source_fields_unavailable");
  }
  if (transactionCode !== "P") return finish("no_match", "transaction_code_not_purchase");
  if (transactionKind !== "non_derivative") return finish("no_match", "transaction_kind_not_supported");
  if (acquiredDisposed !== "A") return finish("no_match", "acquisition_disposition_not_acquired");
  if (security.status === "other") return finish("no_match", "security_not_common_stock");
  if (!shares) return finish("ineligible", "shares_unavailable");
  if (!transactionDate) return finish("ineligible", "transaction_date_unavailable");
  if (settings.minimumShares !== null && shares.value < settings.minimumShares) {
    return finish("no_match", "minimum_shares_not_met");
  }
  if (price.status === "invalid") return finish("ineligible", "price_invalid");
  if (profiles.length === 0) return finish("ineligible", "reporting_owner_unavailable");
  const candidates = ownerCandidates(current, row, profiles);
  const matches: Form4PurchaseMatchRow[] = [];
  let potentiallyMatchingOwnerUnavailable = false;
  const ownerDecisions = profiles.map((profile, ownerIndex): Form4PurchaseOwnerDecision => {
    const role = roleMatches(profile, settings.role);
    if (role === "unavailable") {
      potentiallyMatchingOwnerUnavailable = true;
      return Object.freeze({
        ownerIndex, name: profile.name, roles: Object.freeze([...profile.roles]), officerTitle: profile.officerTitle,
        roleStatus: "unavailable", relationStatus: "not_evaluated", relation: null,
        relationEvidence: Object.freeze([]),
      });
    }
    if (!role) return Object.freeze({
      ownerIndex, name: profile.name, roles: Object.freeze([...profile.roles]), officerTitle: profile.officerTitle,
      roleStatus: "no_match", relationStatus: "not_evaluated", relation: null,
      relationEvidence: Object.freeze([]),
    });
    const candidate = candidates.get(ownerIndex);
    if (!candidate) {
      potentiallyMatchingOwnerUnavailable = true;
      return Object.freeze({
        ownerIndex, name: profile.name, roles: Object.freeze([...profile.roles]), officerTitle: profile.officerTitle,
        roleStatus: "match", relationStatus: "unavailable", relation: null,
        relationEvidence: Object.freeze([]),
      });
    }
    matches.push(Object.freeze({
      transactionIndex,
      ownerName: candidate.profile.name,
      ownerRoles: Object.freeze([...candidate.profile.roles]),
      officerTitle: candidate.profile.officerTitle,
      securityTitle: security.title,
      shares: shares.value,
      sharesRaw: sharesRaw ?? String(shares.value),
      pricePerShare: price.value,
      pricePerShareRaw: price.value === null
        ? null
        : priceRaw ?? String(price.value),
      transactionDate,
      ownershipRelation: candidate.relation,
      relationEvidence: Object.freeze([...candidate.relationEvidence]),
    }));
    return Object.freeze({
      ownerIndex, name: profile.name, roles: Object.freeze([...profile.roles]), officerTitle: profile.officerTitle,
      roleStatus: "match", relationStatus: "validated", relation: candidate.relation,
      relationEvidence: Object.freeze([...candidate.relationEvidence]),
    });
  });
  const roleStatuses = ownerDecisions.map((owner) => owner.roleStatus);
  const relationStatuses = ownerDecisions.map((owner) => owner.relationStatus);
  const conditions = baseConditions.map((condition) => condition.key === "reporting_owner_role"
    ? conditionDecision(
      condition.key,
      roleStatuses.includes("match") ? "match" : roleStatuses.includes("unavailable") ? "unavailable" : "no_match",
      condition.expected,
      condition.actual,
    )
    : condition.key === "ownership_relation"
      ? conditionDecision(
        condition.key,
        relationStatuses.includes("validated") ? "match"
          : relationStatuses.includes("unavailable") ? "unavailable" : "not_evaluated",
        condition.expected,
        condition.actual,
      )
      : condition);
  if (matches.length > 0) return finish("match", "matched", conditions, ownerDecisions, matches);
  return potentiallyMatchingOwnerUnavailable
    ? finish("ineligible", "owner_row_relation_unavailable", conditions, ownerDecisions)
    : finish("no_match", "reporting_owner_role_not_met", conditions, ownerDecisions);
}

function ownerCandidates(
  current: Extract<CurrentOwnershipReadResult, { status: "available"; form: "form4" }>,
  row: Readonly<Record<string, unknown>>,
  profiles: readonly OwnerProfile[],
) {
  const candidates = new Map<number, OwnerCandidate>();
  const provenance = record(row.provenance);
  if (provenance.reporting_owner_scope === "single_filing_owner" && profiles.length === 1) {
    const relation = relationValue(row.direct_or_indirect_ownership);
    if (relation) {
      candidates.set(0, Object.freeze({
        profile: profiles[0],
        relation,
        relationEvidence: Object.freeze([Object.freeze({
          kind: "xml_field" as const,
          ref: "directOrIndirectOwnership",
          text: relation === "direct" ? "Direct ownership (D)" : "Indirect ownership (I)",
        })]),
      }));
    }
    return candidates;
  }
  if (provenance.reporting_owner_scope !== "filing_level_unattributed_owner_set") return candidates;
  if (current.context?.status !== "available" || current.contextEligibility?.status !== "eligible") return candidates;
  const transactionIndex = row.transaction_index;
  if (!Number.isInteger(transactionIndex) || Number(transactionIndex) < 0) return candidates;
  const rowRef = `row:form4:${transactionIndex}`;
  const contextRow = current.context.rows.find((item) => item.rowRef === rowRef);
  const inventoryRow = current.contextEligibility.inventory.rows.find((item) => item.rowRef === rowRef);
  if (!contextRow || !inventoryRow || inventoryRow.ownerRefs.length !== profiles.length) return candidates;
  const footnotes = new Map(current.contextEligibility.inventory.footnotes.map((item) => [item.footnoteRef, item]));
  contextRow.context.assertions.forEach((assertion) => {
    if (
      assertion.fact !== "ownership_relation"
      || assertion.status !== "supported"
      || (assertion.value !== "direct" && assertion.value !== "indirect")
      || typeof assertion.owner_ref !== "string"
    ) return;
    const ownerIndex = inventoryRow.ownerRefs.indexOf(assertion.owner_ref);
    if (ownerIndex < 0 || !profiles[ownerIndex]) return;
    const refs = assertion.footnote_refs ?? (assertion.footnote_ref ? [assertion.footnote_ref] : []);
    const evidence = refs.flatMap((ref) => {
      const footnote = footnotes.get(ref);
      return footnote
        ? [Object.freeze({ kind: "footnote" as const, ref: footnote.xmlId, text: footnote.text })]
        : [];
    });
    if (evidence.length === 0) return;
    candidates.set(ownerIndex, Object.freeze({
      profile: profiles[ownerIndex],
      relation: assertion.value,
      relationEvidence: Object.freeze(evidence),
    }));
  });
  return candidates;
}

function ownerProfiles(row: Readonly<Record<string, unknown>>): readonly OwnerProfile[] {
  const values = record(row.provenance).reporting_owner_profiles;
  if (!Array.isArray(values)) return [];
  return values.flatMap((value) => {
    if (!record(value)) return [];
    const name = nullableString(value.name);
    const roles = stringArray(value.roles);
    const isOfficer = nullableBoolean(value.is_officer);
    const isDirector = nullableBoolean(value.is_director);
    if (!name || !Array.isArray(value.roles) || roles.length !== value.roles.length) return [];
    return [Object.freeze({
      name,
      roles: Object.freeze(roles),
      officerTitle: nullableString(value.officer_title),
      isOfficer,
      isDirector,
    })];
  });
}

function roleMatches(profile: OwnerProfile, role: Form4InsiderRole): boolean | "unavailable" {
  if (role === "officer") return roleValue(profile.isOfficer, profile.roles, "officer");
  if (role === "director") return roleValue(profile.isDirector, profile.roles, "director");
  const officer = roleValue(profile.isOfficer, profile.roles, "officer");
  const director = roleValue(profile.isDirector, profile.roles, "director");
  if (officer === true || director === true) return true;
  if (officer === "unavailable" || director === "unavailable") return "unavailable";
  return false;
}

function roleValue(value: boolean | null, roles: readonly string[], role: "officer" | "director") {
  if (value !== null) return value;
  if (roles.includes(role)) return true;
  return "unavailable" as const;
}

function parseTarget(value: unknown):
  | Readonly<{ ok: true; value: Form4InsiderPurchaseSettings["target"] }>
  | Readonly<{ ok: false; errors: readonly string[] }> {
  if (!recordValue(value) || (value.scope !== "watchlist" && value.scope !== "ticker")) {
    return { ok: false, errors: ["form4_purchase_target_invalid"] };
  }
  const keys = Object.keys(value).sort();
  if (value.scope === "watchlist") {
    return keys.length === 1 && keys[0] === "scope"
      ? { ok: true, value: Object.freeze({ scope: "watchlist" }) }
      : { ok: false, errors: ["form4_purchase_target_shape_invalid"] };
  }
  const ticker = normalizedTicker(value.ticker);
  return keys.length === 2 && keys[0] === "scope" && keys[1] === "ticker" && ticker
    ? { ok: true, value: Object.freeze({ scope: "ticker", ticker }) }
    : { ok: false, errors: ["form4_purchase_ticker_invalid"] };
}

function exactNumeric(row: Readonly<Record<string, unknown>>, prefix: string) {
  const value = row[prefix];
  return row[`${prefix}_availability`] === "available"
    && row[`${prefix}_value_quality`] === "exact"
    && typeof value === "number"
    && Number.isFinite(value)
    && value >= 0
      ? { value }
      : null;
}

function optionalExactNumeric(row: Readonly<Record<string, unknown>>, prefix: string):
  | Readonly<{ status: "available"; value: number }>
  | Readonly<{ status: "unavailable"; value: null }>
  | Readonly<{ status: "invalid"; value: null }> {
  if (
    row[`${prefix}_availability`] === "unavailable"
    && row[`${prefix}_value_quality`] === "unknown"
    && row[prefix] === null
  ) return { status: "unavailable", value: null };
  const exact = exactNumeric(row, prefix);
  return exact ? { status: "available", value: exact.value } : { status: "invalid", value: null };
}

function sourceText(calculation: Record<string, unknown>, field: string) {
  return nullableString(record(calculation[field]).text);
}

function commonStockClassification(value: unknown):
  | Readonly<{ status: "common"; title: string }>
  | Readonly<{ status: "other"; title: string }>
  | Readonly<{ status: "unavailable"; title: "" }> {
  const title = nullableString(value);
  if (!title) return { status: "unavailable", title: "" };
  const normalized = title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const common = /^(?:class [a-z0-9]+ )?common (?:stock|shares)(?: par value .*)?$/.test(normalized);
  return common ? { status: "common", title } : { status: "other", title };
}

function relationValue(value: unknown): "direct" | "indirect" | null {
  return value === "D" ? "direct" : value === "I" ? "indirect" : null;
}

function terminal(
  status: "no_match" | "ineligible",
  reasonCode: Form4PurchaseEvaluationReasonCode,
  current: CurrentOwnershipReadResult,
  settings: Form4InsiderPurchaseSettings,
  rows: readonly Form4PurchaseRowEvaluationTrace[] = [],
): Form4PurchaseEvaluation {
  return {
    status,
    reasonCode,
    trace: evaluationTrace(current, settings, status, reasonCode, rows),
  };
}

function evaluationTrace(
  current: CurrentOwnershipReadResult,
  settings: Form4InsiderPurchaseSettings,
  status: Form4PurchaseEvaluationTrace["status"],
  reasonCode: Form4PurchaseEvaluationReasonCode,
  rows: readonly Form4PurchaseRowEvaluationTrace[],
): Form4PurchaseEvaluationTrace {
  const available = current.status === "available";
  const firstRow = available ? current.rows[0] as Record<string, unknown> | undefined : undefined;
  const ticker = normalizedTicker(firstRow?.symbol) || null;
  const sourceUrl = nullableString(record(firstRow?.provenance).source_url);
  return Object.freeze({
    version: FORM4_PURCHASE_EVALUATION_TRACE_VERSION,
    settings: Object.freeze({
      target: Object.freeze({ ...settings.target }),
      role: settings.role,
      minimumShares: settings.minimumShares,
    }),
    filing: Object.freeze({
      status: available ? "available" : "unavailable",
      eventId: available ? current.eventId : null,
      accessionNumber: available ? current.accessionNumber : null,
      filingForm: available ? current.filingForm ?? null : null,
      filedAt: available ? current.filedAt ?? null : null,
      ticker,
      sourceUrl,
    }),
    status,
    reasonCode,
    rows: Object.freeze([...rows]),
  });
}

function aggregateNoMatchReason(outcomes: readonly RowOutcome[]): Form4PurchaseEvaluationReasonCode {
  if (outcomes.length > 0 && outcomes.every((outcome) => outcome.reasonCode === "minimum_shares_not_met")) {
    return "minimum_shares_not_met";
  }
  if (outcomes.length > 0 && outcomes.every((outcome) => outcome.reasonCode === "reporting_owner_role_not_met")) {
    return "reporting_owner_role_not_met";
  }
  if (outcomes.length > 0 && outcomes.every((outcome) => [
    "transaction_kind_not_supported",
    "transaction_code_not_purchase",
    "acquisition_disposition_not_acquired",
  ].includes(outcome.reasonCode))) {
    return "nonpurchase_transaction";
  }
  return "condition_not_met";
}

function conditionDecision(
  key: string,
  status: Form4PurchaseConditionDecision["status"],
  expected: string,
  actual: string | null,
): Form4PurchaseConditionDecision {
  return Object.freeze({ key, status, expected, actual });
}

function expectedRole(role: Form4InsiderRole) {
  return role === "officer_or_director" ? "officer or director" : role;
}

function ownerRoleSummary(profiles: readonly OwnerProfile[]) {
  if (profiles.length === 0) return null;
  return profiles.map((profile) => {
    const title = profile.officerTitle ? ` (${profile.officerTitle})` : "";
    return `${profile.name}: ${profile.roles.join(", ") || "role unavailable"}${title}`;
  }).join("; ");
}

function isoDate(value: unknown) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value ? null : value;
}

function timestamp(value: unknown) {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) ? value : null;
}

function officialSecUrl(value: string, accession: string) {
  try {
    const url = new URL(value);
    const archive = url.pathname.match(/^\/Archives\/edgar\/data\/\d+\/(\d{18})(?:\/|$)/i);
    return url.protocol === "https:"
      && (url.hostname.toLowerCase() === "sec.gov" || url.hostname.toLowerCase().endsWith(".sec.gov"))
      && archive?.[1] === accession.replace(/-/g, "");
  } catch {
    return false;
  }
}

function normalizedTicker(value: unknown) {
  const ticker = nullableString(value)?.toUpperCase() ?? "";
  return /^[A-Z0-9][A-Z0-9.-]{0,14}$/.test(ticker) ? ticker : "";
}

function nullableBoolean(value: unknown) {
  return typeof value === "boolean" ? value : null;
}

function stringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.length > 0)
    : [];
}

function nullableString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : "";
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function recordValue(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
