import {
  buildOwnershipDisplayPayload,
  buildOwnershipRoutingDecision,
  isApprovedEventType,
} from "./parser.ts";
import type { OwnershipParserOutput } from "./parser.ts";

export const OWNERSHIP_ANALYSIS_PROMPT = `
You are the final SEC Ownership filing analysis LLM for Stock Radar.

Covered forms:
- Form 4
- Form 4/A
- Form 144
- Form 144/A

Current flow:
- The Ownership parser/classifier has already extracted facts and selected
  event_type, display_type, display_version, and display_payload.
- There is no Ownership router LLM in this path.
- Your job is only to write investor-facing copy and assign the final score.

Use only the provided inputs:
- compact parser facts and selected evidence
- selected_routing
- display_payload
- cleaned_source_blocks when provided
- filing_context when provided
- parent_filing_context when provided
- market_context when provided

Do not invent facts, dates, prices, values, roles, tickers, holdings, float data,
prior trading patterns, parent amendment conclusions, or market context.
Do not call or request live DB, FMP, SEC, or market-data lookups.

Event and display rules:
- Use selected_routing.event_type exactly.
- Use the provided display_payload/display_type. Do not choose the UI template.
- If parser facts provide issuer.ticker, preserve it in
  analysis_output.primary_ticker.ticker and analysis_output.tickers.
- Do not create new display types or new display_payload fields, except that
  archive results may fill display_payload.data.filing_summary.
- Do not output delivery_level as a model decision. Integration derives it from
  score: score < 50 archive, 50-74 feed, 75+ alert.

Return JSON only according to the provided response schema.

Output rules:
- parser_output is pass-through. Keep it minimal; do not echo transaction
  arrays, footnotes, source inventory, raw XML/source text, filing_context, or
  compact parser facts inside parser_output.
- display_payload should stay compact. Do not echo transaction tables,
  footnotes, or source inventory into display_payload.

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
  Form 4 actual P/S: shares are at least 1.0% of float/public_float, or at least
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
- Use "open-market purchase" or "open-market sale" only when parser facts
  support an actual P or S transaction.
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
  P open-market purchase is usually bullish; S open-market sale is usually
  bearish; A/F/M/V/holding-only is usually neutral; complex or unclear ownership
  mechanics may be neutral or volatile depending on facts.
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
- Holding-only or V-only: 5-20, hard cap 20.
- Routine A grant/RSU/award: 15-32, hard cap 34.
- F withholding/tax/payment row: 20-35, hard cap 39.
- M exercise/conversion-only: 20-35, hard cap 39.
- G gift/no-cash transfer: 25-40, hard cap 44 unless current filing
  facts show unusual control, legal, or strategic context.
- Clean P/S below $1M: 35-49, hard cap 49 unless a senior/control-holder
  or ownership-percentage trigger below applies.
- CEO/CFO P/S of $500k-$1M: 50-55, hard cap 55.
- 10% owner P/S of $500k-$1M: 50-58, hard cap 58.
- P/S changing estimated pre-transaction holdings by 10% or more: 50-60,
  hard cap 60 unless market_context or filing_context supports more urgency.
- P/S $1M-$5M: 52-62, hard cap 62.
- P/S $5M-$20M: 58-68, hard cap 68.
- P/S above $20M: 65-74, hard cap 74 unless the alert gate is met.

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
- Form 4 alert gate applies only to actual P/S rows. A/F/M/V/G/J/K/U,
  holding-only, and Form 4/A administrative changes cannot become alert by this
  gate.
- For Form 4 actual P/S, 75+ is allowed when one of these absolute-plus-float
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
  If an actual Form 4 P/S clears an absolute feed band, do not score it below
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
  may lift a current P/S or Form 144 into stronger feed.
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
- Use parser-provided amendment comparison facts as the authority for what
  changed. Do not infer parent changes from missing rows, repeated rows, or
  amendment form type alone.
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
- If parser facts show only administrative, metadata, signature, title, or
  footnote/explanatory changes with no changed transaction economics, keep the
  analysis compact and low urgency.
- If parser facts show changed transaction economics, added rows, changed
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
- For Form 144/A remarks-only amendments, do not reuse a parser-provided
  filing_summary that only repeats the remark. Rewrite it to include both the
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
- Prefer the parser-provided filing_summary when it is factually correct.
- Exception: for Form 4/A or Form 144/A, prefer a more precise amendment
  comparison summary over parser-provided filing_summary when the parser summary
  omits what remained unchanged.
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

Compact parser facts:
${JSON.stringify(buildOwnershipAnalysisInput(parserOutput), null, 2)}

Final validation before returning JSON:
- Audit every sentence for unsupported inference.
- Every claim must be traceable to current filing, parser facts, market_context,
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
  const sentenceSafeSummary = buildSentenceSafeFilingSummary(parserOutput);

  return {
    selected_routing: buildOwnershipRoutingDecision(parserOutput),
    display_payload: buildOwnershipAnalysisDisplayPayload(parserOutput),
    parserVersion: parserOutput.parserVersion,
    parserGroup: parserOutput.parserGroup,
    formType: parserOutput.formType,
    accessionNumber: parserOutput.accessionNumber,
    isSupported: parserOutput.isSupported,
    summary: sentenceSafeSummary ?? parserOutput.summary,
    issuer: facts.issuer ?? null,
    market_context: facts.market_context ?? null,
    reporting_owner: facts.reporting_owner ?? null,
    reporting_owners: facts.reporting_owners ?? [],
    filing: facts.filing ?? null,
    form4: form4
      ? {
          acquired_shares: form4.acquired_shares ?? null,
          disposed_shares: form4.disposed_shares ?? null,
          total_reported_value: form4.total_reported_value ?? null,
          has_purchase: form4.has_purchase ?? false,
          has_sale: form4.has_sale ?? false,
          has_gift: form4.has_gift ?? false,
          has_conversion: form4.has_conversion ?? false,
          has_derivative_transaction: form4.has_derivative_transaction ?? false,
          transactions: summarizeTransactions(form4.transactions),
          holdings: form4.holdings ?? [],
        }
      : null,
    form144,
    amendment: facts.amendment ?? null,
    footnotes: facts.footnotes ?? {},
    remarks: facts.remarks ?? null,
    signatures: facts.signatures ?? [],
    source_inventory: facts.source_inventory ?? raw.source_inventory ?? null,
    selected_evidence: raw.selected_evidence ?? [],
    signals: parserOutput.signals,
    calendarItems: parserOutput.calendarItems,
    warnings: ownershipAnalysisWarnings(parserOutput.warnings),
  };
}

function ownershipAnalysisWarnings(warnings: unknown) {
  if (!Array.isArray(warnings)) {
    return [];
  }
  return warnings
    .filter((warning): warning is string => typeof warning === "string")
    .filter((warning) => !/original filing was not supplied|original filing comparison|parent comparison|reconciliation/i.test(warning));
}

function buildOwnershipAnalysisDisplayPayload(parserOutput: OwnershipParserOutput) {
  const routing = buildOwnershipRoutingDecision(parserOutput);
  const parserDisplayPayload = buildOwnershipDisplayPayload(parserOutput);
  const parserDisplayData = (isRecord(parserDisplayPayload.data) ? parserDisplayPayload.data : {}) as Record<string, unknown>;
  const filingSummary =
    typeof parserDisplayData.filing_summary === "string"
      ? parserDisplayData.filing_summary
      : buildSentenceSafeFilingSummary(parserOutput);
  return {
    display_type: routing.display_type,
    data: {
      display_version: routing.display_version,
      event_type: routing.event_type,
      filing_summary: filingSummary,
      parser_display_payload_available: true,
      common_feed_detail_ui: routing.display_type === "candidate_special",
    },
    evidence: [],
    notes: [
      "Full parser-built display payload is available to integration outside the LLM prompt.",
      "LLM should not echo transaction tables, footnotes, or source inventory into display_payload.",
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

function summarizeTransactions(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((transaction) => {
    if (!isRecord(transaction)) {
      return transaction;
    }
    return {
      transaction_kind: transaction.transaction_kind ?? null,
      security_title: transaction.security_title ?? null,
      transaction_date: transaction.transaction_date ?? null,
      transaction_code: transaction.transaction_code ?? null,
      acquired_disposed_code: transaction.acquired_disposed_code ?? null,
      shares: transaction.shares ?? null,
      price_per_share: transaction.price_per_share ?? null,
      transaction_value: transaction.transaction_value ?? null,
      shares_owned_following: transaction.shares_owned_following ?? null,
      direct_or_indirect_ownership: transaction.direct_or_indirect_ownership ?? null,
      underlying_security_title: transaction.underlying_security_title ?? null,
      underlying_security_shares: transaction.underlying_security_shares ?? null,
      footnote_ids: Array.isArray(transaction.footnote_ids) ? transaction.footnote_ids : [],
    };
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
