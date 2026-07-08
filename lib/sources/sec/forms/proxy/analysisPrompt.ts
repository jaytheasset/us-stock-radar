import {
  APPROVED_PROXY_EVENT_TYPES,
  type ProxyParserOutput,
} from "./parser.ts";
import type { ProxyDisplayPayload } from "./displayPayload.ts";
import type { ProxyRouterDecision } from "./routerPrompt.ts";
import { buildProxySourceBlockPromptInput } from "./routerPrompt.ts";

export interface ProxyAnalysisPromptInput {
  parserOutput: ProxyParserOutput;
  routerDecision: ProxyRouterDecision;
  marketContext?: Record<string, unknown> | null;
}

export const SEC_PROXY_ANALYSIS_PROMPT_KEY = "sec_proxy_analysis";
export const SEC_PROXY_ANALYSIS_PROMPT_VERSION = "proxy-analysis-v3-unified-proxy-vote";

export function buildProxyAnalysisPrompt(input: ProxyAnalysisPromptInput): string {
  return [
    ...proxyOpeningInstructions(),
    "",
    "Allowed event_type values:",
    ...APPROVED_PROXY_EVENT_TYPES.map((eventType) => `- ${eventType}`),
    "",
    ...proxyDisplayInstructions(),
    "",
    ...proxyWritingInstructions(),
    "",
    ...proxyScoringInstructions(),
    "",
    "Return JSON only in this exact top-level shape:",
    JSON.stringify(requiredOutputSkeleton(), null, 2),
    ...proxyRuntimeHintSections(input.routerDecision),
    "",
    "cleaned_source_blocks:",
    JSON.stringify(buildProxySourceBlockPromptInput(input.parserOutput, input.marketContext ?? null), null, 2),
    "",
    "market_context_fixture:",
    JSON.stringify(input.marketContext ?? null, null, 2),
  ].join("\n");
}

function proxyOpeningInstructions(): string[] {
  return [
    "You are writing investor-facing analysis for an SEC Proxy filing.",
    "",
    "Use cleaned_source_blocks as source-backed evidence. Do not call live market data, live FMP, live DB, alerts, ingest, or app/UI systems.",
    "Use the filing text as source of truth. If a fact is not stated, write Not disclosed or use an empty array.",
    "Do not copy parser labels or SEC boilerplate as prose. Rewrite source-backed facts in clear investor language.",
    "Choose event_type yourself from the source blocks.",
    "Always use display_payload.display_type = proxy_vote and display_payload.display_version = proxy_vote_v1.",
    "Treat router_decision as a non-binding parser hint only. It may be a placeholder and must not control the final UI.",
    "If market context exists, use only the fixture JSON market_context provided below.",
    "Preserve parser warnings when the filing is preliminary, notice-only, supplemental, image-heavy, or filed by a third-party solicitor.",
  ];
}

function proxyDisplayInstructions(): string[] {
  return [
    "Use one proxy UI contract for every proxy filing:",
    "- display_payload.display_type: proxy_vote",
    "- display_payload.display_version: proxy_vote_v1",
    "- display_payload.data.summary_title: choose one approved title when it fits: Proxy Vote Summary, Proxy Materials Update, Meeting Update, Transaction Vote Summary, Capital Vote Summary, Equity Plan Vote Summary, Governance Vote Summary, Proxy Contest Update, SPAC Extension Vote. Use a short custom title only when none fits.",
    "- display_payload.data.summary_sentence: one plain sentence under 160 characters explaining what shareholders are voting on.",
    "- display_payload.data.snapshot: 2 to 4 compact tiles for proposal-based proxy filings. Use [] for supplemental materials with no new proposal or vote change.",
    "- display_payload.data.proposals: the visible agenda table. Include every material proposal stated in this proxy filing. Use an empty array only when this filing is supplemental proxy material with no standalone proposal text.",
    "Snapshot labels should be selected from these investor-readable labels when applicable: Meeting Date, Record Date, Vote Date, Proposal Count, Board View, Split Ratio, Timing, Listing Issue, Authorized Shares, Plan Shares, % Outstanding, Vote Required, Deal Terms, Consideration, Closing Conditions, Target / Ticker, Cash Condition, Redemptions, Contest Status, Deadline, Extension Period, Extension Payment.",
    "Snapshot label max 24 characters, value max 40 characters, note max 80 characters. If the source text is long, put a compact value in value and the explanation in note.",
    "Every proposal item must include id, title, type, board_recommendation, is_shareholder_proposal, and details.",
    "For proposal type, use investor-readable labels such as Director election, Executive pay vote, Auditor approval, Equity plan, Merger vote, Reverse split, Authorized shares, Listing vote, SPAC extension, Trust amendment, SPAC / de-SPAC, Adjournment, Shareholder proposal, Governance, or Other.",
    "For board_recommendation, use the board recommendation shown by the filing, usually Support, Oppose, Withhold, Mixed, or Not disclosed.",
    "For routine annual proposals, details may be empty unless the filing states a material unusual term.",
    "For merger/transaction, reverse split, authorized-share, equity plan, listing/share-issuance, SPAC/de-SPAC, contested, shareholder, or governance proposals, add proposal.details with the important terms directly under that proposal.",
    "For SPAC extension votes, do not label every proposal as SPAC / de-SPAC. Use SPAC extension, Trust amendment, and Adjournment when those labels fit the stated proposals.",
    "For SPAC extension or trust amendment proposals, include source-backed proposal.details for current deadline, new deadline, extension period, extension payment/deposit, vote requirement, failure consequence, and named target/deal/ticker when stated.",
    "For SPAC extension votes, prefer snapshot tiles for new deadline, target/ticker if stated, extension payment, and redemption/liquidation consequence.",
    "Each proposal.details item uses label and value. Omit note by default because the UI is compact. Use note only when the value would be misleading without a source-stated condition, and keep note under 80 characters.",
    "For DEFA14A or other additional proxy materials that only add solicitation materials, presentations, websites, ads, letters, or campaign updates, do not invent an N/A proposal row or snapshot tiles. Use proposals: [], snapshot: [], and explain the update in summary_sentence.",
    "For archive-level supplemental proxy materials with no new proposal or vote change, use summary_title = Proxy Materials Update, keep summary_sentence concise, and set analysis_output.what_to_watch_next = [] and analysis_output.key_evidence = [].",
    "Do not create separate proposal_modules. Put proposal-specific details inside the matching proposal.details array.",
    "- display_payload.data.expected_followup_forms: optional internal list of likely follow-up filing forms. This is not UI copy. Do not force these form names into what_to_watch_next.",
    "Do not put proposal-specific facts only in summary. If a fact matters to a proposal-based proxy UI, put it in display_payload.data.snapshot or display_payload.data.proposals.",
    "display_payload.evidence and display_payload.notes are optional support only. They do not replace display_payload.data and may be empty when visible data is complete.",
    "Do not rely on analysis_output.summary to introduce the proxy card. Put the card sentence in display_payload.data.summary_sentence.",
  ];
}

function proxyWritingInstructions(): string[] {
  return [
    "Common investor output:",
    "- event_title: investor-facing headline under 90 characters.",
    "- quick_take: one sentence under 22 words. Make it an investor message, not a filing restatement.",
    "- summary: one or two concise sentences. Do not repeat quick_take.",
    "- why_it_matters: one sentence under 35 words, or a concise reason the vote can matter.",
    "- key_evidence: at most three compact source-backed items.",
    "- what_to_watch_next: at most three concrete follow-up items, each under 72 characters.",
    "- what_to_watch_next must be event-first UI text. Do not hard-code a single follow-up filing form as mandatory.",
    "- Use filing form names only as supporting context when necessary; otherwise write the event investors should check.",
    "- For shareholder vote results, prefer UI wording like Voting results after the meeting. Do not always write Form 8-K voting results.",
    "- For U.S. domestic issuers, vote results are usually reported on Form 8-K Item 5.07. If final results are not available, an amended 8-K may follow. For foreign private issuers, results may appear on Form 6-K. Put these forms in display_payload.data.expected_followup_forms, not as mandatory UI text.",
    "- Routine annual proxy: voting results after the meeting; add one specific proposal follow-up only when source-backed.",
    "- Equity plan vote: approval result; later S-8 only if additional plan shares are registered.",
    "- Authorized-share vote: approval result; later financing, resale, or listing disclosure if relevant. Do not default to S-8.",
    "- Merger or transaction vote: vote result; closing or completion disclosure; delisting or ticker change if applicable.",
    "- Reverse split vote: vote result; effective date or final split ratio; exchange compliance update if applicable.",
    "- SPAC/de-SPAC vote: vote result; final redemptions; closing or extension status; ticker change if applicable.",
    "- For SPAC extension votes, if a named target, signed business combination agreement, or expected post-close ticker is disclosed, mention it in summary and summary_sentence. Do not reduce it to a generic business combination deadline.",
    "- For SPAC extension votes, use event-first items such as voting results for extension proposals, final redemption count after the vote, extension deposits if extensions are used, target transaction progress, or closing timeline.",
    "- Contested proxy: final vote; proxy supplement or settlement; board composition changes if applicable.",
    "- Keep items concise, but do not make them vague only to meet the length cap.",
    "- score_reason: under 18 words.",
    "- Always include score_explanation. Do not omit it and do not return null.",
    "- Only write score_explanation.summary. Do not add base_band, upward_factors, limiting_factors, final_read, or other nested score fields for proxy filings.",
    "- score_explanation.summary is the visible text: write one concise analyst-style conclusion for stock investors, 18-32 words, focused on the practical investor impact.",
    "- Do not format score_explanation.summary as bullets, labels, sections, or an internal scoring review.",
    "- Do not mention \"the score\", score level, form type, SEC form label, or filing mechanics in score_explanation.summary.",
    "- For supplemental proxy materials with no new vote item, explain whether the shareholder decision changed.",
    "- Do not start score_explanation.summary with the issuer name, ticker, form type, filed, scheduled, announced, or registered.",
    "- Do not repeat quick_take or summary. Write the score rationale, not another filing summary.",
    "Avoid duplicate wording between quick_take, summary, key_evidence, and what_to_watch_next.",
  ];
}

function proxyScoringInstructions(): string[] {
  return [
    "Score bands are fixed:",
    "- score below 50: archive",
    "- score 50 to 74: feed",
    "- score 75 or above: alert",
    "Proxy scoring guide:",
    "- Core rule: score only what this proxy filing asks shareholders to vote on or materially updates. Do not score up merely because the form is DEF 14A, PRE 14A, DEFM14A, or DEFA14A.",
    "- Routine annual meeting: director elections, say-on-pay, say-on-frequency, and auditor ratification only should be 25-49. Use 50+ only with a source-backed contested item, shareholder proposal, weak governance issue, compensation issue, transaction, listing, legal, or control-change driver.",
    "- Equity plan vote: score by requested shares or dilution scale when stated. Under 5% of outstanding usually 35-49; 5-10% usually 50-59; 10-20% usually 60-69; over 20% usually 70-79. Use 75+ only when large reserve plus microcap, listing, financing, or dilution pressure is source-backed.",
    "- Reverse split or listing capital vote: a reverse stock split proposal is alert-worthy by itself, even when it is the only material proposal. If any proposal asks for a reverse stock split, do not score below 75. Reverse split proposals should usually score 75-84, especially for small/microcap issuers, Nasdaq/NYSE minimum bid issues, delisting deadlines, or listing compliance. Authorized-share increase is 45-64 routine, 65-79 when it creates large future issuance capacity or is tied to financing/dilution pressure.",
    "- Reverse split combined with warrant/share issuance approval, authorized-share increase, financing capacity, Nasdaq/NYSE compliance, or minimum-bid pressure should normally score 78-84.",
    "- Merger, acquisition, sale, or business-combination vote: usually 58-74. Use 75-88 when vote failure risk, appraisal risk, closing-condition risk, minimum-cash risk, regulatory issue, deal break risk, delisting, ticker transition, or changed holder economics is source-backed.",
    "- SPAC or de-SPAC vote/status: proxy filed or vote pending usually 55-74. Use 75-88 for high redemptions, minimum cash risk, waiver/backstop need, redemption deadline, closing uncertainty, or imminent closing/ticker change. Score from closing/redemption/cash risk, not from the SPAC label alone.",
    "- SPAC extension vote: score higher within 55-74 when a named target or signed business combination exists and the extension is needed to complete that deal. Use 75+ only when source-backed redemption, minimum cash, liquidation, or deal-break risk is acute.",
    "- Contested proxy or governance fight: routine shareholder proposal usually 35-59. Dissident slate, third-party solicitation, recommendation change, or board-control fight usually 65-84; use 75+ when board control or strategic direction could change.",
    "- IPO or listing proxy: ordinary listing approval usually 45-64. Use 65-79 when the vote gates listing, reverse split/listing compliance, financing timing, or ticker transition.",
    "- Legal, regulatory, investigation, sanctions, antitrust, or compliance shareholder proposal: score by severity and direct company exposure.",
    "- Preliminary proxy: do not cap solely because it is preliminary if the proposal terms are material, but mention that final proxy or vote result is pending.",
    "- Alert gate: 75+ requires a source-backed near-term investor decision driver: reverse split authorization, listing compliance or delisting risk, major dilution authorization, merger/de-SPAC closing condition, board-control contest, failed vote/deal break risk, legal/regulatory block, or imminent listing/ticker change.",
    "- Do not copy the skeleton score value. For a routine annual proxy with analyzable meeting/proposal facts, choose a real score in the 25-49 range.",
    "- Do not mark a proxy as alert just because it is a shareholder vote.",
    "- Avoid 90+ unless the source shows an extreme outcome: deal break, failed vote, immediate delisting risk, financing failure, regulatory block, or actual control change.",
    "- score_explanation.summary must match the chosen score band and visible UI. It should not introduce a new fact that is absent from display_payload.data, key_evidence, or the source blocks.",
  ];
}

function proxyRuntimeHintSections(routerDecision: ProxyRouterDecision): string[] {
  return [
    "",
    "parser_route_hint_non_binding:",
    JSON.stringify(routerDecision, null, 2),
  ];
}

export function buildProxyLlmRouterPlaceholder(): ProxyRouterDecision {
  return {
    stage: "router",
    usesLlm: true,
    analysis_needed: true,
    event_type: "other",
    display_type: "proxy_vote",
    display_version: "proxy_vote_v1",
    preliminary_action: "analyze",
    preliminary_score: 50,
    rationale: "Placeholder only. The analysis prompt must classify the proxy event and fill the unified proxy vote UI.",
    analysis_focus: ["Classify proxy event", "Fill unified proxy vote UI fields"],
  };
}

export function buildProxyLlmDisplayPayloadPlaceholder(): ProxyDisplayPayload {
  return {
    display_type: "proxy_vote",
    display_version: "proxy_vote_v1",
    data: {},
    evidence: [],
    notes: ["Placeholder only. LLM must fill the final proxy vote display payload."],
  };
}

export function deriveDeliveryLevel(score: number): "archive" | "feed" | "alert" {
  if (score < 50) {
    return "archive";
  }
  if (score < 75) {
    return "feed";
  }
  return "alert";
}

function requiredOutputSkeleton(): Record<string, unknown> {
  return {
    parser_output: {
      parserVersion: "string",
      parserGroup: "proxy",
      formType: "Proxy",
      accessionNumber: "string | null",
      isSupported: true,
      summary: "string | null",
      facts: {} as ProxyParserOutput["facts"],
      signals: [],
      calendarItems: [],
      warnings: [],
      raw: {} as ProxyParserOutput["raw"],
    },
    analysis_output: {
      source_group: "filings",
      market_scope: "company",
      event_type: "other",
      event_title: "string",
      primary_ticker: { ticker: "string | null", exchange: "string | null" },
      tickers: [],
      sector: "string | null",
      industry_group: "string | null",
      theme_group: "string | null",
      sub_theme: "string | null",
      score: 0,
      score_reason: "string",
      score_explanation: {
        summary: "one short investor-facing sentence explaining the score",
      },
      signal: "neutral",
      quick_take: "string",
      summary: "string",
      why_it_matters: "string",
      bullish_points: [],
      bearish_points: [],
      key_evidence: [],
      what_to_watch_next: [],
      related_tickers: [],
      calendar_items: [],
      confidence: "medium",
      needs_human_review: false,
    },
    display_payload: {
      display_type: "proxy_vote",
      display_version: "proxy_vote_v1",
      data: {
        summary_title: "approved short title or custom short title",
        summary_sentence: "one sentence under 160 characters",
        snapshot: [],
        expected_followup_forms: [],
        proposals: [
          {
            id: "string",
            title: "string",
            type: "string",
            board_recommendation: "Support | Oppose | Mixed | Not disclosed",
            is_shareholder_proposal: false,
            details: [
              {
                label: "string",
                value: "string",
                note: "optional string under 80 characters",
              },
            ],
          },
        ],
      },
      evidence: [],
      notes: [],
    },
  };
}
