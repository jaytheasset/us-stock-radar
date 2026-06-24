import {
  APPROVED_SEC_EVENT_TYPES,
  type S1F1ParserOutput,
  type S1F1RequiredOutputJson,
  isApprovedSecEventType,
} from "./types.ts";
import { buildS1F1LlmSourceInput } from "./routerPrompt.ts";

const REQUIRED_TOP_LEVEL_KEYS = ["parser_output", "analysis_output", "display_payload"] as const;

const REQUIRED_ANALYSIS_KEYS = [
  "source_group",
  "market_scope",
  "event_type",
  "event_title",
  "primary_ticker",
  "tickers",
  "sector",
  "industry_group",
  "theme_group",
  "sub_theme",
  "score",
  "score_reason",
  "signal",
  "quick_take",
  "summary",
  "why_it_matters",
  "bullish_points",
  "bearish_points",
  "key_evidence",
  "what_to_watch_next",
  "related_tickers",
  "calendar_items",
  "confidence",
  "needs_human_review",
] as const;

const S1F1_DISPLAY_MODES = [
  "ipo_registration",
  "ipo_amendment",
  "resale_registration",
  "mixed_registration",
  "spac_ipo",
  "rule_462b_mef",
  "post_effective_amendment",
  "generic",
] as const;

const S1F1_PROMPT_VERSION = "s1-f1-analysis-v2";

export function buildS1F1AnalysisPrompt(
  parserOutput: S1F1ParserOutput,
  _routerDecision?: unknown,
  _displayPayload?: unknown,
): string {
  return [
    "You are writing the final investor-facing analysis for one SEC S-1/F-1 registration filing.",
    "Use only cleaned_source_blocks, attachment inventory, parent_filing_context if present, and optional market context in the cleaned source input.",
    "S-1/F-1 flow is Parser -> cleaned source blocks -> Analysis LLM -> Required Output JSON.",
    "There is no S-1/F-1 router LLM and no parser-built display payload in runtime.",
    "The parser only preserves relevant source text. Do not treat parser-generated facts, signal labels, offering kinds, risk flags, extraction summaries, or display labels as authority.",
    "Choose event_type, score, signal, display_payload.display_type, and display_payload.data yourself from the source blocks.",
    "Do not call live APIs, live market data, DBs, ingest code, alert delivery, or UI code.",
    "Do not invent, correct, or substitute ticker symbols. If ticker or exchange is unclear, preserve null or state uncertainty.",
    "If a source block conflicts with package ticker context, keep the package ticker in primary_ticker and explain the conflict in key_evidence or needs_human_review.",
    "",
    "Approved event_type values, and no others:",
    APPROVED_SEC_EVENT_TYPES.map((eventType) => `- ${eventType}`).join("\n"),
    "",
    "Delivery score bands:",
    "- score below 50 = archive",
    "- score 50 to 74 = feed",
    "- score 75 or above = alert",
    "",
    "Writing limits:",
    "- quick_take: one sentence, under 28 words.",
    "- summary: 2-4 sentences, under 100 words total.",
    "- why_it_matters: one sentence, under 35 words.",
    "- score_reason: under 18 words.",
    "- bullish_points: up to 3 short items. This legacy schema key is displayed as Positive; leave empty if there is no direct positive point.",
    "- bearish_points: up to 3 short items. This legacy schema key is displayed as Negative; leave empty if there is no direct negative point.",
    "- key_evidence: up to 4 source-backed facts.",
    "- what_to_watch_next: up to 3 concrete next filings, dates, approvals, pricing terms, effectiveness, lock-up, or closing variables.",
    "Use plain investor language. Avoid abstract phrases such as holder economics, structural impact, optionality, de-risked, or execution visibility.",
    "Do not create risks from form type alone. Describe the disclosed registration, offering mechanics, terms, changes, conditions, and dates.",
    "",
    "S-1/F-1 scoring guide:",
    "- Initial S-1/F-1 IPO registration with no final price or share count: usually 35-55.",
    "- S-1/A or F-1/A with concrete price range, share count, underwriters, ADS ratio, or listing timing: usually 50-70.",
    "- Final IPO pricing, first trading imminent, pricing outside filed range, postponement, withdrawal, or major repricing: 75+ possible.",
    "- Resale registration: score by resale shares versus outstanding/float and sale likelihood. Small routine resale = archive/feed; large unrestricted overhang = feed/alert.",
    "- Mixed primary/resale/warrant/convertible registration: score the highest source-backed investor impact without double-counting the same shares.",
    "- SPAC IPO registration alone is usually feed or archive; de-SPAC transaction-status facts belong to S-4/proxy/424B style scoring if directly disclosed.",
    "- Rule 462(b) MEF: score only the added shares/amount, not the full parent registration. Additional capacity only = usually archive/feed unless very large or final pricing is active.",
    "- POS AM: routine deregistration, consent, exhibit, or housekeeping = archive. Material change to registered securities, resale pool, price, effectiveness, or company proceeds can be feed.",
    "- Do not score 75+ merely because the form is important. Alert requires new source-backed information likely to affect near-term price, volatility, liquidity, holder economics, or trading decisions.",
    "",
    "Display payload contract:",
    "- Return display_payload yourself. Do not copy parser-built UI drafts.",
    "- display_payload.display_type must be one of: generic, offering_terms, candidate_special, spac_transaction_status.",
    "- Use offering_terms for IPO registrations, IPO amendments, resale registrations, mixed registrations, Rule 462(b) MEF, POS AM with securities terms, or any source-backed offering/dilution terms.",
    "- Use generic only when the source blocks are too weak for a structured offering UI.",
    "- Use spac_transaction_status only for source-backed de-SPAC transaction-status facts, not plain SPAC IPO registration.",
    "- display_payload.display_version must be s1-f1-display-v1.",
    "- display_payload.data.display_mode must be one of:",
    S1F1_DISPLAY_MODES.map((mode) => `  - ${mode}`).join("\n"),
    "- display_payload.data must be intentionally filled when display_type is offering_terms. Do not leave it as an empty object.",
    "- If event_type is ipo_listing, include display_payload.data.ipo_kind as traditional or spac.",
    "- Snapshot metrics are the user-facing Dilution/Offering Snapshot cards. Fill up to 4 rows as { label, value, note, tone, emphasis }.",
    "- Keep snapshot value text short. Use null for unavailable non-snapshot fields; do not write Not disclosed as filler.",
    "",
    "Display mode rules:",
    "ipo_registration:",
    "- Use for initial IPO/F-1/S-1 registration before final pricing.",
    "- Snapshot labels: Shares / ADS offered, Price range, Gross proceeds, Proposed exchange.",
    "- Offering details labels: Underwriters, Use of Proceeds, Lock-up, ADS Ratio, Voting Structure, Foreign Issuer / VIE Risk.",
    "",
    "ipo_amendment:",
    "- Use for S-1/A or F-1/A updating IPO terms.",
    "- Snapshot labels: Updated shares / ADS, Updated price range, Updated offering size, Key change.",
    "- What changed labels: Price range, Shares offered, ADS ratio, Underwriters, Use of proceeds, Lock-up, Risk factors, Prospectus date, Financials updated.",
    "- Only write What Changed from confirmed parent_filing_context or explicit current-filing amendment language.",
    "",
    "resale_registration:",
    "- Use for selling stockholder resale registrations.",
    "- Snapshot labels: Resale shares, Overhang vs outstanding, Company proceeds, Selling holders.",
    "- Offering details labels: Selling Holders, Agreement Date, Resale Method, Sale Price, Source Instrument, Registration Obligation.",
    "- Company proceeds should distinguish no resale proceeds from conditional warrant/conversion cash.",
    "",
    "mixed_registration:",
    "- Use when primary issuance, resale, warrants, convertibles, rights, or units are all material and no single component dominates.",
    "- Snapshot labels: Primary component, Resale component, Warrant/convertible component, Main risk.",
    "- Do not double-count the same shares across components.",
    "",
    "spac_ipo:",
    "- Use for blank-check/SPAC IPO registration, not de-SPAC status.",
    "- Snapshot labels: Units offered, Unit price, Trust amount, Warrant / right terms.",
    "- Offering details labels: Sponsor, Trust Account, Redemption Terms, Unit Components, Proposed Exchange.",
    "",
    "rule_462b_mef:",
    "- Use for S-1MEF/F-1MEF or Rule 462(b) additional registration.",
    "- Snapshot labels: Additional shares / ADS, Total registered pool, Additional offering value, Rule 462(b) limit.",
    "- What changed labels: Additional registration, Prior registration statement, Added shares / amount, Fee table.",
    "",
    "post_effective_amendment:",
    "- Use for POS AM or post-effective amendments tied to S-1/F-1 registration.",
    "- Snapshot labels: Amendment type, Securities affected, Registration status, Company proceeds.",
    "- What changed labels: Deregistered securities, Unsold securities removed, Prospectus date, Expert consents, Legal opinion, Filing status.",
    "",
    "generic:",
    "- Use only when the source is too weak for a structured registration UI. Still provide concise analysis_output.",
    "",
    "Required Output JSON shape:",
    JSON.stringify(
      {
        parser_output: {
          parserVersion: parserOutput.parserVersion,
          parserGroup: parserOutput.parserGroup,
          formType: parserOutput.formType,
          accessionNumber: parserOutput.accessionNumber,
          isSupported: parserOutput.isSupported,
          facts: {},
          signals: [],
          calendarItems: [],
          warnings: [],
          raw: {},
        },
        analysis_output: {
          source_group: "filings",
          market_scope: "company",
          event_type: "approved event_type selected from cleaned source blocks",
          event_title: "string",
          primary_ticker: { ticker: "string | null", exchange: "string | null" },
          tickers: [],
          sector: null,
          industry_group: null,
          theme_group: null,
          sub_theme: null,
          score: 0,
          score_reason: "string",
          signal: "bullish | bearish | volatile | neutral",
          quick_take: "string",
          summary: "string",
          why_it_matters: "string",
          bullish_points: [],
          bearish_points: [],
          key_evidence: [],
          what_to_watch_next: [],
          related_tickers: [],
          calendar_items: [],
          confidence: "high | medium | low",
          needs_human_review: false,
        },
        display_payload: {
          display_type: "generic | offering_terms | candidate_special | spac_transaction_status",
          display_version: "s1-f1-display-v1",
          data: {
            display_mode: "one supported S-1/F-1 display mode",
            ipo_kind: "traditional | spac | null",
            snapshot_metrics: [],
            investor_takeaway: "one short sentence or null",
            narrative_summary: "2-4 sentences, under 100 words, or null",
            offering_details: [],
            amendment_changes: [],
            source_notes: [],
            needs_human_review: false,
            review_reasons: [],
          },
          evidence: [],
          notes: [],
        },
      },
      null,
      2,
    ),
    "",
    "Cleaned source input:",
    JSON.stringify(buildS1F1LlmSourceInput(parserOutput), null, 2),
    "",
    `Prompt version: ${S1F1_PROMPT_VERSION}`,
  ].join("\n");
}

export function validateS1F1RequiredOutputShape(value: unknown): string[] {
  const errors: string[] = [];
  if (!value || typeof value !== "object") return ["Expected a JSON object."];
  const root = value as Partial<S1F1RequiredOutputJson> & Record<string, unknown>;

  for (const key of REQUIRED_TOP_LEVEL_KEYS) {
    if (!(key in root)) errors.push(`Missing top-level key: ${key}`);
  }

  const analysis = root.analysis_output as Record<string, unknown> | undefined;
  if (!analysis || typeof analysis !== "object") {
    errors.push("analysis_output must be an object.");
  } else {
    for (const key of REQUIRED_ANALYSIS_KEYS) {
      if (!(key in analysis)) errors.push(`Missing analysis_output key: ${key}`);
    }
    if (analysis.source_group !== "filings") errors.push("analysis_output.source_group must be filings.");
    if (typeof analysis.event_type !== "string" || !isApprovedSecEventType(analysis.event_type)) {
      errors.push("analysis_output.event_type must be one of the approved SEC event types.");
    }
    if (typeof analysis.score !== "number") {
      errors.push("analysis_output.score must be a number.");
    }
    if ("delivery_level" in analysis) {
      errors.push("analysis_output must not include delivery_level; it is derived from score.");
    }
  }

  const parser = root.parser_output as Record<string, unknown> | undefined;
  const parserFacts = parser?.facts as Record<string, unknown> | undefined;
  if (!parser || typeof parser !== "object") {
    errors.push("parser_output must be an object.");
  } else {
    if (parser.parserGroup !== "s1-f1") errors.push("parser_output.parserGroup must be s1-f1.");
    if (parser.formType !== "S-1 / F-1, S-1/A / F-1/A") {
      errors.push("parser_output.formType must use the exact room scope label.");
    }
  }

  if (analysis && parserFacts && typeof parserFacts === "object") {
    const parserTicker = typeof parserFacts.ticker === "string" ? parserFacts.ticker.trim().toUpperCase() : "";
    const parserExchange = typeof parserFacts.exchange === "string" ? parserFacts.exchange.trim() : "";
    const primaryTicker = analysis.primary_ticker as Record<string, unknown> | undefined;
    const analysisTicker =
      typeof primaryTicker?.ticker === "string" ? primaryTicker.ticker.trim().toUpperCase() : "";
    const analysisExchange =
      typeof primaryTicker?.exchange === "string" ? primaryTicker.exchange.trim() : "";

    if (parserTicker && analysisTicker !== parserTicker) {
      errors.push("analysis_output.primary_ticker.ticker must match parser_output.facts.ticker.");
    }
    if (parserExchange && analysisExchange !== parserExchange) {
      errors.push("analysis_output.primary_ticker.exchange must match parser_output.facts.exchange.");
    }
    if (parserTicker && Array.isArray(analysis.tickers)) {
      const tickers = analysis.tickers.map((ticker) => String(ticker).trim().toUpperCase());
      if (!tickers.includes(parserTicker)) {
        errors.push("analysis_output.tickers must include parser_output.facts.ticker.");
      }
    }
  }

  const display = root.display_payload as Record<string, unknown> | undefined;
  if (!display || typeof display !== "object") {
    errors.push("display_payload must be an object.");
  } else {
    if (!["generic", "offering_terms", "candidate_special", "spac_transaction_status"].includes(String(display.display_type))) {
      errors.push("display_payload.display_type must be generic, offering_terms, candidate_special, or spac_transaction_status.");
    }
    if ("display_version" in display && typeof display.display_version !== "string") {
      errors.push("display_payload.display_version must be a string when present.");
    }
    const data = display.data as Record<string, unknown> | undefined;
    if (display.display_type === "offering_terms") {
      if (!data || typeof data !== "object" || !Object.keys(data).length) {
        errors.push("display_payload.data must be filled for offering_terms.");
      } else if (!S1F1_DISPLAY_MODES.includes(String(data.display_mode) as (typeof S1F1_DISPLAY_MODES)[number])) {
        errors.push(`display_payload.data.display_mode must be one of: ${S1F1_DISPLAY_MODES.join(", ")}.`);
      }
    }
  }

  return errors;
}
