# SEC Dilution / Offering Detail Contract Draft

Status: draft only. Do not apply to production DB yet.

Scope:
- Filing event type: `dilution_risk`
- UI target: `/filings/[id]` dilution/offering detail template
- Source of truth: SEC filing package text preserved in `raw_items`
- Non-goals: no parser change, no DB migration execution in this draft

## Recommendation

Use a dedicated one-to-one table named `event_offering_terms`.

Rationale:
- `events` should stay the normalized event header: ticker, event type, score, signal, source, title, summary.
- `event_analysis` should stay the common narrative layer: why it matters, bull/bear points, evidence, watch-next.
- `raw_items` should continue preserving source documents, raw payload, body text, and attachment text.
- `event_calendar_items` should store investable dates such as offering closing, warrant deadline, lock-up expiration, and exact shareholder vote deadlines.
- Offering terms are domain-specific, wide, and not useful for most event types. Keeping them out of `events.metadata` and `event_analysis.metadata` makes the UI contract clearer and allows field-level confidence/evidence without turning generic metadata into a dumping ground.

Preferred table:

```text
event_offering_terms
  event_id primary key -> events.id
  raw_item_id -> raw_items.id
  extracted filing terms
  market context snapshot used for dilution math
  normalized numeric/date values where code can parse them
  code-calculated values
  LLM judgment fields
  field_confidence / field_evidence JSONB
```

Avoid for now:
- `events.metadata`: okay for source metadata only; not for detailed offering terms.
- `event_analysis.metadata`: okay for analysis confidence; not for structured offering terms.
- `event_dilution_details`: too narrow; some filings are ATM, resale, warrant indenture, shelf, or convertible terms where "offering terms" is the cleaner domain.

## Field Classes

### Store as extracted / normalized fields

These should come from the filing text. LLM may locate the text and classify it, but code should normalize money/share/date numbers where possible.

| Field | Store | Notes |
| --- | --- | --- |
| `offering_type` | yes | Enum-like classification: `atm`, `registered_direct`, `private_placement`, `shelf_registration`, `resale_registration`, `warrant_exercise`, `convertible_financing`, `rights_offering`, `mixed`, `other`, `unknown`. |
| `security_type` | yes | Common stock, ordinary shares, ADS, units, warrants, prefunded warrants, convertible notes, mixed, other. |
| `primary_or_resale` | yes | `primary`, `resale`, `mixed`, `not_disclosed`. |
| `offering_amount` | yes | Store source text, numeric amount, and currency. |
| `shares_offered` | yes | Store source text and normalized share count. |
| `offering_price` | yes | Store source text and normalized price if explicit. |
| `warrant_coverage` | yes | Often text or ratio; keep both where possible. |
| `warrant_exercise_price` | yes | Store source text and normalized price. |
| `conversion_price` | yes | Store source text and normalized price. |
| `use_of_proceeds` | yes | Text phrase or short sentence from filing. |
| `sales_agent` | yes | Text. Allow multiple names in one string for first pass. |
| `effective_date` | yes | Filing-stated registration effectiveness date. Also candidate for calendar only if investor-relevant. |
| `closing_date` | yes | Candidate for `event_calendar_items` as `offering_closing`. |
| `shelf_capacity` | yes | Useful for shelf/ATM capacity. |
| `amount_remaining` | yes | Useful when supplement says amount still available. |
| `atm_program_size` | yes | Often same as offering amount for ATM, but useful as a named UI field. |
| `resale_share_count` | yes | Resale-specific share count. |
| `selling_shareholders` | yes | JSON array initially; normalize later only if queries need it. |
| `registration_status` | yes | `filed`, `effective`, `not_effective`, `withdrawn`, `prospectus_supplement`, `not_disclosed`. |
| `sec_form_type` | yes | Display and QA filter. Usually duplicate of source metadata but useful for table reads. |
| `prospectus_type` | yes | `base`, `supplement`, `registration_statement`, `current_report`, `warrant_indenture`, `other`, `unknown`. |

### Store as market context snapshot

These should come from market data providers or local market cache, not from the LLM. This snapshot is required for scoring because dilution size is relative to the issuer's market cap, shares outstanding, and float.

Preferred source order:
1. Fresh FMP shares-float / quote / profile response.
2. `market_quotes` for current price and volume.
3. `tickers.market_cap` for fallback market cap.
4. Latest `market_snapshots` row for fallback float, shares outstanding, and price.

| Field | Store | Notes |
| --- | --- | --- |
| `market_reference_price` | yes, nullable | Current price or previous close used for discount and market-cap context. Include source and timestamp. |
| `market_cap` | yes, nullable | Used for offering amount as % of market cap. |
| `shares_outstanding_market` | yes, nullable | Provider shares outstanding. Do not overwrite filing-extracted share count; keep both with sources. |
| `public_float_market` | yes, nullable | Provider public float / float shares. This is central for resale/overhang analysis. |
| `public_float_percent` | yes, nullable | Provider free-float percent when available; do not treat percent as share count. |
| `volume` | yes, nullable | Liquidity context. |
| `avg_volume` | yes, nullable | Liquidity context. |
| `market_context_as_of` | yes, nullable | Timestamp for the market snapshot used in the calculation. |
| `market_context_source` | yes | Field-level source map such as `fmp_shares_float`, `fmp_quote`, `tickers`, `market_snapshots`. |

### Store as code-calculated fields

LLM should not calculate these.

| Field | Store | Code source |
| --- | --- | --- |
| `estimated_dilution_percent` | yes, nullable | `shares_offered / current_shares_outstanding * 100`, only when both values are explicit and compatible. |
| `float_overhang_percent` | yes, nullable | `shares_offered_or_resale_shares / public_float_market * 100`. This is often more useful than outstanding-share dilution for resale S-3s. |
| `offering_amount_percent_of_market_cap` | yes, nullable | `offering_amount / market_cap * 100`, useful for ATM and mixed shelf where shares offered are not explicit. |
| `discount_to_market` | yes, nullable | Requires offering price plus a market reference price. Prefer quote/cache or explicit filing comparison. |
| normalized money/share/price columns | yes, nullable | Parse from extracted source text in code, preserve source text even when parse fails. |
| `preliminary_score_floor` | yes, nullable | Code-derived scoring floor based on dilution/overhang scale. Final policy can raise/lower it using filing specificity and staleness. |
| `preliminary_score_cap` | yes, nullable | Code-derived alert guardrail. Simple shelf filings can be feed-level but capped below alert unless concrete sale terms or large overhang exist. |

### Store as LLM judgment fields

These are analysis judgments, not raw filing facts.

| Field | Store | Notes |
| --- | --- | --- |
| `overhang_level` | yes | `low`, `moderate`, `elevated`, `high`, `unknown`. Based on amount, share count, ATM/resale/warrant structure, and specificity. |
| `next_trigger` | yes | One short action/date/filing to watch next. |
| `dilution_risk_summary` | yes | Short offering-specific explanation for the detail page. |
| `needs_human_review` | yes | True when fields conflict, source text is table-heavy, or a material value is ambiguous. |
| `confidence_by_field` | yes | JSONB map of field -> `high` / `medium` / `low`. |

### Defer / do not store yet

| Field | Reason |
| --- | --- |
| underwriter fee schedules | Too detailed for current UI; keep in raw text/evidence. |
| every selling shareholder line item | Store summarized `selling_shareholders` JSON first; normalize later if needed. |
| every anti-dilution adjustment term | Too broad for first pass; summarize under warrant/convertible terms. |
| legal boilerplate dates | Do not calendar or surface unless they are investor-relevant deadlines. |

## LLM JSON Output Draft

Recommended prompt shape: a second-stage enrichment output named `sec_dilution_offering_terms`, run only after the main SEC filing analysis classifies `event_type = dilution_risk`.

This keeps the current generic SEC analysis contract small and avoids forcing non-offering filings to emit empty offering fields.

Current implementation direction:
- The S-3 family prompt now emits an optional `offering_display_model` for the detail page.
- SEC filing text, important sections, and important tables are authoritative.
- Parser output is passed only as `parser_candidates`; it is not authoritative and must be ignored when unsupported by source text.
- LLM chooses what each value means and how instruments relate to total supply.
- Code should calculate dilution percent, multiple, discount to market, and final score guardrails from the LLM-selected source facts plus market context.
- The display model should prefer a narrative explanation plus a simple share-overhang view over a wide list of raw fields.

```json
{
  "source_group": "filings",
  "event_type": "dilution_risk",
  "offering_terms": {
    "sec_form_type": "6-K",
    "prospectus_type": "current_report",
    "offering_type": "atm",
    "security_type": "ordinary_shares",
    "primary_or_resale": "primary",
    "registration_status": "not_disclosed",
    "offering_amount": {
      "value_text": "$17,000,000",
      "currency": "USD",
      "evidence": "..."
    },
    "shelf_capacity": {
      "value_text": null,
      "currency": null,
      "evidence": null
    },
    "amount_remaining": {
      "value_text": null,
      "currency": null,
      "evidence": null
    },
    "atm_program_size": {
      "value_text": "$17,000,000",
      "currency": "USD",
      "evidence": "..."
    },
    "shares_offered": {
      "value_text": null,
      "evidence": null
    },
    "resale_share_count": {
      "value_text": null,
      "evidence": null
    },
    "current_shares_outstanding": {
      "value_text": null,
      "evidence": null
    },
    "public_float": {
      "value_text": null,
      "evidence": null
    },
    "authorized_shares": {
      "value_text": null,
      "evidence": null
    },
    "offering_price": {
      "value_text": null,
      "currency": null,
      "evidence": null
    },
    "warrant_coverage": {
      "value_text": null,
      "evidence": null
    },
    "warrant_exercise_price": {
      "value_text": null,
      "currency": null,
      "evidence": null
    },
    "conversion_price": {
      "value_text": null,
      "currency": null,
      "evidence": null
    },
    "use_of_proceeds": {
      "value_text": "working capital and general corporate purposes",
      "evidence": "..."
    },
    "sales_agent": {
      "value_text": "Chaince Securities, LLC",
      "evidence": "..."
    },
    "selling_shareholders": [],
    "effective_date": {
      "value": null,
      "date_precision": "unknown",
      "evidence": null
    },
    "closing_date": {
      "value": null,
      "date_precision": "unknown",
      "evidence": null
    },
    "market_context": {
      "as_of": "2026-05-19T00:00:00.000Z",
      "market_reference_price": 1.23,
      "market_cap": 50000000,
      "shares_outstanding_market": 40000000,
      "public_float_market": 22000000,
      "public_float_percent": 55,
      "volume": 1200000,
      "avg_volume": 900000,
      "field_sources": {
        "market_reference_price": "fmp_quote",
        "market_cap": "fmp_quote",
        "shares_outstanding_market": "fmp_shares_float",
        "public_float_market": "fmp_shares_float"
      }
    },
    "dilution_metrics": {
      "shares_offered": null,
      "shares_offered_source": null,
      "current_shares_outstanding": 40000000,
      "current_shares_outstanding_source": "market_context.shares_outstanding",
      "public_float": 22000000,
      "public_float_source": "market_context.public_float",
      "estimated_dilution_percent": null,
      "float_overhang_percent": null,
      "offering_amount_percent_of_market_cap": 34,
      "discount_to_market_percent": null,
      "dilution_scale": "elevated",
      "preliminary_score_floor": 70,
      "preliminary_score_cap": null,
      "delivery_hint": "feed",
      "score_policy_reasons": ["atm_program_feed_floor"]
    },
    "overhang_level": "moderate",
    "dilution_risk_summary": "ATM capacity creates potential share-sale overhang until actual sales are disclosed.",
    "next_trigger": "Watch for prospectus supplement, sale notice, or share-count update.",
    "field_confidence": {
      "offering_type": "high",
      "offering_amount": "high",
      "shares_offered": "low",
      "current_shares_outstanding": "low",
      "sales_agent": "high"
    },
    "needs_human_review": false
  },
  "calendar_items": []
}
```

Schema rules:
- Required object keys should be present with `null` values when not disclosed.
- `value_text` must be copied or tightly paraphrased from the filing; do not infer values.
- LLM must not calculate `estimated_dilution_percent` or `discount_to_market`.
- LLM must not supply market cap, float, shares outstanding, or market price. These are `market_context` inputs supplied by code.
- Code-calculated `dilution_metrics` should drive alert scoring before the final policy layer applies routine/amendment/source-quality adjustments.
- Simple base shelf, universal shelf, and automatic shelf filings should go to the feed, not archive-only. Large issuers should remain below alert without concrete sale terms. Small/micro issuers can reach alert-level when shelf capacity is large versus market cap or explicitly registered shares are large versus current shares/float.
- LLM may set `overhang_level`, `dilution_risk_summary`, and `next_trigger`.
- Evidence should be short and field-specific. Do not paste large filing sections.

## Calendar Connection

Use `event_calendar_items` only for explicit investor-relevant dates or deadlines.

Currently supported calendar event types include:
- `offering_closing`
- `rights_offering_deadline`
- `warrant_redemption_deadline`
- `lockup_expiration`
- `shareholder_vote`

Needs code registry addition before use:
- `registration_effective_date`
- `shareholder_approval_deadline`

Can add to calendar:
- Offering closing date with exact or bounded estimated date.
- Warrant exercise, redemption, or expiration deadline.
- Lock-up expiration.
- Registration effective date only if the filing clearly states it and the product wants this on the calendar.
- Shareholder approval vote/deadline for financing, reverse split, or share authorization.

Do not add to calendar:
- "May sell from time to time."
- "Intends to use proceeds."
- Expected deployment or business roadmap dates.
- Generic future plan language.
- Filing date itself unless the filing says the offering event occurs on that date.
- Boilerplate dates in incorporated documents.

## UI Mapping

| UI section | DB source |
| --- | --- |
| Filing Summary | `events.title`, `events.quick_take`, `event_offering_terms.offering_type`, `security_type`, `primary_or_resale`, `offering_amount`, `next_trigger` |
| Dilution Snapshot | `event_offering_terms.offering_type`, `security_type`, `offering_amount`, `primary_or_resale`, `estimated_dilution_percent`, `overhang_level` |
| Offering Structure | `offering_type`, `security_type`, `primary_or_resale`, `offering_amount`, `shares_offered`, `offering_price`, `sales_agent`, `use_of_proceeds`, `registration_status`, `prospectus_type` |
| Share Impact | `shares_offered`, `resale_share_count`, filing `current_shares_outstanding`, `shares_outstanding_market`, `public_float_market`, `authorized_shares`, `estimated_dilution_percent`, `float_overhang_percent`, `offering_amount_percent_of_market_cap`, `amount_remaining`, `atm_program_size` |
| Warrant / Convertible Terms | `warrant_coverage`, `warrant_exercise_price`, `conversion_price`, evidence fields |
| Share Overhang | `overhang_level`, `dilution_risk_summary`, `estimated_dilution_percent`, `float_overhang_percent`, `offering_amount_percent_of_market_cap`, `preliminary_score_floor`, `amount_remaining`, `field_confidence` |
| Timeline / Next Triggers | `event_offering_terms.next_trigger` plus related `event_calendar_items` |
| Key Evidence | `event_analysis.key_evidence`, `event_offering_terms.field_evidence` |
| Related Filings | Existing ticker/event query from `events` |
| Original Filing Text | `raw_items.body_text`, `raw_items.analysis_text`, `raw_items.raw_payload.documents`, `raw_items.raw_payload.attachment_texts` |
| Source & Evidence | `events.source_url`, `events.metadata`, `raw_items.raw_payload.primary_document_url` |

## Sample Readout From Current DB

## Scoring Policy Draft

Delivery thresholds:
- `0-19`: skip candidate.
- `20-49`: archive.
- `50-74`: feed.
- `75-89`: alert.
- `90-100`: urgent.

S-3 family policy:
- Routine `S-3/A`: default `skip_analysis`, cap `15`, no event storage unless material changed terms are detected.
- Base shelf / universal shelf / automatic shelf: feed-level, floor `50`; cap `59` for normal large issuers.
- Small/micro issuer shelf: floor `55`, cap `65` by default.
- Large shelf capacity without current sale terms can rise within feed for large issuers, but remains below alert without concrete sale terms.
- Small/micro issuer shelf capacity `>= 50%` of market cap: alert-capable, floor `75`, cap `84`.
- Small/micro issuer shelf capacity `>= 100%` of market cap: strong alert-capable, floor `85`, cap `88`.
- Small/micro issuer explicitly registered shares `>= 20%` of current shares or public float: alert-capable, floor `75`, cap `84`.
- Small/micro issuer explicitly registered shares `>= 50%` of current shares or public float: strong alert-capable, floor `88`, cap `88`.
- Resale registration: floor `60`; alert when registered supply is at least `20%` of current shares or public float.
- ATM / mixed shelf / prospectus supplement / registered direct terms: feed floor `65`; alert/urgent follows size and specificity.
- Other S-3 filings with concrete sale terms: feed floor `60`.
- `estimated_dilution_percent` or `float_overhang_percent >= 20%`: floor `75`.
- `estimated_dilution_percent` or `float_overhang_percent >= 50%`: floor `90`.
- `offering_amount_percent_of_market_cap >= 25%`: floor `75` when the filing is actionable.
- `offering_amount_percent_of_market_cap >= 50%`: floor `90` when the filing is actionable.

Final policy should clamp LLM score into the code-derived floor/cap range before persistence.

Read-only sample check on 2026-05-18:

| Sample | What can be filled now | Gaps |
| --- | --- | --- |
| WETO 6-K | ATM classification, ordinary shares, offering amount around `$17,000,000`, Chaince Securities sales agreement, use/proceeds/net proceeds phrasing. | Shares offered, current shares outstanding, float, authorized shares, explicit closing/effective date not reliably extracted. |
| IAUX 8-K | Warrant-focused terms, up to `34,849,025` warrants, exercise price language around `$2.15`, common shares on exercise. | Not a classic ATM/offering summary; needs warrant-specific treatment and table-aware parsing. |
| VELO 8-K | ATM sales agreement, up to `$100,000,000`, common stock, Needham/Cantor/Craig-Hallum agents, use of proceeds. | Text also contains resale/warrant/shelf references; needs field-level evidence to avoid over-crediting unrelated incorporated text. |
| VELO 424B5 | Prospectus supplement, up to `$100,000,000`, common stock, ATM agent names, use of proceeds, multiple share-count figures. | Need distinguish offering amount from market price and historical share counts; avoid treating every incorporated future/boilerplate date as calendar item. |

## Validation Order Before Applying

1. Add `event_offering_terms` migration in a branch but do not apply.
2. Add TypeScript row types and a read-only fetch helper.
3. Add a local fixture mapper that converts existing `raw_items.analysis_text` into the draft output without DB writes.
4. Run fixture extraction for WETO, IAUX, VELO 8-K, VELO 424B5.
5. Compare per-field evidence manually against SEC source text.
6. Add code calculation for normalized money/share values, `estimated_dilution_percent`, and `discount_to_market`.
7. Only then wire ingestion to upsert `event_offering_terms`.
8. Run read-only UI preview using stored fixture data.
9. Apply DB migration only after sample-backed checks pass.
