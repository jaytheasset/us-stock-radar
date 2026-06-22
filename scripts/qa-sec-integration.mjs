#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const checks = [];
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

try {
  const contractUrl = tsFileDataUrl("lib/sources/sec/forms/common/secIntegrationContract.ts");
  const adapterUrl = tsFileDataUrl("lib/sources/sec/forms/common/formRoomAdapter.ts", [
    ["from \"./secIntegrationContract\"", `from "${contractUrl}"`],
  ]);
  const promptSource = readFileSync(path.resolve(repoRoot, "lib/prompts/secFilingAnalysis.ts"), "utf8");
  const contract = await import(contractUrl);
  const adapter = await import(adapterUrl);

  const baseFixture = makeFixture();
  const validResult = contract.validateSecRequiredOutputJson(baseFixture);
  check("valid Required Output JSON passes validation", validResult.ok === true, validResult);
  check("SEC contract exposes 16 event types", contract.SEC_INTEGRATION_EVENT_TYPES.length === 16, contract.SEC_INTEGRATION_EVENT_TYPES);
  check("SEC contract includes ipo_listing event type", contract.SEC_INTEGRATION_EVENT_TYPES.includes("ipo_listing"), contract.SEC_INTEGRATION_EVENT_TYPES);
  check(
    "SEC IPO/SPAC score policy means attention urgency",
    contract.SEC_IPO_SPAC_SCORING_POLICY.scoreMeaning === "investor_attention_urgency",
    contract.SEC_IPO_SPAC_SCORING_POLICY,
  );
  check(
    "SEC IPO/SPAC score policy keeps delivery score-derived",
    contract.SEC_IPO_SPAC_SCORING_POLICY.deliveryBands.archive === "score < 50" &&
      contract.SEC_IPO_SPAC_SCORING_POLICY.deliveryBands.feed === "50 <= score < 75" &&
      contract.SEC_IPO_SPAC_SCORING_POLICY.deliveryBands.alert === "score >= 75",
    contract.SEC_IPO_SPAC_SCORING_POLICY.deliveryBands,
  );
  check(
    "SEC prompt includes Traditional IPO scoring policy",
    promptSource.includes("Traditional IPO scoring") &&
      promptSource.includes("424B4/final prospectus with final pricing 65-78") &&
      promptSource.includes("pricing below range +8 to +15"),
    undefined,
  );
  check(
    "SEC prompt includes SPAC/de-SPAC alert policy",
    promptSource.includes("SPAC/de-SPAC scoring") &&
      promptSource.includes("redemption rate 80%+") &&
      promptSource.includes("minimum cash condition not satisfied or waiver/backstop needed"),
    undefined,
  );
  check(
    "SEC prompt prevents underwriter-only alerts",
    promptSource.includes("Underwriter alone must not force alert") &&
      promptSource.includes("underwriters and lead_underwriters") &&
      promptSource.includes("ipo_underwriter"),
    undefined,
  );
  check(
    "SEC prompt documents generic fallback for incomplete special display payloads",
    promptSource.includes("display_payload.display_type generic") &&
      promptSource.includes("report missing fields in display_payload.notes"),
    undefined,
  );
  check(
    "SEC shareholder vote score policy means attention urgency",
    contract.SEC_SHAREHOLDER_VOTE_SCORING_POLICY.scoreMeaning === "investor_attention_urgency" &&
      contract.SEC_SHAREHOLDER_VOTE_SCORING_POLICY.guidance.typicalAlertBand === "75-84" &&
      contract.SEC_SHAREHOLDER_VOTE_SCORING_POLICY.caps.routineProposal === 49,
    contract.SEC_SHAREHOLDER_VOTE_SCORING_POLICY,
  );
  check(
    "SEC shareholder vote policy keeps 90+ extremely rare",
    contract.SEC_SHAREHOLDER_VOTE_SCORING_POLICY.guidance.ninetyPlus ===
      "extremely_rare_source_backed_extreme_outcome_only" &&
      contract.SEC_SHAREHOLDER_VOTE_SCORING_POLICY.ninetyPlusAllowedOnlyFor.includes(
        "proxy_contest_result_actually_changes_control",
      ),
    contract.SEC_SHAREHOLDER_VOTE_SCORING_POLICY,
  );
  check(
    "SEC prompt includes shareholder vote archive/feed/alert ranges",
    promptSource.includes("Shareholder vote archive scoring") &&
      promptSource.includes("routine annual meeting with director election or auditor ratification only 25-38") &&
      promptSource.includes("Shareholder vote feed scoring") &&
      promptSource.includes("reverse split proposal 52-68") &&
      promptSource.includes("Shareholder vote alert scoring") &&
      promptSource.includes("SPAC merger vote tied to redemption/cash-condition risk 75-84"),
    undefined,
  );
  check(
    "SEC prompt caps routine shareholder vote scoring",
    promptSource.includes("routine proposal cap 49") &&
      promptSource.includes("simple vote schedule disclosure cap 72") &&
      promptSource.includes("approval-request stage usually caps at 82") &&
      promptSource.includes("only actual failed, unexpected, or control-change outcomes should exceed 85"),
    undefined,
  );
  check(
    "SEC prompt prevents shareholder vote alert by form alone",
    promptSource.includes("Do not mark a shareholder_vote as alert just because it is a vote") &&
      promptSource.includes("Use evidence-backed score rationale") &&
      promptSource.includes("derive delivery_level from score only"),
    undefined,
  );

  check("score 49 derives archive", contract.deriveSecDeliveryLevel(49) === "archive");
  check("score 50 derives feed", contract.deriveSecDeliveryLevel(50) === "feed");
  check("score 74 derives feed", contract.deriveSecDeliveryLevel(74) === "feed");
  check("score 75 derives alert", contract.deriveSecDeliveryLevel(75) === "alert");

  const invalidEventType = makeFixture({
    analysis_output: {
      event_type: "made_up_event_type",
    },
  });
  const invalidEventResult = contract.validateSecRequiredOutputJson(invalidEventType);
  check(
    "invalid event_type is rejected",
    invalidEventResult.ok === false && includesError(invalidEventResult, "analysis_output.event_type"),
    invalidEventResult,
  );

  const ipoListingResult = contract.validateSecRequiredOutputJson(
    makeFixture({
      analysis_output: {
        event_type: "ipo_listing",
      },
      display_payload: {
        display_type: "ipo_listing",
        data: {
          ipo_kind: "Traditional IPO",
          current_stage: "terms_set",
          issuer: "QA IPO Co.",
          proposed_ticker: "QIPO",
          exchange: "NASDAQ",
          price_range: "$18-$20",
          underwriters: "QA Securities",
          use_of_proceeds: ["Fund growth."],
          stages: [{ code: "s1_filed", label: "S-1/F-1 Filed" }],
          risk_flags: ["Loss-making issuer."],
          watch_next: ["SEC effectiveness."],
          sources: [{ title: "S-1/A", detail: "IPO terms" }],
        },
      },
    }),
  );
  check("ipo_listing display payload is accepted", ipoListingResult.ok === true, ipoListingResult);

  const invalidIpoKindResult = contract.validateSecRequiredOutputJson(
    makeFixture({
      analysis_output: {
        event_type: "ipo_listing",
      },
      display_payload: {
        display_type: "ipo_listing",
        data: {
          ipo_kind: "de_spac",
        },
      },
    }),
  );
  check(
    "ipo_listing rejects unsupported ipo_kind",
    invalidIpoKindResult.ok === false && includesError(invalidIpoKindResult, "display_payload.data.ipo_kind"),
    invalidIpoKindResult,
  );

  const missingIpoKindResult = contract.validateSecRequiredOutputJson(
    makeFixture({
      analysis_output: {
        event_type: "ipo_listing",
      },
    }),
  );
  check(
    "ipo_listing requires ipo_kind in display payload data",
    missingIpoKindResult.ok === false && includesError(missingIpoKindResult, "display_payload.data.ipo_kind"),
    missingIpoKindResult,
  );

  const invalidIpoListingPayload = contract.validateSecRequiredOutputJson(
    makeFixture({
      analysis_output: {
        event_type: "ipo_listing",
      },
      display_payload: {
        display_type: "ipo_listing",
        data: {
          ipo_kind: "Traditional IPO",
          current_stage: "roadshow",
          use_of_proceeds: "not-an-array",
        },
      },
    }),
  );
  check(
    "ipo_listing display payload fields are validated",
    invalidIpoListingPayload.ok === false &&
      includesError(invalidIpoListingPayload, "display_payload.data.current_stage") &&
      includesError(invalidIpoListingPayload, "display_payload.data.use_of_proceeds"),
    invalidIpoListingPayload,
  );

  const invalidDisplayType = makeFixture({
    display_payload: {
      display_type: "custom_special",
    },
  });
  const invalidDisplayResult = contract.validateSecRequiredOutputJson(invalidDisplayType);
  check(
    "invalid display_payload.display_type is rejected",
    invalidDisplayResult.ok === false && includesError(invalidDisplayResult, "display_payload.display_type"),
    invalidDisplayResult,
  );

  const adapted = adapter.adaptSecFormRoomOutputForIngest(baseFixture);
  check("adapter returns production output", adapted.ok === true, adapted);
  check(
    "adapter includes score-derived delivery_level",
    adapted.ok === true && adapted.value.analysis_output.delivery_level === "alert",
    adapted.ok ? adapted.value.analysis_output : adapted,
  );
  check(
    "adapter preserves optional filing_context",
    adapted.ok === true && Array.isArray(adapted.value.filing_context?.ownership?.same_insider_12m_trades),
    adapted.ok ? adapted.value.filing_context : adapted,
  );

  const fingerprintFixture = makeFixture({
    transaction_fingerprint: {
      transaction_family: "going_private",
      transaction_type: "going_private_cash_out",
      target_company: "QA Target",
      cash_price: "$10.00",
      source_accession: "0000000000-26-000001",
      source_evidence: ["QA source-backed tender evidence."],
    },
  });
  const fingerprintAdapted = adapter.adaptSecFormRoomOutputForIngest(fingerprintFixture);
  check("optional transaction_fingerprint is valid", fingerprintAdapted.ok === true, fingerprintAdapted);
  check(
    "adapter preserves optional transaction_fingerprint metadata",
    fingerprintAdapted.ok === true &&
      fingerprintAdapted.value.metadata.transaction_fingerprint?.transaction_family === "going_private",
    fingerprintAdapted.ok ? fingerprintAdapted.value.metadata.transaction_fingerprint : fingerprintAdapted,
  );

  const noContextAdapted = adapter.adaptSecFormRoomOutputForIngest(makeFixture({ filing_context: undefined }));
  check("missing filing_context is valid", noContextAdapted.ok === true, noContextAdapted);
  check(
    "missing filing_context is omitted from adapter output",
    noContextAdapted.ok === true && !("filing_context" in noContextAdapted.value),
    noContextAdapted.ok ? noContextAdapted.value : noContextAdapted,
  );

  const parserContextFixture = makeFixture({
    parser_output: {
      filing_context: {
        ownership: {},
      },
    },
  });
  const parserContextResult = contract.validateSecRequiredOutputJson(parserContextFixture);
  check(
    "parser_output.filing_context is rejected",
    parserContextResult.ok === false && includesError(parserContextResult, "parser_output.filing_context"),
    parserContextResult,
  );

  const invalidOwnershipContext = makeFixture({
    filing_context: {
      ownership: {
        same_insider_12m_trades: null,
        company_90d_insider_flow: null,
        recent_30d_cluster: null,
      },
      context_as_of: null,
      source_notes: [],
    },
  });
  const invalidOwnershipResult = contract.validateSecRequiredOutputJson(invalidOwnershipContext);
  check(
    "filing_context ownership fields are validated",
    invalidOwnershipResult.ok === false && includesError(invalidOwnershipResult, "same_insider_12m_trades"),
    invalidOwnershipResult,
  );

  const candidateSpecial = adapter.adaptSecFormRoomOutputForIngest(
    makeFixture({
      display_payload: {
        display_type: "candidate_special",
        data: {
          proposed_component: "ownership-change-timeline",
        },
      },
    }),
  );
  check("candidate_special adapter output is valid", candidateSpecial.ok === true, candidateSpecial);
  check(
    "candidate_special is metadata only",
    candidateSpecial.ok === true &&
      candidateSpecial.value.metadata.candidate_special_metadata_only === true &&
      candidateSpecial.value.metadata.display_payload_storage_mode === "metadata_only" &&
      candidateSpecial.value.structured_persistence_targets.length === 0,
    candidateSpecial.ok ? candidateSpecial.value : candidateSpecial,
  );

  const offeringTerms = adapter.adaptSecFormRoomOutputForIngest(
    makeFixture({
      analysis_output: {
        event_type: "dilution_risk",
      },
      display_payload: {
        display_type: "offering_terms",
        data: {
          offering_amount: "$100 million",
        },
      },
    }),
  );
  check("offering_terms adapter output is valid", offeringTerms.ok === true, offeringTerms);
  check(
    "offering_terms is eligible for event_offering_terms mapping",
    offeringTerms.ok === true &&
      offeringTerms.value.metadata.display_payload_storage_mode === "metadata_and_offering_terms_candidate" &&
      offeringTerms.value.structured_persistence_targets.includes("event_offering_terms"),
    offeringTerms.ok ? offeringTerms.value : offeringTerms,
  );

  const ipoListingAdapter = adapter.adaptSecFormRoomOutputForIngest(
    makeFixture({
      analysis_output: {
        event_type: "ipo_listing",
        score: 70,
      },
      display_payload: {
        display_type: "ipo_listing",
        data: {
          ipo_kind: "Traditional IPO",
          current_stage: "terms_set",
          issuer: "QA IPO Co.",
          proposed_ticker: "QIPO",
          exchange: "NASDAQ",
          underwriters: "QA Securities",
          use_of_proceeds: ["Fund growth."],
          stages: [{ code: "terms_set", label: "Terms / Range Set" }],
          risk_flags: ["Loss-making issuer."],
          watch_next: ["Final prospectus."],
          sources: [{ title: "S-1/A", detail: "IPO terms" }],
        },
      },
    }),
  );
  check("ipo_listing adapter output is valid", ipoListingAdapter.ok === true, ipoListingAdapter);
  check(
    "ipo_listing display payload is metadata only",
    ipoListingAdapter.ok === true &&
      ipoListingAdapter.value.metadata.display_payload_storage_mode === "metadata_only" &&
      ipoListingAdapter.value.structured_persistence_targets.length === 0,
    ipoListingAdapter.ok ? ipoListingAdapter.value : ipoListingAdapter,
  );

  const spacStatus = adapter.adaptSecFormRoomOutputForIngest(
    makeFixture({
      analysis_output: {
        event_type: "strategic_transaction",
        score: 72,
      },
      display_payload: {
        display_type: "spac_transaction_status",
        data: {
          current_stage: "redemption",
          current_stage_label: "Redemption Result",
          deal_status: "Vote approved / closing pending",
          spac_status: "Vote approval moved the de-SPAC toward closing, but cash and listing conditions remain in focus.",
          target_company: "QA Mobility Systems",
          target_company_story: "QA Mobility Systems provides commercial fleet electrification software.",
          expected_ticker: "QAM",
          deal_value: "$350.0M",
          announced_date: "2026-03-18",
          merger_agreement_date: "2026-03-18",
          sponsor: "QA Sponsor LLC",
          ipo_underwriter: "EF Hutton",
          ipo_date: "2025-04-02",
          unit_right_warrant_terms: "Units include one share and one-half warrant.",
          vote_date: "2026-06-18",
          redemption_deadline: "2026-06-16",
          redemption_result_date: "2026-06-19",
          redemption_rate: "78%",
          min_cash_condition: "$50.0M",
          min_cash_status: "At risk",
          stages: [
            { code: "target", label: "Target / Deal Signed" },
            { code: "proxy", label: "SEC Filing / Proxy" },
            { code: "vote", label: "Vote & Redemption Window" },
            { code: "redemption", label: "Redemption Result" },
            { code: "cash", label: "Cash / Listing Conditions" },
            { code: "closing", label: "Closing / Ticker Change" },
          ],
          risk_flags: ["Minimum cash condition may need waiver."],
          watch_next: ["Closing 8-K or waiver update."],
          sources: [{ title: "8-K vote results", detail: "Redemption result disclosure" }],
          event_history: [{ date: "2026-06-19", title: "Redemption result filed", form: "8-K" }],
        },
      },
    }),
  );
  check("spac_transaction_status adapter output is valid", spacStatus.ok === true, spacStatus);
  check(
    "spac_transaction_status is metadata only",
    spacStatus.ok === true &&
      spacStatus.value.metadata.display_payload_storage_mode === "metadata_only" &&
      spacStatus.value.structured_persistence_targets.length === 0,
    spacStatus.ok ? spacStatus.value : spacStatus,
  );

  const listingRiskStatus = adapter.adaptSecFormRoomOutputForIngest(
    makeFixture({
      analysis_output: {
        event_type: "listing_risk",
        score: 68,
      },
      display_payload: {
        display_type: "listing_risk",
        data: {
          exchange: "Nasdaq",
          compliance_status: "Active deficiency disclosed",
          deficiency_notice: "Minimum bid price deficiency notice",
          main_risk_driver: "Bid price below representative continued-listing threshold",
          current_point: "Cure period active",
          notice_date: "2026-06-18",
          cure_deadline: "2026-12-15",
          extension_eligibility: "Potentially eligible if other standards are met",
          appeal_hearing_status: "No hearing disclosed",
          checks: [{ label: "Bid Price", value: "$0.43", status: "Deficient" }],
          timeline: [{ label: "Notice Date", date: "2026-06-18", status: "Complete" }],
          risk_flags: ["Bid-price deficiency active."],
          watch_next: ["Cure deadline or extension determination."],
          sources: [{ title: "8-K Nasdaq notice", detail: "Deficiency notice and cure period" }],
        },
      },
    }),
  );
  check("listing_risk adapter output is valid", listingRiskStatus.ok === true, listingRiskStatus);
  check(
    "listing_risk display payload is metadata only",
    listingRiskStatus.ok === true &&
      listingRiskStatus.value.metadata.display_payload_storage_mode === "metadata_only" &&
      listingRiskStatus.value.structured_persistence_targets.length === 0,
    listingRiskStatus.ok ? listingRiskStatus.value : listingRiskStatus,
  );

  const earningsStatus = adapter.adaptSecFormRoomOutputForIngest(
    makeFixture({
      analysis_output: {
        event_type: "earnings",
        score: 66,
      },
      display_payload: {
        display_type: "earnings",
        data: {
          period_type: "quarterly",
          period: "Q1 2026",
          revenue: "$612.4M",
          eps: "$0.28",
          net_income: "$18.6M",
          guidance_summary: "Full-year revenue guidance maintained.",
          cash: "$142.0M",
          actuals: [{ label: "Revenue", value: "$612.4M", comparison: "+4.8% YoY" }],
          guidance: [{ label: "Revenue Guidance", value: "$2.45B-$2.55B", comparison: "Maintained" }],
          segments: [{ name: "Stores", revenue: "$438.0M", performance: "+6.1% YoY" }],
          surprises: [{ label: "Consensus Context", value: "Not available" }],
          risk_flags: ["Margin pressure remains."],
          watch_next: ["Next-quarter gross margin."],
          sources: [{ title: "Form 10-Q", detail: "Quarterly financial statements" }],
        },
      },
    }),
  );
  check("earnings adapter output is valid", earningsStatus.ok === true, earningsStatus);
  check(
    "earnings display payload is metadata only",
    earningsStatus.ok === true &&
      earningsStatus.value.metadata.display_payload_storage_mode === "metadata_only" &&
      earningsStatus.value.structured_persistence_targets.length === 0,
    earningsStatus.ok ? earningsStatus.value : earningsStatus,
  );

  const fdaClinicalStatus = adapter.adaptSecFormRoomOutputForIngest(
    makeFixture({
      analysis_output: {
        event_type: "fda_clinical",
        score: 82,
      },
      display_payload: {
        display_type: "fda_clinical",
        data: {
          phase: "Phase 3",
          indication: "Second-line ovarian cancer",
          therapy: "AT-201",
          trial_name: "AURORA-301",
          event_status: "Topline data disclosed",
          primary_endpoint: "Progression-free survival",
          fda_status: "FDA meeting not yet held",
          key_takeaways: ["Primary endpoint met.", "FDA meeting timing is next."],
          fda_timeline: [{ label: "Topline readout", date: "May 2026", status: "Current" }],
          data_highlights: [{ label: "Primary endpoint", value: "Met" }],
          risks: ["Overall survival remains immature."],
          watch_next: ["FDA meeting request."],
          sources: [{ title: "Form 8-K", detail: "Clinical update" }],
        },
      },
    }),
  );
  check("fda_clinical adapter output is valid", fdaClinicalStatus.ok === true, fdaClinicalStatus);
  check(
    "fda_clinical display payload is metadata only",
    fdaClinicalStatus.ok === true &&
      fdaClinicalStatus.value.metadata.display_payload_storage_mode === "metadata_only" &&
      fdaClinicalStatus.value.structured_persistence_targets.length === 0,
    fdaClinicalStatus.ok ? fdaClinicalStatus.value : fdaClinicalStatus,
  );

  const invalidSpacStatus = contract.validateSecRequiredOutputJson(
    makeFixture({
      display_payload: {
        display_type: "spac_transaction_status",
        data: {
          risk_flags: "not-an-array",
        },
      },
    }),
  );
  check(
    "spac_transaction_status array fields are validated",
    invalidSpacStatus.ok === false && includesError(invalidSpacStatus, "display_payload.data.risk_flags"),
    invalidSpacStatus,
  );

  const invalidSpacStage = contract.validateSecRequiredOutputJson(
    makeFixture({
      display_payload: {
        display_type: "spac_transaction_status",
        data: {
          current_stage: "de_spac_vibes",
        },
      },
    }),
  );
  check(
    "spac_transaction_status current_stage is validated",
    invalidSpacStage.ok === false && includesError(invalidSpacStage, "display_payload.data.current_stage"),
    invalidSpacStage,
  );

  const invalidListingRiskPayload = contract.validateSecRequiredOutputJson(
    makeFixture({
      analysis_output: {
        event_type: "listing_risk",
      },
      display_payload: {
        display_type: "listing_risk",
        data: {
          checks: "not-an-array",
        },
      },
    }),
  );
  check(
    "listing_risk array fields are validated",
    invalidListingRiskPayload.ok === false && includesError(invalidListingRiskPayload, "display_payload.data.checks"),
    invalidListingRiskPayload,
  );

  const invalidEarningsPayload = contract.validateSecRequiredOutputJson(
    makeFixture({
      analysis_output: {
        event_type: "earnings",
      },
      display_payload: {
        display_type: "earnings",
        data: {
          actuals: "not-an-array",
        },
      },
    }),
  );
  check(
    "earnings array fields are validated",
    invalidEarningsPayload.ok === false && includesError(invalidEarningsPayload, "display_payload.data.actuals"),
    invalidEarningsPayload,
  );

  const invalidFdaClinicalPayload = contract.validateSecRequiredOutputJson(
    makeFixture({
      analysis_output: {
        event_type: "fda_clinical",
      },
      display_payload: {
        display_type: "fda_clinical",
        data: {
          key_takeaways: "not-an-array",
        },
      },
    }),
  );
  check(
    "fda_clinical array fields are validated",
    invalidFdaClinicalPayload.ok === false && includesError(invalidFdaClinicalPayload, "display_payload.data.key_takeaways"),
    invalidFdaClinicalPayload,
  );

  const ok = checks.every((item) => item.ok);
  console.log(
    JSON.stringify(
      {
        ok,
        summary: {
          checkedEventTypeCount: contract.SEC_INTEGRATION_EVENT_TYPES.length,
          displayPayloadTypes: contract.SEC_DISPLAY_PAYLOAD_TYPES,
          liveCalls: false,
        },
        checks,
      },
      null,
      2,
    ),
  );
  process.exitCode = ok ? 0 : 1;
} catch (error) {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
}

function makeFixture(overrides = {}) {
  const fixture = {
    parser_output: {
      parserVersion: "qa-sec-parser-v1",
      parserGroup: "qa",
      formType: "8-K",
      accessionNumber: "0000000000-26-000001",
      isSupported: true,
      summary: "QA parser output.",
      facts: {},
      signals: [],
      calendarItems: [],
      warnings: [],
      raw: {},
    },
    filing_context: {
      ownership: {
        same_insider_12m_trades: [],
        company_90d_insider_flow: null,
        recent_30d_cluster: null,
      },
      context_as_of: null,
      source_notes: [],
    },
    analysis_output: {
      source_group: "filings",
      market_scope: "company",
      event_type: "product_update",
      event_title: "QA issuer files test disclosure",
      primary_ticker: {
        ticker: "QA",
        exchange: "NASDAQ",
      },
      tickers: ["QA"],
      sector: null,
      industry_group: null,
      theme_group: null,
      sub_theme: null,
      score: 80,
      score_reason: "QA score reason.",
      signal: "neutral",
      quick_take: "QA quick take.",
      summary: "QA summary.",
      why_it_matters: "QA why it matters.",
      bullish_points: [],
      bearish_points: [],
      key_evidence: ["QA evidence."],
      what_to_watch_next: [],
      related_tickers: [],
      calendar_items: [],
      confidence: "high",
      needs_human_review: false,
    },
    display_payload: {
      display_type: "generic",
      data: {},
      evidence: [],
      notes: [],
    },
  };

  return mergeFixture(fixture, overrides);
}

function mergeFixture(base, overrides) {
  const output = { ...base };
  for (const [key, value] of Object.entries(overrides)) {
    if (isPlainObject(value) && isPlainObject(output[key])) {
      output[key] = {
        ...output[key],
        ...value,
      };
      continue;
    }
    output[key] = value;
  }
  return output;
}

function check(name, ok, detail) {
  checks.push({ name, ok: Boolean(ok), detail: ok ? undefined : detail });
}

function includesError(result, text) {
  return Array.isArray(result.errors) && result.errors.some((error) => String(error).includes(text));
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function tsFileDataUrl(relativePath, replacements = []) {
  const filename = path.resolve(repoRoot, relativePath);
  const source = readFileSync(filename, "utf8");
  const rewritten = replacements.reduce((text, [from, to]) => text.replace(from, to), source);
  const output = stripTypeScriptTypes(rewritten, {
    mode: "transform",
    fileName: filename,
  });
  return `data:text/javascript;base64,${Buffer.from(output).toString("base64")}`;
}
