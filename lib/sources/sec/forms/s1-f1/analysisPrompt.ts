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
    "Use current_filing.form_type exactly when naming the SEC form. Do not substitute another form from the same S-1/F-1 family.",
    "For S-1/A and F-1/A, analyze the current amendment first. Use parent_filing_context only as compact reference when it is supplied and status is found.",
    "Do not let parent_filing_context override the current filing's display mode. A current amendment with concrete IPO terms should use ipo_amendment even if parent context is missing.",
    "Only write amendment_changes when parent_filing_context.status is found and the changed term is source-backed, or when the current filing explicitly states the change. Otherwise analyze the amendment as a standalone current filing.",
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
    "- For primary_ticker and tickers, use filing_package.primary_ticker/tickers exactly when provided. Do not copy filing body text, source excerpts, company descriptions, or CIK text into ticker fields.",
    "- Return display_payload yourself. Do not copy parser-built UI drafts.",
    "- display_payload.display_type must be one of: generic, offering_terms, candidate_special, spac_transaction_status.",
    "- Use offering_terms for IPO registrations, IPO amendments, resale registrations, mixed registrations, Rule 462(b) MEF, POS AM with securities terms, or any source-backed offering/dilution terms.",
    "- Use generic only when the source blocks are too weak for a structured offering UI.",
    "- Use spac_transaction_status only for source-backed de-SPAC transaction-status facts, not plain SPAC IPO registration.",
    "- display_payload.display_version must be s1-f1-display-v1.",
    "- display_payload.data.display_mode must be one of:",
    S1F1_DISPLAY_MODES.map((mode) => `  - ${mode}`).join("\n"),
    "- display_payload.data must be intentionally filled when display_type is offering_terms. Do not leave it as an empty object.",
    "- Choose exactly one primary display_payload.data.display_mode before writing investor-facing text.",
    "- The selected display_mode is the only detailed output path. Do not write a second generic analysis page for the same filing.",
    "- For display_type=offering_terms, analysis_output.quick_take must match display_payload.data.investor_takeaway in meaning.",
    "- For display_type=offering_terms, analysis_output.summary must match display_payload.data.narrative_summary in meaning.",
    "- For display_type=offering_terms, bullish_points and bearish_points are compatibility fields only. Leave both empty unless the selected display_mode explicitly needs a visible Positive/Negative section.",
    "- Do not create Key Evidence or What To Watch Next as an alternate generic page when the selected display_mode already has snapshot_metrics, offering_details, amendment_changes, or source_notes. Keep them short and consistent with the selected display_mode.",
    "- Secondary modules such as offering_details, amendment_changes, source_notes, and what_to_watch_next may appear only as children of the selected display_mode. They must not imply a second top-level UI mode.",
    "- For IPO display modes, include display_payload.data.ipo_kind as traditional or spac. For non-IPO display modes, omit ipo_kind.",
    "- Ticker fields must contain only short ticker symbols from filing_package, never source text, old ticker strings, exchange descriptions, CIK text, or delisting notes. If filing_package.primary_ticker is present, primary_ticker.ticker must be exactly that ticker.",
    "- Snapshot metrics are the user-facing Dilution/Offering Snapshot cards. Fill up to 4 rows as { label, value, note, tone, emphasis }.",
    "- Offering details are user-facing detail rows. Fill rows as { label, value, note } using the label candidates for the selected display mode.",
    "- Snapshot card values must be short, matching 424B/S-3 style. Keep value under 55 characters when possible. Put longer explanation in narrative_summary, key_evidence, or offering_details.",
    "- Snapshot note should be short and plain, under 12 words when possible. Do not put full legal names, page references, or long clauses in snapshot notes.",
    "- Offering Details must also match 424B/S-3 row style: compact values, no legalese fragments, and no paragraph-like values. Keep each value under 90 characters when possible.",
    "- Offering Details notes must be 80 characters or fewer. Omit the note instead of writing a long explanation.",
    "- Do not write placeholder money strings such as $ million, $ per share, or $ and $ in any display_payload field. Use pending wording instead.",
    "- For resale_registration or mixed_registration, if total registered/offered resale shares can be identified, always include a snapshot row labeled Overhang vs outstanding and fill current_shares, total_potential_supply, estimated_dilution_percent, and supply_segments using the same numerator and denominator.",
    "- If you write an overhang, dilution, or outstanding-share percentage in snapshot_metrics, also fill current_shares, total_potential_supply, estimated_dilution_percent, and supply_segments using the same source-backed numerator and denominator.",
    "- For current_shares, total_potential_supply, estimated_dilution_percent, and supply_segments shares, numeric_value must be a bare JSON number when the value is disclosed or calculated. Do not put the number only inside value_text.",
    "- For resale/mixed registrations, use the filing-date outstanding share count as current_shares when the filing provides it. If the filing does not provide an outstanding-share denominator, use latest market_context.shares_outstanding when available and say the ratio uses latest market data.",
    "- A numeric market_context.shares_outstanding value is a valid source-backed denominator. Do not leave current_shares, estimated_dilution_percent, or Overhang vs outstanding blank when market_context.shares_outstanding is present.",
    "- For market data, filing_package.market_context is the authoritative runtime context. Ignore parser-only market_context_summary fields when they conflict with filing_package.market_context; parsers do not receive the live market context.",
    "- Do not say outstanding shares are missing from context when filing_package.market_context.shares_outstanding is numeric.",
    "- If neither the filing nor market_context provides a source-backed denominator, do not invent an overhang percentage. Use snapshot text to explain that the ratio is not fixed instead of forcing a calculation.",
    "- Do not return empty objects inside snapshot_metrics, offering_details, amendment_changes, or source_notes.",
    "- Keep snapshot value text short. Use null for unavailable non-snapshot fields; do not write Not disclosed as filler.",
    "",
    "Display mode rules:",
    "ipo_registration:",
    "- Use for initial IPO/F-1/S-1 registration before final pricing.",
    "- Initial IPO filings usually do not yet disclose price, share count, valuation, lock-up expiry, final underwriters, or first trade date. Do not fill the UI with Not disclosed rows for those missing final terms.",
    "- If an initial IPO filing contains blank placeholders such as '$ and $', '$ per share', '$ million', empty share counts, or bracketed blanks, do not repeat those placeholders anywhere in analysis_output or display_payload. Say price range, share count, or proceeds are pending instead.",
    "- Never output literal placeholder phrases like between $ and $, $ per share, approximately $ million, or amount pending from a blank fee table. Treat them as missing terms.",
    "- Snapshot labels for initial IPO filings must be exactly these four rows in this order: Filing stage; Terms status; Proposed exchange / ticker; Underwriters.",
    "- For Terms status, use short values such as Price and share count pending or Range filed; do not copy blank price-table placeholders.",
    "- For initial IPO filings, display_payload.data.investor_takeaway should match analysis_output.quick_take in meaning and may use the same wording.",
    "- For initial IPO filings, display_payload.data.narrative_summary should match analysis_output.summary in meaning and may use the same wording.",
    "- For initial IPO filings, company_story should explain what the company does, its business model, and the IPO status in plain investor language. Do not make it a legal filing recap.",
    "- For Underwriters, use a concise source-backed lead underwriter/bookrunner value when named. If the initial filing has not named underwriters yet, use Pending.",
    "- For initial IPO filings, offering_details may be an empty array. Do not create Investor Checks or filler detail rows.",
    "- Do not include market data rows for initial IPO filings. Pre-listing S-1/F-1 filings should not show current market cap, float, price, or share-count context as if it existed when the filing was made.",
    "- Keep Initial IPO Filing output focused on what is known now and what filing comes next. Final IPO Pricing data belongs in 424B4 or final prospectus output, not the initial S-1 screen.",
    "",
    "ipo_amendment:",
    "- Use for S-1/A or F-1/A updating IPO terms.",
    "- Use this mode when the current amendment discloses concrete IPO terms such as shares or ADSs offered, price range, underwriters, exchange/ticker, ADS ratio, primary/secondary mix, underwriter option, directed-share program, lock-up, or control/voting structure.",
    "- Snapshot labels for IPO terms updates must be exactly these four rows in this order: Shares offered; Price range; Offering size; Exchange / ticker.",
    "- If offering size is not directly stated, calculate a short range only when shares offered and price range are clear. Otherwise use Pending.",
    "- Offering Details labels: Lead underwriters, Underwriter option, Primary / secondary mix, Use of proceeds, Lock-up, Control / voting structure, Foreign issuer / VIE structure, Listing condition, Directed share program, ADS ratio, Selling shareholders.",
    "- Do not repeat snapshot terms in Offering Details. Exchange/ticker, shares offered, price range, and offering size belong in snapshot_metrics only.",
    "- If snapshot_metrics Shares offered already includes underwriter-option or greenshoe shares, omit Underwriter option from Offering Details.",
    "- Keep Offering Details compact. Use only rows that are source-backed and useful to investors; omit obvious or filler rows.",
    "- parent_filing_context is optional for IPO terms updates. Use it only to identify real changes, not to decide the current UI.",
    "- What changed labels: Price range, Shares offered, ADS ratio, Underwriters, Use of proceeds, Lock-up, Risk factors, Prospectus date, Financials updated.",
    "- Only write What Changed from confirmed parent_filing_context or explicit current-filing amendment language. Do not invent a change just because the form is S-1/A or F-1/A.",
    "",
    "resale_registration:",
    "- Use for selling stockholder resale registrations.",
    "- If resale shares are known, snapshot_metrics must contain exactly these four rows in this order: Resale shares; Overhang vs outstanding; Company proceeds; Selling holders.",
    "- Do not replace Overhang vs outstanding with Market price, Current share price, Registered value, or any price-only row.",
    "- Do not omit Overhang vs outstanding when total_potential_supply is numeric. If filing-date outstanding shares are missing, calculate it from market_context.shares_outstanding when available.",
    "- Offering details labels: Selling Holders, Agreement Date, Resale Method, Sale Price, Source Instrument, Registration Obligation.",
    "- For resale_registration Overhang vs outstanding, value must be the bare percentage only, such as 85.4%. Put the denominator source in note.",
    "- For resale_registration Company proceeds, use short values such as No proceeds to company, Nominal warrant cash only, or Future facility sales. Do not use None by itself.",
    "- For resale_registration Selling holders, use compact display values in both snapshot and Offering Details. If holder names are long or there are multiple holders, use concise source-backed group names such as CHS / Nexus / STORY3 affiliates. Use '+ others' only when the filing lists additional holders not shown in the value.",
    "- For the Selling holders snapshot row, put the compact holder group in value and keep note null or very short. Do not repeat full legal names in the note.",
    "- For the Selling Holders Offering Details row, do not write full legal-name lists, share counts, or phrases like Entities affiliated with. Use base holder or fund group names plus affiliates, for example CHS / Nexus / STORY3 affiliates.",
    "- Strip generic legal wrappers from holder names in display rows: write Nexus affiliates, STORY3 affiliates, or Baker Bros. affiliates instead of Entities affiliated with Nexus Capital Management or entities affiliated with Baker Bros.",
    "- Do not put per-holder share counts inside Selling Holders values. Put those share counts in supply_segments, key_evidence, or source_notes instead.",
    "- Resale Registration Offering Details values should be row labels, not prose: Selling Holders = CHS / Nexus / STORY3 affiliates; Resale Method = Market, negotiated, or private sales; Sale Price = Market or negotiated prices; Source Instrument = Recapitalization shares, PIPE shares, Warrant shares, or Convertible note shares; Registration Obligation = Registration rights agreement or Required by registration rights.",
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
    "- Parent context is optional. Treat the current MEF filing as the primary source. If parent_filing_context is supplied, use it only as supporting context.",
    "- Analyze the incremental registration only. Do not describe the full parent IPO/F-1/S-1 as newly registered unless the current MEF filing itself adds that amount.",
    "- Snapshot labels must be exactly these four rows when source-backed: Additional shares / ADS; Total registered pool; Additional offering value; Rule 462(b) limit.",
    "- If parent context is missing, still analyze the MEF using Additional shares / ADS, Additional offering value, Rule 462(b) limit, and Prior registration statement when source-backed by the current filing.",
    "- Additional shares / ADS is the new MEF add-on amount. Total registered pool is the combined or parent-plus-additional pool only when explicitly stated in the MEF or clearly source-backed by parent context.",
    "- If the filing states only a dollar value or only a share/ADS count, fill the matching row and omit unsupported rows rather than guessing.",
    "- Offering Details labels: Prior registration statement, Rule 462(b) status, Securities added, Base offering, Fee table.",
    "- What changed labels: Additional registration, Prior registration statement, Added shares / amount, Fee table.",
    "- investor_takeaway should state this is an add-on registration under Rule 462(b), not a new standalone offering.",
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
            risk_label: "low | moderate | elevated | high | severe | null",
            current_shares: {
              value_text: "source-backed outstanding shares used as the denominator, or null",
              numeric_value: "number or null",
              unit: "shares",
              evidence: "short source evidence or null",
            },
            total_potential_supply: {
              value_text: "source-backed registered/offered/resale shares used as the numerator, or null",
              numeric_value: "number or null",
              unit: "shares",
              evidence: "short source evidence or null",
            },
            estimated_dilution_percent: {
              value_text: "source-backed or calculated percent using the same numerator/denominator, or null",
              numeric_value: "number or null",
              unit: "percent",
              evidence: "short calculation basis or null",
            },
            supply_segments: [
              {
                role: "new_shares | potential_warrants | potential_instruments | total_potential_supply",
                label: "short segment label",
                shares: {
                  value_text: "segment shares or null",
                  numeric_value: "number or null",
                  unit: "shares",
                  evidence: "short source evidence or null",
                },
                price: {
                  value_text: "source-backed price or null",
                  numeric_value: "number or null",
                  unit: "usd_per_share | percent | null",
                  evidence: "short source evidence or null",
                },
              },
            ],
            snapshot_metrics: [
              {
                label: "one candidate label for the selected display mode",
                value: "short source-backed value",
                note: "short explanation or null",
                tone: "neutral | bullish | bearish | volatile | null",
                emphasis: false,
              },
            ],
            investor_takeaway: "one short sentence or null",
            narrative_summary: "2-4 sentences, under 100 words, or null",
            offering_details: [
              {
                label: "one offering detail label for the selected display mode",
                value: "source-backed value",
                note: "short explanation or null",
              },
            ],
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
