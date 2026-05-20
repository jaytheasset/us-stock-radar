import type { SecFilingAnalysisInput } from "@/lib/prompts/secFilingAnalysis";

export const SEC_OFFERING_AUDIT_PROMPT_KEY = "sec_offering_security_audit";
export const SEC_OFFERING_AUDIT_PROMPT_VERSION = "v4";

const AUDIT_CONFIDENCE_VALUES = ["high", "medium", "low", "unknown"] as const;
const AUDIT_ACTION_VALUES = ["complete", "needs_human_review", "insufficient_evidence"] as const;
const AUDIT_OFFERING_TYPE_VALUES = [
  "primary",
  "resale",
  "mixed",
  "ipo_listing",
  "shelf",
  "atm",
  "convertible_warrant_financing",
  "non_common",
  "routine_amendment",
  "unknown",
] as const;
const AUDIT_STATUS_VALUES = ["preliminary", "filed_not_effective", "effective", "closed", "amended", "unknown"] as const;
const AUDIT_UNIT_VALUES = ["shares", "usd", "usd_per_share", "percent", "text", "date", "unknown"] as const;
const AUDIT_RELATIONSHIP_VALUES = [
  "current_denominator",
  "public_float_denominator",
  "registered_pool_total",
  "included_in_registered_pool",
  "outside_current_registered_pool",
  "primary_new_issuance",
  "resale_by_selling_holder",
  "company_cash",
  "selling_holder_cash",
  "conditional_company_cash",
  "fee_table_only",
  "context_only",
  "not_disclosed",
  "unknown",
] as const;
const AUDIT_SEVERITY_VALUES = ["high", "medium", "low"] as const;

const auditFactSchema = {
  type: "object",
  additionalProperties: false,
  required: ["label", "value_text", "numeric_value", "unit", "relationship", "source", "evidence", "confidence"],
  properties: {
    label: { type: "string" },
    value_text: { type: ["string", "null"] },
    numeric_value: { type: ["number", "null"] },
    unit: { type: "string", enum: AUDIT_UNIT_VALUES },
    relationship: { type: "string", enum: AUDIT_RELATIONSHIP_VALUES },
    source: { type: ["string", "null"] },
    evidence: { type: ["string", "null"] },
    confidence: { type: "string", enum: AUDIT_CONFIDENCE_VALUES },
  },
} as const;

const auditTermSchema = {
  type: "object",
  additionalProperties: false,
  required: ["present", "value_text", "source", "evidence", "confidence"],
  properties: {
    present: { type: ["boolean", "null"] },
    value_text: { type: ["string", "null"] },
    source: { type: ["string", "null"] },
    evidence: { type: ["string", "null"] },
    confidence: { type: "string", enum: AUDIT_CONFIDENCE_VALUES },
  },
} as const;

const auditConflictSchema = {
  type: "object",
  additionalProperties: false,
  required: ["issue", "severity", "evidence"],
  properties: {
    issue: { type: "string" },
    severity: { type: "string", enum: AUDIT_SEVERITY_VALUES },
    evidence: { type: ["string", "null"] },
  },
} as const;

export const secOfferingAuditResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "audit_action",
    "offering_type",
    "registration_status",
    "security_stack",
    "proceeds_stack",
    "toxic_terms",
    "sanity_checks",
    "unresolved_conflicts",
    "source_notes",
    "confidence",
    "needs_human_review",
    "review_reasons",
  ],
  properties: {
    audit_action: { type: "string", enum: AUDIT_ACTION_VALUES },
    offering_type: { type: "string", enum: AUDIT_OFFERING_TYPE_VALUES },
    registration_status: { type: "string", enum: AUDIT_STATUS_VALUES },
    security_stack: {
      type: "object",
      additionalProperties: false,
      required: [
        "current_shares_outstanding",
        "public_float",
        "primary_common_shares_offered",
        "primary_common_shares_registered",
        "resale_selling_stockholder_shares",
        "registered_resale_supply",
        "pre_funded_warrant_underlying_shares",
        "warrant_underlying_shares",
        "common_warrant_max_registered_underlying_shares",
        "convertible_note_underlying_shares",
        "preferred_conversion_shares",
        "equity_line_registered_shares",
        "additional_future_share_overhang",
        "max_registered_stack_share_equivalent",
      ],
      properties: {
        current_shares_outstanding: auditFactSchema,
        public_float: auditFactSchema,
        primary_common_shares_offered: auditFactSchema,
        primary_common_shares_registered: auditFactSchema,
        resale_selling_stockholder_shares: auditFactSchema,
        registered_resale_supply: auditFactSchema,
        pre_funded_warrant_underlying_shares: auditFactSchema,
        warrant_underlying_shares: auditFactSchema,
        common_warrant_max_registered_underlying_shares: auditFactSchema,
        convertible_note_underlying_shares: auditFactSchema,
        preferred_conversion_shares: auditFactSchema,
        equity_line_registered_shares: auditFactSchema,
        additional_future_share_overhang: auditFactSchema,
        max_registered_stack_share_equivalent: auditFactSchema,
      },
    },
    proceeds_stack: {
      type: "object",
      additionalProperties: false,
      required: [
        "company_gross_proceeds",
        "company_net_proceeds",
        "selling_stockholder_proceeds",
        "resale_proceeds_to_company",
        "possible_warrant_exercise_proceeds",
        "fee_table_amount_only",
        "note_principal",
        "offering_price",
        "conversion_price",
        "warrant_exercise_price",
      ],
      properties: {
        company_gross_proceeds: auditFactSchema,
        company_net_proceeds: auditFactSchema,
        selling_stockholder_proceeds: auditFactSchema,
        resale_proceeds_to_company: auditFactSchema,
        possible_warrant_exercise_proceeds: auditFactSchema,
        fee_table_amount_only: auditFactSchema,
        note_principal: auditFactSchema,
        offering_price: auditFactSchema,
        conversion_price: auditFactSchema,
        warrant_exercise_price: auditFactSchema,
      },
    },
    toxic_terms: {
      type: "object",
      additionalProperties: false,
      required: [
        "best_efforts",
        "no_minimum",
        "cashless_exercise",
        "reset_or_repricing",
        "floor_price",
        "nasdaq_19_99_cap",
        "beneficial_ownership_blocker",
        "variable_price_or_atm",
      ],
      properties: {
        best_efforts: auditTermSchema,
        no_minimum: auditTermSchema,
        cashless_exercise: auditTermSchema,
        reset_or_repricing: auditTermSchema,
        floor_price: auditTermSchema,
        nasdaq_19_99_cap: auditTermSchema,
        beneficial_ownership_blocker: auditTermSchema,
        variable_price_or_atm: auditTermSchema,
      },
    },
    sanity_checks: {
      type: "object",
      additionalProperties: false,
      required: [
        "no_fee_table_amount_as_proceeds",
        "no_registered_shares_as_outstanding",
        "no_resale_as_company_financing",
        "no_double_count_units_and_components",
        "registered_pool_reconciles",
        "unresolved_number_conflict",
        "used_market_context_as_denominator_only",
      ],
      properties: {
        no_fee_table_amount_as_proceeds: { type: ["boolean", "null"] },
        no_registered_shares_as_outstanding: { type: ["boolean", "null"] },
        no_resale_as_company_financing: { type: ["boolean", "null"] },
        no_double_count_units_and_components: { type: ["boolean", "null"] },
        registered_pool_reconciles: { type: ["boolean", "null"] },
        unresolved_number_conflict: { type: ["boolean", "null"] },
        used_market_context_as_denominator_only: { type: ["boolean", "null"] },
      },
    },
    unresolved_conflicts: { type: "array", items: auditConflictSchema },
    source_notes: { type: "array", items: { type: "string" } },
    confidence: { type: "string", enum: AUDIT_CONFIDENCE_VALUES },
    needs_human_review: { type: "boolean" },
    review_reasons: { type: "array", items: { type: "string" } },
  },
} as const;

export const secOfferingAuditSystemPrompt = [
  "You are auditing SEC registration/offering numbers before any investor-facing analysis is written.",
  "Return only strict JSON matching the provided schema.",
  "Your job is numeric classification and sanity checking, not copywriting, scoring, bullish/bearish analysis, or alert policy.",
  "Use filing_package.router_evidence, component_candidates, important tables, important sections, parser_candidates, and market_context.",
  "Parser candidates and component_candidates are candidate evidence, not final truth. Use them when supported by nearby source text or table labels.",
  "Market context is denominator/context only. It is not SEC filing evidence and must not be treated as a disclosed filing number.",
  "Do not calculate dilution percentages, multiples, discounts, market-cap ratios, or alert scores.",
  "You may copy an already-normalized component_candidates total if it is source-backed and reconciles to the registered pool.",
  "You may classify which numbers belong inside a registered pool, outside the pool, company proceeds, selling-holder proceeds, fee-table-only amounts, or denominators.",
  "Registered shares are not automatically outstanding shares.",
  "Resale proceeds are not company proceeds.",
  "If the filing states the company will not receive proceeds from selling-stockholder resale, set proceeds_stack.resale_proceeds_to_company to $0 and relationship company_cash. Do not leave it null.",
  "If the company may receive proceeds only from cash warrant exercises, classify that separately as possible_warrant_exercise_proceeds or conditional_company_cash, not as resale proceeds.",
  "Filing fee table amounts are not actual issuer proceeds unless the filing separately states issuer proceeds.",
  "Do not put fee-table maximum aggregate offering amount into selling_stockholder_proceeds unless the filing separately states estimated selling-holder proceeds outside the fee table. If the only support is the fee table, keep the amount in fee_table_amount_only.",
  "Set sanity_checks.no_fee_table_amount_as_proceeds true when fee-table dollar amounts are kept only in fee_table_amount_only or context fields and are not used as company proceeds or selling-holder proceeds.",
  "Shares underlying warrants, pre-funded warrants, preferred stock, or convertibles are potential issuable shares.",
  "Do not double count units and their component securities.",
  "Do not treat Rule 415 or a base shelf as a completed sale.",
  "Do not infer specific takedown terms from a base shelf.",
  "Classify shelf filings by the current actionable mechanism, not by shelf context alone.",
  "If the filing only creates or updates shelf capacity and has no ATM agreement, no takedown supplement, no selling-holder resale pool, no priced offering, and no concrete warrant/convertible sale mechanics, classify offering_type as shelf.",
  "If a shelf registration also includes an at-the-market sales agreement, sales-agent language, or a stated ATM program size, classify offering_type as atm. Keep shelf capacity as context or fee-table capacity, not the current mechanism.",
  "If a shelf registration contains a concrete selling-stockholder resale pool, classify offering_type as resale or mixed depending on whether other active mechanisms are also present.",
  "Use mixed only when the current filing contains multiple active mechanisms or multiple security structures that must be evaluated together. Do not use mixed merely because a base shelf and a specific ATM/takedown context appear in the same package.",
  "For automatic shelf registrations, classify offering_type as shelf only when there are no concrete current sale mechanics. If concrete ATM, resale, takedown, warrant, or convertible terms are present, classify by those terms instead.",
  "Authorized capital stock, authorized shares, charter share capacity, and generic Description of Capital Stock numbers are not offering supply. Never use them in primary_common_shares_registered, registered_resale_supply, or max_registered_stack_share_equivalent.",
  "Do not use public_offering, underwritten_public_offering, or common_stock_public_offering as offering_type. This audit schema is structure-first: plain common-stock public offerings are primary, offerings with units/warrants/pre-funded warrants or multiple securities are mixed, and convertible-note/security deals are convertible_warrant_financing.",
  "If a convertible-note financing is sold by private placement, classify offering_type as convertible_warrant_financing and describe private placement only in source_notes/review context if needed.",
  "EFFECT means registration effectiveness, not completed selling.",
  "For max_registered_stack_share_equivalent, use the best single source-backed maximum share-equivalent pool that should be compared against current shares. Do not add outside/future overhang to the current registered pool.",
  "If the current registered pool states multiple share-equivalent components in the same offer, such as common shares plus shares underlying pre-funded warrants, include both in the current registered pool and set max_registered_stack_share_equivalent to the combined share-equivalent count when the components are additive and source-backed.",
  "Pre-funded warrant underlying shares are near-immediate common-share exposure. Do not drop them from max_registered_stack_share_equivalent when they are expressly registered for resale together with common shares.",
  "max_registered_stack_share_equivalent must be a share count only. If the filing only gives a dollar shelf capacity or fee-table dollar amount, set max_registered_stack_share_equivalent to null/not_disclosed and put the dollar amount in fee_table_amount_only or company proceeds as appropriate.",
  "Do not place dollar amounts, market values, fee table dollar amounts, shelf capacity dollars, authorized share counts, or outstanding-share denominator counts into any security_stack supply field.",
  "If a registered pool is explicitly broken into convertible-note shares plus warrant shares and the components reconcile to the total pool, classify those components separately and set registered_pool_reconciles true.",
  "If numbers conflict, leave the uncertain fact null, add an unresolved_conflict, and set needs_human_review true.",
  "Keep evidence snippets short, under 22 words when possible.",
].join("\n");

export function buildSecOfferingAuditPrompt(input: SecFilingAnalysisInput) {
  return {
    key: SEC_OFFERING_AUDIT_PROMPT_KEY,
    version: SEC_OFFERING_AUDIT_PROMPT_VERSION,
    system: secOfferingAuditSystemPrompt,
    user: JSON.stringify(buildSecOfferingAuditPromptInput(input)),
    responseFormat: {
      type: "json_schema",
      json_schema: {
        name: "sec_offering_security_audit",
        strict: true,
        schema: secOfferingAuditResponseSchema,
      },
    },
  };
}

function buildSecOfferingAuditPromptInput(input: SecFilingAnalysisInput) {
  const filingPackage = readRecord(input.filing_package) || {};
  const hardParsers = readRecord(filingPackage.hard_parsers) || {};
  const routerEvidence = readRecord(filingPackage.router_evidence) || {};
  const s3Evidence = readRecord(routerEvidence.s3) || {};
  const routerExcerpt = stringValue(s3Evidence.router_excerpt) || trimForPrompt(stringValue(filingPackage.llm_text), 18_000);

  return {
    filing_package: {
      package_version: filingPackage.package_version || null,
      source_group: filingPackage.source_group || null,
      source_code: filingPackage.source_code || null,
      raw_item_id: filingPackage.raw_item_id || null,
      source_unique_id: filingPackage.source_unique_id || null,
      accession_number: filingPackage.accession_number || null,
      cik: filingPackage.cik || null,
      company_name: filingPackage.company_name || null,
      primary_ticker: filingPackage.primary_ticker || null,
      form_type: filingPackage.form_type || null,
      form_family: filingPackage.form_family || null,
      filed_at: filingPackage.filed_at || null,
      filing_detail_url: filingPackage.filing_detail_url || null,
      primary_document_url: filingPackage.primary_document_url || null,
      parser_candidates: {
        warning: "Candidate extraction only. Audit must classify role and reject unsupported values.",
        s3: readRecord(hardParsers.s3) || null,
        s3_core_terms: readRecord(s3Evidence.core_terms) || null,
        amendment: readRecord(s3Evidence.amendment) || null,
      },
      router_evidence: {
        s3: {
          evidence_version: s3Evidence.evidence_version || null,
          document_fetch: s3Evidence.document_fetch || null,
          important_sections: Array.isArray(s3Evidence.important_sections) ? s3Evidence.important_sections : [],
          important_tables: readRecord(s3Evidence.important_tables) || null,
          component_candidates: readRecord(s3Evidence.component_candidates) || null,
          router_excerpt: routerExcerpt,
        },
      },
      parent_registration_context: filingPackage.parent_registration_context || null,
      market_context: filingPackage.market_context || null,
      package_stats: filingPackage.package_stats || null,
    },
  };
}

function trimForPrompt(value: string, max: number) {
  const normalized = value.replace(/\s+\n/g, "\n").replace(/\n{4,}/g, "\n\n\n").trim();
  return normalized.length > max ? `${normalized.slice(0, max - 12).trim()}\n[TRUNCATED]` : normalized;
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringValue(value: unknown) {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}
