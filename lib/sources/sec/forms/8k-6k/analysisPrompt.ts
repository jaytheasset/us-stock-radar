import {
  SEC_8K_6K_APPROVED_EVENT_TYPES,
  SEC_8K_6K_CAPITAL_FINANCING_MODE_VALUES,
  type Sec8k6kEventType,
} from "./types";
import {
  SEC_8K_6K_ROUTER_CONFIDENCE_VALUES,
  SEC_8K_6K_ROUTER_DISPLAY_TYPE_VALUES,
  type Sec8k6kRouterPromptInput,
} from "./routerPrompt";
import { buildSec8k6kDisplayPayload } from "./displayPayload";
import {
  buildSecSourceBlockPromptInput,
  type SecSourceBlockPromptInput,
} from "./sourceBlockPromptInput";
import { offeringDisplayRowSchema, shareOverhangSchema } from "../../../../ai/secOfferingOutputSchemas";
import {
  SEC_ACTIVE_OFFERING_DILUTION_ALERT_GUARDS,
  SEC_ACTIVE_OFFERING_DILUTION_SCORING_GUIDE,
} from "../common/offeringDilutionScoring";
import {
  CORPORATE_ACTION_MONITOR_ROUTING_PROMPT_INSTRUCTIONS,
  LISTING_RISK_MONITOR_ROUTING_PROMPT_INSTRUCTIONS,
  MONITOR_ROUTING_RESULT_JSON_SCHEMA,
} from "../../../../monitor/monitorRouting";

export const SEC_8K_6K_ANALYSIS_PROMPT_KEYS = {
  riskStatus: "sec_8k_6k_analysis_listing_financial_risk",
  capitalFinancing: "sec_8k_6k_analysis_financing_dilution_capital_structure",
  strategicTransaction: "sec_8k_6k_analysis_strategic_transaction",
  governanceVote: "sec_8k_6k_analysis_governance_vote_leadership",
  operatingLegalRoutine: "sec_8k_6k_analysis_operating_legal_routine",
} as const;

export const SEC_8K_6K_ANALYSIS_PROMPT_KEY = SEC_8K_6K_ANALYSIS_PROMPT_KEYS.operatingLegalRoutine;
export const SEC_8K_6K_ANALYSIS_PROMPT_VERSION = "v45-corporate-action-routing";

export const SEC_8K_6K_ANALYSIS_PROMPT_FAMILY_VALUES = [
  "risk_status",
  "capital_financing",
  "strategic_transaction",
  "governance_vote",
  "operating_legal_routine",
] as const;

export type Sec8k6kAnalysisPromptFamily = (typeof SEC_8K_6K_ANALYSIS_PROMPT_FAMILY_VALUES)[number];

export function isSec8k6kAnalysisPromptKey(value: string) {
  return Object.values(SEC_8K_6K_ANALYSIS_PROMPT_KEYS).includes(value as (typeof SEC_8K_6K_ANALYSIS_PROMPT_KEYS)[keyof typeof SEC_8K_6K_ANALYSIS_PROMPT_KEYS]);
}

export const SEC_8K_6K_ANALYSIS_CASE_VALUES = [
  "listing_risk",
  "dilution_or_offering",
  "debt_or_credit_financing",
  "ipo_listing",
  "earnings_or_results",
  "sales_or_operating_update",
  "product_or_commercial_update",
  "leadership_or_governance",
  "insider_or_control_update",
  "shareholder_vote",
  "strategic_transaction",
  "financial_distress_or_default",
  "legal_or_regulatory_risk",
  "dividend",
  "capital_return",
  "fda_or_clinical",
  "routine_amendment",
  "material_amendment",
  "other_8k_6k",
] as const;

export type Sec8k6kAnalysisPromptInput = Sec8k6kRouterPromptInput & {
  router_result: Record<string, unknown>;
  market_context?: Record<string, unknown> | null;
};

const analysisPromptFamilyByEventType: Record<Sec8k6kEventType, Sec8k6kAnalysisPromptFamily> = {
  listing_risk: "risk_status",
  financial_risk: "risk_status",
  dilution_risk: "capital_financing",
  dividends: "capital_financing",
  capital_return: "capital_financing",
  strategic_transaction: "strategic_transaction",
  ipo_listing: "strategic_transaction",
  shareholder_vote: "governance_vote",
  leadership_governance: "governance_vote",
  insider_ownership: "governance_vote",
  earnings: "operating_legal_routine",
  sales_performance: "operating_legal_routine",
  operating_update: "operating_legal_routine",
  product_update: "operating_legal_routine",
  legal_risk: "operating_legal_routine",
  fda_clinical: "operating_legal_routine",
  other: "operating_legal_routine",
};

const analysisPromptKeyByFamily: Record<Sec8k6kAnalysisPromptFamily, string> = {
  risk_status: SEC_8K_6K_ANALYSIS_PROMPT_KEYS.riskStatus,
  capital_financing: SEC_8K_6K_ANALYSIS_PROMPT_KEYS.capitalFinancing,
  strategic_transaction: SEC_8K_6K_ANALYSIS_PROMPT_KEYS.strategicTransaction,
  governance_vote: SEC_8K_6K_ANALYSIS_PROMPT_KEYS.governanceVote,
  operating_legal_routine: SEC_8K_6K_ANALYSIS_PROMPT_KEYS.operatingLegalRoutine,
};

export const SEC_8K_6K_ANALYSIS_DISPLAY_TYPE_VALUES = [
  ...SEC_8K_6K_ROUTER_DISPLAY_TYPE_VALUES,
  "strategic_transaction",
  "operating_event",
] as const;

export const sec8k6kScoreExplanationSchema = {
  type: "object",
  additionalProperties: false,
  required: ["summary"],
  properties: {
    summary: {
      type: "string",
      maxLength: 220,
      description:
        "One plain-language analyst bottom-line judgment stating the practical scoring principle, not a filing recap. Never begin with The score or mention score level/band.",
    },
  },
} as const;

export const sec8k6kAmendmentDeltaSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "is_amendment",
    "change_kind",
    "changed_fields",
    "unchanged_parent_event",
    "investor_impact",
    "parent_accession",
    "source_block_ids",
  ],
  properties: {
    is_amendment: { type: "boolean" },
    change_kind: {
      type: "string",
      enum: [
        "not_amendment",
        "clerical_correction",
        "supplemental_update",
        "material_change",
        "unable_to_compare",
      ],
    },
    changed_fields: {
      type: "array",
      maxItems: 4,
      items: { type: "string", maxLength: 80 },
    },
    unchanged_parent_event: { type: "boolean" },
    investor_impact: { type: ["string", "null"], maxLength: 180 },
    parent_accession: { type: ["string", "null"], maxLength: 24 },
    source_block_ids: { type: "array", maxItems: 8, items: { type: "string" } },
  },
} as const;

const analysisOutputSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "source_group",
    "market_scope",
    "event_type",
    "monitor_routes",
    "material_events",
    "event_title",
    "primary_ticker",
    "tickers",
    "sector",
    "industry_group",
    "theme_group",
    "sub_theme",
    "score",
    "score_reason",
    "score_explanation",
    "signal",
    "quick_take",
    "listing_status_snapshot",
    "why_it_matters",
    "bullish_points",
    "bearish_points",
    "key_evidence",
    "what_to_watch_next",
    "related_tickers",
    "calendar_items",
    "confidence",
    "needs_human_review",
    "summary",
  ],
  properties: {
    source_group: { type: "string", enum: ["filings"] },
    market_scope: { type: "string", enum: ["company", "sector", "theme", "macro"] },
    event_type: { type: "string", enum: SEC_8K_6K_APPROVED_EVENT_TYPES },
    monitor_routes: MONITOR_ROUTING_RESULT_JSON_SCHEMA.properties.monitor_routes,
    material_events: {
      type: "array",
      minItems: 1,
      maxItems: 4,
      description: "Internal analysis plan written before investor-facing prose. Include exactly one primary event and only a separate, independently decision-relevant secondary event.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["role", "event_type", "event_summary", "key_terms", "source_block_ids"],
        properties: {
          role: { type: "string", enum: ["primary", "secondary"] },
          event_type: { type: "string", enum: SEC_8K_6K_APPROVED_EVENT_TYPES },
          event_summary: { type: "string" },
          key_terms: { type: "array", maxItems: 5, items: { type: "string" } },
          source_block_ids: { type: "array", maxItems: 8, items: { type: "string" } },
        },
      },
    },
    event_title: { type: "string" },
    primary_ticker: {
      type: "object",
      additionalProperties: false,
      required: ["ticker", "exchange"],
      properties: {
        ticker: { type: ["string", "null"] },
        exchange: { type: ["string", "null"] },
      },
    },
    tickers: { type: "array", items: { type: "string" } },
    sector: { type: ["string", "null"] },
    industry_group: { type: ["string", "null"] },
    theme_group: { type: ["string", "null"] },
    sub_theme: { type: ["string", "null"] },
    score: { type: "integer", minimum: 0, maximum: 100 },
    score_reason: { type: "string" },
    score_explanation: sec8k6kScoreExplanationSchema,
    signal: { type: "string", enum: ["bullish", "bearish", "volatile", "neutral"] },
    quick_take: { type: "string" },
    listing_status_snapshot: {
      type: "array",
      maxItems: 4,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["label", "value", "note"],
        properties: {
          label: { type: "string" },
          value: { type: "string" },
          note: { type: ["string", "null"] },
        },
      },
    },
    why_it_matters: { type: "string" },
    bullish_points: { type: "array", items: { type: "string" } },
    bearish_points: { type: "array", items: { type: "string" } },
    key_evidence: {
      type: "array",
      maxItems: 3,
      description:
        "Return only the two or three strongest proof points for the central investor conclusion. Rank all candidates first, remove duplicates and lower-priority facts, and never return more than three items. Each item must be no more than 18 words.",
      items: { type: "string" },
    },
    what_to_watch_next: { type: "array", items: { type: "string" } },
    related_tickers: { type: "array", items: { type: "string" } },
    calendar_items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["label", "dateText", "evidence"],
        properties: {
          label: { type: "string" },
          dateText: { type: "string" },
          evidence: { type: "string" },
        },
      },
    },
    confidence: { type: "string", enum: SEC_8K_6K_ROUTER_CONFIDENCE_VALUES },
    needs_human_review: { type: "boolean" },
    summary: {
      type: "string",
      description: "Write this last. Synthesize every material_events primary and secondary row into a concise investor summary, preserving its strongest source-backed key terms.",
    },
  },
} as const;

export const sec8k6kSecurityInventorySchema = {
  type: "array",
  maxItems: 8,
  description:
    "Internal capital-analysis inventory written before visible output. Include every security created, issued, sold, amended, or made newly operative by the current filing event.",
  items: {
    type: "object",
    additionalProperties: false,
    required: [
      "security_name",
      "security_role",
      "display_target",
      "source_block_id",
      "instrument_details_type",
    ],
    properties: {
      security_name: { type: "string", maxLength: 96 },
      security_role: { type: "string", maxLength: 72 },
      display_target: { type: "string", maxLength: 48 },
      source_block_id: { type: "string", maxLength: 96 },
      instrument_details_type: {
        type: ["string", "null"],
        maxLength: 96,
        description:
          "Exact Type-row value used in instrument_details, or null when this security is represented only in snapshot_metrics or share_overhang.",
      },
    },
  },
} as const;

function capitalShareOverhangSchema() {
  const baseSchema = shareOverhangSchema({ requireStatusFields: true });
  const properties = baseSchema.properties;

  // Structured-output property order is the LLM's working order. Calculate rows and
  // total_note before writing the visible headline so one ratio drives every field.
  return {
    ...baseSchema,
    required: ["chart_title", "basis", "rows", "total_note", "status_label", "status_value"],
    properties: {
      chart_title: properties.chart_title,
      subtitle: properties.subtitle,
      basis: properties.basis,
      rows: properties.rows,
      total_note: properties.total_note,
      status_label: properties.status_label,
      status_value: properties.status_value,
      caption: properties.caption,
      ratio_label: properties.ratio_label,
      ratio_value: properties.ratio_value,
      note: properties.note,
    },
  };
}

export const sec8k6kAnalysisDisplayPayloadSchema = {
  type: "object",
  additionalProperties: false,
  required: ["display_type", "data", "evidence", "notes"],
  properties: {
    display_type: { type: "string", enum: SEC_8K_6K_ANALYSIS_DISPLAY_TYPE_VALUES },
    data: {
      type: "object",
      additionalProperties: true,
      properties: {
        display_version: { type: "string" },
        capital_mode: { type: "string", enum: SEC_8K_6K_CAPITAL_FINANCING_MODE_VALUES },
        snapshot_metrics: {
          type: "array",
          minItems: 4,
          maxItems: 4,
          description:
            "Visible capital snapshot. Return exactly four non-duplicative scan-first metrics.",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["label", "value", "note"],
            properties: {
              label: { type: "string", maxLength: 48 },
              value: { type: "string", maxLength: 96 },
              note: { type: ["string", "null"], maxLength: 80 },
            },
          },
        },
        share_overhang: {
          ...capitalShareOverhangSchema(),
          type: ["object", "null"],
        },
        instrument_details: {
          type: "array",
          maxItems: 35,
          description:
            "424B/S-1-compatible Instrument Details rows. Group each material security with Type first, followed by the applicable Shares / Securities, Exercise / Conversion Price, Reset / Floor, and Term / Limits rows.",
          items: {
            ...offeringDisplayRowSchema(40, 130, 80),
            additionalProperties: false,
            required: ["label", "value", "note"],
            properties: {
              label: {
                type: "string",
                enum: ["Type", "Shares / Securities", "Exercise / Conversion Price", "Reset / Floor", "Term / Limits"],
              },
              value: { type: "string", maxLength: 130 },
              note: { type: ["string", "null"], maxLength: 80 },
            },
          },
        },
        offering_details: {
          type: "array",
          maxItems: 6,
          description:
            "Existing Offering Details UI. Include only material transaction-level facts not already visible in Snapshot, Share Overhang, or Instrument Details, such as purchaser, placement agent, agreement date, closing condition, or use of proceeds.",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["label", "value", "note"],
            properties: {
              label: { type: "string", maxLength: 56 },
              value: { type: "string", maxLength: 140 },
              note: { type: ["string", "null"], maxLength: 80 },
            },
          },
        },
      },
    },
    evidence: { type: "array", items: { type: "string" } },
    notes: { type: "array", items: { type: "string" } },
  },
} as const;

type Sec8k6kFamilySchemaOptions = {
  eventTypes: readonly string[];
  analysisCases: readonly string[];
  includeListingStatusSnapshot?: boolean;
  includeKeyEvidence?: boolean;
  includeWhatToWatchNext?: boolean;
};

const runtimeAnalysisOutputBaseRequired = [
  "source_group",
  "market_scope",
  "event_type",
  "monitor_routes",
  "material_events",
  "event_title",
  "primary_ticker",
  "tickers",
  "sector",
  "industry_group",
  "theme_group",
  "sub_theme",
  "score",
  "score_reason",
  "score_explanation",
  "signal",
  "quick_take",
  "key_evidence",
  "what_to_watch_next",
  "confidence",
  "needs_human_review",
  "summary",
] as const;

function buildRuntimeAnalysisOutputSchema(options: Sec8k6kFamilySchemaOptions) {
  const required: string[] = [...runtimeAnalysisOutputBaseRequired];
  const properties: Record<string, unknown> = {
    source_group: { type: "string", enum: ["filings"] },
    market_scope: { type: "string", enum: ["company", "sector", "theme", "macro"] },
    event_type: { type: "string", enum: options.eventTypes },
    monitor_routes: MONITOR_ROUTING_RESULT_JSON_SCHEMA.properties.monitor_routes,
    material_events: {
      type: "array",
      minItems: 1,
      maxItems: 2,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["role", "event_type", "event_summary", "key_terms", "source_block_ids"],
        properties: {
          role: { type: "string", enum: ["primary", "secondary"] },
          event_type: { type: "string", enum: options.eventTypes },
          event_summary: { type: "string" },
          key_terms: { type: "array", maxItems: 4, items: { type: "string" } },
          source_block_ids: { type: "array", maxItems: 8, items: { type: "string" } },
        },
      },
    },
    event_title: { type: "string" },
    primary_ticker: {
      type: "object",
      additionalProperties: false,
      required: ["ticker", "exchange"],
      properties: {
        ticker: { type: ["string", "null"] },
        exchange: { type: ["string", "null"] },
      },
    },
    tickers: { type: "array", items: { type: "string" } },
    sector: { type: ["string", "null"] },
    industry_group: { type: ["string", "null"] },
    theme_group: { type: ["string", "null"] },
    sub_theme: { type: ["string", "null"] },
    score: { type: "integer", minimum: 0, maximum: 100 },
    score_reason: { type: "string" },
    score_explanation: sec8k6kScoreExplanationSchema,
    signal: { type: "string", enum: ["bullish", "bearish", "volatile", "neutral"] },
    quick_take: { type: "string" },
    key_evidence: {
      type: "array",
      maxItems: 3,
      description: "Return two or three strongest proof points, each no more than 18 words.",
      items: { type: "string" },
    },
    what_to_watch_next: { type: "array", maxItems: 3, items: { type: "string" } },
    confidence: { type: "string", enum: SEC_8K_6K_ROUTER_CONFIDENCE_VALUES },
    needs_human_review: { type: "boolean" },
    summary: { type: "string" },
  };

  if (options.includeKeyEvidence === false) {
    required.splice(required.indexOf("key_evidence"), 1);
    delete properties.key_evidence;
  }

  if (options.includeWhatToWatchNext === false) {
    required.splice(required.indexOf("what_to_watch_next"), 1);
    delete properties.what_to_watch_next;
  }

  if (options.includeListingStatusSnapshot) {
    required.splice(required.indexOf("quick_take") + 1, 0, "listing_status_snapshot");
    properties.listing_status_snapshot = {
      type: "array",
      minItems: 4,
      maxItems: 4,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["label", "value", "note"],
        properties: {
          label: {
            type: "string",
            maxLength: 24,
            description: "One short single-line label. Never include line breaks or repeated whitespace.",
          },
          value: {
            type: "string",
            maxLength: 55,
            description: "One short single-line value. Never include line breaks, control characters, or repeated whitespace.",
          },
          note: {
            type: ["string", "null"],
            maxLength: 80,
            description: "Optional single-line context. Never include line breaks or repeated whitespace.",
          },
        },
      },
    };
  }

  return {
    type: "object",
    additionalProperties: false,
    required,
    properties,
  } as const;
}

const snapshotMetricSchema = {
  type: "array",
  minItems: 4,
  maxItems: 4,
  items: {
    type: "object",
    additionalProperties: false,
    required: ["label", "value", "note"],
    properties: {
      label: { type: "string", maxLength: 24 },
      value: { type: "string", maxLength: 55 },
      note: { type: ["string", "null"], maxLength: 80 },
    },
  },
} as const;

const strategicTransactionDisplayPayloadSchema = {
  type: "object",
  additionalProperties: false,
  required: ["display_type", "data", "evidence", "notes"],
  properties: {
    display_type: { type: "string", enum: ["strategic_transaction"] },
    data: {
      type: "object",
      additionalProperties: false,
      required: ["display_version", "snapshot_metrics"],
      properties: {
        display_version: { type: "string", enum: ["sec_8k_6k_strategic_transaction_v1"] },
        snapshot_metrics: snapshotMetricSchema,
      },
    },
    evidence: { type: "array", maxItems: 3, items: { type: "string" } },
    notes: { type: "array", maxItems: 3, items: { type: "string" } },
  },
} as const;

const governanceEventDisplayPayloadSchema = {
  type: "object",
  additionalProperties: false,
  required: ["display_type", "data"],
  properties: {
    display_type: { type: "string", enum: ["governance_event"] },
    data: {
      type: "object",
      additionalProperties: false,
      required: ["display_version", "governance_mode", "snapshot_title", "snapshot_metrics", "key_changes"],
      properties: {
        display_version: { type: "string", enum: ["sec_8k_6k_governance_event_v1"] },
        governance_mode: {
          type: "string",
          enum: ["leadership_change", "auditor_change", "vote_result", "governance_change", "mixed"],
        },
        snapshot_title: { type: "string", maxLength: 40 },
        snapshot_metrics: snapshotMetricSchema,
        key_changes: {
          type: "array",
          minItems: 1,
          maxItems: 4,
          description: "One to four non-duplicative governance changes or vote results shown in source order.",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["title", "category", "explanation", "details"],
            properties: {
              title: { type: "string", maxLength: 80 },
              category: { type: "string", maxLength: 32 },
              explanation: { type: "string", maxLength: 150 },
              details: {
                type: "array",
                maxItems: 3,
                items: {
                  type: "object",
                  additionalProperties: false,
                  required: ["label", "value", "note"],
                  properties: {
                    label: { type: "string", maxLength: 32 },
                    value: { type: "string", maxLength: 100 },
                    note: { type: ["string", "null"], maxLength: 80 },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
} as const;

const capitalFinancingDisplayPayloadSchema = {
  type: "object",
  additionalProperties: false,
  required: ["display_type", "data", "evidence", "notes"],
  properties: {
    display_type: { type: "string", enum: ["capital_financing"] },
    data: {
      type: "object",
      additionalProperties: false,
      required: ["display_version", "capital_mode", "snapshot_metrics", "share_overhang", "instrument_details", "offering_details"],
      properties: {
        display_version: { type: "string", enum: ["sec_8k_6k_capital_financing_v1"] },
        capital_mode: { type: "string", enum: SEC_8K_6K_CAPITAL_FINANCING_MODE_VALUES },
        snapshot_metrics: snapshotMetricSchema,
        share_overhang: {
          ...capitalShareOverhangSchema(),
          type: ["object", "null"],
        },
        instrument_details: {
          type: "array",
          maxItems: 35,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["label", "value", "note"],
            properties: {
              label: {
                type: "string",
                enum: ["Type", "Shares / Securities", "Exercise / Conversion Price", "Reset / Floor", "Term / Limits"],
              },
              value: { type: "string", maxLength: 130 },
              note: { type: ["string", "null"], maxLength: 80 },
            },
          },
        },
        offering_details: {
          type: "array",
          maxItems: 6,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["label", "value", "note"],
            properties: {
              label: { type: "string", maxLength: 56 },
              value: { type: "string", maxLength: 140 },
              note: { type: ["string", "null"], maxLength: 80 },
            },
          },
        },
      },
    },
    evidence: { type: "array", maxItems: 3, items: { type: "string" } },
    notes: { type: "array", maxItems: 3, items: { type: "string" } },
  },
} as const;

const operatingPerformanceComparisonsSchema = {
  type: "array",
  maxItems: 3,
  description: "Never return more than three items.",
  items: {
    type: "object",
    additionalProperties: false,
    required: [
      "label",
      "current_label",
      "current_value",
      "current_numeric",
      "comparison_label",
      "comparison_value",
      "comparison_numeric",
      "comparison_basis",
      "change_note",
    ],
    properties: {
      label: { type: "string", maxLength: 32 },
      current_label: { type: "string", maxLength: 20 },
      current_value: { type: "string", maxLength: 32 },
      current_numeric: { type: "number" },
      comparison_label: { type: "string", maxLength: 20 },
      comparison_value: { type: "string", maxLength: 32 },
      comparison_numeric: { type: "number" },
      comparison_basis: { type: "string", enum: ["yoy", "qoq", "other"] },
      change_note: { type: ["string", "null"], maxLength: 40 },
    },
  },
} as const;

const operatingEventDisplayPayloadSchema = {
  type: "object",
  additionalProperties: false,
  required: ["display_type", "data"],
  properties: {
    display_type: { type: "string", enum: ["operating_event"] },
    data: {
      type: "object",
      additionalProperties: false,
      required: [
        "display_version",
        "operating_mode",
        "performance_comparisons",
        "regulatory_stage",
        "snapshot_title",
        "snapshot_metrics",
        "guidance_metrics",
        "business_catalysts",
      ],
      properties: {
        display_version: { type: "string", enum: ["sec_8k_6k_operating_event_v1"] },
        operating_mode: {
          type: "string",
          enum: ["earnings", "operating_update", "product_or_regulatory", "legal_or_accounting", "routine_archive"],
        },
        performance_comparisons: operatingPerformanceComparisonsSchema,
        regulatory_stage: {
          type: "string",
          enum: [
            "not_applicable",
            "ind_or_clinical_hold",
            "application_review",
            "advisory_committee",
            "approval",
            "crl_or_appeal",
            "clinical_update",
            "other_regulatory",
          ],
        },
        snapshot_title: {
          type: "string",
          enum: ["Earnings Snapshot", "Operating Snapshot", "Product / Regulatory Snapshot", "Legal / Accounting Snapshot", "Event Snapshot"],
        },
        snapshot_metrics: {
          type: "array",
          maxItems: 4,
          description: "Never return more than four items.",
          items: snapshotMetricSchema.items,
        },
        guidance_metrics: {
          type: "array",
          description: "Never return more than three items.",
          items: {
            type: "object",
            additionalProperties: false,
            required: [
              "label",
              "guidance_label",
              "guidance_value",
              "guidance_kind",
              "guidance_low_numeric",
              "guidance_high_numeric",
              "performance_relationship",
              "performance_label",
              "note",
            ],
            properties: {
              label: { type: "string", maxLength: 32 },
              guidance_label: { type: "string", maxLength: 20 },
              guidance_value: { type: "string", maxLength: 40 },
              guidance_kind: { type: "string", enum: ["numeric_range", "point", "qualitative"] },
              guidance_low_numeric: { type: ["number", "null"] },
              guidance_high_numeric: { type: ["number", "null"] },
              performance_relationship: {
                type: "string",
                enum: ["same_basis", "related_different_basis", "standalone"],
              },
              performance_label: { type: ["string", "null"], maxLength: 32 },
              note: { type: ["string", "null"], maxLength: 80 },
            },
          },
        },
        business_catalysts: {
          type: "array",
          maxItems: 3,
          description: "Never return more than three items.",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["title", "value", "summary"],
            properties: {
              title: { type: "string", maxLength: 72 },
              value: { type: ["string", "null"], maxLength: 55 },
              summary: { type: "string", maxLength: 120 },
            },
          },
        },
        detail_sections: {
          type: "array",
          maxItems: 2,
          description: "Never return more than two items. Omit this property for earnings.",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["title", "rows"],
            properties: {
              title: { type: "string", maxLength: 40 },
              rows: {
                type: "array",
                maxItems: 5,
                items: {
                  type: "object",
                  additionalProperties: false,
                  required: ["label", "value", "note"],
                  properties: {
                    label: { type: "string", maxLength: 48 },
                    value: { type: "string", maxLength: 100 },
                    note: { type: ["string", "null"], maxLength: 80 },
                  },
                },
              },
            },
          },
        },
        secondary_updates: {
          type: "array",
          maxItems: 1,
          description: "Never return more than one item. Omit this property when no separate material event exists.",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["label", "title", "summary"],
            properties: {
              label: { type: "string", maxLength: 24 },
              title: { type: "string", maxLength: 80 },
              summary: { type: "string", maxLength: 120 },
            },
          },
        },
      },
    },
  },
} as const;

function buildFamilyRuntimeResponseSchema(
  analysisOutput: ReturnType<typeof buildRuntimeAnalysisOutputSchema>,
  analysisCases: readonly string[],
  options: {
    securityInventory?: boolean;
    displayPayload?: Record<string, unknown>;
    displayPayloadFirst?: boolean;
  } = {},
) {
  const required = ["amendment_delta"];
  const properties: Record<string, unknown> = {
    amendment_delta: sec8k6kAmendmentDeltaSchema,
  };

  if (options.displayPayload && options.displayPayloadFirst) {
    required.push("display_payload");
    properties.display_payload = options.displayPayload;
  }
  if (options.securityInventory) {
    required.push("security_inventory");
    properties.security_inventory = sec8k6kSecurityInventorySchema;
  }

  required.push("analysis_output", "analysis_case", "source_blocks_used");
  Object.assign(properties, {
    analysis_output: analysisOutput,
    analysis_case: { type: "string", enum: analysisCases },
    source_blocks_used: { type: "array", maxItems: 12, items: { type: "string" } },
  });

  if (options.displayPayload && !options.displayPayloadFirst) {
    required.push("display_payload");
    properties.display_payload = options.displayPayload;
  }

  return {
    type: "object",
    additionalProperties: false,
    required,
    properties,
  } as const;
}

const riskStatusRuntimeResponseSchema = buildFamilyRuntimeResponseSchema(
  buildRuntimeAnalysisOutputSchema({
    eventTypes: ["listing_risk", "financial_risk", "legal_risk", "other"],
    analysisCases: ["listing_risk", "financial_distress_or_default", "legal_or_regulatory_risk", "other_8k_6k"],
    includeListingStatusSnapshot: true,
  }),
  ["listing_risk", "financial_distress_or_default", "legal_or_regulatory_risk", "other_8k_6k"],
);

const capitalFinancingRuntimeResponseSchema = buildFamilyRuntimeResponseSchema(
  buildRuntimeAnalysisOutputSchema({
    eventTypes: ["dilution_risk", "financial_risk", "dividends", "capital_return", "other"],
    analysisCases: [
      "dilution_or_offering",
      "debt_or_credit_financing",
      "financial_distress_or_default",
      "dividend",
      "capital_return",
      "other_8k_6k",
    ],
    includeKeyEvidence: false,
    includeWhatToWatchNext: false,
  }),
  [
    "dilution_or_offering",
    "debt_or_credit_financing",
    "financial_distress_or_default",
    "dividend",
    "capital_return",
    "other_8k_6k",
  ],
  {
    securityInventory: true,
    displayPayload: capitalFinancingDisplayPayloadSchema,
  },
);

const strategicTransactionRuntimeResponseSchema = buildFamilyRuntimeResponseSchema(
  buildRuntimeAnalysisOutputSchema({
    eventTypes: ["strategic_transaction", "ipo_listing", "financial_risk", "other"],
    analysisCases: ["strategic_transaction", "ipo_listing", "financial_distress_or_default", "other_8k_6k"],
  }),
  ["strategic_transaction", "ipo_listing", "financial_distress_or_default", "other_8k_6k"],
  {
    displayPayload: strategicTransactionDisplayPayloadSchema,
  },
);

const governanceVoteRuntimeResponseSchema = buildFamilyRuntimeResponseSchema(
  buildRuntimeAnalysisOutputSchema({
    eventTypes: ["leadership_governance", "shareholder_vote", "insider_ownership", "other"],
    analysisCases: ["leadership_or_governance", "shareholder_vote", "insider_or_control_update", "other_8k_6k"],
    includeKeyEvidence: false,
    includeWhatToWatchNext: false,
  }),
  ["leadership_or_governance", "shareholder_vote", "insider_or_control_update", "other_8k_6k"],
  {
    displayPayload: governanceEventDisplayPayloadSchema,
    displayPayloadFirst: true,
  },
);

const operatingLegalRoutineRuntimeResponseSchema = buildFamilyRuntimeResponseSchema(
  buildRuntimeAnalysisOutputSchema({
    eventTypes: [
      "earnings",
      "sales_performance",
      "operating_update",
      "product_update",
      "fda_clinical",
      "legal_risk",
      "leadership_governance",
      "financial_risk",
      "other",
    ],
    analysisCases: [
      "earnings_or_results",
      "sales_or_operating_update",
      "product_or_commercial_update",
      "fda_or_clinical",
      "legal_or_regulatory_risk",
      "leadership_or_governance",
      "routine_amendment",
      "material_amendment",
      "financial_distress_or_default",
      "other_8k_6k",
    ],
    includeKeyEvidence: false,
    includeWhatToWatchNext: false,
  }),
  [
    "earnings_or_results",
    "sales_or_operating_update",
    "product_or_commercial_update",
    "fda_or_clinical",
    "legal_or_regulatory_risk",
    "leadership_or_governance",
    "routine_amendment",
    "material_amendment",
    "financial_distress_or_default",
    "other_8k_6k",
  ],
  {
    displayPayload: operatingEventDisplayPayloadSchema,
    displayPayloadFirst: true,
  },
);

export function getSec8k6kSpecializedRuntimeResponseSchema(family: Sec8k6kAnalysisPromptFamily) {
  if (family === "risk_status") return riskStatusRuntimeResponseSchema;
  if (family === "capital_financing") return capitalFinancingRuntimeResponseSchema;
  if (family === "strategic_transaction") return strategicTransactionRuntimeResponseSchema;
  if (family === "governance_vote") return governanceVoteRuntimeResponseSchema;
  if (family === "operating_legal_routine") return operatingLegalRoutineRuntimeResponseSchema;
  return null;
}

export const sec8k6kAnalysisResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "amendment_delta",
    "security_inventory",
    "analysis_output",
    "display_payload",
    "analysis_case",
    "source_form_scope",
    "source_blocks_used",
    "router",
    "market_context",
  ],
  properties: {
    amendment_delta: sec8k6kAmendmentDeltaSchema,
    security_inventory: sec8k6kSecurityInventorySchema,
    analysis_output: analysisOutputSchema,
    display_payload: sec8k6kAnalysisDisplayPayloadSchema,
    analysis_case: { type: "string", enum: SEC_8K_6K_ANALYSIS_CASE_VALUES },
    source_form_scope: { type: "string", enum: ["8-K / 6-K, 8-K/A / 6-K/A"] },
    source_blocks_used: { type: "array", items: { type: "string" } },
    router: { type: "object", additionalProperties: true },
    market_context: { type: ["object", "null"], additionalProperties: true },
  },
} as const;

export const sec8k6kAnalysisSystemPrompt = [
  "SECTION: Scope and evidence.",
  "Analyze one SEC 8-K / 6-K, 8-K/A / 6-K/A filing and return only strict JSON matching the provided schema.",
  "Base conclusions first on the complete original cleaned_source_blocks in the analysis source bundle, then on explicitly linked related filing context, parent filing context, and site market context source blocks when provided.",
  "Explicitly linked related filing context comes from previously analyzed SEC filings named by the current filing. Keep the current filing's original source blocks authoritative for what changed now. When related_filing_source_block contains the original text of the expressly referenced filing, use it to recover concrete terms, quantities, instrument mechanics, or transaction history that the current filing incorporates or refers to. Do not treat a related analysis summary alone as proof of a term.",
  "For 8-K/A and 6-K/A, parent_filing_context and amendment-lifecycle related_filing_context provide compact prior analyses. Historical original source blocks are normally withheld from the first analysis and may be supplied only to a bounded validator repair when a warning requires exact comparison. The current filing's original blocks remain authoritative for the present amendment.",
  "Write the amendment analysis around the delta: what is newly added, corrected, confirmed, removed, or made more certain by the current amendment. Use compact prior analyses as background, do not invent an exact historical term that is absent from current original blocks, and do not present unchanged original terms as newly announced facts.",
  "Write root amendment_delta before visible analysis fields. For a non-amendment, return is_amendment=false, change_kind=not_amendment, empty changed_fields and source_block_ids, unchanged_parent_event=false, and null investor_impact and parent_accession.",
  "For an 8-K/A or 6-K/A, use amendment_delta to classify only the present delta. Use clerical_correction for an identifier, date, name, caption, formatting, typographical, or filing-description correction that does not change economic, legal, operational, voting, listing, or transaction substance. Use supplemental_update for new context that matters but does not replace the parent event. Use material_change only when the amendment changes an investor-relevant term, state, amount, obligation, outcome, or risk. Use unable_to_compare when the compact prior analysis is insufficient.",
  "A clerical_correction must not repeat or rescore the unchanged parent event. Use event_type other, neutral signal, an archive-level score below 50, and a short amendment-only summary. Do not create a rich risk, capital, strategic, governance, or operating snapshot for the unchanged parent event.",
  "Reason from the complete original source-block bundle first. Do not rely on router summaries as evidence when the original source blocks provide the fact.",
  "Keep every scalar JSON string compact and readable. Do not place newline characters, blank-line padding, repeated whitespace, or repeated control characters inside labels, values, notes, titles, summaries, or explanations.",
  "The complete source-block bundle preserves original context: item sections, exhibit sections, press-release bodies, agreement sections, and vote/result tables. Extracted dates, amounts, share counts, rule numbers, exchange names, security names, and keyword hits are parser/debug metadata only, not analysis evidence.",
  "Full raw SEC text, XML, HTML, complete attachment text, parser facts, parser signals, parser route hints, and parser-generated event/display labels are intentionally excluded from the prompt. Do not assume missing exhibit text.",
  "Do not invent amounts, dates, tickers, terms, financial metrics, market reaction, management names, or event causes that are not present in cleaned_source_blocks or supplied context blocks.",
  "If the complete source-block bundle is insufficient, state the uncertainty in the relevant output fields instead of filling gaps with plausible assumptions. Use broader context only when it is explicitly supplied.",
  "If parser warnings indicate PDF, graphic, binary, truncated, or missing attachment text, reflect uncertainty when relevant; do not treat a parser warning as negative news by itself.",
  "Distinguish filed versus furnished only when cleaned_source_blocks support it. For 8-K and 8-K/A, use Item numbers, Item excerpts, linked exhibit references, and exhibit source blocks. For 6-K and 6-K/A, do not expect 8-K Item numbers; use the wrapper, meaningful exhibits, and exhibit role hints instead.",
  "For 6-K Exhibit 99.1 filings, use the exhibit headline, source, and body blocks as primary evidence and do not rely on missing 8-K item codes.",
  "SECTION: Route and event judgment.",
  "The router result is routing context only. router_result.event_type, primary_route_candidate, and route_candidates are candidate routes, not final classifications.",
  "You may correct or override the router candidate route when the complete original source blocks support a different conclusion.",
  "Determine the final analysis_output.event_type from the complete original source blocks. Use exactly one approved event_type and do not copy router_result.event_type blindly.",
  LISTING_RISK_MONITOR_ROUTING_PROMPT_INSTRUCTIONS,
  CORPORATE_ACTION_MONITOR_ROUTING_PROMPT_INSTRUCTIONS,
  "For SEC current reports, decide analysis_output.monitor_routes from the complete original source blocks. Preserve primary_route_candidate, route_candidates, and material_events for their existing purposes; never convert or copy any of them into monitor_routes.",
  "Use exactly one approved event_type: listing_risk, dilution_risk, ipo_listing, earnings, sales_performance, operating_update, product_update, leadership_governance, insider_ownership, shareholder_vote, strategic_transaction, financial_risk, legal_risk, dividends, capital_return, fda_clinical, or other.",
  "Populate material_events before event_title, quick_take, score_reason, score_explanation, or summary. material_events is an internal analysis plan, not visible UI copy.",
  "material_events must contain exactly one role=primary row whose event_type matches analysis_output.event_type. Add a role=secondary only for a separate new event that would independently warrant its own investor conclusion. Do not create a secondary row for a term, use of proceeds, condition, rationale, background fact, procedural cleanup, or consequence of the primary event.",
  "For each material_events row, event_summary states what changed, key_terms preserves the strongest concrete source-backed terms, and source_block_ids cites only block_id values actually present in analysis_source_bundle.",
  "After material_events is complete, write summary last. Summary must cover every primary and secondary material_events row and preserve the strongest key_terms; do not silently drop a row from the prose.",
  "Infer lifecycle from source-backed language when relevant: new event, update, closing, termination, procedural follow-up, or routine/non-material. When one primary event is required, preserve secondary facts in summary or why_it_matters first. Use key_evidence only when a fact is one of the two or three core proof points for the investor conclusion.",
  "For a multi-route filing, inspect the complete original source-block bundle before writing. Preserve a source-backed term, use of proceeds, condition, rationale, or consequence of the primary event in its primary analysis; it does not become a separate material_events row merely because it is important. Preserve a genuine separate event in summary when independently material. Put a fact in key_evidence only when it is indispensable to proving the central investor conclusion.",
  "For analysis_prompt_family=capital_financing, populate root security_inventory before display_payload or analysis_output. For every other family, return an empty security_inventory array.",
  "security_inventory is an internal completeness plan, not visible UI copy. Inventory every security created, issued, sold, amended, or made newly operative by the current filing event before deciding which transaction is primary. Do not inventory historical securities or background capitalization.",
  "Use one security_inventory row per economically distinct family or series. Keep series separate when price, conversion formula, reset or floor, expiry, exercisability, ownership limits, or other material economics differ. Include plain common stock or ADSs in the inventory even when they will be omitted from Instrument Details.",
  "Every security_inventory row must cite one current original source_block_id or one expressly linked related_filing_source_block block_id and one primary visible display_target. For any warrant, pre-funded warrant, convertible, preferred security, unit, right, note, or other security with distinct mechanics, set display_target to instrument_details and set instrument_details_type to the exact Type value later written in instrument_details. Exception: for an approval-only capital action where neither current source blocks nor expressly linked related_filing_source_block text provides material economics, set display_target to snapshot_metrics and instrument_details_type to null. Do not invent a Type group from an unlinked filing, an analysis summary, or unsupported background.",
  "A shareholder vote is a filing mechanism, not automatically the primary investor event. For a vote approving a merger, acquisition, tender, business combination, or comparable deal, use strategic_transaction as the final event type. For a vote approving share issuance, warrant or convertible changes, financing capacity, a reverse split, authorized shares, or another capital action, use dilution_risk as the final event type. Use shareholder_vote only for governance-focused vote outcomes. For merger closing 8-Ks with delisting, trading suspension, or Form 25 language, strategic_transaction is usually primary and listing language is procedural context unless separate exchange noncompliance is source-backed.",
  "For ipo_listing, use supplied display_payload.data.ipo_kind when present. Do not split traditional IPO and SPAC IPO into separate event types. For SPAC/de-SPAC transaction status filings, use supplied spac_transaction_status only when the source supports an actual target or deal status.",
  "Treat 8-K/A and 6-K/A as updates. Compare current original blocks with supplied compact parent and prior-amendment analyses, then score the incremental investor impact of the present change. Exact historical source text is reserved for warning repair. Routine amendment cases should stay below 50 unless changed content is independently material.",
  "SECTION: Investor analysis and scoring.",
  "Do analysis, not just recap. Connect source-backed facts to the practical investor consequence: trading access, liquidity, capital supply, dilution, cash need, debt pressure, control, transaction uncertainty, operating outlook, or regulatory risk.",
  "Give a clear source-backed investor judgment when the facts support one. Explain whether the event increases risk or pressure, improves the outlook, removes uncertainty, or has offsetting effects. Neutral is not the default when the evidence supports a directional conclusion.",
  "The analysis may state an opinion, warning, or investor read-through. Separate that judgment from disclosed facts, explain its source-backed basis, and do not infer hidden intent, undisclosed risk, fraud, management motive, or a market reaction.",
  "router_result.score is an archive-gate score only, not the final analysis_output.score. If router_result.analysis_needed is true, calculate analysis_output.score independently from selected cleaned_source_blocks, investor relevance, immediacy, and source-backed evidence. Do not copy router_result.score into analysis_output.score for analysis-needed cases.",
  "Score by investor relevance and immediacy: below 50 is archive, 50 to 74 is feed, and 75 or above is alert. Delivery is derived downstream from analysis_output.score and must not be chosen freely.",
  "Archive short-circuit cases are different: when router_result.analysis_needed is false and router_result.score is below 50, runtime may persist archive output using the router score without calling the analysis LLM.",
  "score_reason and score_explanation.summary are visible investor-facing score rationales. Write each as one plain-language analyst-style conclusion of 12-24 words. Keep both fields aligned to the same scoring principle.",
  "For both fields, write an analyst's bottom-line judgment, not a filing summary. Start directly from the practical investor driver or scoring principle, not an issuer action, disclosed fact list, transaction mechanic, or form description.",
  "Use only the strongest one or two score drivers and one material offset when that offset explains the rating. Do not force every disclosed fact into the rationale.",
  "Neither field may begin with The score, This score, Impact score, the issuer name, ticker, form type, or filing-action verbs such as filed, announced, disclosed, entered into, or amended.",
  "Do not mention the score, score level, score band, rating process, parser, router, or internal classification. Do not use phrases such as the score is high because, warrants a high score, or falls in the alert range.",
  "Do not reuse the opening structure or sentence from quick_take or summary. Avoid dollar amounts or percentages when the scale is already visible in Snapshot, Performance, Overhang, or transaction terms.",
  "SECTION: Writing and output fields.",
  "Writing style: Use plain investor language. Rewrite SEC/legal phrasing into clear, simple wording without changing the meaning. Do not copy filing jargon when a simpler phrase is possible. Keep each point self-contained and easy to understand. Avoid legalistic fragments, copied definitions, and sentence pieces that only make sense inside the original filing.",
  "Write like a direct explanation to a smart retail investor. A first-time reader should understand the investor consequence without decoding SEC terminology.",
  "Keep distinct disclosure dimensions separate. Do not present one fact as an exception, condition, cause, or explanation of another unless the original source explicitly connects them. Preserve procedural state exactly: proposed, approved, conditionally approved, engaged, effective, and completed are not interchangeable. Each label must match the source-backed state, and each note may qualify only its own labeled value.",
  "event_title should name the actual event or outcome, not merely say that a company filed an 8-K or 6-K.",
  "quick_take is one short investor-facing sentence about the central change. summary is 2-4 sentences that explain the source-backed facts and their practical consequence. Do not repeat the same opening or same sentence across quick_take and summary.",
  "why_it_matters is one direct investor consequence, not a restatement of the filing or a generic claim that the disclosure is important.",
  "Use bullish_points and bearish_points only for distinct, source-backed directional facts. Use fewer items, or empty arrays, when the filing does not support them. Do not repeat the same fact across bullish_points, bearish_points, key_evidence, summary, and why_it_matters.",
  "For response schemas that include key_evidence, use it as a compact proof set, not a second summary or a list of every material term. First rank all candidate facts by how directly they prove the central investor conclusion, then keep only the strongest two or three; use fewer only when the filing genuinely supports fewer core facts. Never return four or more key_evidence items. Each item must be no more than 18 words. Do not repeat the summary, quick_take, snapshot, score rationale, or why_it_matters. Do not copy long legal passages, full exhibit text, procedural background, or parser labels. The capital_financing response schema intentionally omits key_evidence because its Snapshot, Share Overhang, Instrument Details, and Offering Details are the visible evidence. what_to_watch_next should contain zero to three concrete next events, not generic instructions to monitor the company or read the filing.",
  "For archive-score filings, do not manufacture bullish_points, bearish_points, or what_to_watch_next. Keep those arrays empty when the source filing does not support them.",
  "SECTION: UI contract.",
  "The supplied display_payload is parser-built source/debug context, not a final UI decision. For families without a specialized response schema, return it unchanged and do not invent a display type or detail UI version.",
  "For analysis_prompt_family=capital_financing, you must author the final display_payload from the complete original source-block bundle. Set display_type=capital_financing and data.display_version=sec_8k_6k_capital_financing_v1. Do not copy parser-built offering_terms, extracted-value lists, or parser labels into the visible model.",
  "For capital_financing, choose exactly one data.capital_mode: equity_issuance, share_linked_financing, atm_capacity, debt_liquidity, capital_structure_action, or capital_return. Write exactly four non-duplicative LLM-chosen snapshot_metrics using short investor-facing labels, values, and optional notes.",
  "For analysis_prompt_family=strategic_transaction, you must author the final display_payload from the complete original source-block bundle. Set display_type=strategic_transaction and data.display_version=sec_8k_6k_strategic_transaction_v1. Do not copy parser-built generic labels, extracted-value lists, or parser labels into the visible model.",
  "For strategic_transaction, write exactly four non-duplicative data.snapshot_metrics rows with short labels, values, and optional notes. Use only source-backed facts. Prefer Transaction Status, Acquirer, Target / Asset, Consideration, Vote / Tender Result, Closing Condition, Trading Status, Expected Listing, or Termination Fee when they fit; otherwise create a short plain-English label. Do not use Not disclosed unless the absence itself is material.",
  "For analysis_prompt_family=governance_vote, author display_payload from the complete original source-block bundle. Set display_type=governance_event and data.display_version=sec_8k_6k_governance_event_v1. Complete governance_mode, snapshot_metrics, and key_changes before writing investor prose.",
  "For analysis_prompt_family=operating_legal_routine, author display_payload from the complete original source-block bundle. Set display_type=operating_event and data.display_version=sec_8k_6k_operating_event_v1. Complete snapshot_metrics, detail_sections, and secondary_updates before writing investor prose.",
  "For equity_issuance or share_linked_financing, add data.share_overhang only when the original source blocks provide compatible current-share basis and included supply values. Do not derive shares from a dollar cap, assumed price, fee-table value, market price, or parser extraction. Otherwise set share_overhang to null.",
  "capital_mode describes the transaction structure, not the measurement unit. atm_capacity means the security is sold through an ATM-style program; determine separately whether the controlling current capacity is source-stated in fixed shares or dollars.",
  "For debt_liquidity, capital_structure_action, and capital_return, set share_overhang to null unless the filing itself provides a directly comparable, source-backed share-supply basis. Use only material non-duplicative Offering Details rows and Instrument Details rows; use empty arrays when no row belongs there. A meeting date, shareholder approval status, exchange-rule purpose, or a referenced agreement date is not an Offering Details row.",
  "Capital snapshot and detail labels are chosen by the analysis LLM. The UI only renders the returned labels and values; do not encode parser classifications or boilerplate labels in the payload.",
  "For archive-score filings, use display_payload.display_type generic and put compact archive handoff fields in display_payload.data when available: archive_summary, archive_reason, source_url, source_availability_note, selected_source_snippets, selected_tables, and attachment_inventory. Do not put full raw text, XML, or complete attachment text in display_payload.",
].join("\n");

export const sec8k6kListingFinancialRiskPrompt = [
  "SECTION: Listing / Financial Risk analysis room.",
  "Use this room for exchange listing deficiencies, compliance notices, delisting determinations, trading suspensions, appeal or hearing updates, Form 25-NSE references, bankruptcy, going-concern warnings, liquidity crises, covenant breaches, defaults, debt acceleration, forbearance, restructuring, receivership, or similar financial stress.",
  "SECTION: Choose the primary event.",
  "Classify the main new fact in the current filing, not the most alarming background fact. If this filing newly reports an exchange notice, suspension, delisting determination, appeal result, or compliance change, listing_risk is usually primary even when bankruptcy or weak finances caused it.",
  "If this filing newly reports a bankruptcy filing, covenant breach, payment default, acceleration, forbearance, going-concern warning, liquidity shortfall, restructuring, or receivership, financial_risk is usually primary; any expected delisting is secondary context unless the filing also reports a new exchange action.",
  "Separate cause from consequence in the analysis. State which disclosed condition caused the event and what changed for common shareholders as a result.",
  "Do not add separate score premiums for the same underlying problem. Bankruptcy causing an exchange suspension is one connected risk sequence, not two independent alerts.",
  "A completed merger, acquisition, share exchange, cash-out, de-SPAC transition, unit separation, security substitution, or ticker transition may mechanically remove or suspend an old security. When the original source blocks show transaction cleanup rather than exchange noncompliance, override this room and use strategic_transaction or ipo_listing as appropriate.",
  "A move from one exchange to another with continued trading is not automatically listing_risk. A ticker, CUSIP, venue, or registration change without reduced trading access is usually procedural context.",
  "SECTION: Listing status analysis.",
  "For listing events, identify the affected security and exchange, the exact status change, the source-backed reason, cure period, compliance deadline, hearing or appeal status, trading suspension date, removal date, company response, continued trading venue, and expected Form 25-NSE only when disclosed.",
  "Keep notice date, suspension date, removal date, and appeal deadline distinct. Do not infer one date from another or turn a reference to a prior event into the current filing date.",
  "A deficiency notice with an available cure period means the listing remains active but under pressure. A delisting determination, failed cure, denied appeal, imminent suspension, or no-appeal decision means the risk is active and more immediate.",
  "Do not say OTC trading will occur unless the source or supplied context identifies a continued venue. If a continued venue is unknown, state that trading access after suspension is uncertain.",
  "Listing-risk scoring guide:",
  "- Regained compliance, resolved deficiency, or continued listing approval with no unresolved material condition: usually 45-64; signal neutral or bullish when the source supports reduced risk.",
  "- Initial minimum-bid or other continued-listing deficiency with a meaningful cure period and no suspension date: usually 68-78. Use 75+ when common equity or ADS listing pressure is active, a reverse split is likely required, or the issuer is already under repeated compliance pressure.",
  "- Reverse split implementation or authorization tied to maintaining the listing: usually 75-84. Treat the listing pressure as the score driver, not the mechanical reduction in share count.",
  "- Delisting determination with appeal or hearing still available and trading not yet suspended: usually 78-88, depending on deadline proximity, grounds, and likelihood of continued trading.",
  "- Trading suspension scheduled or active, appeal waived or denied, cure period exhausted, or Form 25-NSE expected because of exchange noncompliance: usually 85-95 and bearish.",
  "- Exchange action tied to bankruptcy, insolvency, public-interest concerns, or severe financial distress: usually 90-97 when suspension or removal is active or imminent.",
  "- Procedural removal after a completed merger, acquisition, cash-out, security substitution, unit separation, or successor listing: usually 35-64 and not bearish by default; use the substantive transaction event instead of listing_risk.",
  "Reserve 90+ for source-backed extreme states such as active or imminent trading suspension with no effective appeal path, bankruptcy-linked delisting, or loss of common-equity trading access. Do not use 90+ for a routine deficiency notice with a live cure period.",
  "SECTION: Financial stress analysis.",
  "For financial-risk events, explain the immediate obligation or constraint, available cash or liquidity when disclosed, maturity or payment timing, covenant or default status, waiver or forbearance terms, creditor remedies, restructuring stage, and what remains uncertain for common shareholders.",
  "When listing_risk is primary and financial_risk is a secondary route with a new operative loan, default, waiver, forbearance, or creditor obligation, reserve one summary sentence for that financial event. Include the strongest source-backed economic terms such as principal, interest rate, material fee, or near-term funding limit; do not let the listing timeline consume the entire summary.",
  "Distinguish a warning from an operative event: going-concern language is not the same as a payment default; a covenant breach is not the same as acceleration; waiver negotiations are not a completed waiver; Chapter 11 is not liquidation; and restructuring discussions are not a confirmed restructuring plan.",
  "Do not infer that common equity will be cancelled or become worthless unless a source-backed plan, court filing, liquidation, or explicit statement supports that conclusion. Bankruptcy can still justify a severe warning because recovery for existing shareholders is highly uncertain.",
  "Financial-risk scoring guide:",
  "- General risk-factor language, ordinary debt disclosure, or historical stress with no new operative change: usually 20-49 and often archive.",
  "- Going-concern warning, material cash-runway concern, near-term financing need, or meaningful liquidity uncertainty without a present default: usually 65-79.",
  "- Covenant breach with a completed waiver or adequate cure and no acceleration: usually 60-74; explain the offset and remaining restrictions.",
  "- Covenant breach without a waiver, default notice, forbearance dependence, missed payment, or material debt becoming currently due: usually 75-88.",
  "- Debt acceleration, enforcement rights, foreclosure risk, inability to meet obligations, failed financing needed for survival, or imminent restructuring pressure: usually 85-94.",
  "- Chapter 11 filing, involuntary bankruptcy, receivership, liquidation, or a source-backed plan that places existing common equity at severe recovery risk: usually 90-98.",
  "- A completed refinancing, waiver, capital raise, or restructuring step that materially removes an immediate default or liquidity threat can score 55-75 with neutral or bullish signal, while clearly describing dilution, added debt, or remaining conditions.",
  "Do not stack every disclosed weakness as a separate score modifier. Choose a base range from the most advanced source-backed stage, then adjust modestly for immediacy, common-shareholder exposure, available cure or waiver, and unresolved trading or recovery uncertainty.",
  "SECTION: Investor-facing output.",
  "event_title should state the operative change and, when essential, its cause: for example, a scheduled Nasdaq suspension after a bankruptcy filing, not merely a company receiving a letter.",
  "quick_take should state what changed now. summary should explain the event sequence in chronological order, then give a clear investor read-through on trading access, liquidity, recovery risk, or remaining cure options.",
  "For listing_risk or financial_risk, listing_status_snapshot is the visible 2-by-2 Risk Status snapshot. Return exactly four non-duplicative source-backed rows. For every other event_type, return an empty listing_status_snapshot array.",
  "For listing_risk, choose the most useful listing_status_snapshot labels from this list when they fit: Listing Status, Trading Status, Compliance Status, Listing Issue, Delisting Reason, Compliance Issue, Cure Deadline, Appeal Deadline, Hearing Date, Suspension Date, Delisting Date, Appeal Status, Company Response, Compliance Plan, Cure Path, Continued Venue, Exchange / Venue, Affected Security, Next Step.",
  "For financial_risk, choose labels that explain the active risk state rather than repeat filing mechanics. Prefer Primary Issue, Current Status, Affected Periods, Non-Reliance Period, Restatement Scope, Reporting Status, Auditor Status, Internal Controls, Liquidity Position, Default Status, Waiver Status, Payment Deadline, Restructuring Stage, Company Response, Remediation Plan, or Next Step when they fit. Use Reporting Status or Restatement Scope for delayed, unreliable, or pending financial reports. Use Default Status only for an actual payment default, covenant default, or creditor default notice. If none fits, create a short plain-English label.",
  "Do not use generic labels such as Key Date or combined labels such as Company Response / Compliance Path. Use one concept per row. Keep labels within 24 characters, values within 55 characters, and notes within 80 characters. Use note only for material context. Do not add a Not disclosed row unless the absence itself is important to the investor.",
  "Every listing_status_snapshot label, value, and note must be a compact single line. Never emit newline characters, blank-line padding, repeated spaces, or repeated control characters inside any JSON string.",
  "For listing_risk summary, write three to five plain-language sentences: what changed now, the cause and current stage, the practical investor effect, and at least one source-backed analyst judgment, warning, or useful offset. Do not repeat quick_take sentence wording.",
  "The final listing_risk summary sentence must be the investor judgment or material offset. It must explain what the current stage means for trading access, liquidity, cure probability, or shareholder recovery, not merely repeat a notice, date, filing, or scheduled procedural step.",
  "For listing_risk score_reason, explain why the event belongs in its score band rather than repeating filing mechanics. Focus on how advanced or immediate the risk is, whether a cure or appeal remains, the effect on trading access and liquidity, common-shareholder recovery uncertainty, and one material offset when it changes the reading.",
  "Do not repeat the issuer, exchange, exact date, form type, notice wording, or snapshot facts in listing_risk score_reason. Write the scoring principle in one plain-language sentence.",
  "Examples of the intended listing_risk score_reason style: 'Near-certain loss of exchange liquidity and severe recovery uncertainty justify an extreme impact rating.' 'A live cure period limits immediate harm, but persistent compliance pressure keeps the risk material.' 'The immediate listing threat has eased, though repeat compliance risk prevents a low-impact reading.'",
  "For financial_risk summary, write three to five plain-language sentences: what became unreliable or constrained, the affected scope and current stage, the practical investor consequence, and one source-backed judgment or meaningful offset. For accounting non-reliance or restatement cases, distinguish the original reporting problem from the remediation or refiling status.",
  "For financial_risk score_reason, explain the severity principle rather than restating the filing. Focus on how much reported information or liquidity is affected, whether the issue is unresolved, the immediacy of creditor, audit, or restatement consequences, and one material offset when it changes the reading.",
  "what_to_watch_next should use only concrete next events supported by the source: cure or appeal deadline, hearing result, suspension date, continued venue, waiver expiry, payment deadline, financing condition, restructuring filing, court milestone, or confirmed recovery treatment. Do not add generic advice to monitor announcements.",
  "Never add a continued trading venue, OTC possibility, appeal, cure step, financing, or other follow-up that the original source blocks do not support. If a possible next event is unknown or explicitly not stated, omit it rather than speculating or explaining that it was not disclosed.",
].join("\n");

export const sec8k6kFinancingDilutionCapitalStructurePrompt = [
  "SECTION: Financing / Dilution / Capital Structure analysis room.",
  "Use this room for offerings, PIPEs, warrants, convertibles, equity lines, ATM-style sales, debt financings, securities purchase agreements, indentures, warrant agreements, share issuance approvals, reverse splits, authorized-share changes, dividends, and buybacks.",
  "SECTION: Choose one capital mode.",
  "Choose equity_issuance when fixed common shares or ADSs are the main new supply and share-linked instruments do not dominate the investor read.",
  "Choose share_linked_financing when warrants, pre-funded warrants, convertible securities, preferred conversion, equity-line mechanics, reset terms, or a mixed share-and-instrument package materially drives future supply.",
  "Choose atm_capacity when an at-the-market program, sales agreement, or prospectus supplement creates, expands, replenishes, or reports current sale capacity, whether that capacity is capped in fixed shares or dollars. ATM is the transaction method; capacity unit is a separate economic fact. ATM capacity is potential future selling over time, not completed issuance.",
  "Choose debt_liquidity when loans, notes, credit facilities, refinancing, repayment obligations, interest cost, collateral, maturity, or liquidity runway is the main economic effect. If distress, default, acceleration, or survival financing is the primary event, use the Listing / Financial Risk room instead and keep financing terms as secondary context.",
  "Choose capital_structure_action for a reverse split, authorized-share change, share reclassification, charter capital change, or shareholder approval of future issuance capacity when no current financing transaction dominates. A current approval to issue shares or modify warrants for exchange compliance also belongs here when the filing does not disclose enough terms to model an active financing package. Do not choose share_linked_financing merely because the approval concerns warrants or convertible securities.",
  "Choose capital_return for dividends, repurchase authorizations, completed buybacks, tendered capital returns, or similar cash returned to holders.",
  "For a filing with multiple capital events, first complete security_inventory across the complete original source-block bundle, then choose the mode with the most immediate common-shareholder effect. Preserve a separately material secondary capital event in material_events and do not let the primary transaction hide a current-event security or distinct series.",
  "SECTION: Model economic substance before visible fields.",
  "Distinguish the legal number of securities from their common-share equivalent. Never present preferred shares, warrants, notes, units, or other instruments as though their legal security count were already a common-share count.",
  "When a fixed common-share equivalent is source-backed, preserve both the legal security amount and the fixed common-share equivalent. When the common-share equivalent varies with price, reset, exercise, conversion, approval, or another unresolved condition, describe it as variable and do not invent a fixed amount.",
  "Never hide known fixed common-share exposure merely because total exposure is not calculable. Preserve the fixed exposure in Instrument Details or Snapshot even when share_overhang must remain null because the denominator is unavailable or another material instrument remains variable.",
  "Distinguish funded or closed amounts from commitments, maximum financing size, capacity, and conditional future tranches. If an aggregate includes unfunded or conditional tranches, do not label the aggregate Gross Proceeds or imply that the full amount has closed; use a source-backed commitment or financing-size label and show funded amounts separately when stated.",
  "When a headline says up to an aggregate amount but the original source separately states closing proceeds and additional exercise-contingent proceeds, show that split in one compact snapshot row. Never let an unconditional Gross Proceeds or Offering Size label hide that part of the maximum depends on future warrant or instrument exercise.",
  "Prioritize terms that change common-share supply, cash received, investor economics, or timing. Omit unavailable rows and immaterial legal protections rather than filling the UI with Not disclosed values or internal class-governance provisions.",
  "Keep each term scoped to the instrument, series, tranche, or transaction to which it applies. Do not present a Series B placement agent, funding condition, reset, ownership limit, or other series-specific term as a condition of the entire financing.",
  "SECTION: Build the visible capital model before prose.",
  "Do not return key_evidence for this family. The visible Snapshot, Share Overhang, Instrument Details, and Offering Details already provide the evidence and must not be followed by a duplicate proof list.",
  "Complete root security_inventory first. For an ATM, identify the source-stated capacity unit before authoring visible fields. Then follow runtime schema property order: set display_payload.display_type, data.display_version, capital_mode, snapshot_metrics, share_overhang, instrument_details, and offering_details. In particular, finish snapshot_metrics, instrument_details, and offering_details before writing quick_take, summary, and score_reason.",
  "Return exactly four snapshot_metrics. This is the visible 2-by-2 snapshot. Choose four non-duplicative source-backed investor facts and never pad with an immaterial Not disclosed row. Choose short labels from the following when they fit, or create a short source-backed label when none fits: Approval Status, Approval Scope, Exchange Requirement, Floor Price, New Shares, Offering Size, Purchase Price, Gross Proceeds, Net Proceeds, Warrant Shares, Conversion Price, ATM Program Size, Sold to Date, Remaining Capacity, Capacity vs Market Cap, Debt Amount, Interest Rate, Maturity, Liquidity Added, Split Ratio, Effective Date, Authorized Shares, Dividend, Record Date, Payment Date, Buyback Size, Authorization Period.",
  "Use one concept per snapshot row. Keep labels within 24 characters, values within 55 characters, and notes within 80 characters. Do not show a Not disclosed row unless the missing term is itself material to the investor decision.",
  "Use a proceeds value only when an original source block directly states that proceeds amount for the same transaction or tranche and supports the stated lifecycle stage. Do not multiply shares by price to create proceeds, add debt principal to equity sale value, combine funded and conditional tranches into Gross Proceeds, or present any derived aggregate as a filing-stated value. Show separate source-stated funded amounts, commitments, or tranche amounts instead.",
  "For an approval-only capital action, use capital_structure_action. This filing records an approval, not an active offering: describe the approval in snapshot_metrics, return offering_details as an empty array, and do not use the meeting date, approval purpose, exchange rule, or a referenced agreement date as Offering Details. Return share_overhang as null unless current source blocks state a numeric current-event supply that can be compared with a compatible share basis. Instrument Details may preserve quantities and mechanics from current source blocks or expressly linked related_filing_source_block original text when the current filing explicitly refers to that filing. If neither source provides a numeric quantity or fixed security amount, omit the Shares / Securities row; never replace it with phrases such as full issuance approved or quantity not stated. Use the same fixed Instrument Details contract as 424B/S-1. For each material instrument, start a group with Type, then add only source-backed applicable rows in this order: Shares / Securities, Exercise / Conversion Price, Reset / Floor, Term / Limits.",
  "Use only these instrument_details labels: Type, Shares / Securities, Exercise / Conversion Price, Reset / Floor, Term / Limits. Do not create labels such as Warrant Exercise Price, Note Conversion Price, Exercisability, Expiry, Ownership Limit, or Maturity; put those values in the matching fixed column.",
  "Use one Type group per material instrument family or series whose economics differ. Keep separate warrant or convertible series separate when exercise or conversion price, reset/floor, expiry, exercisability, ownership limits, or other material terms differ.",
  "Reconcile instrument_details against security_inventory before returning. Every inventory row whose display_target is instrument_details must have exactly one matching Type group using the exact instrument_details_type value. Do not stop after describing only the lead security or main purchase agreement.",
  "Do not create an instrument_details Type group for plain common stock, ordinary shares, or ADSs when the row would only repeat a quantity already shown in snapshot_metrics or share_overhang. Instrument Details is for warrants, pre-funded warrants, convertibles, preferred securities, rights, units, notes, and other securities with distinct mechanics.",
  "Return at most seven material Type groups, for no more than 35 instrument_details rows. Include at least Type and Shares / Securities when a source-backed quantity exists. In Shares / Securities, identify the legal instrument unit and also include its fixed common-share equivalent when source-backed; if that equivalent is variable, say so compactly instead of converting the legal count into common shares. Add the other fixed rows only when their terms are source-backed; unavailable cells render as a dash, so do not create Not disclosed rows.",
  "Keep every instrument_details value compact: usually under 90 characters and never over 130 characters. Put exercisability, expiry, maturity, ownership cap, cashless exercise, redemption, and similar limits together in Term / Limits using short semicolon-separated phrases.",
  "Set instrument_details note to null. The fixed five-column table displays row values, so put a material adjustment or caveat in the matching compact value or in Reset / Floor or Term / Limits instead of hiding it in note.",
  "For share_linked_financing, instrument_details must not be empty when the original source blocks disclose material warrant, pre-funded warrant, convertible, preferred-conversion, or similar instrument mechanics. Those mechanics must not appear only in prose or Offering Details.",
  "After instrument_details is complete, use Offering Details only for material current-transaction facts not already visible in Snapshot, Share Overhang, or Instrument Details. Typical eligible rows are Purchaser / Investor, Placement Agent, Agreement Date, Closing Condition, Concurrent Private Placement, and Use of Proceeds. Do not repeat financing type, proceeds, price, share count, or warrant economics already visible elsewhere. Use at most six compact rows; return an empty array when none remains.",
  "When the original source blocks show a material separate private placement that is issued, sold, or closed alongside the current registered, public, or other primary transaction, include one Offering Details row labeled Concurrent Private Placement. Use the value for a short source-backed description of the private-placement security or financing structure. Use the optional note only for its relationship to the main transaction or one material registration, closing, or resale context. Do not repeat share counts, exercise or conversion prices, ownership caps, or other instrument mechanics in this row; those belong in Share Overhang or Instrument Details.",
  "Do not create Concurrent Private Placement for historical financings, prior ELOC or SEPA facilities, background capitalization, or an unrelated private transaction merely mentioned in the filing. Do not require any specific security type, offering type, or registration-rights term for this row; use it only when the current source-supported concurrent structure is materially relevant.",
  "For a Use of Proceeds Offering Details row, list no more than two specific source-backed purposes in value. If more purposes are disclosed, write '{purpose1}, {purpose2} + others'. Keep the two most specific investor-relevant purposes first, such as debt repayment, R&D or clinical trials, acquisition, capital expenditures, or commercialization. Put generic working capital or general corporate purposes behind '+ others'. The optional note may contain only one material caveat or amount and must not continue the purpose list.",
  "When using '+ others' for Use of Proceeds, do not list a third purpose before '+ others'. Keep the Offering Details value compact and the optional note at 80 characters or fewer.",
  "SECTION: ATM capacity.",
  "For atm_capacity, first classify the controlling current program capacity as fixed-share-capped or dollar-capped from the original source blocks. Do not infer one unit from the other, and do not change capital_mode based on the unit.",
  "In either unit model, the numerator is current unsold ATM capacity for the same program and date as the disclosed limit and usage.",
  "For a fixed-share-capped ATM, compare current unsold fixed share capacity with compatible current shares outstanding for the same share or ADS basis. Use unit shares for the basis, ATM row, numerator, and denominator. Never multiply the share cap by a market price to manufacture a dollar capacity.",
  "For a dollar-capped ATM, compare current unsold dollar capacity with a compatible dollar company-value denominator. Use unit usd for the basis and ATM row. Use market_context.market_cap only when a filing-date company-value denominator is unavailable, and label that basis Latest market context. Never divide a dollar capacity by shares outstanding or convert it into an implied share count.",
  "Use one current-capacity row with row_role reference and supply_type atm_capacity. total_note.numerator is that row's current unsold capacity, total_note.denominator is the same-unit basis shown in share_overhang.basis, and total_note.ratio is numerator divided by denominator. The basis, capacity row, numerator, and denominator must all use one compatible unit model; never mix shares and usd in one calculation.",
  "When current program size and sold-to-date usage are both disclosed in the same unit for the same program and date, the numerator is remaining current capacity, not historical total capacity and not only an amendment increase. Prefer a directly disclosed remaining amount; otherwise subtract only source-backed same-unit usage from the source-backed current program limit. Never subtract shares from dollars, dollars from shares, or amounts from different programs or dates.",
  "Use chart_title ATM Program, status_label Capacity Scale, and total_note.title ATM Capacity Scale. Use a suffix that names the actual denominator, such as of shares outstanding or of market cap. If a compatible numerator and denominator are unavailable, set share_overhang to null rather than inventing a ratio.",
  "Use the ATM snapshot for exactly four non-duplicative program facts. Prefer source-backed program limit, sold-to-date usage, remaining capacity, and capacity versus the compatible basis. Keep every amount in its disclosed unit. Put sale method, sales agent, commission, agreement date, and use of proceeds in Offering Details only when material and not already visible.",
  "SECTION: Share supply and dilution.",
  "Populate share_overhang only when original source blocks or compatible supplied market context support an honest numerator and denominator. Never derive a share count from a dollar cap, assumed price, fee-table value, market price, or parser-extracted value list.",
  "Use source-block shares outstanding before the current transaction as the first denominator choice. If that is absent, market_context shares outstanding may be used only when its class and unit match the counted supply; label the basis note Latest market context. If no compatible basis exists, set share_overhang to null rather than inventing a percentage.",
  "Use row_role as the single calculation role. Count currently issued or sold share-equivalent supply. Mark future-exercise warrants or convertibles conditional unless the original source blocks show zero-price, nominal-price, pre-funded, already-paid, or immediately share-equivalent economics. Mark replacement securities alternative when they draw from the same maximum pool, and mark contextual capacity or historical reference rows reference.",
  "Before assigning row_role to common shares and pre-funded warrants, determine their relationship from the exact source sentence. Separately stated common-share and pre-funded-warrant quantities that are issued or sold in the same transaction are additive counted supply. Do not infer a replacement relationship merely because both appear in one financing package.",
  "Treat common shares and pre-funded warrants as one alternative maximum pool only when the same allocated shares are expressly described as common shares or pre-funded warrants in lieu of those same shares. Use one combined counted row or one counted row plus an alternative row; never count that same pool twice.",
  "A clause that an accompanying warrant may be exercised for common shares or pre-funded warrants in lieu thereof governs only that future warrant exercise. It does not turn separately issued initial common shares and pre-funded warrants into alternatives.",
  "A current-event pre-funded warrant with a source-backed amount and zero or nominal exercise price must be row_role counted unless it is an explicit one-for-one alternative already represented by a counted pool. Do not use row_role conditional for that pre-funded supply.",
  "Include only securities created, issued, sold, amended, or made newly operative by the current filing event. Do not add prior warrants, historical notes, old facilities, employee options, or background capitalization merely because the filing mentions them.",
  "Every counted row must use the same share class and unit as share_overhang.basis. Keep Class A, Class B, ordinary-share, ADS, and other class-specific bases distinct. If they cannot be reconciled, do not calculate a ratio.",
  "The included numerator is the sum of counted rows only. Conditional, alternative, and reference rows are excluded. total_note.numerator, denominator, ratio, status_value, and ratio_value must reconcile to that same counted-row calculation. When calculable, total_note.ratio, status_value, and ratio_value must use the same bare percentage representation including the % sign, such as 229.5%; never write an unlabeled decimal or multiple such as 2.295. Never calculate one visible percentage from all rows and another from only counted rows.",
  "share_overhang.status_value is the large header value. It must be only a bare percentage such as 62.4%, or one of Variable, Not fixed yet, Not calculable, or Not stated. Do not put comparison wording such as vs. Current Shares, formula text, share counts, or supply labels in status_value.",
  "When a material current-event security has a variable conversion formula, unresolved share count, reset-dependent share count, or otherwise non-calculable share equivalent, keep that row conditional. If no fixed counted numerator remains, use Variable or Not fixed yet for the header and do not create a partial dilution percentage.",
  "When fixed counted supply and conditional future supply both exist, the visible percentage may show only the fixed counted numerator. Keep conditional supply outside the numerator and state in one short share_overhang.note that the headline ratio excludes conditional future supply shown separately. Do not call a fixed-only ratio Total Potential Dilution if the excluded conditional supply is material; use a narrower source-backed calculation label.",
  "When shares, warrants, conversion prices, reset/floor terms, ownership caps, or cashless exercise are source-backed, summarize them plainly without turning parser-extracted numbers into separate evidence.",
  "SECTION: Capital-structure and capital-return interpretation.",
  "For reverse splits, distinguish the mechanical reduction in share count from the investor reason, such as listing compliance or financing flexibility. A completed or board-approved reverse split is alert-level even without a separate offering because it usually signals meaningful listing or capital pressure.",
  "A reverse split does not mechanically dilute proportional ownership by itself. Do not call the consolidation itself dilution or place it in a share-overhang graph unless a separate current issuance creates additional supply. Explain the bearish investor signal through listing pressure, price weakness, financing flexibility, or another source-backed capital concern.",
  "For authorized-share changes, explain future issuance capacity without claiming those shares were already issued. For dividends and buybacks, distinguish an authorization from cash actually paid or shares actually repurchased.",
  "Do not treat fee-table amounts, placeholders, or blank terms as final proceeds or final dilution.",
  "SECTION: Capital-event scoring guide.",
  "Use scale, immediacy, pricing economics, instrument terms, balance-sheet effect, and common-shareholder exposure. Score the net economic effect after weighing liquidity or funding gained against cost, collateral, restrictions, maturity pressure, dilution, and other source-backed burdens. Do not stack the same dilution or liquidity fact as multiple score increases.",
  "For capital_mode equity_issuance, share_linked_financing, or atm_capacity, apply the shared SEC active offering and dilution scoring guide below before the remaining capital-event modifiers. Use the same numerator, denominator, and included supply shown in the visible capital model.",
  "Do not apply the shared offering and dilution bands to debt_liquidity, capital_structure_action, or capital_return. Those modes use the separate rules below.",
  ...SEC_ACTIVE_OFFERING_DILUTION_SCORING_GUIDE,
  ...SEC_ACTIVE_OFFERING_DILUTION_ALERT_GUARDS,
  "Distinguish contractual downside protections from an adverse condition that is active now. Collateral requirements, margin-call clauses, covenants, default remedies, and other lender protections describe possible downside; they do not by themselves establish present distress, an immediate loss, or an alert-level event when no trigger, breach, acceleration, forced action, or comparable current pressure is source-backed.",
  "Ordinary debt or refinancing that improves liquidity is usually 45-64 and may be neutral or bullish. Financing with material cost, collateral, maturity, or operating restrictions but no active adverse trigger is usually 60-74 and should reflect both the liquidity benefit and burden. Use 75 or above only when the financing itself creates a source-backed immediate and material common-shareholder consequence, not merely because protective terms exist. Route operative default, acceleration, bankruptcy, or survival-level distress to financial_risk rather than inflating the capital score here.",
  "For route_case debt_or_credit_financing or capital_mode debt_liquidity, the score must remain 74 or below when the original sources show no current breach, default, acceleration, margin call, forced collateral action, inability to pay, or comparable activated adverse condition. The financial_risk event label does not by itself prove distress or justify a bearish signal. Use bearish only when the current financing burden clearly outweighs the funding benefit; use neutral or volatile when the source-backed effects are balanced or directionally mixed.",
  "A completed or board-approved reverse split is usually 75-84, with the upper end appropriate when active listing compliance pressure is source-backed. An authorized-share increase is usually 60-79 and reaches alert level when the increase is large or tied to active financing or issuance plans.",
  "A routine dividend is usually 25-49. A special dividend, unusually large distribution, or material repurchase authorization is usually 45-74; use 75+ only when the capital return is exceptionally large or changes control, liquidity, or per-share value materially.",
  "SECTION: Investor-facing output.",
  "Write a three-to-five-sentence summary after evaluating the capital action's net economic effect. Explain what became operative, the funding or capital benefit, the material cost, restriction, dilution, or downside, whether any adverse condition is active or only conditional, and a balanced investor judgment. Include a source-backed offset whenever it materially changes the conclusion. Do not restate the snapshot row by row or describe a conditional remedy as an immediate event.",
  "Write score_reason as the plain-language scoring principle, not a second transaction summary. Explain why the event belongs at that impact level through immediacy, scale, dilution mechanics, financing quality, or balance-sheet effect, using one material offset only when it changes the reading.",
  "Do not return what_to_watch_next for this family. Snapshot, Share Overhang or ATM capacity, Instrument Details, and Offering Details already provide the complete visible capital analysis.",
].join("\n");

export const sec8k6kStrategicTransactionPrompt = [
  "Specialized analysis room: Strategic Transaction.",
  "Use this room for merger agreements, acquisition or disposition agreements, merger closings, going-private deals, tender offers, business combinations, de-SPAC transaction status, asset sales, transaction terminations, and major transaction amendments.",
  "Identify the transaction stage: signed, amended, approved, closed, terminated, condition failed/satisfied, or procedural follow-up.",
  "For completed mergers with trading suspension or Form 25 language, treat delisting as procedural context unless exchange noncompliance is separately source-backed.",
  "Explain consideration, target/acquirer roles, closing conditions, shareholder vote status, expected ticker/listing transition, and cash/share mix when source-backed.",
  "For a completed cash tender offer, merger, acquisition, or going-private transaction, summary must state the per-share consideration when source-backed. Also state the tendered or approved share percentage when it materially demonstrates completion or control. Do not replace these shareholder-outcome terms with only delisting, board-change, or procedural details.",
  "For a completed cash tender offer followed by a merger, make the first summary sentence name the acquirer, completed transaction, and exact per-share cash consideration. Use the next sentence for the tendered percentage or other completion threshold when source-backed, before describing delisting or governance cleanup.",
  "Do not call a deal bullish or bearish merely because a board approved it. The signal should reflect price, uncertainty, completion risk, shareholder outcome, or strategic effect.",
  "SECTION: Transaction snapshot and scoring.",
  "Build data.snapshot_metrics before investor prose. It is the visible 2-by-2 snapshot, so return exactly four non-duplicative scan-first rows. Keep labels within 24 characters, values within 55 characters, and notes within 80 characters.",
  "A shareholder approval for a merger, acquisition, tender, business combination, or comparable deal is still strategic_transaction, not a generic shareholder_vote. For a signed or approved transaction with material conditions still open, score 50-64 when the decision matters but completion remains uncertain. Use 65-74 when closing conditions, financing, regulatory review, vote results, or execution risk materially change the shareholder outcome.",
  "For a failed, terminated, blocked, or condition-impaired major transaction, score 75-84 when the development creates substantial uncertainty or removes a material expected outcome. Use 85 or above only when source-backed facts show direct severe recovery, liquidity, or trading-access risk tied to the transaction.",
  "For a completed cash acquisition, tender offer, or going-private transaction, normally use 55-69 with a neutral signal. The old ticker ending or Form 25 cleanup alone does not make the event bearish or alert-worthy. Raise the score only for a distinct unresolved investor risk supported by the source.",
  "Write score_explanation.summary as one concise analyst-style explanation of the score band. Explain the practical scoring principle, such as resolved deal uncertainty, unresolved closing risk, failed consideration, or direct shareholder recovery risk. Do not repeat the transaction summary, form type, issuer name, or headline facts.",
  "Write a three-to-five-sentence summary: transaction stage and parties, strongest economics or shareholder outcome, remaining condition or completion fact, and a direct source-backed investor read-through. Do not restate the snapshot row by row.",
  "what_to_watch_next should contain only concrete source-backed next events. For a pending transaction, use vote, tender expiry or results, regulatory decision, closing condition, financing, or expected closing when disclosed. For a completed cash exit, omit the section unless a remaining investor-relevant action such as Form 25, cash payment timing, or appraisal process is specifically supported.",
].join("\n");

export const sec8k6kGovernanceVoteLeadershipPrompt = [
  "Specialized analysis room: Governance / Vote / Leadership.",
  "Use this room for Item 5.07 vote results, director or officer changes, board changes, auditor changes, compensation changes, shareholder proposals, control-holder or insider ownership updates, and governance contests.",
  "SECTION: Governance display model.",
  "Build display_payload before investor prose. Set display_type=governance_event and data.display_version=sec_8k_6k_governance_event_v1.",
  "Choose exactly one governance_mode. Use leadership_change for a named officer, director, board-role, or succession change; auditor_change for auditor dismissal, resignation, appointment, or disagreement disclosure; vote_result for governance-focused Item 5.07 results; governance_change for bylaws, board rights, compensation governance, shareholder proposals, control rights, or comparable oversight changes; mixed only when multiple independently material governance events belong in this same room.",
  "Write exactly four non-duplicative snapshot_metrics with short LLM-chosen investor labels. Select the most decision-useful status, person or firm, role, effective date, vote outcome, disagreement, successor, control consequence, or implementation fact. Do not add a Not disclosed row unless the missing fact itself materially changes the investor reading.",
  "Write one to four key_changes in source order. Each change needs a short category, a plain title, one complete plain-English explanation sentence with an explicit subject, and zero to three non-duplicative detail rows. Do not repeat snapshot facts merely to fill detail rows.",
  "For vote_result, use key_changes for the material proposals and outcomes. State approved, rejected, elected, withheld, or unresolved before procedural vote counts; include counts only when they materially clarify the result.",
  "For auditor_change, use both the selected Item 4.01 block and selected auditor letter when available. Distinguish dismissal, resignation, and appointment; identify disagreements, adverse or disclaimer opinions, and reportable events only when source-backed.",
  "For auditor_change, keep disagreements, reportable events, audit opinion, going-concern language, and appointment conditions as separate disclosure dimensions. Never describe going concern, an adverse opinion, a disclaimer, or another audit-opinion issue as an exception to no disagreements or no reportable events.",
  "For auditor_change, also separate the financial-statement audit opinion from ICFR audit scope. A statement that the auditor was not engaged to audit or opine on internal control over financial reporting is not a qualification, exception, or adverse modification of the financial-statement opinion.",
  "For auditor_change dates, preserve the disclosed state. When engagement remains subject to a filing, agreement, consent, or other condition, label the date Approval Date or Conditional Engagement rather than Engagement Date or Effective Date.",
  "For leadership_change, distinguish permanent and interim appointments, effective dates, stated reasons, succession coverage, and any source-backed disagreement or investigation. Do not turn biography or praise into investor evidence.",
  "The Governance Snapshot and Key Changes are the visible evidence. Do not return key_evidence for this family and do not write display_payload evidence or notes.",
  "For vote results, first identify what shareholders voted on. Routine annual votes can be low impact; merger, reverse split, financing approval, charter/capital changes, contested elections, or failed proposals can be material.",
  "For leadership changes, distinguish planned transitions from abrupt resignations, terminations, investigations, or control changes.",
  "Leadership means a named officer, director, board role, governance right, control arrangement, auditor, or executive compensation decision changed. General employee layoffs, workforce reorganizations, facility exits, and company cost-reduction or restructuring plans are operating_update, even when a CEO communicates the plan. Do not treat affected employees as leadership.",
  "Score leadership changes by the source-backed consequence, not by the executive title or the fact of resignation alone. A director replacement with an immediate successor and no disagreement is usually 25-49. An ordinary senior-officer transition with continuity is usually 45-59. An abrupt CEO or CFO departure, interim appointment, or dual-role transition may score 55-69 when it creates meaningful execution uncertainty, but the leadership change alone must remain below 75.",
  "Use 75 or above only when a distinct source-backed adverse condition independently makes the event alert-worthy, such as no credible successor and material operating disruption, multiple critical executives leaving together, termination for cause, an active fraud or accounting investigation, a control contest, or a linked liquidity, default, restatement, or survival risk. The score must be driven by that separate condition, not merely by the departure.",
  "A pending merger or other transaction does not automatically increase a leadership score. Treat an experienced interim successor, an orderly handoff, no stated disagreement, and a transaction already progressing toward closing as offsets unless the source says the change threatens execution or closing.",
  "Use neutral for routine or orderly succession, volatile for an abrupt transition with unresolved execution uncertainty, and bearish only when the source supports a concrete adverse consequence. Do not call a routine replacement bullish merely because the incoming director or officer has relevant experience.",
  "An auditor transition with a prompt replacement, no disclosed disagreement, no adverse or disclaimer opinion, and no linked filing delay or restatement is usually 35-55 and neutral. Raise the score only for independently source-backed accounting uncertainty, disagreement, non-reliance, material weakness, investigation, filing delay, or continuity risk.",
  "For governance disputes or shareholder proposals, explain what investor control or oversight issue changed and what vote/result matters next.",
  "If the vote subject belongs mainly to another room, such as merger approval or financing issuance approval, analyze that economic substance and keep the vote mechanics as context.",
].join("\n");

export const sec8k6kOperatingLegalRoutinePrompt = [
  "SECTION: Operating / Legal / Routine analysis room.",
  "Use this room for earnings, guidance, sales or delivery metrics, workforce or cost restructuring, facility or capacity changes, product or commercial updates, FDA/clinical or regulatory updates, litigation, settlements, investigations, accounting or restatement items, routine amendments, exhibit-only filings, and low-signal 6-K or 8-K updates.",
  "Choose exactly one data.operating_mode. Use earnings only when the primary event is financial results or financial guidance involving revenue, profit or loss, margins, EPS, cash flow, or equivalent financial-statement performance. Use operating_update for workforce, restructuring plans, costs, facilities, capacity, sales volume, deliveries, demand, customers, production, utilization, hashrate, or other operating changes, including non-financial operating guidance. Product or production guidance alone is not earnings. Use product_or_regulatory for product, FDA, clinical, approval, launch, or regulatory milestones; legal_or_accounting for litigation, investigation, settlement, auditor, restatement, or accounting developments; routine_archive only for a genuinely administrative or low-signal update.",
  "Set data.regulatory_stage from the primary FDA or clinical event only. Use ind_or_clinical_hold for IND clearance, IND activation, clinical hold, or hold removal; application_review for NDA/BLA submission acceptance, Priority Review, PDUFA, resubmission review, or another application-review milestone; advisory_committee for an FDA advisory committee event; approval for final approval or label expansion; crl_or_appeal for a Complete Response Letter, formal dispute, appeal, or post-CRL response; clinical_update for trial initiation, enrollment, endpoint, safety, or data-readout events without a controlling FDA action; and other_regulatory only for a substantive regulatory event that fits none of those stages. Use not_applicable for earnings, ordinary operating, legal/accounting, routine, and non-FDA product events.",
  "When a filing contains more than one FDA, clinical, partnership, or payment fact, regulatory_stage follows the primary regulatory event. Keep secondary milestones or collaboration economics in Snapshot, detail rows, or the single secondary update; do not create a blended or invented stage label.",
  "For operating restructuring, use event_type operating_update when the company is realigning investments, workforce, facilities, capacity, or costs without separate survival-pressure evidence. Use leadership_governance only for an actual named leadership or governance change. Use financial_risk only when liquidity stress, inability to meet obligations, default, acceleration, going-concern doubt, bankruptcy, receivership, or comparable survival pressure is independently source-backed.",
  "Cross-field consistency is mandatory: when data.operating_mode is operating_update, analysis_output.event_type and the single role=primary material_events event_type must both be operating_update. Do not use other for a substantive operating change that fits operating_update.",
  "Cross-field consistency is also mandatory for product_or_regulatory: when data.regulatory_stage is not not_applicable, analysis_output.event_type and the single primary material event must both be fda_clinical. Use product_update only for a non-FDA product or commercial event whose regulatory_stage is not_applicable.",
  "For Item 2.05 and related Item 2.06 disclosures, make the operating action, affected workforce or facilities, expected charges, cash versus non-cash effects, timing, and stated objective the core analysis when disclosed. A CEO employee note is supporting context, not a leadership event by itself.",
  "Set snapshot_title to the matching approved title. For every substantive mode, return exactly four non-duplicative snapshot_metrics containing the strongest scan-first facts. Use a material source-backed status, timing, guidance, scope, or next-stage fact as the fourth row when needed. For routine_archive, return an empty snapshot_metrics array.",
  "Use one concept per snapshot row. Keep labels within 24 characters, values within 55 characters, and notes within 80 characters. Omit unavailable fields instead of displaying Not disclosed.",
  "SECTION: Key Business Updates.",
  "For earnings and operating_update, use business_catalysts only for zero to three material investor-relevant facts that do not already appear in Snapshot, Performance & Outlook, detail_sections, or secondary_updates. Before selecting these rows, collect every material disclosed outlook. If an earnings outlook cannot attach to a matching performance_comparisons metric, reserve a business_catalysts row for it before selecting other updates. Use value for a concise metric or timing when one exists; otherwise use null. Do not fill this section with generic optimization plans, future strategy language, management praise, awards, or promotional statements. An empty array is better than repetitive or low-information rows.",
  "For non-earnings modes only, use zero to two detail_sections with no more than five compact source-backed rows each. Prefer these section titles when they fit: Operating Metrics, Project Economics, Commercial Update, Product / Regulatory Details, Legal / Accounting Details, Company Response, Event Details. When material source-backed project valuation, ownership interest, reserve estimates, long-term unit economics, or technical-report economics affect the investor reading, title the section Project Economics and group those complementary facts there instead of scattering them across Snapshot, Key Business Updates, or Summary. Do not rename that section Project Details. Create another short title only when none fits.",
  "For earnings and operating_update, use performance_comparisons for one to three source-backed current-versus-prior comparisons when valid comparable values exist. Each comparison must use the same metric, period scope, accounting or operating basis, and unit, and both numeric values must be explicitly available in the original source blocks. Never compare a quarter with a full year, year-to-date period, half year, or another incompatible duration. Use compact unambiguous period labels such as Q1 2026, Q4 2025, or FY 2026. Set comparison_basis=yoy only for the same period one year earlier, qoq only for the immediately preceding fiscal quarter, and other for any different valid comparison. For earnings headline metrics, use the same-period prior-year YoY value when disclosed; otherwise use the immediately preceding fiscal-quarter QoQ value. For operating_update, choose the most decision-useful source-backed comparison for production, deliveries, utilization, capacity, sales volume, customers, usage, hashrate, or another primary operating KPI; sequential QoQ is appropriate when the filing presents operations that way. Return true signed numeric values: a disclosed loss of $90 million must use -90, never 0. Positive-to-positive comparisons render as bars; comparisons containing a negative value render as a profit/loss transition. Do not use expenses, costs, unlike units, derived estimates, or expectations comparisons as performance comparisons because a larger value may not mean better performance.",
  "For earnings and operating_update, use guidance_metrics for zero to three outlook rows inside Performance & Outlook. guidance_label must identify the disclosed time horizon, such as Q2 2026, FY 2027, or 2025; never use Expected, Outlook, or Guidance alone. Use guidance_kind=numeric_range for a disclosed low-high range, point for a single numeric target, and qualitative for directional language such as Flat to Up Low Single Digits. For qualitative guidance set both numeric fields to null; never omit material guidance merely because the company used words instead of exact numbers. For point guidance use the source-backed number in guidance_low_numeric and set guidance_high_numeric to null. Numeric fields may be negative when the source gives loss or negative-EPS guidance. For earnings, include source-backed revenue and profitability guidance when present, combine revenue and EPS guidance for the same horizon when appropriate, prefer full-year guidance, and add near-term guidance only when material. For operating_update, include source-backed production, delivery, utilization, capacity, customer, volume, or comparable operating guidance when it directly advances the primary event. Classify every guidance row with performance_relationship. Use same_basis and set performance_label to the exact performance_comparisons label only when metric, unit, and basis match. Use related_different_basis only for a genuinely related metric with a different accounting basis. Use standalone with performance_label=null only when no matching comparison exists. Never duplicate the same outlook in guidance_metrics and business_catalysts.",
  "For earnings, do not repeat financial metrics already shown in Snapshot or Performance Comparison inside business_catalysts. Select the strongest investor-relevant facts rather than every metric or promotional claim in a press release. Exclude awards, generic partner recognition, promotional AI language, feature lists, and management praise unless the filing states a concrete investor-relevant effect.",
  "For earnings, return detail_sections as an empty array. If no valid performance comparison exists, use Snapshot, guidance_metrics, and business_catalysts rather than recreating a long financial table. Avoid repeating Snapshot values when a complementary fact is available.",
  "For earnings, prioritize revenue or growth, operating profitability or margin, cash flow, customer or usage quality, and source-stated guidance. Never claim a beat, miss, expectations comparison, or market surprise unless an original source block or supplied market context explicitly provides that comparison.",
  "SECTION: Earnings scoring guide.",
  "For earnings, score measures investor attention and practical impact; signal states direction. Score the new operating and outlook information in this filing, not the amount of disclosure, number of metrics, document length, or the mere fact that results were released. Do not stack closely related growth, margin, and profit facts as separate score increases.",
  "Use 20-39 for duplicate, administrative, or effectively no-new-information result materials. Use 40-54 for a routine quarter with broadly stable performance and no material outlook change. Use 55-64 for meaningful improvement or deterioration that remains within an ordinary quarterly range. Use 65-74 for a clear directional change in growth, profitability, cash flow, customer quality, or source-stated guidance that matters but does not create an urgent outlook reset.",
  "Use 75-84 only for a source-backed step change that can materially reset the near-term investment outlook, such as a profit-to-loss or loss-to-profit inflection, major guidance raise, cut, withdrawal, or initiation, sharp revenue, margin, cash-flow, or demand acceleration or deterioration, or another unusually consequential operating milestone. Use 85 or above only for an exceptional immediate consequence; survival, default, going-concern, non-reliance, restatement, or comparable severe facts usually belong in financial_risk or legal_or_accounting rather than being hidden inside an earnings score.",
  "A large GAAP or IFRS loss caused mainly by a non-cash impairment, purchase accounting, tax effect, or another identified one-time item does not by itself justify 75 or above. Use 75 or above only when adjusted profitability, cash flow, source-stated guidance, demand, or another near-term operating driver also materially deteriorates. When headline results are mixed, state the strongest material offset in Summary and the score rationale, then explain why the controlling driver still determines signal and impact.",
  "Apply the same earnings-quality principle to gains. A reported profit, profit inflection, or EPS improvement caused mainly by a non-cash fair-value change, warrant-liability remeasurement, tax benefit, asset-sale gain, or another identified one-time accounting item does not by itself justify a bullish signal or 75 or above. Determine direction from recurring operating performance, adjusted profitability, cash flow, demand, and source-stated guidance. State the accounting driver plainly in Summary and any affected Snapshot note. Keep 75 or above only when a separate recurring or near-term operating driver independently supports that range.",
  "For an earnings amendment, score the incremental economic change rather than the size of the revised reported accounting number. When revenue, cash flow, adjusted profitability, and guidance are unchanged, a non-cash or one-time accounting revision may be material but must not be presented as stronger operating momentum than the parent filing.",
  "When a large headline profit-to-loss inflection remains material but non-cash or one-time charges are the main cause and adjusted performance or growth provides a meaningful offset, normally use 65-74. Do not collapse that material event into the routine 40-54 range unless adjusted performance and outlook are broadly stable and no meaningful investor consequence remains.",
  "For earnings signal, use bullish when the primary reported trajectory and outlook clearly improve and offsets do not overturn that conclusion; bearish when they clearly deteriorate; neutral for stable or modestly mixed results without a clear direction; and volatile when large opposing drivers or material uncertainty make the direction unstable. A neutral earnings result must not score above 74. If an earnings event has an alert-level trigger but major opposing forces prevent a bullish or bearish conclusion, use volatile rather than neutral.",
  "A secondary acquisition, capital return, leadership change, unrealized mark, or other update may adjust the earnings score only when it is newly confirmed in this filing and independently changes the near-term investor conclusion. Do not add it mechanically to an otherwise routine quarter.",
  "Material guidance direction must be reflected in Summary, signal, and scoring. Do not use bullish when a key profitability or cash-flow outlook is flat, down, cut, or withdrawn unless stronger source-backed results or guidance clearly outweigh it and Summary states that offset.",
  "SECTION: FDA / clinical scoring guide.",
  "Apply this guide when event_type is fda_clinical or a controlling FDA or clinical event makes operating_mode product_or_regulatory. Score investor impact and immediacy; use signal for direction. Choose one base range from the most advanced source-backed regulatory or clinical stage, then adjust within that range for finality, lead-asset or company-value dependence, remaining review or trial uncertainty, safety, addressable commercial consequence, and a material source-backed economic effect. Do not add separate premiums for closely related regulatory facts from the same decision sequence.",
  "Use 40-54 for administrative, scheduling, or low-information clinical updates with little change to development probability. Use 50-64 for ordinary trial initiation, enrollment, or early clinical progress without a decisive efficacy, safety, or regulatory change.",
  "IND clearance or activation, application acceptance, Priority Review, a PDUFA date, or an advisory-committee meeting announcement is usually 60-74 when it advances the program but leaves the main approval decision unresolved. A scheduled advisory meeting alone is not an approval signal.",
  "A clinical-hold removal, granted regulatory appeal, clearly positive pivotal result, or favorable advisory-committee vote is usually 75-84 because it materially reduces risk but does not equal final approval. Use the lower end when substantial review, confirmatory, labeling, manufacturing, or execution uncertainty remains.",
  "Final FDA approval or a material label expansion is usually 80-94 bullish. Use the upper end only when the approved asset is central to company value and the decision creates an immediate major commercial or financial consequence. A narrow label, restrictive conditions, unresolved launch constraints, or limited asset relevance supports the lower end.",
  "An imposed clinical hold or a material safety-related delay is usually 75-89 bearish. A Complete Response Letter, approval rejection, severe safety finding, trial termination, or regulator-driven program halt is usually 85-95 bearish when it materially impairs a lead asset. Use a lower range when a clear, limited, and readily addressable path remains.",
  "Use bullish when the primary source-backed development materially improves approval or development probability; bearish when it materially worsens probability or safety; neutral only for low-consequence procedural updates; and volatile when major opposing facts or unresolved binary risk prevent a stable directional conclusion. A collaboration milestone or payment may adjust the range only when it is newly triggered, material, and source-backed; do not count it again as a second regulatory milestone.",
  "For operating updates, explain what changed in demand, revenue, margins, guidance, product adoption, customer traction, production, deliveries, or commercialization timing. Do not turn promotional background language into a KPI.",
  "For legal, regulatory, accounting, FDA, or clinical items, show the action or status, practical exposure or catalyst, company response when disclosed, and the next source-backed date or decision. Do not overstate probability or copy legal phrasing.",
  "SECTION: Other Material Event.",
  "Return at most one secondary_updates item, and only when the separate event would materially change the investor conclusion, score, capital structure, governance, or near-term catalyst beside the primary operating event. Combine closely related changes into that one update. It needs a short category label, plain headline, and one investor-facing sentence of roughly 12 to 16 words. Omit minor capital allocation, personnel-by-person timelines, and legal detail that do not meet that threshold. Do not repeat primary Snapshot or Key Business Updates facts.",
  "For an earnings filing with leadership and governance changes, keep financial results dominant in Snapshot, Key Details, Summary, and scoring. Put leadership or governance changes in secondary_updates rather than displacing core earnings facts.",
  "SECTION: Investor-facing output.",
  "Do not return key_evidence for this family. Snapshot and Key Details are the visible source-backed evidence and must not be followed by a duplicate proof list.",
  "Write a three-to-five-sentence summary for substantive events. State the primary change, strongest economics or operating result, practical investor effect, and one direct analyst judgment or meaningful offset. Mention secondary updates in no more than one sentence. Do not restate every snapshot row.",
  "Write score_explanation.summary as one concise analyst-style scoring principle. Do not begin with The score, repeat the form type, or claim an expectations beat without explicit source support.",
  "Preserve the source direction of every visible financial value. A disclosed loss or negative per-share amount must retain a minus sign or parentheses in Snapshot and must agree with the signed numeric value used in Performance Comparison.",
  "For product_or_regulatory, legal_or_accounting, and routine_archive, return empty performance_comparisons, guidance_metrics, and business_catalysts arrays. operating_update may use those arrays only for source-backed operating KPIs and outlooks that meet the comparison rules above. Put a separate governance, capital, legal, or transaction update in the single secondary_updates item when it is material, and compress its practical effect into one plain investor-facing sentence rather than reproducing every amendment term. For routine_archive, keep Summary to one or two plain sentences, omit detail_sections and secondary_updates unless a compact source-backed status is useful, and avoid manufacturing bullish or bearish points.",
  "If the original source blocks reveal a stronger listing, financing, transaction, or governance event, override this room and analyze the substantive event type instead.",
].join("\n");

export const sec8k6kAnalysisFamilyPrompts: Record<Sec8k6kAnalysisPromptFamily, string> = {
  risk_status: sec8k6kListingFinancialRiskPrompt,
  capital_financing: sec8k6kFinancingDilutionCapitalStructurePrompt,
  strategic_transaction: sec8k6kStrategicTransactionPrompt,
  governance_vote: sec8k6kGovernanceVoteLeadershipPrompt,
  operating_legal_routine: sec8k6kOperatingLegalRoutinePrompt,
};

export const sec8k6kFinalOutputCheckPrompt = [
  "SECTION: Final output check.",
  "Recheck score_reason and score_explanation.summary before returning. Rewrite either field if it begins with The score, This score, Impact score, an issuer name, ticker, form type, or a filing-action verb; mentions a score level or band; repeats quick_take or summary; or recaps the filing instead of explaining the practical scoring principle.",
  "Never use score, rating, impact band, alert-level, feed-level, archive-level, warrants an alert, or similar system-delivery language in an investor-facing score rationale.",
  "Keep each score rationale to one plain-language analyst conclusion using the strongest one or two drivers and only one material offset when it changes the reading.",
  "Recheck every visible label, value, note, and summary relationship. Separate independent disclosure dimensions, preserve proposed/approved/conditional/effective/completed states, and remove any except, but, cause, condition, or note relationship that the original source does not explicitly support.",
  "When the selected response schema includes key_evidence, rank candidates by direct support for the central investor conclusion and keep only the strongest two or three, each no more than 18 words. Never return four or more items, and do not rely on downstream truncation. For capital_financing, do not return key_evidence.",
  "When analysis_prompt_family is capital_financing, verify that source-backed warrant, convertible, preferred-conversion, pre-funded, or similar instrument mechanics appear in instrument_details rather than only in prose or Offering Details. Correct misplaced mechanics before returning.",
  "For capital_financing, compare security_inventory with instrument_details. Every current-event non-common security whose display_target is instrument_details must be represented by its exact instrument_details_type Type row; restore any omitted family or series before returning.",
  "For capital_financing, remove any instrument_details Type group for plain Common Stock, Ordinary Shares, or ADSs when it only repeats a quantity already shown in snapshot_metrics or share_overhang. Keep the instrument table for securities with distinct mechanics.",
  "For capital_financing with share_overhang, recompute the visible numerator from counted rows only. Make total_note, status_value, and ratio_value agree with that one calculation. Conditional, alternative, and reference rows must never create a second headline percentage. For capital_structure_action, return share_overhang as null when no positive numeric counted supply or numerator is source-backed.",
  "For capital_financing with capital_mode atm_capacity, do not apply counted-issuance reconciliation. Verify that exactly one ATM capacity row is reference, that the basis and row are both shares or both usd, and that total_note uses that same-unit current unsold ATM capacity and denominator. Reject any shares/usd mixed calculation.",
  "For capital_financing, recheck every current-event pre-funded warrant row: source-backed zero or nominal exercise pre-funded supply is counted unless it is explicitly the alternative to an already counted common-share pool. A warrant's alternative settlement feature does not change separately issued initial pre-funded supply.",
  "For capital_financing with a variable or non-calculable current supply component, use Variable or Not fixed yet instead of presenting an all-supply or partial headline percentage as a total potential dilution figure.",
  "For capital_financing route_case debt_or_credit_financing or capital_mode debt_liquidity, recheck activation state before returning. If no adverse trigger is active, analysis_output.score must be 74 or below, standard lender protections must not be the sole basis for a bearish signal, and Summary must preserve both the funding benefit and any material financing burden using conditional language for untriggered remedies.",
  "For capital_financing, analysis_output must not contain key_evidence or what_to_watch_next.",
  "For strategic_transaction, verify display_payload.display_type=strategic_transaction, snapshot_metrics has exactly four non-duplicative source-backed rows, and score_explanation.summary explains the score principle without repeating the transaction recap.",
  "For governance_vote, verify display_payload.display_type=governance_event, governance_mode matches the primary governance event, snapshot_metrics has exactly four non-duplicative rows, and key_changes has one to four source-backed items with no more than three details each. analysis_output must not contain key_evidence or what_to_watch_next, and display_payload must not contain evidence or notes.",
  "For operating_legal_routine, verify display_payload.display_type=operating_event. Every substantive mode needs exactly four non-duplicative snapshot rows; routine_archive uses none. Before returning, recheck operating_mode from the original source blocks: use earnings only when financial results or financial guidance involving revenue, profit or loss, margins, EPS, cash flow, or equivalent financial-statement performance is the primary event. When the primary disclosed performance is production, deliveries, shipments, utilization, uptime, output, operating volume, customers, hashrate, capacity, or comparable non-financial operating guidance, use operating_update even if a technical report or project-economics exhibit is attached. For an operating_update with material project valuation, ownership, reserves, long-term unit economics, or technical economics, group those facts in a detail section titled exactly Project Economics and do not leave them split across Snapshot, Key Business Updates, and Summary. Remove generic optimization goals, future-strategy language, awards, and promotional filler from Key Business Updates. For earnings, recheck that every comparison_basis agrees with its period labels, that a same-period prior-year pair was preferred over a prior-quarter pair for the same headline metric when both were disclosed, and that neutral never exceeds 74. Key Business Updates must carry the strongest supporting facts, secondary_updates may contain at most one distinct additional event, and analysis_output must not contain key_evidence or what_to_watch_next. Do not copy original source text into display_payload evidence or notes; provenance is carried by source_blocks_used IDs.",
  "For earnings, recheck earnings quality before returning. If a reported profit or profit inflection is driven mainly by a non-cash fair-value change, warrant-liability remeasurement, tax benefit, asset-sale gain, or another one-time accounting item, identify that driver in Summary and any affected Snapshot note. Do not use that accounting gain alone to produce a bullish signal or score of 75 or above; recurring operating performance, adjusted profitability, cash flow, demand, or guidance must independently support the direction and range.",
  "For operating_legal_routine, verify regulatory_stage matches the primary FDA or clinical event and is not_applicable when the filing has no controlling FDA or clinical event.",
  "For fda_clinical, recheck that the score follows the most advanced source-backed stage rather than keyword intensity: an appeal, hold removal, review acceptance, PDUFA date, or advisory event must not be described as final approval, and material safety restrictions or remaining review conditions must appear as offsets when they change the score.",
].join("\n");

export function buildSec8k6kAnalysisPromptDraft(input: Sec8k6kAnalysisPromptInput) {
  const displayPayload = buildSec8k6kDisplayPayload({
    parser_output: input.parser_output,
    router_result: input.router_result,
    market_context: input.market_context,
  });
  const sourceInput = buildSec8k6kAnalysisSourcePromptInput(input);
  const promptFamily = resolveSec8k6kAnalysisPromptFamily(input.router_result);
  const promptKey = analysisPromptKeyByFamily[promptFamily];
  const responseSchema = getSec8k6kSpecializedRuntimeResponseSchema(promptFamily) || sec8k6kAnalysisResponseSchema;
  return {
    key: promptKey,
    version: SEC_8K_6K_ANALYSIS_PROMPT_VERSION,
    system: [sec8k6kAnalysisSystemPrompt, sec8k6kAnalysisFamilyPrompts[promptFamily], sec8k6kFinalOutputCheckPrompt].join("\n"),
    user: JSON.stringify({
      ...sourceInput,
      analysis_prompt_family: promptFamily,
      analysis_prompt_key: promptKey,
      analysis_prompt_version: SEC_8K_6K_ANALYSIS_PROMPT_VERSION,
      router_result: routerContextForAnalysis(input.router_result),
      display_payload: displayPayload,
      market_context: input.market_context ?? null,
    }),
    responseFormat: {
      type: "json_schema",
      json_schema: {
        name: "sec_8k_6k_analysis",
        strict: true,
        schema: responseSchema,
      },
    },
  };
}

export function resolveSec8k6kAnalysisPromptFamily(routerResult: Record<string, unknown>): Sec8k6kAnalysisPromptFamily {
  const primaryRoute = readRouteType(readRecord(routerResult.primary_route_candidate)?.route_type);
  const routeCaseFamily = inferFamilyFromRouteCase(stringValue(routerResult.route_case));
  if (primaryRoute === "shareholder_vote" && routeCaseFamily && routeCaseFamily !== "governance_vote") return routeCaseFamily;
  if (primaryRoute === "financial_risk" && routeCaseFamily === "capital_financing") return routeCaseFamily;
  if (primaryRoute) return analysisPromptFamilyByEventType[primaryRoute];

  const firstPrimaryCandidate = readRecordArray(routerResult.route_candidates)
    .filter((candidate) => stringValue(candidate.priority) === "primary")
    .map((candidate) => readRouteType(candidate.route_type))
    .find(Boolean);
  if (firstPrimaryCandidate) return analysisPromptFamilyByEventType[firstPrimaryCandidate];

  const eventType = readRouteType(routerResult.event_type);
  if (eventType) return analysisPromptFamilyByEventType[eventType];

  return routeCaseFamily || "operating_legal_routine";
}

type Sec8k6kAnalysisSourcePromptInput = SecSourceBlockPromptInput & {
  analysis_source_bundle: {
    mode: "analysis_deep";
    selection_source: "all_source_blocks";
    included_source_block_ids: string[];
    included_source_refs: string[];
    warnings: string[];
  };
};

function buildSec8k6kAnalysisSourcePromptInput(input: Sec8k6kAnalysisPromptInput): Sec8k6kAnalysisSourcePromptInput {
  const hasDeferredAmendmentHistory =
    stringValue(readRecord(input.parent_filing_context)?.context_kind) === "current_report_parent_filing" ||
    readRecordArray(input.related_filing_contexts).some(
      (context) => stringValue(context.context_kind) === "current_report_amendment_lifecycle",
    );
  const sourceInput = buildSecSourceBlockPromptInput({
    filingPackage: input.filing_package,
    parserOutput: toRecord(input.parser_output),
    fallbackText: input.filing_excerpt,
    parentFilingContext: input.parent_filing_context,
    relatedFilingContexts: input.related_filing_contexts,
    marketContext: input.market_context,
    includeAmendmentHistoricalSourceBlocks: false,
    maxBlockChars: 6_000,
  });
  const includedIds = sourceInput.cleaned_source_blocks.map((block) => block.block_id);

  return {
    ...sourceInput,
    analysis_source_bundle: {
      mode: "analysis_deep",
      selection_source: "all_source_blocks",
      included_source_block_ids: includedIds,
      included_source_refs: sourceInput.cleaned_source_blocks
        .map((block) => block.source_ref || block.label || block.block_id)
        .filter(Boolean),
      warnings: hasDeferredAmendmentHistory
        ? ["amendment_historical_source_blocks_deferred_until_validation_warning"]
        : [],
    },
  };
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function routerContextForAnalysis(routerResult: Record<string, unknown>) {
  const {
    selected_source_block_ids: _selectedSourceBlockIds,
    selected_source_blocks_by_route: _selectedSourceBlocksByRoute,
    source_blocks_used: _sourceBlocksUsed,
    ...routeContext
  } = routerResult;
  const primaryRouteCandidate = stripRouteCandidateSourceSelection(readRecord(routeContext.primary_route_candidate));
  const routeCandidates = readRecordArray(routeContext.route_candidates).map(stripRouteCandidateSourceSelection);
  return {
    ...routeContext,
    primary_route_candidate: primaryRouteCandidate,
    route_candidates: routeCandidates,
  };
}

function stripRouteCandidateSourceSelection(candidate: Record<string, unknown> | null) {
  if (!candidate) return null;
  const { selected_source_block_ids: _selectedSourceBlockIds, ...routeCandidate } = candidate;
  return routeCandidate;
}

function readRecordArray(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return [];
  return value.map(readRecord).filter((item): item is Record<string, unknown> => Boolean(item));
}

function readRouteType(value: unknown): Sec8k6kEventType | null {
  const routeType = stringValue(value);
  return SEC_8K_6K_APPROVED_EVENT_TYPES.includes(routeType as Sec8k6kEventType) ? (routeType as Sec8k6kEventType) : null;
}

function inferFamilyFromRouteCase(routeCase: string): Sec8k6kAnalysisPromptFamily | null {
  if (!routeCase) return null;
  if (/listing|financial_distress|default|bankrupt|liquidity|going_concern/i.test(routeCase)) return "risk_status";
  if (/strategic|transaction|merger|acquisition|disposition|tender|ipo|spac/i.test(routeCase)) return "strategic_transaction";
  if (/dilution|offering|financing|capital|dividend|buyback|warrant|convertible|reverse_split|authorized/i.test(routeCase)) {
    return "capital_financing";
  }
  if (/vote|leadership|governance|insider|control|auditor|director|officer|compensation/i.test(routeCase)) return "governance_vote";
  if (/earnings|results|sales|operating|product|commercial|legal|regulatory|fda|clinical|routine|amendment|other/i.test(routeCase)) {
    return "operating_legal_routine";
  }
  return null;
}

function stringValue(value: unknown) {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}
