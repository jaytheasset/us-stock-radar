import {
  buildOwnershipRoutingDecision,
  isApprovedEventType,
} from "./parser.ts";
import type { OwnershipParserOutput } from "./parser.ts";
import { buildCurrentFilingIdentity } from "../common/currentFilingIdentity.ts";

export const OWNERSHIP_ANALYSIS_PROMPT = `
You are the final SEC Ownership filing analysis LLM for Stock Radar.

Covered forms:
- Form 4
- Form 4/A
- Form 144
- Form 144/A

Current flow:
- The Ownership parser has preserved source evidence and selected
  event_type, display_type, display_version, and display_payload.
- There is no Ownership router LLM in this path.
- You are the final semantic judge for transaction economics, structured
  Ownership Monitor facts, investor-facing copy, and the final score.

Use only the provided inputs:
- current_filing
- ownership_source_evidence and selected evidence
- selected_routing
- display_payload
- cleaned_source_blocks when provided
- filing_context when provided
- parent_filing_context when provided
- market_context when provided

Do not invent facts, dates, prices, values, roles, tickers, holdings, float data,
prior trading patterns, parent amendment conclusions, or market context.
Do not call or request live DB, FMP, SEC, or market-data lookups.
Use current_filing.form_type exactly when naming the SEC form. Do not substitute
another form from the same Ownership family.

Event and display rules:
- Use selected_routing.event_type exactly.
- Use the provided display_payload/display_type as the UI template.
- Fill display_payload.data with compact, source-backed UI data. Do not leave
  display_payload.data empty.
- For Form 4 or Form 4/A, include compact form4 display data when the source
  supports it.
- For Form 4 or Form 4/A, preserve each transaction's actual source-backed
  security title/type. Do not collapse distinct securities such as RSUs,
  performance units, options, or common stock into one type merely because they
  appear in the same filing.
- For Form 144 or Form 144/A, include compact form144 display data when the
  source supports it.
- If current source evidence provides issuer.ticker, preserve it in
  analysis_output.primary_ticker.ticker and analysis_output.tickers.
- Do not create new display types.
- Every result should include display_payload.data.filing_summary as one concise
  source-backed sentence.
- Do not output delivery_level as a model decision. Integration derives it from
  score: score < 50 archive, 50-74 feed, 75+ alert.

Return JSON only according to the provided response schema.

Output rules:
- parser_output is pass-through. Keep it minimal; do not echo transaction
  arrays, footnotes, source inventory, raw XML/source text, filing_context, or
  ownership analysis input inside parser_output.
- display_payload should stay compact. Do not echo full transaction tables,
  footnotes, or source inventory into display_payload. Include only the compact
  fields needed by the UI.

Structured Ownership Monitor facts:
- Add analysis_output.ownership_monitor_facts using version
  ownership_monitor_facts_v1. This is additive machine-readable output and must
  not change display_payload, investor copy, score, signal, event taxonomy, or
  routing.
- Set the non-current form family to null. For a successfully analyzed filing
  with no supported transaction/proposed-sale rows, return the current family
  object with an empty rows array; do not omit the object.
- Preserve every reporting owner and every normalized role. A person who is
  both CEO and Director must retain both roles. Preserve is_officer,
  is_director, is_10_percent_owner, officer_title, owner evidence, and owner
  confidence when source-supported; otherwise use null, [], or unknown as the
  schema requires.
- Form 4 transactions must be raw source rows in source order, without netting,
  aggregation, or deduplication. Preserve transaction_date, transaction_code,
  acquired_disposed_code, security title/type, shares, price_per_share,
  post_transaction_shares, direct_or_indirect_ownership, nature_of_ownership,
  row evidence, and row confidence. Do not calculate transaction value here.
- economic_direction is a separate canonical semantic field: buy for an
  economically source-supported purchase, sell for an economically
  source-supported sale, other for a supported non-buy/non-sell transaction,
  and unknown when semantics are not established. Judge the complete row,
  derivative structure, security titles, footnotes, remarks, and related source
  evidence. A transaction code or A/D value alone never determines economic
  direction. Never replace or reinterpret transaction_code or
  acquired_disposed_code with this field.
- is_10b5_1 is row-level. Use true or false only when the source reliably
  supports that row's plan status; otherwise use null. Do not promote a filing-
  wide mention to every row without source support. Preserve an explicit source
  aff10b5One false as false for the filing's rows unless conflicting row-level
  evidence makes the applicable row uncertain; do not turn explicit false into
  null merely because no plan footnote is present. Preserve explicit true,
  explicit false, and unavailable/null as three distinct states.
- Form 144 proposed_sales must preserve each source row, reporting owners,
  proposed_sale_shares, aggregate_market_value, proposed_sale_date, exchange,
  relevant shares_outstanding, evidence, and confidence. A proposed sale is not
  an executed transaction. Do not calculate a proposed-sale percentage here
  and do not choose a denominator when the relevant outstanding-share figure is
  unclear.
- For every Form 144 proposed-sale row, fill percent_calculation as the LLM's
  source-backed decision. Set comparable_units true only when the numerator and
  denominator are already comparable or the source explicitly supplies a
  conversion relation. Use false when the source establishes different,
  unconverted units, and null when comparability cannot be determined. Preserve
  the raw numerator_unit and denominator_unit descriptions. If a source-confirmed
  conversion is needed, select normalization_target and a positive
  normalization_multiplier, quote the source relation in source_relation, and
  include its evidence. Do not infer a unit policy, conversion, ADS ratio, or
  multiplier from issuer identity, accession, market convention, or code.
- If comparable_units is not true, do not publish a proposed-sale percentage in
  event_title, quick_take, summary, filing_summary, why_it_matters, score_reason,
  bullish_points, bearish_points, key_evidence, or what_to_watch_next. Use raw
  shares/value and explain the unit uncertainty without inventing a ratio.
- Every numeric fact uses {value, value_quality, availability}. A supplied
  numeric value is availability available even when value_quality is unknown.
  Missing numeric values are value null, value_quality unknown, availability
  unavailable. Never invent zero. Use exact, derived, or estimated only when
  that quality is source-supported; otherwise retain unknown.

Ownership writing rules:
- Write for investors, not SEC parser logs.
- Describe the economic substance first, in plain language.
- Use plain investor language. Rewrite SEC/legal phrasing into clear, simple
  wording without changing the meaning.
- Use the most human-readable source-backed person name available. Prefer
  Form 144 seller_name or display-name fields over internal reporting-owner
  sort/order names. Do not invert a person's name unless the source clearly
  provides comma-separated last-name-first formatting.
- Keep each point self-contained and easy to understand.
- Avoid legalistic fragments, copied definitions, and sentence pieces that only
  make sense inside the original filing.
- Do not expose internal input names or implementation labels such as parser
  facts, selected_routing, display_payload, hard parser, or LLM path in
  investor-facing copy.
- event_title must be a readable SEO-friendly filing title, not an internal
  category.
- Ownership event_title rule:
  Use this structure:
  "{recognizable owner/role} {action} {amount/value}"
- Do not repeat ticker, company name, or form type in event_title when the UI
  already displays them separately.
- Choose {recognizable owner/role} in this order:
  1. source-backed recognizable parent, sponsor, fund, affiliate, or control
     relationship
  2. insider role plus name, such as CEO Jane Smith or CFO John Smith
  3. reporting owner or seller legal name
- Use {action} based on source-backed filing facts:
  buys, sells, proposes sale of, exits reported position, receives award/grant,
  withholds shares for tax/payment, exercises/converts, or files amendment to.
- Use {amount/value} only when source-backed, such as "$282M reported position",
  "5.59M shares", "$5.7M purchase", "$3.8M sale", or "144/A proposed-sale
  update".
- When market_context is provided, compare the ownership action against supplied
  market cap, public float, or shares outstanding. Use the comparison in summary
  or key_evidence when material. Use it in event_title only when the relative
  size is clearly notable and can be stated compactly.
- When one of these title thresholds is met, add one compact relative-size
  comparison to event_title:
  Form 4 source-confirmed actual purchase/sale: shares are at least 1.0% of float/public_float, or at least
  1.5% of shares outstanding when float is unavailable, or transaction value is
  at least 1.0% of market cap.
  Form 144 proposed sale: proposed shares are at least 2.0% of float/public_float,
  or at least 3.0% of shares outstanding when float is unavailable, or proposed
  value is at least 2.0% of market cap.
- For event_title comparisons, use one comparison only. Prefer float/public_float
  first, then shares outstanding, then market cap.
- Do not omit the event_title comparison when a title threshold is met. Append
  the selected comparison after the share/value phrase, for example "about 11%
  of float", "about 14% of shares outstanding", or "about 10% of market cap".
- If the relative-size comparison is the main reason the filing reaches feed,
  event_title must include that comparison when it fits compactly.
- If title thresholds are not met, keep the comparison in summary or key_evidence
  instead of event_title.
- Keep the exact legal reporting owner in summary or key_evidence if the title
  uses a recognizable parent, sponsor, fund, affiliate, or control relationship.
- Good examples:
  "SoftBank-linked holder exits $282M reported position"
  "SoftBank-linked holder sells $281.8M, about 11% of float"
  "CEO buys $5.7M in registered-direct deal"
  "legal chief sells $3.8M in planned diversification"
  "Kate Gebo signature-name update"
  "Kate Gebo proposes share sale"
  "CFO 10b5-1 stock sale"
- Bad examples:
  "SYM Form 4: SoftBank-linked holder sells $281.8M position"
  "SLMT Form 4: CEO Sade Ron buys $5.7M"
  "Form 4 disclosure"
  "Ownership filing"
  "Stock transaction"
  "Administrative ownership amendment"
  "Low-impact Form 4 ownership filing"
  "Parser deterministic archive"
  "Form 4 transaction"
- For amendments, title the filing by what changed when source-backed:
  signature-name update, proposed-sale amount change, sale-date update, broker
  update, plan-date update, footnote-only update, or parent comparison needed.
- Form 4/A titles must make amendment status clear. Use "amends", "updates",
  "clarifies", or "corrects" when source-backed; do not title a Form 4/A as if
  the amended rows were a fresh standalone purchase or sale unless the amendment
  clearly adds a new transaction row.
- Form 144/A titles must make amendment status clear. Use "amends", "updates",
  "clarifies", or "corrects" when source-backed; do not title a Form 144/A as
  if it were a fresh standalone proposed-sale notice.
- For Form 144/A event_title, never use "proposes to sell" as the main verb.
  Use "amends proposed sale notice", "clarifies Form 144 notice", or "updates
  planned-sale notice" instead.
- Include "proposed" in Form 144 titles unless actual Form 4 execution context
  is provided.
- Keep event_title under 14 words when possible.
- Do not use hype, clickbait, or unsupported investment words in event_title.
- Do not lead event_title, quick_take, summary, or filing_summary with SEC
  transaction-code jargon such as "code J", "code F", or "code M".
- Transaction codes may appear in key_evidence or source-backed details.
- Use "open-market purchase" or "open-market sale" only when the full source
  context supports that economic meaning; transaction code or A/D alone is not
  sufficient.
- For non-market ownership activity, describe the source-backed mechanism:
  award/grant, withholding, exercise/conversion, gift, non-cash exchange,
  derivative transaction, holding update, or Form 144 proposed-sale notice.
- For Form 144, always treat the filing as a proposed-sale notice unless a
  separate source-backed Form 4 execution context is provided.
- For Form 144/144-A, every title, quick_take, summary, filing_summary, and
  why_it_matters reference to the current sale must use proposed/planned/notice
  language. Prefer "proposes to sell", "proposed sale", or "planned-sale
  notice"; do not write "filed to sell" unless the same sentence clearly says
  proposed or planned.
- Do not stack proposed/planned words awkwardly. Use one clean phrase such as
  "proposes to sell" or "planned-sale notice", not "plans a proposed sale".
- Do not convert ownership-size ratios into claims that float, supply,
  liquidity, or market structure changed unless the source explicitly supports
  that. For Form 144, frame relative size as proposed sale size that warrants
  follow-up for execution.
- Do not turn ownership mechanics into investor direction or market-impact
  language by wording alone.

Scoring rules:
- Score means investor attention / urgency, not bullishness or bearishness.
- Signal carries direction:
  a source-confirmed open-market purchase is usually bullish; a source-confirmed
  open-market sale is usually bearish; grants, withholding, exercises,
  conversions, gifts, holding-only changes, and other non-market mechanics are
  usually neutral; complex or unclear ownership mechanics may be neutral or
  volatile depending on facts. Never assign signal from transaction code or A/D
  alone.
- Ownership filings are high-volume. Score them strictly so routine ownership
  filings do not crowd the feed.
- Feed can be triggered by either source-backed absolute filing size or
  source-backed relative market size. Do not require both for feed.
- Alert requires source-backed absolute filing size plus source-backed relative
  market size. Keep the stricter AND gate for alert only.
- Do not use additive point stacking. Use hard caps and alert gates. Role,
  10b5-1, filing_context, and market_context may move a score within a narrow
  range, but they must not be repeatedly added until the score becomes alert.
- When current-filing facts and optional context disagree, preserve the
  uncertainty in score_reason/key_evidence and avoid alert-level scoring.
- Keep score band reasoning in analysis_output.score_reason, not in summary or
  quick_take.

Form 4 scoring caps:
- Source-confirmed holding-only or voluntary non-economic activity: 5-20, hard cap 20.
- Source-confirmed routine grant/RSU/award: 15-32, hard cap 34.
- Source-confirmed withholding/tax/payment row: 20-35, hard cap 39.
- Source-confirmed exercise/conversion-only activity: 20-35, hard cap 39.
- Source-confirmed gift/no-cash transfer: 25-40, hard cap 44 unless current filing
  facts show unusual control, legal, or strategic context.
- Clean source-confirmed actual purchase/sale below $1M: 35-49, hard cap 49 unless a senior/control-holder
  or ownership-percentage trigger below applies.
- CEO/CFO actual purchase/sale of $500k-$1M: 50-55, hard cap 55.
- 10% owner actual purchase/sale of $500k-$1M: 50-58, hard cap 58.
- Actual purchase/sale changing estimated pre-transaction holdings by 10% or more: 50-60,
  hard cap 60 unless market_context or filing_context supports more urgency.
- Actual purchase/sale $1M-$5M: 52-62, hard cap 62.
- Actual purchase/sale $5M-$20M: 58-68, hard cap 68.
- Actual purchase/sale above $20M: 65-74, hard cap 74 unless the alert gate is met.

Form 144 scoring caps:
- Proposed sale below $5M, below 0.5% of shares outstanding, current plus
  prior three-month gross proceeds below $10M, and three or fewer prior-sale
  rows: 20-49, hard cap 49.
- Proposed sale $5M-$10M, or 0.5%-1% of shares outstanding, or current plus
  prior three-month gross proceeds $10M-$20M: 50-58, hard cap 58.
- Proposed sale $10M-$25M, or 1%-2% of shares outstanding, or current plus
  prior three-month gross proceeds $20M-$50M: 55-64, hard cap 64.
- Proposed sale $25M-$50M or 2%-3% of shares outstanding: 60-70, hard cap 70.
- Proposed sale above $50M or above 3% of shares outstanding: 65-74, hard cap
  74 unless the alert gate is met.
- Form 144 alone is proposed-sale-only. Do not treat it as an executed sale.

Alert gate:
- Do not produce 75+ by stacking role, transaction value, and keywords.
- Alert requires source-backed absolute size plus source-backed relative size.
- Form 4 alert gate applies only to rows the LLM source-confirms as actual
  purchases or sales. Non-market or unknown activity, holding-only changes, and
  Form 4/A administrative changes cannot become alert by this gate.
- For Form 4 source-confirmed actual purchases/sales, 75+ is allowed when one of these absolute-plus-float
  combinations is met:
  value > $20M and shares >= 1% of float/public_float;
  value > $10M and shares >= 2% of float/public_float;
  value > $5M and shares >= 5% of float/public_float;
  value > $1M and shares >= 10% of float/public_float;
  value > $500k and shares >= 20% of float/public_float.
- If float/public_float is unavailable, Form 4 75+ is allowed when one of these
  absolute-plus-market-cap combinations is met:
  value > $10M and value >= 3% of market cap;
  value > $5M and value >= 5% of market cap;
  value > $1M and value >= 10% of market cap.
- Form 4 transactions below $500k cannot be alert by relative size alone.
- Senior officer, director, 10% owner, or control-holder status can support the
  alert score when an absolute-plus-relative gate is met; it cannot unlock alert
  without the gate.
- Filing_context is not required for Form 4 alert when the absolute-plus-relative
  gate is clearly met. Use filing_context to raise urgency within alert, such as
  repeated same-insider trading, company-wide cluster, related Form 144/Form 4
  linkage, or non-routine amendment parent mismatch.
- Without filing_context, Form 4 alert scores should usually stay 75-82.
- Without market_context, Form 4 alert normally requires value > $20M and strong
  source-backed senior/control-holder relevance.
- For Form 144, 75+ is allowed when one of these proposed absolute-plus-float
  combinations is met:
  proposed value > $50M and proposed shares >= 2% of float/public_float;
  proposed value > $25M and proposed shares >= 5% of float/public_float;
  proposed value > $10M and proposed shares >= 10% of float/public_float;
  proposed value > $2.5M and proposed shares >= 20% of float/public_float.
- If float/public_float is unavailable, Form 144 75+ is allowed when one of these
  proposed absolute-plus-market-cap combinations is met:
  proposed value > $25M and proposed value >= 5% of market cap;
  proposed value > $10M and proposed value >= 10% of market cap;
  proposed value > $2.5M and proposed value >= 20% of market cap.
- Form 144 proposed value below $2.5M cannot be alert by relative size alone.
- Form 144 remains proposed-sale-only. Filing_context can raise urgency when it
  shows related Form 4 execution candidates, repeated same-insider selling,
  company-wide selling cluster, or parent/amendment mismatch, but do not state
  execution unless source-backed Form 4 actual sale context is provided.
- 10b5-1, trust, fund, or keyword context may explain the score within the
  applicable range but cannot by itself unlock alert scoring.

Context use contract:
- Current filing facts are primary evidence. Context can adjust urgency, but it
  cannot create a transaction, proposed sale, owner role, parent amendment
  conclusion, or execution conclusion that is not in the provided inputs.
- market_context answers one question: how large is the current filing relative
  to the issuer's supplied company size, public supply, and liquidity.
- filing_context answers one question: whether this filing is part of a
  source-backed ownership pattern, cluster, related Form 144/Form 4 sequence, or
  amendment-parent issue.
- If market_context or filing_context is absent, analyze the current filing
  normally and do not lower confidence solely because optional context is
  missing.
- If context fields conflict, look stale, or are too incomplete for a clean
  ratio, do not force a calculation. Put the limitation in score_reason only
  when it affects scoring.

Market context rules:
- market_context is optional. Use it only when provided.
- Do not invent market cap, float, shares outstanding, volume, price, sector,
  liquidity, or percent-of-company values.
- Use only supplied market_context fields such as market_cap,
  shares_outstanding, float, public_float, average_volume,
  average_daily_volume, average_daily_dollar_volume, and last_price.
- last_price is context only; do not use it to override the filing's reported
  transaction price or proposed-sale value.
- average_volume, average_daily_volume, and average_daily_dollar_volume may be
  used only as background liquidity context when supplied. They are not a
  standalone feed trigger or alert gate.
- Compare Form 4 actual transaction value against supplied market cap.
- Compare Form 4 actual shares bought/sold against supplied float or shares
  outstanding.
- Compare Form 144 proposed value and proposed shares against supplied market
  cap, float, or shares outstanding, while saying it is proposed rather than
  executed.
- Percent unit rule:
  If a value is already labeled as percent, percentage, pct, percent_of,
  or "of shares outstanding/float/market cap", treat it as percentage points
  already. Do not multiply or shift decimals. A value of 0.0366 means 0.0366%,
  not 3.66%. A value of 14.1333 means 14.1333%, not 0.141333%.
- When a relative-size value is below 1%, keep the leading zero and percent
  sign, or write "well below 1%" if exact precision is not needed. Do not turn
  a below-1% value into a whole-number percentage.
- Use a percent comparison in event_title only when the comparison is at least
  1% and clearly material. For values below 1%, keep the comparison in summary,
  score_reason, or key_evidence instead of the title.
- If the unit is ambiguous, do not publish a percent figure. Use raw shares,
  value, market cap, float, or shares outstanding qualitatively.
- Market-context score bands:
  If a source-confirmed actual Form 4 purchase/sale clears an absolute feed band, do not score it below
  50 solely because relative market_context ratios are below 0.25%; use the
  lower end of the feed cap instead.
  If a Form 144 proposed sale clears an absolute feed band, do not score it
  below 50 solely because relative market_context ratios are below 0.25%; use
  the lower end of the feed cap instead.
  If absolute filing size is below the feed band and relative size is also below
  0.25% of market cap and below 0.25% of float/outstanding, archive or low feed
  is usually appropriate.
  value >= 0.25% of market cap or shares >= 0.25% of float/outstanding can
  support feed even when the absolute size is below the usual feed band.
  value >= 1% of market cap or shares >= 0.75% of float/outstanding supports
  stronger feed within the cap.
  value >= 2% of market cap or shares >= 1% of float/outstanding may support
  alert only if the alert gate and filing_context trigger are both met.
- If a needed market_context field is missing, say the comparison is
  unavailable in score_reason only if that missing comparison affects the
  score. Do not clutter summary with missing-context language.
- Prefer float/public_float for public-supply comparison when supplied; use
  shares_outstanding when float is missing. Do not report both unless both are
  material to the score.

Filing context rules:
- filing_context is optional.
- Use it when present.
- Do not fail when missing.
- Use ownership context fields when supplied:
  same_insider_12m_trades, company_90d_insider_flow, recent_30d_cluster,
  related_form144_candidates, related_form4_execution_candidates,
  amendment_parent_candidate, context_as_of, and source_notes.
- Repeated same-insider same-direction trading:
  same-insider 12-month count >= 3 and cumulative same-direction value >= $5M
  may lift a current source-confirmed purchase/sale or Form 144 into stronger feed.
- Same-insider large cumulative selling:
  same-insider 12-month sale value >= $10M may lift urgency even if the current
  filing is below the next absolute-value band.
- First or unusual senior-officer purchase:
  CEO/CFO open-market P of $500k or more may be stronger when filing_context
  shows prior activity was routine grants/withholding/exercises only.
- Company-wide 90-day insider flow:
  three or more insiders same-direction with total value >= $5M supports feed;
  five or more insiders or total value >= $20M supports stronger feed and may
  help satisfy the alert gate when market_context also clears it.
- Recent 30-day cluster:
  two or more insiders and total same-direction value >= $2M supports feed;
  three or more insiders and total value >= $10M supports stronger feed.
- Related Form 144/Form 4 candidates:
  use related candidates as context only. Candidate linkage can raise urgency,
  but do not state that a Form 144 was executed unless a source-backed Form 4
  actual sale is provided.
- If related_form144_candidates or related_form4_execution_candidates are
  provided, describe them as candidates unless the context itself provides a
  source-backed actual Form 4 execution row.
- Amendment parent context:
  administrative, metadata-only, or footnote-only changes usually remain
  archive. Changed amount, price, date, security class, broker, plan date, or
  parent mismatch requires analysis and can raise urgency.
- Routine context:
  prior grants, withholding, exercise-only rows, small routine sales, or no
  cluster should not raise score materially.
- Do not mention filing_context in summary merely because it exists. Mention it
  only when it changes score_reason, explains why a borderline filing reached
  feed/alert, or explains why a superficially large filing remained lower.

Context-aware writing rules:
- Summary order must be: current filing fact first, market-context comparison
  second if material and supplied, filing-context pattern third if material and
  supplied.
- Do not start summary with filing_context or market_context. The filing being
  analyzed is the primary evidence.
- Summary examples:
  Current filing: "The CEO sold 1.2M shares for about $18M."
  Market context: "The sale equals about 1.4% of market cap and 0.8% of float."
  Filing context: "This follows two same-insider sales in 12 months totaling
  $9M."
- If context affects the score, reflect it in score_reason and key_evidence.
- If context does not affect the score, do not force it into summary.
- Do not add "context unavailable", "no market context provided", or "no filing
  context provided" to summary or filing_summary.
- For archive results, display_payload.data.filing_summary should be one
  concise current-filing sentence. Include context only if it explains why an
  otherwise borderline filing stayed archive or rose near feed.
- For feed/alert results, summary may use 2-4 compact sentences under 100 words total:
  current filing size/mechanics; market-context relative size; filing-context
  pattern or absence of material pattern.
- Never write that Form 144 is executed unless provided Form 4 context supports
  an actual transaction.

Amendments:
- For Form 4/A and Form 144/A, analyze the filing as an amendment, not as a new
  standalone ownership event.
- Use source-backed amendment remarks and supplied parent_filing_context as the
  authority for what changed. Do not infer parent changes from missing rows,
  repeated rows, or amendment form type alone.
- If parent comparison is unavailable or ambiguous, avoid claiming what changed
  relative to the parent. In investor-facing summary, describe only what the
  amendment itself says it corrects, updates, adds, or clarifies.
- Do not tell investors that the original filing is missing, unavailable, or
  needs comparison in summary, filing_summary, quick_take, why_it_matters, or
  directional points. That is workflow status, not the filing summary.
- In investor-facing copy, do not use internal process phrases such as
  "reconciliation is needed", "requires reconciliation", or "reconciliation
  path".
- Do not use the word "reconciliation" in investor-facing output. Use
  "comparison" instead.
- If source evidence shows only administrative, metadata, signature, title, or
  footnote/explanatory changes with no changed transaction economics, keep the
  analysis compact and low urgency.
- If source evidence shows changed transaction economics, added rows, changed
  proposed-sale terms, correction/error wording, or ambiguous mapping, explain
  only the source-backed amendment content. Do not tell the reader that review
  is needed.
- For a Form 4/A price correction, use this style: "The amendment corrects the
  reported price for a [date] purchase of [shares] shares to [price] per share.
  No new purchase or sale is reported in the amendment."
- Never treat Form 4/A rows as fresh duplicate purchase/sale signals.
- Never treat Form 144/A as proof of an executed sale.
- For Form 144/A, keep two facts separate: the current filing's proposed sale
  notice and any prior-sales or sale-history remark. If the amendment adds a
  remark that prior reported sales were for tax withholding after RSU vesting,
  write that it clarifies the prior-sale history; do not imply the current
  proposed sale was executed.
- Do not write that the current Form 144/A proposed sale is "to cover tax
  withholding" unless that exact purpose is source-backed for the current
  proposed-sale row. If the remark refers to "reported sales" and prior-sale
  rows exist, attach the withholding language to those prior reported sales,
  not to the current proposed sale.
- If parent comparison shows proposed sale rows, acquisition lots, or prior
  sales are unchanged and only remarks changed, call it a remarks-only
  amendment. State that proposed sale amount, value, or date were unchanged
  from the original Form 144 when those unchanged fields are provided.
- For a Form 144/A remarks-only amendment with unchanged proposed-sale terms,
  a summary that only describes the remark is incomplete. The summary must also
  state the unchanged proposed shares, value, sale date, or prior accession when
  those fields are provided.
- For Form 144/A archive summaries, prefer this structure when source-backed:
  "The 144/A amendment adds [remark/change]; the proposed sale terms remain
  [shares/value/date] from the original Form 144."
- For Form 144/A remarks-only amendments, do not write a filing_summary that
  only repeats the remark. Include both the
  amendment change and the unchanged proposed-sale terms when comparison facts
  provide them.

For score < 50 archive:
- Set analysis_output.quick_take to "".
- Set analysis_output.why_it_matters to "".
- Set analysis_output.bullish_points to [].
- Set analysis_output.bearish_points to [].
- Set analysis_output.what_to_watch_next to [].
- Set analysis_output.summary and display_payload.data.filing_summary to one
  concise, natural, source-backed filing fact summary.
- For archive results, display_payload.data.filing_summary must exactly match
  analysis_output.summary.
- Author filing_summary directly from ownership_source_evidence.
- Exception: for Form 4/A or Form 144/A, prefer a more precise source-backed
  amendment comparison summary when supplied parent context proves what remained
  unchanged.
- For amendment archive summaries, state what changed. If parent comparison
  says transaction rows or proposed-sale terms were unchanged, include that
  unchanged status instead of writing generic low-impact copy.

For score >= 50 feed/alert:
- Use the common filing UI sections:
  Quick take, Filing summary, Why it matters, Positive, Negative, and What to watch next.
- Map UI "Filing summary" to analysis_output.summary.
- Map UI "Positive" to analysis_output.bullish_points.
- Map UI "Negative" to analysis_output.bearish_points.
- analysis_output.bullish_points and analysis_output.bearish_points are legacy schema keys; the UI displays them as Positive and Negative.
- A less negative fact is not automatically positive.
- A less positive fact is not automatically negative.
- Positive/Negative points must contain only actual source-backed favorable or adverse facts.
- Mitigating context must be used only for score adjustment and explanation.
- If there is no applicable content, return an empty array [].
- "Max 3" means at most 3 items, not exactly 3 items.
- For a clean Form 4 S sale, analysis_output.bullish_points must be [] unless
  provided parent/context facts prove cancellation, reduction, or correction of
  a previously reported sale.
- For a clean Form 4 P purchase, analysis_output.bearish_points must be [] unless
  provided source-backed facts show a separate distressed financing, control,
  dilution, legal, or amendment risk.
- A sale that is small, planned, diversified, 10b5-1-based, option-related, or
  still leaves holdings is not Positive; use that only in summary, score_reason,
  or key_evidence.
- A purchase that is small, private, offering-related, or raises concentration
  questions is not Negative by itself; use that only in summary, score_reason, or
  key_evidence unless a separate source-backed risk is provided.
- Treat ending-holding facts as key evidence by default, but they may be
  directional only when combined with source-backed control-holder, sponsor,
  affiliate, or unusually large position-exit context.
- Do not create generic filler points such as company-confirmed update, no
  dilution trigger, no listing-risk trigger, or follow-up may improve visibility.
- analysis_output.quick_take: one sentence, under 22 words.
- analysis_output.summary: 2-4 sentences, under 100 words total.
- analysis_output.why_it_matters: one sentence, under 35 words.
- analysis_output.score_reason: under 18 words.
- analysis_output.bullish_points: max 3 items, each under 16 words.
- analysis_output.bearish_points: max 3 items, each under 16 words.
- analysis_output.key_evidence: max 3 items, each under 16 words.
- analysis_output.what_to_watch_next: max 3 items, each under 16 words.
- what_to_watch_next items must be concrete follow-up variables, dates,
  filings, conditions, or risks. Avoid vague advice.
- Keep all bullets as compact phrases, not paragraphs.
- Do not add extra sections outside the required response schema.

Return JSON only.
`.trim();

export function buildOwnershipAnalysisPrompt(
  parserOutput: OwnershipParserOutput,
) {
  return `${OWNERSHIP_ANALYSIS_PROMPT}

Ownership analysis input:
${JSON.stringify(buildOwnershipAnalysisInput(parserOutput), null, 2)}

Final validation before returning JSON:
- Audit every sentence for unsupported inference.
- Every claim must be traceable to current filing, ownership_source_evidence, market_context,
  filing_context, or parent_filing_context.
- For Form 4/A or Form 144/A, re-read event_title before returning. If the main
  verb is buys, sells, proposes, or files instead of amends, updates, clarifies,
  or corrects, rewrite the title as an amendment title.`;
}

export function buildOwnershipAnalysisInput(parserOutput: OwnershipParserOutput) {
  const facts = isRecord(parserOutput.facts) ? parserOutput.facts : {};
  const form4 = isRecord(facts.form4) ? facts.form4 : null;
  const form144 = isRecord(facts.form144) ? facts.form144 : null;
  const raw = isRecord(parserOutput.raw) ? parserOutput.raw : {};

  return {
    current_filing: buildCurrentFilingIdentity({
      parserOutput: parserOutput as unknown as Record<string, unknown>,
      formFamily: parserOutput.formType,
    }),
    selected_routing: buildOwnershipRoutingDecision(parserOutput),
    display_payload: buildOwnershipAnalysisDisplayPayload(parserOutput),
    parserVersion: parserOutput.parserVersion,
    parserGroup: parserOutput.parserGroup,
    formType: parserOutput.formType,
    accessionNumber: parserOutput.accessionNumber,
    isSupported: parserOutput.isSupported,
    issuer: facts.issuer ?? null,
    market_context: facts.market_context ?? null,
    ownership_source_evidence: {
      filing: summarizeFilingSourceEvidence(facts.filing),
      reporting_owners: summarizeReportingOwnerSourceEvidence(facts.reporting_owners),
      form4: form4 ? { transactions: summarizeTransactions(form4.transactions) } : null,
      form144: summarizeForm144SourceEvidence(form144),
      amendment: summarizeAmendmentSourceEvidence(facts.amendment),
      footnotes: facts.footnotes ?? {},
      remarks: facts.remarks ?? null,
      signatures: facts.signatures ?? [],
    },
    source_inventory: facts.source_inventory ?? raw.source_inventory ?? null,
    selected_evidence: raw.selected_evidence ?? [],
  };
}

function buildOwnershipAnalysisDisplayPayload(parserOutput: OwnershipParserOutput) {
  const routing = buildOwnershipRoutingDecision(parserOutput);
  return {
    display_type: routing.display_type,
    data: {
      display_version: routing.display_version,
      event_type: routing.event_type,
      parser_display_payload_available: true,
      common_feed_detail_ui: routing.display_type === "candidate_special",
    },
    evidence: [],
    notes: [
      "Full parser-built display payload is available to integration outside the LLM prompt.",
      "This template contains no parser-authored semantic answer. LLM should author source-backed UI facts and must not echo full transaction tables, footnotes, or source inventory into display_payload.",
    ],
  };
}

function buildSentenceSafeFilingSummary(parserOutput: OwnershipParserOutput) {
  const facts = isRecord(parserOutput.facts) ? parserOutput.facts : {};
  const filing = isRecord(facts.filing) ? facts.filing : {};
  const issuer = isRecord(facts.issuer) ? facts.issuer : {};
  const owner = isRecord(facts.reporting_owner) ? facts.reporting_owner : {};
  const form4 = isRecord(facts.form4) ? facts.form4 : null;
  const form144 = isRecord(facts.form144) ? facts.form144 : null;
  const amendment = isRecord(facts.amendment) ? facts.amendment : null;
  const formType = displayFormType(filing.form_type ?? parserOutput.formType ?? "Ownership filing");
  const ownerName = sentenceSafeName(owner.name);
  const ticker = sentenceSafeText(issuer.trading_symbol);

  if (form4) {
    const transactions = Array.isArray(form4.transactions) ? form4.transactions.filter(isRecord) : [];
    const sameCodeSummary = buildSameCodeForm4Summary({
      formType,
      ownerName,
      ticker,
      transactions,
    });
    if (sameCodeSummary) {
      return sameCodeSummary;
    }
    const sale = transactions.find((transaction) => transaction.transaction_code === "S");
    const purchase = transactions.find((transaction) => transaction.transaction_code === "P");
    const primary = sale ?? purchase ?? transactions[0];

    if (primary) {
      const code = sentenceSafeText(primary.transaction_code);
      const action = code === "S" ? "sale" : code === "P" ? "purchase" : "transaction";
      const shares = formatNumberValue(primary.shares);
      const price = formatMoneyValue(primary.price_per_share);
      const value = formatMoneyValue(primary.transaction_value);
      const date = sentenceSafeText(primary.transaction_date);
      const holdings = formatNumberValue(primary.shares_owned_following);
      const tradeSentence = [
        `${formType}: ${ownerName || "the reporting owner"} reported a ${action}${shares ? ` of ${shares}` : ""}${ticker ? ` ${ticker}` : ""} shares`,
        date ? `on ${date}` : null,
        price ? `at ${price} per share` : null,
        value ? `, totaling about ${value}` : null,
        has10b51Reference(parserOutput) ? "under a 10b5-1 plan" : null,
      ].filter(Boolean).join(" ").replace(/\s+,/g, ",");
      const holdingsSentence = holdings ? `, with post-transaction holdings of ${holdings} shares` : "";
      return `${tradeSentence}${holdingsSentence}.`;
    }
  }

  if (form144) {
    const amendmentSummary = buildForm144AmendmentInputSummary({
      formType,
      ownerName,
      form144,
      amendment,
    });
    if (amendmentSummary) {
      return amendmentSummary;
    }
    const proposedSales = Array.isArray(form144.proposed_sales) ? form144.proposed_sales.filter(isRecord) : [];
    const primary = proposedSales[0];
    if (primary) {
      const shares = formatNumberValue(primary.shares_or_units);
      const value = formatMoneyValue(primary.aggregate_market_value);
      const date = sentenceSafeText(primary.approximate_sale_date);
      const parts = [
        `${formType}: ${ownerName || "the reporting person"} filed a proposed sale notice${shares ? ` for ${shares}` : ""}${ticker ? ` ${ticker}` : ""} shares or units`,
        value ? `aggregate market value about ${value}` : null,
        date ? `approximate sale date ${date}` : null,
        "not a reported executed sale",
      ].filter(Boolean);
      return `${parts.join("; ")}.`;
    }
  }

  return null;
}

function buildForm144AmendmentInputSummary({
  formType,
  ownerName,
  form144,
  amendment,
}: {
  formType: string;
  ownerName: string;
  form144: Record<string, unknown>;
  amendment: Record<string, unknown> | null;
}) {
  if (formType !== "Form 144/A") {
    return null;
  }
  const comparison = isRecord(amendment?.local_comparison) ? amendment.local_comparison : null;
  const labels = Array.isArray(comparison?.labels)
    ? comparison.labels.map((label) => sentenceSafeText(label)).filter(Boolean)
    : [];
  const changedFields = Array.isArray(comparison?.changed_fields)
    ? comparison.changed_fields.map((field) => sentenceSafeText(field)).filter(Boolean)
    : [];
  const isRemarksOnly =
    labels.includes("REMARKS_ONLY") ||
    (changedFields.length === 1 && changedFields[0] === "remarks");
  if (!isRemarksOnly) {
    return null;
  }

  const rows = [
    ...(Array.isArray(form144.proposed_sale_rows) ? form144.proposed_sale_rows.filter(isRecord) : []),
    ...(Array.isArray(form144.proposed_sales) ? form144.proposed_sales.filter(isRecord) : []),
  ];
  const primary = rows[0] ?? form144;
  const sellerName = form144SellerDisplayName(form144, primary);
  const shares =
    formatNumberValue(primary.shares_or_units) ||
    formatNumberValue(primary.securities_to_be_sold) ||
    formatNumberValue(primary.amount_of_securities_to_be_sold);
  const value =
    formatMoneyValue(primary.aggregate_market_value) ||
    formatMoneyValue(primary.market_value) ||
    formatMoneyValue(primary.aggregate_sale_value);
  const date =
    sentenceSafeText(primary.approximate_sale_date) ||
    sentenceSafeText(primary.sale_date);
  const previousAccession =
    sentenceSafeText(amendment?.previous_accession_number) ||
    sentenceSafeText(form144.previous_accession_number);

  const proposedTerms = [
    shares ? `${shares} shares` : null,
    value ? `about ${value}` : null,
    date ? `approximate sale date ${date}` : null,
  ].filter(Boolean).join(", ");
  const unchangedText = proposedTerms
    ? `the proposed-sale terms remained ${proposedTerms}${previousAccession ? ` from original Form 144 ${previousAccession}` : ""}`
    : "the proposed-sale terms were unchanged from the original Form 144";
  const ownerText = sellerName || ownerName || "the reporting person";
  const possessiveOwner = ownershipPossessiveName(ownerText);

  return `${possessiveOwner} ${formType} amendment added a remark about prior reported sales; ${unchangedText}.`;
}

function form144SellerDisplayName(form144: Record<string, unknown>, primary: Record<string, unknown>) {
  const priorSales = Array.isArray(form144.prior_sales) ? form144.prior_sales.filter(isRecord) : [];
  const acquisitionLots = Array.isArray(form144.acquisition_lots) ? form144.acquisition_lots.filter(isRecord) : [];
  const candidates = [
    primary.seller_name,
    priorSales[0]?.seller_name,
    form144.seller_name,
    form144.account_person_name,
    form144.reporting_person_name,
    acquisitionLots[0]?.seller_name,
  ];
  for (const candidate of candidates) {
    const name = sentenceSafeName(candidate);
    if (name) {
      return name;
    }
  }
  return "";
}

function ownershipPossessiveName(name: string) {
  const clean = sentenceSafeName(name);
  if (!clean) {
    return "The reporting person's";
  }
  return /s$/i.test(clean) ? `${clean}'` : `${clean}'s`;
}

function buildSameCodeForm4Summary({
  formType,
  ownerName,
  ticker,
  transactions,
}: {
  formType: string;
  ownerName: string;
  ticker: string;
  transactions: Record<string, unknown>[];
}) {
  if (transactions.length < 2) {
    return null;
  }

  const codes = uniqueTextValues(transactions.map((transaction) => transaction.transaction_code));
  if (codes.length !== 1) {
    return null;
  }

  const code = codes[0];
  const action = form4SummaryAction(code);
  const totalShares = sumNumericValues(transactions.map((transaction) => transaction.shares));
  const totalValue = sumNumericValues(transactions.map((transaction) => transaction.transaction_value));
  const securities = uniqueTextValues(transactions.map((transaction) => transaction.security_title));
  const dates = uniqueTextValues(transactions.map((transaction) => transaction.transaction_date));
  const following = uniqueTextValues(transactions.map((transaction) => transaction.shares_owned_following));
  const securityText = securities.length === 1 ? securities[0] : "shares";
  const shareText = totalShares !== null ? ` of ${formatNumberValue(totalShares)} ${ticker ? `${ticker} ` : ""}${securityText}` : "";
  const dateText =
    dates.length === 1
      ? ` on ${dates[0]}`
      : dates.length > 1
        ? ` across ${dates.length} dates`
        : "";
  const valueText = totalValue !== null && totalValue !== 0 ? `, totaling about ${formatMoneyValue(totalValue)}` : "";
  const zeroValueText = totalValue === 0 ? ", with $0 reported value" : "";
  const followingText =
    following.length === 1
      ? `${valueText || zeroValueText ? " and" : ", with"} post-transaction holdings of ${formatNumberValue(following[0])} shares`
      : "";

  return `${formType}: ${ownerName || "the reporting owner"} reported ${action}${shareText}${dateText}${valueText}${zeroValueText}${followingText}.`;
}

function form4SummaryAction(code: string) {
  if (code === "S") return "sales";
  if (code === "P") return "purchases";
  if (code === "G") return "gifts";
  if (code === "F") return "tax/payment withholding";
  if (code === "A") return "award/grant activity";
  if (code === "M") return "exercise/conversion activity";
  return `code ${code} transactions`;
}

function uniqueTextValues(values: unknown[]) {
  return Array.from(new Set(values.map(sentenceSafeText).filter(Boolean)));
}

function sumNumericValues(values: unknown[]) {
  let total = 0;
  let found = false;
  for (const value of values) {
    const numeric = numericValue(value);
    if (numeric === null) continue;
    total += numeric;
    found = true;
  }
  return found ? total : null;
}

function displayFormType(value: unknown) {
  const formType = sentenceSafeText(value).toUpperCase().replace(/\s+/g, " ");
  if (formType === "4") return "Form 4";
  if (formType === "4/A") return "Form 4/A";
  if (formType === "144") return "Form 144";
  if (formType === "144/A") return "Form 144/A";
  if (formType.includes("FORM 4 / 4/A")) return "Form 4";
  return sentenceSafeText(value || "Ownership filing");
}

function has10b51Reference(parserOutput: OwnershipParserOutput) {
  const facts = isRecord(parserOutput.facts) ? parserOutput.facts : {};
  const evidenceTerms = Array.isArray(facts.evidence_terms) ? facts.evidence_terms : [];
  const remarks = typeof facts.remarks === "string" ? facts.remarks : "";
  return parserOutput.signals.includes("rule_10b5_1_plan")
    || evidenceTerms.some((term) => String(term).toLowerCase().includes("10b5"))
    || /10b5-1/i.test(remarks);
}

function sentenceSafeName(value: unknown) {
  return sentenceSafeText(value)
    .replace(/\b([A-Z])\./g, "$1")
    .replace(/\b(Jr|Sr|St)\./gi, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function sentenceSafeText(value: unknown) {
  if (value === null || value === undefined) {
    return "";
  }
  return String(value)
    .replace(/\b(Inc|Corp|Co|Ltd|LLC|LP|L\.P|LTD)\./gi, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function formatNumberValue(value: unknown) {
  const numeric = numericValue(value);
  if (numeric === null) {
    return sentenceSafeText(value);
  }
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(numeric);
}

function formatMoneyValue(value: unknown) {
  const numeric = numericValue(value);
  if (numeric === null) {
    return sentenceSafeText(value);
  }
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(numeric);
}

function numericValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value !== "string") {
    return null;
  }
  const numeric = Number(value.replace(/[$,]/g, ""));
  return Number.isFinite(numeric) ? numeric : null;
}

export function validateOwnershipResultShape(result: unknown): string[] {
  const errors: string[] = [];
  if (!isRecord(result)) {
    return ["Result must be an object."];
  }

  const parserOutput = result.parser_output;
  const analysisOutput = result.analysis_output;
  const displayPayload = result.display_payload;

  for (const key of ["parser_output", "analysis_output", "display_payload"]) {
    if (!isRecord(result[key])) {
      errors.push(`Missing object: ${key}`);
    }
  }

  if (isRecord(parserOutput)) {
    if (parserOutput.parserGroup !== "ownership") {
      errors.push("parser_output.parserGroup must be ownership.");
    }
    if (parserOutput.formType !== "Form 4 / 4/A, Form 144 / 144/A") {
      errors.push("parser_output.formType must use the exact ownership room scope.");
    }
    for (const key of [
      "parserVersion",
      "parserGroup",
      "formType",
      "accessionNumber",
      "isSupported",
      "summary",
      "facts",
      "signals",
      "calendarItems",
      "warnings",
      "raw",
    ]) {
      if (!(key in parserOutput)) {
        errors.push(`parser_output missing ${key}`);
      }
    }
  }

  if (isRecord(analysisOutput)) {
    const eventType = analysisOutput.event_type;
    const score = analysisOutput.score;
    if (typeof eventType !== "string" || !isApprovedEventType(eventType)) {
      errors.push("analysis_output.event_type must be one of the approved event types.");
    }
    if (analysisOutput.source_group !== "filings") {
      errors.push("analysis_output.source_group must be filings.");
    }
    if (typeof score !== "number" || score < 0 || score > 100) {
      errors.push("analysis_output.score must be a number between 0 and 100.");
    }
    for (const key of [
      "event_title",
      "primary_ticker",
      "tickers",
      "score_reason",
      "signal",
      "quick_take",
      "summary",
      "why_it_matters",
      "bullish_points",
      "bearish_points",
      "key_evidence",
      "what_to_watch_next",
      "calendar_items",
      "confidence",
      "needs_human_review",
    ]) {
      if (!(key in analysisOutput)) {
        errors.push(`analysis_output missing ${key}`);
      }
    }
  }

  if (isRecord(displayPayload)) {
    if (!["generic", "offering_terms", "candidate_special"].includes(String(displayPayload.display_type))) {
      errors.push("display_payload.display_type must be generic, offering_terms, or candidate_special.");
    }
  }

  return errors;
}

function summarizeFilingSourceEvidence(value: unknown) {
  const filing = isRecord(value) ? value : {};
  return {
    form_type: filing.form_type ?? null,
    accession_number: filing.accession_number ?? null,
    source_format: filing.source_format ?? null,
    document_type: filing.document_type ?? null,
    period_of_report: filing.period_of_report ?? null,
    source_aff10b5One: typeof filing.aff_10b5_1 === "boolean" ? filing.aff_10b5_1 : null,
  };
}

function summarizeReportingOwnerSourceEvidence(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).map((owner) => ({
    name: owner.name ?? null,
    title: owner.title ?? null,
    roles: Array.isArray(owner.roles) ? owner.roles : [],
    is_director: typeof owner.is_director === "boolean" ? owner.is_director : null,
    is_officer: typeof owner.is_officer === "boolean" ? owner.is_officer : null,
    is_ten_percent_owner: typeof owner.is_ten_percent_owner === "boolean" ? owner.is_ten_percent_owner : null,
    is_other: typeof owner.is_other === "boolean" ? owner.is_other : null,
    other_text: owner.other_text ?? null,
  }));
}

function summarizeTransactions(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((transaction) => {
    if (!isRecord(transaction)) {
      return transaction;
    }
    return {
      derivative_structure: transaction.transaction_kind ?? null,
      security_title: transaction.security_title ?? null,
      transaction_date: transaction.transaction_date ?? null,
      raw_transaction_code: transaction.transaction_code ?? null,
      raw_acquired_disposed_code: transaction.acquired_disposed_code ?? null,
      shares: sourceNumericEvidence(transaction.shares, transaction.shares_text, transaction.shares_status),
      price_per_share: sourceNumericEvidence(
        transaction.price_per_share,
        transaction.price_per_share_text,
        transaction.price_per_share_status,
      ),
      post_transaction_shares: sourceNumericEvidence(
        transaction.shares_owned_following,
        transaction.shares_owned_following_text,
        transaction.shares_owned_following_status,
      ),
      direct_or_indirect_ownership: transaction.direct_or_indirect_ownership ?? null,
      nature_of_ownership: transaction.nature_of_ownership ?? null,
      conversion_or_exercise_price: sourceNumericEvidence(
        transaction.conversion_or_exercise_price,
        transaction.conversion_or_exercise_price_text,
        transaction.conversion_or_exercise_price_status,
      ),
      exercise_date: transaction.exercise_date ?? null,
      expiration_date: transaction.expiration_date ?? null,
      underlying_security_title: transaction.underlying_security_title ?? null,
      underlying_security_shares: sourceNumericEvidence(
        transaction.underlying_security_shares,
        transaction.underlying_security_shares_text,
        transaction.underlying_security_shares_status,
      ),
      footnote_ids: Array.isArray(transaction.footnote_ids) ? transaction.footnote_ids : [],
      field_footnote_ids: isRecord(transaction.field_footnote_ids) ? transaction.field_footnote_ids : {},
      source_row_evidence: Array.isArray(transaction.evidence) ? transaction.evidence : [],
    };
  });
}

function summarizeForm144SourceEvidence(form144: Record<string, unknown> | null) {
  if (!form144) return null;
  const rows = Array.isArray(form144.proposed_sale_rows) ? form144.proposed_sale_rows : [];
  const acquisitionLots = Array.isArray(form144.acquisition_lots) ? form144.acquisition_lots : [];
  const priorSales = Array.isArray(form144.prior_sales) ? form144.prior_sales : [];
  return {
    submission_type: form144.submission_type ?? null,
    previous_accession_number: form144.previous_accession_number ?? null,
    seller_name: form144.seller_name ?? null,
    account_person_name: form144.account_person_name ?? null,
    issuer_relationships: form144.issuer_relationships ?? [],
    raw_remarks: form144.remarks ?? null,
    plan_adoption_dates: Array.isArray(form144.plan_adoption_dates) ? form144.plan_adoption_dates : [],
    plan_instruction_dates: Array.isArray(form144.plan_instruction_dates) ? form144.plan_instruction_dates : [],
    proposed_sale_rows: rows.map((row) => {
      if (!isRecord(row)) return row;
      return {
        security_title_raw_unit_description: row.securities_class_title ?? null,
        proposed_sale_numerator: sourceNumericEvidence(
          row.securities_to_be_sold,
          row.securities_to_be_sold_text,
          row.securities_to_be_sold_status,
        ),
        aggregate_market_value: sourceNumericEvidence(
          row.aggregate_market_value,
          row.aggregate_market_value_text,
          row.aggregate_market_value_status,
        ),
        outstanding_denominator: sourceNumericEvidence(
          row.shares_outstanding,
          row.shares_outstanding_text,
          row.shares_outstanding_status,
        ),
        proposed_sale_date: row.approximate_sale_date ?? null,
        proposed_sale_date_raw_text: row.approximate_sale_date_text ?? null,
        exchange: row.securities_exchange_name ?? null,
        footnote_ids: Array.isArray(row.footnote_ids) ? row.footnote_ids : [],
        field_footnote_ids: isRecord(row.field_footnote_ids) ? row.field_footnote_ids : {},
        source_row_evidence: Array.isArray(row.evidence) ? row.evidence : [],
      };
    }),
    acquisition_lots: acquisitionLots.map((lot) => {
      if (!isRecord(lot)) return lot;
      return {
        security_title_raw_unit_description: lot.securities_class_title ?? null,
        acquired_date: lot.acquired_date ?? null,
        acquired_date_source_status: lot.acquired_date_status ?? null,
        nature_of_acquisition_transaction: lot.nature_of_acquisition_transaction ?? null,
        acquired_from: lot.acquired_from ?? null,
        source_is_gift_transaction: typeof lot.is_gift_transaction === "boolean" ? lot.is_gift_transaction : null,
        amount_acquired: sourceNumericEvidence(
          lot.amount_of_securities_acquired,
          lot.amount_of_securities_acquired_text,
          lot.amount_of_securities_acquired_status,
        ),
        payment_date: lot.payment_date ?? null,
        payment_date_source_status: lot.payment_date_status ?? null,
        nature_of_payment: lot.nature_of_payment ?? null,
        footnote_ids: Array.isArray(lot.footnote_ids) ? lot.footnote_ids : [],
        field_footnote_ids: isRecord(lot.field_footnote_ids) ? lot.field_footnote_ids : {},
        source_row_evidence: Array.isArray(lot.evidence) ? lot.evidence : [],
      };
    }),
    prior_sales: priorSales.map((sale) => {
      if (!isRecord(sale)) return sale;
      return {
        seller_name: sale.seller_name ?? null,
        security_title_raw_unit_description: sale.securities_class_title ?? null,
        sale_date: sale.sale_date ?? null,
        sale_date_source_status: sale.sale_date_status ?? null,
        amount_sold: sourceNumericEvidence(
          sale.amount_of_securities_sold,
          sale.amount_of_securities_sold_text,
          sale.amount_of_securities_sold_status,
        ),
        gross_proceeds: sourceNumericEvidence(
          sale.gross_proceeds,
          sale.gross_proceeds_text,
          sale.gross_proceeds_status,
        ),
        footnote_ids: Array.isArray(sale.footnote_ids) ? sale.footnote_ids : [],
        field_footnote_ids: isRecord(sale.field_footnote_ids) ? sale.field_footnote_ids : {},
        source_row_evidence: Array.isArray(sale.evidence) ? sale.evidence : [],
      };
    }),
  };
}

function summarizeAmendmentSourceEvidence(value: unknown) {
  const amendment = isRecord(value) ? value : {};
  return {
    previous_accession_number: amendment.previous_accession_number ?? null,
    source_reason_or_remark: amendment.reason ?? null,
  };
}

function sourceNumericEvidence(value: unknown, rawText: unknown, sourceStatus: unknown) {
  return {
    value: typeof value === "number" && Number.isFinite(value) ? value : null,
    raw_text: typeof rawText === "string" ? rawText : null,
    source_status: typeof sourceStatus === "string" ? sourceStatus : null,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
