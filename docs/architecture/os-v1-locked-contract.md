# O/S V1 — LOCKED CONTRACT

## 1. Status

Status: LOCKED

Frozen validation commit:
`88060742b0ff1ad29abe041a68ab7677f0a9fa65`

O/S LIVE FIELD VALIDATION V1:
PASS

O/S V1:
LOCKED

Do not redesign or expand O/S V1 during Dilution development
unless a new real-world production case proves an architecture defect.

---

## 2. Product Definition

O/S V1 represents:

The best safely resolved common shares outstanding
available from public SEC information at a given point in time.

It is NOT a real-time legal share ledger.

Sources include:

- authoritative filing-level XBRL O/S
- Level 2 source-stated O/S
- complete common-class universe snapshots
- security-class-specific observations
- known Forward / Reverse Stock Split executions

---

## 3. Resolution Contract

O/S resolution uses:

SEC Filing / XBRL
→ authoritative share observations
→ Share Count History
→ Common-Class Universe
→ Class Resolver
→ Stock Split Basis Normalizer
→ Issuer Total Common O/S

Event-time rules apply.

Future filings must never rewrite historical knowledge.

No look-ahead.

---

## 4. Security-Class Contract

Supported:

- single common class
- complete multi-class common structures
- custom canonical security-class identity where source-backed

Issuer total is produced only when the required common-class universe
is complete and every required class can be safely resolved.

Preferred shares, warrants, convertibles and other non-common securities
are excluded from O/S.

ADR / ordinary-share ambiguity fails closed.

---

## 5. Stock Split Contract

Supported:

- Forward Split
- Reverse Split

Historical observations are normalized at read time.

Raw share-count history is never rewritten.

Formula:

historical O/S × new_share_units / old_share_units

Exact rational arithmetic is preserved.

Calculation activation:

- date_only
- business_day_open
- market_open
- start_of_trading
  → ON_EFFECTIVE_DATE

- after_market_close
  → effective date itself not applied;
    later dates applied

- ambiguous effective date
  → INDETERMINATE / fail-closed

The calculation effective date must represent the date
the outstanding shares move to the post-split share basis.

Approval, amendment, filing or announcement dates are not sufficient
unless the source explicitly binds the share-basis change to that date.

---

## 6. Evidence Contract

Authoritative evidence identity includes:

- source_ref
- exact source range
- SHA-256
- exact_source

800-character evidence limits are display/preview limits only.
They must never determine truth availability.

For calculation-critical semantic fields,
source authenticity alone is insufficient.

The evidence must also support the semantic role of the field.

Example:

amendment effective date
≠
stock-split calculation effective date

---

## 7. Current Analyzer Contract Behavior

Historical analyzer contracts may coexist.

Examples:

V1
V3
V4

Historical row count is not current-state uniqueness.

Current state is resolved according to the production reader contract.

A failed / pending / incomplete current analyzer contract
must not silently fall back to an older successful contract.

Fail closed.

---

## 8. Anchor Reconciliation

Periodic authoritative O/S observations act as anchors.

Reconciliation compares split-basis-normalized anchors.

It may calculate:

- normalized start shares
- end shares
- exact net change
- percentage change

It does NOT guess the economic cause of the change.

Example:

O/S increase between anchors
does not automatically mean ATM, warrant exercise or CB conversion.

Economic attribution belongs to the future Dilution Engine.

---

## 9. Fail-Closed Conditions

UNAVAILABLE is valid when the system cannot safely resolve O/S.

Examples:

- ADR / ordinary-share ambiguity
- incomplete IXDS
- incomplete common-class universe
- unresolved security-class identity
- current analyzer contract failure
- source-backed split materialization failure
- ambiguous split calculation date

Never output a confident O/S value merely to avoid UNAVAILABLE.

---

## 10. O/S V1 Validation

Frozen validation universe:

- AAPL
- Alphabet
- NVDA
- COSM
- BINI
- GWAV
- FFAI
- WIT
- ARM

Final quality gates:

WRONG_CONFIDENT_O/S = 0
LOOK_AHEAD_VIOLATION = 0
DUPLICATE_SPLIT_APPLICATION = 0
SOURCE_SPOT_CHECK_MISMATCH = 0
WRONG_CONFIDENT_SPLIT_SEMANTIC_DATE = 0
LOCKED_SPLIT_MATERIALIZATION_FAILURE = 0

Relevant Node regression:
300 / 300 PASS

Relevant pgTAP:
132 / 132 PASS

Frozen validation used the same commit from start to finish.

---

## 11. Explicit Limitations

O/S V1 does NOT claim to know:

- undisclosed real-time ATM issuance
- undisclosed convertible-note conversions
- undisclosed warrant exercises
- other unpublished intermediate share issuance

If a company later publishes a newer source-stated O/S,
that becomes a new authoritative observation / anchor.

Unknown intermediate issuance must not be invented.

---

## 12. LOCK Rule

Do not reopen O/S V1 merely to pursue theoretical completeness.

A future modification requires:

1. a real production/source example,
2. evidence of an actual incorrect or unsafe result,
3. a separate reviewed candidate,
4. regression against the frozen O/S V1 cases.

New functionality belongs outside O/S V1 whenever possible.

---

## 13. Next Layer — Dilution

O/S V1 answers:

"What common shares have been safely resolved as outstanding?"

The Dilution Engine will answer:

"What additional shares may still be issued?"

Next architecture layer:

SEC filings
→ small source-backed instrument observations
→ Economic Exposure Registry
→ Terms Versions
→ Registration Lifecycle
→ Current Exposure Projection
→ Potential Shares
→ Potential Dilution %

O/S and Dilution must remain separate concepts.

Do not infer potential dilution into O/S.
Do not infer unknown historical issuance from potential dilution.
