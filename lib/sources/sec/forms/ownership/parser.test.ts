import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  APPROVED_EVENT_TYPES,
  OWNERSHIP_FORM_SCOPE,
  deriveDeliveryLevel,
  parseOwnershipFiling,
} from "./parser.ts";

const here = dirname(fileURLToPath(import.meta.url));

function readJson<T>(relativePath: string): T {
  return JSON.parse(readFileSync(join(here, relativePath), "utf8")) as T;
}

test("ownership parser keeps the approved event type set fixed at 16 values", () => {
  assert.deepEqual(APPROVED_EVENT_TYPES, [
      "listing_risk",
      "dilution_risk",
      "earnings",
      "sales_performance",
      "product_update",
      "leadership_governance",
      "insider_ownership",
      "shareholder_vote",
      "strategic_transaction",
      "financial_risk",
      "legal_risk",
      "ipo_listing",
      "dividends",
      "capital_return",
      "fda_clinical",
      "other",
    ]);
});

test("ownership parser derives delivery level only from score bands", () => {
  assert.equal(deriveDeliveryLevel(49), "archive");
  assert.equal(deriveDeliveryLevel(50), "feed");
  assert.equal(deriveDeliveryLevel(74), "feed");
  assert.equal(deriveDeliveryLevel(75), "alert");
});

test("ownership parser extracts a Form 4 open-market purchase from fixture JSON", () => {
    const fixture = readJson<Record<string, unknown>>("fixtures/form4-insider-purchase.json");
    const parsed = parseOwnershipFiling(fixture as never);
    const facts = parsed.facts as Record<string, any>;

    assert.equal(parsed.formType, OWNERSHIP_FORM_SCOPE);
    assert.ok(parsed.signals.includes("form_4_transaction"));
    assert.ok(parsed.signals.includes("insider_purchase"));
    assert.equal(facts.issuer.ticker, "ATRB");
    assert.equal(facts.reporting_owner.name, "Maya Chen");
    assert.deepEqual(pick(facts.form4.transactions[0], [
      "transaction_code",
      "acquired_disposed_code",
      "shares",
      "price_per_share",
      "transaction_value",
    ]), {
      transaction_code: "P",
      acquired_disposed_code: "A",
      shares: 25000,
      price_per_share: 12.4,
      transaction_value: 310000,
    });
    assert.equal(facts.source_inventory.source_format, "structured_xml");
    assert.equal(facts.source_inventory.non_derivative_transaction_count, 1);
    assert.ok(Array.isArray(parsed.raw.selected_evidence));
    assert.equal(parsed.raw.deterministic_result_available, true);
    assert.equal(facts.parser_completion.completion_kind, "insider_buy");
    assert.equal(facts.parser_completion.can_finish_without_llm, true);
    assert.equal(facts.parser_completion.metrics.total_value, 310000);
    assert.equal(facts.parser_completion.metrics.requires_llm, false);
    assert.equal(facts.ownership_handoff.analysis_llm_needed, false);
});

test("ownership parser extracts Form 144 proposed sale facts without live market context", () => {
    const fixture = readJson<Record<string, unknown>>("fixtures/form144-routine-proposed-sale.json");
    const parsed = parseOwnershipFiling(fixture as never);
    const facts = parsed.facts as Record<string, any>;

    assert.ok(parsed.signals.includes("form_144_proposed_sale"));
    assert.ok(parsed.signals.includes("routine_form_144"));
    assert.ok(parsed.signals.includes("deterministic_archive"));
    assert.deepEqual(pick(facts.form144, [
      "securities_to_be_sold",
      "aggregate_market_value",
      "proposed_sale_percent_of_shares_outstanding",
    ]), {
      securities_to_be_sold: 25000,
      aggregate_market_value: 175000,
      proposed_sale_percent_of_shares_outstanding: 0.025,
    });
    assert.equal(facts.source_inventory.selected_table_count, 1);
    assert.equal(parsed.raw.deterministic_result_available, true);
});

test("ownership parser keeps source inventory and selected evidence without filing context", () => {
    const fixture = readJson<Record<string, unknown>>("fixtures/source-agig-form4-purchase.json");
    const parsed = parseOwnershipFiling(fixture as never);
    const facts = parsed.facts as Record<string, any>;

    assert.equal(facts.issuer.ticker, "AGIG");
    assert.equal(facts.form4.transactions[0].shares, 1050);
    assert.equal("ownership_context" in facts, false);
    assert.equal("filing_context" in facts, false);
    assert.equal(facts.source_inventory.source_format, "structured_xml");
    assert.equal(facts.source_inventory.source_excerpt_available, true);
    assert.ok(String(parsed.raw.source_excerpt).includes("<ownershipDocument"));
    assert.ok(Array.isArray(parsed.raw.selected_evidence));
});

test("ownership parser preserves unsupported-source facts for downstream LLM analysis", () => {
    const fixture = readJson<Record<string, unknown>>("fixtures/form4-empty-unsupported.json");
    const parsed = parseOwnershipFiling(fixture as never);

    assert.ok(parsed.signals.includes("unsupported_or_empty_document"));
    assert.equal(parsed.accessionNumber, fixture.accessionNumber);
});

test("ownership parser caps small Form 4 P/S by absolute value even when holdings percent or context words are high", () => {
  const smallHighPercentPurchase = parseOwnershipFiling({
    formType: "4",
    filingText: form4OwnershipXml(
      form4TransactionXml({ code: "P", acquiredDisposed: "A", shares: "2000", price: "2.00" }).replace(
        "<sharesOwnedFollowingTransaction><value>1000</value></sharesOwnedFollowingTransaction>",
        "<sharesOwnedFollowingTransaction><value>5529</value></sharesOwnedFollowingTransaction>",
      ),
      null,
      {
        ownerName: "Small Spouse Buyer",
        ownerTitle: "Director",
        footnotes: ["Shares are held by spouse."],
      },
    ),
  } as never);
  const smallEntitySale = parseOwnershipFiling({
    formType: "4",
    filingText: form4OwnershipXml(
      form4TransactionXml({ code: "S", acquiredDisposed: "D", shares: "101", price: "44.49", rowFootnote: "F1" }),
      null,
      {
        ownerName: "Small Entity Seller LLC",
        ownerTitle: "Director",
        footnotes: ["Sale made pursuant to a Rule 10b5-1 trading plan by an LLC reporting person."],
      },
    ),
  } as never);
  const privatePlacementPurchase = parseOwnershipFiling({
    formType: "4",
    filingText: form4OwnershipXml(
      form4TransactionXml({ code: "P", acquiredDisposed: "A", shares: "10000", price: "10.00", rowFootnote: "F1" }),
      "Shares were acquired under a securities purchase agreement in a private placement.",
      {
        ownerName: "Placement Buyer",
        footnotes: ["Shares were acquired under a securities purchase agreement in a private placement."],
      },
    ),
  } as never);

  const highPercentFacts = smallHighPercentPurchase.facts as Record<string, any>;
  assert.equal(highPercentFacts.parser_completion.can_finish_without_llm, false);
  assert.equal(highPercentFacts.parser_completion.metrics.requires_llm, true);
  assert.ok((highPercentFacts.parser_completion.metrics.score_drivers as string[]).includes("pre_holding_10pct_plus"));

  for (const parsed of [smallEntitySale]) {
    const facts = parsed.facts as Record<string, any>;
    assert.equal(facts.parser_completion.can_finish_without_llm, true);
    assert.ok((facts.parser_completion.metrics.score_drivers as string[]).includes("parser_archive_cap_under_form4_llm_threshold"));
  }

  assert.equal((privatePlacementPurchase.facts as any).parser_completion.can_finish_without_llm, false);
});

test("ownership parser completes mixed Form 4 P/S position-exit cases without forcing bullish or bearish direction", () => {
  const fixture = readJson<Record<string, unknown>>("fixtures/form4-mixed-buy-sell-position-exit.json");
  const parsed = parseOwnershipFiling(fixture as never);
  const facts = parsed.facts as Record<string, any>;

  assert.ok(parsed.signals.includes("insider_purchase"));
  assert.ok(parsed.signals.includes("insider_sale"));
  assert.ok(parsed.signals.includes("section_16_exit"));
  assert.equal(facts.parser_completion.completion_kind, "mixed_buy_sell");
  assert.equal(facts.parser_completion.can_finish_without_llm, true);
  assert.equal(facts.parser_completion.metrics.position_exit, true);
  assert.equal(facts.parser_completion.metrics.signal, "volatile");
});

test("ownership parser extracts multi-owner Form 4 10b5-1 conversion structure", () => {
  const fixture = readJson<Record<string, unknown>>("fixtures/form4-multi-owner-10b5-1-conversion.json");
  const parsed = parseOwnershipFiling(fixture as never);
  const facts = parsed.facts as Record<string, any>;

  assert.equal(facts.filing.aff_10b5_1, true);
  assert.equal(facts.reporting_owners.length, 2);
  assert.ok(parsed.signals.includes("multi_reporting_owner"));
  assert.ok(parsed.signals.includes("rule_10b5_1_plan"));
  assert.ok(parsed.signals.includes("conversion_transaction"));
  assert.ok(parsed.signals.includes("derivative_transaction"));
  assert.equal(facts.form4.transactions.length, 3);
  assert.equal(facts.form4.transactions[2].underlying_security_title, "Class A Common Stock");
  assert.equal(parsed.accessionNumber, "0001841794-26-000018");
  assert.equal(Array.isArray((parsed as any).events), false);
  assert.equal(facts.footnotes.F1, "Sold pursuant to the 10b5-1 Plan adopted by SFS Corp on March 17, 2025.");
  assert.ok(parsed.warnings.includes("Conversion rows may link derivative and non-derivative entries; parser did not net or merge them."));
});

test("ownership parser flags derivative gifts and Section 16 exit checkbox", () => {
  const fixture = readJson<Record<string, unknown>>("fixtures/form4-derivative-gift-section16-exit.json");
  const parsed = parseOwnershipFiling(fixture as never);
  const facts = parsed.facts as Record<string, any>;

  assert.equal(facts.filing.not_subject_to_section_16, true);
  assert.ok(parsed.signals.includes("section_16_exit"));
  assert.ok(parsed.signals.includes("insider_gift"));
  assert.ok(parsed.signals.includes("derivative_transaction"));
  assert.equal(facts.form4.transactions[0].security_title, "Warrants (Option to Buy)");
  assert.equal(facts.form4.transactions[0].conversion_or_exercise_price, 10);
  assert.equal(facts.ownership_handoff.analysis_llm_needed, true);
  assert.ok(
    facts.ownership_handoff.analysis_needed_reasons.some((reason: string) =>
      reason.includes("gift or non-routine derivative transaction facts"),
    ),
  );
  assert.ok(parsed.warnings.includes("notSubjectToSection16 is checked; downstream should not assume ongoing Section 16 status."));
});

test("ownership parser extracts structured Form 144 with no prior sales", () => {
  const fixture = readJson<Record<string, unknown>>("fixtures/form144-no-prior-sales.json");
  const parsed = parseOwnershipFiling(fixture as never);
  const facts = parsed.facts as Record<string, any>;

  assert.equal(facts.form144.structured_xml, true);
  assert.equal(facts.form144.securities_to_be_sold, 30000);
  assert.equal(facts.form144.past_three_months_sales, 0);
  assert.equal(facts.form144.no_prior_sales_in_past_three_months, true);
  assert.equal(facts.form144.acquisition_lots.length, 2);
  assert.deepEqual(facts.form144.prior_sales, []);
  assert.ok(parsed.signals.includes("form_144_no_prior_sales"));
});

test("ownership parser extracts namespaced XML Form 144 source filings", () => {
  const fixture = readJson<Record<string, unknown>>("fixtures/source-walmart-form144-namespaced.json");
  const parsed = parseOwnershipFiling(fixture as never);
  const facts = parsed.facts as Record<string, any>;

  assert.equal(facts.filing.source_format, "structured_xml");
  assert.equal(facts.issuer.name, "Walmart Inc.");
  assert.equal(facts.issuer.cik, "0000104169");
  assert.equal(facts.form144.seller_name, "Jim C. Walton, as trustee of the Walton Family Holdings Trust (1)");
  assert.equal(facts.form144.broker_name, "Goldman Sachs & Co. LLC");
  assert.equal(facts.form144.securities_to_be_sold, 20000000);
  assert.equal(facts.form144.prior_sales.length, 16);
  assert.equal(facts.form144.acquisition_lots.length, 1);
  assert.ok(parsed.signals.includes("form_144_proposed_sale"));
  assert.equal(parsed.warnings.includes("Form 144 proposed shares to be sold were not extracted."), false);
});

test("ownership parser warns when Form 144/A has previous accession but no remarks", () => {
  const fixture = readJson<Record<string, unknown>>("fixtures/form144a-no-remarks.json");
  const parsed = parseOwnershipFiling(fixture as never);
  const facts = parsed.facts as Record<string, any>;

  assert.equal(facts.filing.previous_accession_number, "0001654954-26-005107");
  assert.equal(facts.amendment.reason, null);
  assert.equal(facts.amendment.needs_parent_context, true);
  assert.equal(facts.form144.plan_adoption_dates.length, 0);
  assert.ok(
    parsed.warnings.includes(
      "Form 144/A has previous accession but no amendment remarks; parent filing comparison is needed.",
    ),
  );
});

test("ownership parser detects legacy HTML Form 144 without normalizing table fields", () => {
  const fixture = readJson<Record<string, unknown>>("fixtures/form144-legacy-html.json");
  const parsed = parseOwnershipFiling(fixture as never);
  const facts = parsed.facts as Record<string, any>;

  assert.equal(facts.filing.source_format, "legacy_html");
  assert.equal(facts.form144.structured_xml, false);
  assert.ok(parsed.signals.includes("legacy_format"));
  assert.ok(
    parsed.warnings.includes(
      "Legacy HTML Form 144 detected; structured XML parser intentionally did not normalize table fields.",
    ),
  );
});

test("ownership parser does not classify A-only award rows as open-market purchases", () => {
  const fixture = readJson<Record<string, unknown>>("fixtures/form4-code-a-award-safety.json");
  const parsed = parseOwnershipFiling(fixture as never);
  const facts = parsed.facts as Record<string, any>;
  const transaction = facts.form4.transactions[0];

  assert.equal(transaction.transaction_code, "A");
  assert.equal(transaction.transaction_code_meaning, "grant_award_or_other_acquisition");
  assert.equal(transaction.transaction_category, "award_or_grant");
  assert.equal(facts.form4.has_purchase, false);
  assert.equal(parsed.signals.includes("insider_purchase"), false);
  assert.deepEqual(transaction.footnote_ids, ["F1"]);
});

test("ownership parser does not classify F-only withholding rows as ordinary sales", () => {
  const fixture = readJson<Record<string, unknown>>("fixtures/form4-code-f-tax-withholding-safety.json");
  const parsed = parseOwnershipFiling(fixture as never);
  const facts = parsed.facts as Record<string, any>;
  const transaction = facts.form4.transactions[0];

  assert.equal(transaction.transaction_code, "F");
  assert.equal(transaction.transaction_code_meaning, "tax_withholding_or_payment_of_exercise_price");
  assert.equal(transaction.transaction_category, "tax_withholding_or_exercise_price_payment");
  assert.equal(transaction.acquired_disposed_code, "D");
  assert.equal(facts.form4.has_sale, false);
  assert.equal(parsed.signals.includes("insider_sale"), false);
});

test("ownership parser does not classify M-only exercise rows as ordinary purchases or sales", () => {
  const fixture = readJson<Record<string, unknown>>("fixtures/form4-code-m-option-exercise-safety.json");
  const parsed = parseOwnershipFiling(fixture as never);
  const facts = parsed.facts as Record<string, any>;
  const transaction = facts.form4.transactions[0];

  assert.equal(transaction.transaction_code, "M");
  assert.equal(transaction.transaction_code_meaning, "derivative_exercise_or_conversion");
  assert.equal(transaction.transaction_category, "option_exercise_or_conversion");
  assert.equal(facts.form4.has_purchase, false);
  assert.equal(facts.form4.has_sale, false);
  assert.equal(parsed.signals.includes("insider_purchase"), false);
  assert.equal(parsed.signals.includes("insider_sale"), false);
  assert.ok(parsed.signals.includes("derivative_transaction"));
});

test("ownership parser does not treat V code as an economic transaction direction", () => {
  const fixture = readJson<Record<string, unknown>>("fixtures/form4-code-v-voluntary-safety.json");
  const parsed = parseOwnershipFiling(fixture as never);
  const facts = parsed.facts as Record<string, any>;
  const transaction = facts.form4.transactions[0];

  assert.equal(transaction.transaction_code, "V");
  assert.equal(transaction.transaction_code_meaning, "voluntarily_reported_earlier_than_required");
  assert.equal(transaction.transaction_category, "non_economic_reporting_code");
  assert.equal(facts.form4.acquired_shares, null);
  assert.equal(facts.form4.disposed_shares, null);
  assert.equal(parsed.signals.includes("insider_purchase"), false);
  assert.equal(parsed.signals.includes("insider_sale"), false);
});

test("ownership parser keeps holding-only rows out of transaction facts", () => {
  const fixture = readJson<Record<string, unknown>>("fixtures/form4-holding-only-safety.json");
  const parsed = parseOwnershipFiling(fixture as never);
  const facts = parsed.facts as Record<string, any>;

  assert.equal(facts.form4.transactions.length, 0);
  assert.equal(facts.form4.holdings.length, 1);
  assert.equal(facts.source_inventory.non_derivative_transaction_count, 0);
  assert.equal(facts.source_inventory.holding_count, 1);
  assert.equal(parsed.signals.includes("form_4_transaction"), false);
});

test("ownership parser marks Form 4/A rows as needing original filing comparison, not fresh purchase events", () => {
  const fixture = readJson<Record<string, unknown>>("fixtures/form4a-amendment-reconciliation-safety.json");
  const parsed = parseOwnershipFiling(fixture as never);
  const facts = parsed.facts as Record<string, any>;

  assert.equal(facts.amendment.is_amendment, true);
  assert.equal(facts.amendment.needs_reconciliation, true);
  assert.equal(facts.amendment.original_filing_match_status, "not_available_to_parser");
  assert.equal(facts.form4.transactions.length, 1);
  assert.ok(parsed.summary?.includes("original filing was not available for comparison"));
  assert.equal(parsed.signals.includes("insider_purchase"), false);
  assert.ok(
    parsed.warnings.includes(
      "Amended ownership filing needs original filing comparison before treating rows as new transactions.",
    ),
  );
  assert.equal(Array.isArray((parsed as any).events), false);
});

test("ownership parser treats Form 144 as proposed sale notice only", () => {
  const fixture = readJson<Record<string, unknown>>("fixtures/form144-proposed-sale-safety.json");
  const parsed = parseOwnershipFiling(fixture as never);
  const facts = parsed.facts as Record<string, any>;

  assert.ok(parsed.signals.includes("form_144_proposed_sale"));
  assert.equal(parsed.signals.includes("insider_sale"), false);
  assert.equal(facts.form144.notice_type, "proposed_sale_notice");
  assert.equal(facts.form144.sale_status, "proposed_not_executed");
  assert.equal(facts.form144.sale_date_kind, "approximate_proposed_sale_date");
  assert.deepEqual(pick(parsed.calendarItems[0], ["date", "label"]), {
    date: "05/25/2026",
    label: "Approximate Form 144 sale date",
  });
  assert.ok(
    parsed.warnings.includes("Form 144 is a proposed sale notice; parser did not classify it as an executed insider sale."),
  );
});

test("ownership parser treats Form 144/A as amendment to proposed sale notice only", () => {
  const fixture = readJson<Record<string, unknown>>("fixtures/form144a-amendment-proposed-sale-safety.json");
  const parsed = parseOwnershipFiling(fixture as never);
  const facts = parsed.facts as Record<string, any>;

  assert.equal(facts.amendment.is_amendment, true);
  assert.equal(facts.amendment.needs_reconciliation, true);
  assert.equal(facts.amendment.original_filing_match_status, "not_matched_in_parser");
  assert.equal(facts.form144.notice_type, "proposed_sale_notice");
  assert.equal(facts.form144.sale_status, "proposed_not_executed");
  assert.equal(parsed.signals.includes("insider_sale"), false);
  assert.ok(parsed.summary?.includes("proposed sale amount"));
  assert.ok(parsed.warnings.includes("Form 144/A is an amendment to a proposed sale notice, not proof of executed sale."));
});

test("ownership parser falls back with warning when XML source is malformed", () => {
  const fixture = readJson<Record<string, unknown>>("fixtures/form4-malformed-xml-fallback-safety.json");
  const parsed = parseOwnershipFiling(fixture as never);
  const facts = parsed.facts as Record<string, any>;

  assert.equal(facts.filing.source_format, "text_excerpt");
  assert.equal(facts.filing.source_status, "fallback_after_malformed_xml");
  assert.equal(facts.filing.source_confidence, "low");
  assert.equal(facts.filing.parser_source_role, "filingText");
  assert.equal(facts.issuer.name, "Fallback Source Corp");
  assert.equal(facts.form4.transactions[0].transaction_code, "P");
  assert.ok(
    parsed.warnings.includes(
      "Structured ownership XML candidate was malformed or incomplete; parser used lower-confidence fallback source.",
    ),
  );
});

test("ownership parser extracts detailed non-derivative row fields and owner relationship flags", () => {
  const fixture = readJson<Record<string, unknown>>("fixtures/form4-detailed-nonderivative-footnotes.json");
  const parsed = parseOwnershipFiling(fixture as never);
  const facts = parsed.facts as Record<string, any>;
  const owner = facts.reporting_owner;
  const transaction = facts.form4.non_derivative_transactions[0];

  assert.equal(facts.issuer.cik, "0003333001");
  assert.equal(facts.issuer.name, "Detailed NonDerivative Corp");
  assert.equal(facts.issuer.ticker, "DND");
  assert.equal(owner.cik, "0004444001");
  assert.equal(owner.name, "Nora Detail");
  assert.equal(owner.is_director, true);
  assert.equal(owner.is_officer, true);
  assert.equal(owner.is_ten_percent_owner, false);
  assert.equal(owner.is_other, true);
  assert.equal(owner.other_text, "Investment committee member");
  assert.equal(owner.address.city, "New York");
  assert.deepEqual(pick(transaction, [
    "security_title",
    "transaction_date",
    "deemed_execution_date",
    "transaction_code",
    "acquired_disposed_code",
    "shares",
    "price_per_share",
    "shares_owned_following",
    "direct_or_indirect_ownership",
    "nature_of_ownership",
  ]), {
    security_title: "Common Stock",
    transaction_date: "2026-05-19",
    deemed_execution_date: "2026-05-20",
    transaction_code: "P",
    acquired_disposed_code: "A",
    shares: 1234,
    price_per_share: 12.34,
    shares_owned_following: 5678,
    direct_or_indirect_ownership: "I",
    nature_of_ownership: "By family trust",
  });
});

test("ownership parser links field-level footnotes and reports unresolved/orphan footnotes", () => {
  const fixture = readJson<Record<string, unknown>>("fixtures/form4-detailed-nonderivative-footnotes.json");
  const parsed = parseOwnershipFiling(fixture as never);
  const facts = parsed.facts as Record<string, any>;
  const transaction = facts.form4.transactions[0];

  assert.deepEqual(facts.footnote_order, ["F1", "F2", "F3", "F4", "F5", "F6"]);
  assert.equal(facts.footnotes.F3, "Weighted average purchase price.");
  assert.deepEqual(transaction.field_footnote_ids.transactionShares, ["F2"]);
  assert.deepEqual(transaction.field_footnote_ids.transactionPricePerShare, ["F3", "F99"]);
  assert.deepEqual(transaction.field_footnote_ids.natureOfOwnership, ["F6"]);
  assert.deepEqual(facts.footnote_diagnostics.unresolved_references, ["F99"]);
  assert.deepEqual(facts.footnote_diagnostics.orphan_footnote_ids, ["F4"]);
  assert.ok(parsed.warnings.includes("Unresolved ownership footnote references: F99."));
  assert.ok(parsed.warnings.includes("Ownership footnotes not linked to parsed rows or fields: F4."));
});

test("ownership parser parses derivative transactions separately from derivative holdings", () => {
  const fixture = readJson<Record<string, unknown>>("fixtures/form4-derivative-detail-holding.json");
  const parsed = parseOwnershipFiling(fixture as never);
  const facts = parsed.facts as Record<string, any>;
  const transaction = facts.form4.derivative_transactions[0];
  const holding = facts.form4.holdings[0];

  assert.equal(facts.form4.non_derivative_transactions.length, 0);
  assert.equal(facts.form4.derivative_transactions.length, 1);
  assert.equal(facts.form4.holdings.length, 1);
  assert.equal(transaction.transaction_kind, "derivative");
  assert.equal(transaction.transaction_code, "M");
  assert.equal(transaction.conversion_or_exercise_price, 9.5);
  assert.equal(transaction.date_exercisable, "2026-05-18");
  assert.equal(transaction.expiration_date, "2031-05-18");
  assert.equal(transaction.underlying_security_title, "Common Stock");
  assert.equal(transaction.underlying_security_shares, 2000);
  assert.equal(transaction.equity_swap_involved, true);
  assert.equal(facts.form4.has_purchase, false);
  assert.equal(facts.form4.has_sale, false);
  assert.equal(holding.holding_kind, "derivative");
  assert.equal(holding.security_title, "Performance Stock Option");
  assert.equal(holding.underlying_security_shares, 5000);
  assert.ok(parsed.signals.includes("derivative_transaction"));
});

test("ownership parser preserves M plus S rows without double-counting derivative underlying shares", () => {
  const fixture = readJson<Record<string, unknown>>("fixtures/form4-m-plus-s-chain.json");
  const parsed = parseOwnershipFiling(fixture as never);
  const facts = parsed.facts as Record<string, any>;

  assert.equal(facts.form4.transactions.length, 2);
  assert.equal(facts.form4.non_derivative_transactions.length, 1);
  assert.equal(facts.form4.derivative_transactions.length, 1);
  assert.equal(facts.form4.acquired_shares, null);
  assert.equal(facts.form4.disposed_shares, 1000);
  assert.equal(facts.form4.derivative_acquired_units, 1000);
  assert.equal(facts.form4.derivative_transactions[0].underlying_security_shares, 1000);
  assert.ok(parsed.signals.includes("insider_sale"));
  assert.ok(parsed.signals.includes("derivative_transaction"));
  assert.ok(
    parsed.warnings.includes("Derivative transaction code M preserved separately from ordinary open-market purchase/sale rows."),
  );
});

test("ownership parser detects 10b5-1 evidence without investment interpretation", () => {
  const fixture = readJson<Record<string, unknown>>("fixtures/form4-10b5-remarks-footnote.json");
  const parsed = parseOwnershipFiling(fixture as never);
  const facts = parsed.facts as Record<string, any>;

  assert.ok(parsed.signals.includes("rule_10b5_1_plan"));
  assert.equal(facts.filing.aff_10b5_1, true);
  assert.equal(facts.trading_plan.has_10b5_1_mention, true);
  assert.deepEqual(facts.trading_plan.plan_adoption_dates, ["2026-01-15"]);
  assert.deepEqual(facts.trading_plan.instruction_dates, ["2026-02-01"]);
  assert.ok(facts.trading_plan.evidence_snippets[0].includes("Rule 10b5-1 trading plan"));
  assert.deepEqual(facts.evidence_keywords.filter((keyword: string) => ["10b5-1", "trading plan", "adopted", "instruction date"].includes(keyword)), [
    "10b5-1",
    "trading plan",
    "adopted",
    "instruction date",
  ]);
});

test("ownership parser preserves Form 4/A correction wording without fresh duplicate trade signal", () => {
  const fixture = readJson<Record<string, unknown>>("fixtures/form4a-correction-row-safety.json");
  const parsed = parseOwnershipFiling(fixture as never);
  const facts = parsed.facts as Record<string, any>;

  assert.equal(facts.amendment.is_amendment, true);
  assert.equal(facts.amendment.needs_reconciliation, true);
  assert.equal(facts.amendment.correction_or_error_language, true);
  assert.equal(facts.remarks, "The transaction was previously reported in error and should not have been reported.");
  assert.equal(facts.form4.transactions[0].transaction_code, "S");
  assert.equal(parsed.signals.includes("insider_sale"), false);
  assert.ok(
    parsed.warnings.includes(
      "Amendment or remarks contain correction/error language; parser preserved wording and requires original filing comparison before interpretation.",
    ),
  );
});

test("ownership parser handles multiple reporting owners and unknown transaction codes safely", () => {
  const fixture = readJson<Record<string, unknown>>("fixtures/form4-multiple-owners-unknown-code.json");
  const parsed = parseOwnershipFiling(fixture as never);
  const facts = parsed.facts as Record<string, any>;
  const transaction = facts.form4.transactions[0];

  assert.equal(facts.reporting_owners.length, 2);
  assert.equal(facts.reporting_owner.name, "First Owner");
  assert.ok(parsed.signals.includes("multi_reporting_owner"));
  assert.equal(transaction.transaction_code, "Q");
  assert.equal(transaction.transaction_code_meaning, "unmapped_transaction_code");
  assert.equal(transaction.transaction_category, "other_transaction_code");
  assert.equal(transaction.price_per_share, null);
  assert.equal(transaction.price_per_share_text, "Various");
  assert.equal(transaction.price_per_share_status, "various");
  assert.equal(transaction.shares_owned_following_text, "See Footnote");
  assert.equal(transaction.shares_owned_following_status, "see_footnote");
  assert.ok(
    parsed.warnings.includes(
      "Multiple reporting owners detected; parser preserved all owners but primary owner remains the first owner for compatibility.",
    ),
  );
  assert.ok(parsed.warnings.includes("Unknown Form 4 transaction code preserved without interpretation: Q."));
  assert.ok(
    parsed.warnings.includes(
      "Indirect ownership transaction is missing natureOfOwnership text; parser did not infer beneficial ownership meaning.",
    ),
  );
});

test("ownership parser extracts detailed Form 144 proposed sale, broker, notice, and footnotes", () => {
  const fixture = readJson<Record<string, unknown>>("fixtures/form144-detailed-proposed-sale.json");
  const parsed = parseOwnershipFiling(fixture as never);
  const facts = parsed.facts as Record<string, any>;
  const row = facts.form144.proposed_sale_rows[0];

  assert.equal(facts.issuer.cik, "0005555001");
  assert.equal(facts.issuer.name, "Detailed 144 Corp");
  assert.equal(facts.issuer.ticker, "D144");
  assert.equal(facts.form144.seller_name, "Jordan Seller");
  assert.equal(facts.form144.account_person_name, "Jordan Seller");
  assert.equal(facts.form144.seller_address.city, "Boston");
  assert.deepEqual(facts.form144.issuer_relationships, ["Officer"]);
  assert.deepEqual(pick(facts.form144, [
    "securities_class_title",
    "securities_to_be_sold",
    "aggregate_market_value",
    "shares_outstanding",
    "approximate_sale_date",
    "securities_exchange_name",
    "notice_date",
  ]), {
    securities_class_title: "Common Stock",
    securities_to_be_sold: 12345,
    aggregate_market_value: 987600,
    shares_outstanding: 50000000,
    approximate_sale_date: "05/30/2026",
    securities_exchange_name: "NASDAQ",
    notice_date: "05/20/2026",
  });
  assert.equal(facts.form144.sale_status, "proposed_not_executed");
  assert.equal(facts.form144.sale_date_kind, "approximate_proposed_sale_date");
  assert.equal(facts.form144.broker_name, "Example Broker LLC");
  assert.equal(facts.form144.broker_dealer_file_number, "8-12345");
  assert.equal(facts.form144.broker_or_market_maker.broker_address.city, "New York");
  assert.deepEqual(row.field_footnote_ids.noOfUnitsSold, ["F2", "F99"]);
  assert.deepEqual(row.field_footnote_ids.approxSaleDate, ["F3"]);
  assert.deepEqual(facts.footnote_diagnostics.unresolved_references, ["F99"]);
  assert.deepEqual(facts.footnote_diagnostics.orphan_footnote_ids, ["F4"]);
  assert.ok(parsed.warnings.includes("Form 144 is a proposed sale notice; parser did not classify it as an executed insider sale."));
});

test("ownership parser extracts Form 144 acquisition and prior-sales tables separately", () => {
  const fixture = readJson<Record<string, unknown>>("fixtures/form144-detailed-proposed-sale.json");
  const parsed = parseOwnershipFiling(fixture as never);
  const facts = parsed.facts as Record<string, any>;
  const lot = facts.form144.acquisition_lots[0];

  assert.deepEqual(pick(lot, [
    "securities_class_title",
    "acquired_date",
    "acquired_date_status",
    "nature_of_acquisition_transaction",
    "acquired_from",
    "amount_of_securities_acquired",
    "payment_date",
    "nature_of_payment",
  ]), {
    securities_class_title: "Common Stock",
    acquired_date: "01/15/2024",
    acquired_date_status: "date",
    nature_of_acquisition_transaction: "Restricted stock grant from issuer",
    acquired_from: "Issuer",
    amount_of_securities_acquired: 12345,
    payment_date: "01/15/2024",
    nature_of_payment: "Services",
  });
  assert.deepEqual(lot.evidence_terms, ["restricted stock", "grant", "issuer"]);
  assert.equal(facts.form144.prior_sales.length, 2);
  assert.deepEqual(pick(facts.form144.prior_sales[1], [
    "seller_name",
    "securities_class_title",
    "sale_date",
    "amount_of_securities_sold",
    "gross_proceeds",
  ]), {
    seller_name: "Jordan Seller",
    securities_class_title: "Common Stock",
    sale_date: "04/01/2026",
    amount_of_securities_sold: 2000,
    gross_proceeds: 152000,
  });
  assert.equal(facts.form144.past_three_months_sales, 3000);
  assert.equal(facts.form144.past_three_months_sales_status, "reported_rows");
});

test("ownership parser extracts Form 144 10b5-1 dates and preserves remarks", () => {
  const fixture = readJson<Record<string, unknown>>("fixtures/form144-detailed-proposed-sale.json");
  const parsed = parseOwnershipFiling(fixture as never);
  const facts = parsed.facts as Record<string, any>;

  assert.equal(facts.form144.remarks, "Proposed sale under a Rule 10b5-1 trading plan adopted on 2026-01-10. Instruction date 2026-02-01.");
  assert.deepEqual(facts.form144.plan_adoption_dates, ["2026-01-10"]);
  assert.deepEqual(facts.form144.plan_instruction_dates, ["2026-02-01"]);
  assert.equal(facts.trading_plan.has_10b5_1_mention, true);
  assert.deepEqual(facts.trading_plan.plan_adoption_dates, ["2026-01-10"]);
  assert.deepEqual(facts.trading_plan.instruction_dates, ["2026-02-01"]);
  assert.ok(facts.evidence_keywords.includes("10b5-1"));
  assert.ok(facts.evidence_keywords.includes("instruction date"));
});

test("ownership parser uses market maker details when broker is absent", () => {
  const fixture = readJson<Record<string, unknown>>("fixtures/form144-market-maker-no-broker.json");
  const parsed = parseOwnershipFiling(fixture as never);
  const facts = parsed.facts as Record<string, any>;

  assert.equal(facts.form144.broker_name, null);
  assert.equal(facts.form144.market_maker_name, "Example Market Maker Inc.");
  assert.equal(facts.form144.broker_dealer_file_number, "8-99999");
  assert.equal(parsed.warnings.includes("Form 144 proposed sale row is missing broker or market maker name."), false);
});

test("ownership parser warns on missing broker and preserves ambiguous acquisition date/status", () => {
  const fixture = readJson<Record<string, unknown>>("fixtures/form144-missing-broker-various-acquisition.json");
  const parsed = parseOwnershipFiling(fixture as never);
  const facts = parsed.facts as Record<string, any>;
  const lot = facts.form144.acquisition_lots[0];

  assert.equal(facts.form144.broker_name, null);
  assert.equal(facts.form144.market_maker_name, null);
  assert.equal(lot.acquired_date, null);
  assert.equal(lot.acquired_date_status, "footnote_only");
  assert.equal(lot.amount_of_securities_acquired_text, "Various");
  assert.equal(lot.amount_of_securities_acquired_status, "various");
  assert.equal(lot.payment_date, "Various");
  assert.equal(lot.payment_date_status, "various");
  assert.deepEqual(lot.evidence_terms, ["option exercise", "trust"]);
  assert.ok(parsed.warnings.includes("Form 144 proposed sale row is missing broker or market maker name."));
  assert.ok(parsed.warnings.includes("Form 144 acquisition date is ambiguous or footnote-only; parser did not normalize it."));
});

test("ownership parser keeps Form 144 no-prior-sales flag distinct from blank missing rows", () => {
  const fixture = readJson<Record<string, unknown>>("fixtures/form144-no-prior-sales-blank.json");
  const parsed = parseOwnershipFiling(fixture as never);
  const facts = parsed.facts as Record<string, any>;

  assert.equal(facts.form144.no_prior_sales_in_past_three_months, true);
  assert.equal(facts.form144.past_three_months_sales, 0);
  assert.equal(facts.form144.past_three_months_sales_status, "none_reported");
  assert.deepEqual(facts.form144.prior_sales, []);
});

test("ownership parser warns on ambiguous 10b5-1 date and multiple proposed-sale rows", () => {
  const fixture = readJson<Record<string, unknown>>("fixtures/form144-ambiguous-10b5-multiple-rows.json");
  const parsed = parseOwnershipFiling(fixture as never);
  const facts = parsed.facts as Record<string, any>;

  assert.equal(facts.form144.proposed_sale_rows.length, 2);
  assert.equal(facts.form144.securities_class_title, "Common Stock");
  assert.equal(facts.form144.proposed_sale_rows[1].securities_class_title, "Preferred Stock");
  assert.equal(facts.form144.broker_name, "Both Broker LLC");
  assert.equal(facts.form144.market_maker_name, "Both Market Maker LLC");
  assert.equal(facts.trading_plan.has_10b5_1_mention, true);
  assert.deepEqual(facts.trading_plan.plan_adoption_dates, []);
  assert.ok(facts.trading_plan.uncertain_date_evidence[0].includes("adopted in spring"));
  assert.ok(parsed.warnings.includes("10b5-1 or trading plan language was detected, but parser did not infer an uncertain plan date."));
  assert.ok(parsed.warnings.includes("Multiple Form 144 proposed sale rows detected; parser preserved rows and kept first row as compatibility summary."));
  assert.ok(parsed.warnings.includes("Multiple Form 144 securities classes detected; parser did not collapse them into one class."));
  assert.ok(parsed.warnings.includes("Form 144 proposed sale row includes both broker and market maker; parser preserved both."));
});

test("ownership parser keeps Form 144/A as proposed-sale amendment and preserves correction wording", () => {
  const fixture = readJson<Record<string, unknown>>("fixtures/form144a-correction-detailed.json");
  const parsed = parseOwnershipFiling(fixture as never);
  const facts = parsed.facts as Record<string, any>;

  assert.equal(facts.form144.submission_type, "144/A");
  assert.equal(facts.form144.previous_accession_number, "0000000000-26-014501");
  assert.equal(facts.form144.sale_status, "proposed_not_executed");
  assert.equal(facts.amendment.needs_reconciliation, true);
  assert.equal(facts.amendment.correction_or_error_language, true);
  assert.equal(facts.form144.remarks, "This amendment corrects the proposed amount previously reported in error.");
  assert.equal(parsed.signals.includes("insider_sale"), false);
  assert.ok(parsed.warnings.includes("Form 144/A is an amendment to a proposed sale notice, not proof of executed sale."));
});

test("ownership parser uses lower-confidence fallback for malformed Form 144 XML", () => {
  const fixture = readJson<Record<string, unknown>>("fixtures/form144-malformed-xml-fallback.json");
  const parsed = parseOwnershipFiling(fixture as never);
  const facts = parsed.facts as Record<string, any>;

  assert.equal(facts.filing.source_format, "text_excerpt");
  assert.equal(facts.filing.source_status, "fallback_after_malformed_xml");
  assert.equal(facts.filing.source_confidence, "low");
  assert.equal(facts.issuer.name, "Fallback 144 Corp");
  assert.equal(facts.form144.structured_xml, false);
  assert.equal(facts.form144.securities_to_be_sold, 300);
  assert.equal(facts.form144.broker_name, "Fallback Broker LLC");
  assert.ok(
    parsed.warnings.includes(
      "Structured ownership XML candidate was malformed or incomplete; parser used lower-confidence fallback source.",
    ),
  );
});

test("ownership parser locally classifies Form 4/A amount, price, date, and code amendments without fresh trade signals", () => {
  for (const [field, changedXml] of [
    ["shares", form4TransactionXml({ shares: "150" })],
    ["price", form4TransactionXml({ price: "11.50" })],
    ["transaction_date", form4TransactionXml({ date: "2026-05-21" })],
    ["transaction_code", form4TransactionXml({ code: "F", acquiredDisposed: "D" })],
  ] as const) {
    const parsed = parseOwnershipFiling(form4AmendmentFixture(changedXml, "Amends transaction line.", form4TransactionXml()) as never);
    const facts = parsed.facts as Record<string, any>;

    assert.ok(facts.amendment.local_comparison.labels.includes("AMEND_LINE"), `${field} should amend line`);
    assert.equal(parsed.signals.includes("insider_purchase"), false);
    assert.equal(parsed.signals.includes("insider_sale"), false);
    assert.notEqual(facts.amendment.local_comparison.changed_fields.length, 0);
  }
});

test("ownership parser locally classifies Form 4/A added line, footnote-only, metadata-only, and correction wording", () => {
  const original = form4TransactionXml();
  const added = parseOwnershipFiling(
    form4AmendmentFixture(`${original}${form4TransactionXml({ shares: "75", date: "2026-05-22" })}`, "Adds a line.", original) as never,
  );
  const footnoteOnly = parseOwnershipFiling(
    form4AmendmentFixture(
      form4TransactionXml({ rowFootnote: "F2", footnoteText: "Updated explanatory footnote." }),
      "Updates footnote text only.",
      original,
    ) as never,
  );
  const metadataOnly = parseOwnershipFiling(
    form4AmendmentFixture(original, "Updates officer title only.", original, { ownerTitle: "Executive Chair" }) as never,
  );
  const correction = parseOwnershipFiling(
    form4AmendmentFixture(original, "The transaction was previously reported in error and should not have been reported.", original) as never,
  );

  assert.ok(((added.facts as any).amendment.local_comparison.labels as string[]).includes("ADD_LINE"));
  assert.ok(((footnoteOnly.facts as any).amendment.local_comparison.labels as string[]).includes("FOOTNOTE_ONLY"));
  assert.ok(((metadataOnly.facts as any).amendment.local_comparison.labels as string[]).includes("METADATA_ONLY"));
  assert.ok(((correction.facts as any).amendment.local_comparison.labels as string[]).includes("VOID_OR_ERROR_CANDIDATE"));
  assert.equal(added.signals.includes("insider_purchase"), false);
});

test("ownership parser uses parser-only ownership_original_filing for clean Form 4/A comparison facts", () => {
  const original = form4TransactionXml();
  const parsed = parseOwnershipFiling({
    formType: "4/A",
    accessionNumber: "0000000000-26-004201",
    filingText: form4OwnershipXml(
      form4TransactionXml({ rowFootnote: "F2", footnoteText: "Updated explanatory footnote." }),
      "Updates footnote text only.",
    ),
    ownership_original_filing: {
      formType: "4",
      accessionNumber: "0000000000-26-004100",
      filingText: form4OwnershipXml(original, null),
    },
  } as never);
  const facts = parsed.facts as Record<string, any>;

  assert.equal(facts.amendment.local_comparison.local_parent_available, true);
  assert.ok((facts.amendment.local_comparison.labels as string[]).includes("FOOTNOTE_ONLY"));
  assert.equal(facts.ownership_handoff.analysis_llm_needed, false);
  assert.equal(parsed.raw.deterministic_result_available, true);
});

test("ownership parser locally handles Form 4/A omitted, derivative changed, ambiguous, and parent-unavailable cases safely", () => {
  const omitted = parseOwnershipFiling(
    form4AmendmentFixture(
      form4TransactionXml(),
      "Amends one reported line.",
      `${form4TransactionXml()}${form4TransactionXml({ shares: "200", date: "2026-05-22" })}`,
    ) as never,
  );
  const derivativeChanged = parseOwnershipFiling(
    form4AmendmentFixture(
      form4DerivativeXml({ derivativeShares: "1500", underlyingShares: "1500" }),
      "Amends derivative amount.",
      form4DerivativeXml(),
    ) as never,
  );
  const ambiguous = parseOwnershipFiling(
    form4AmendmentFixture(
      form4TransactionXml({ shares: "150" }),
      "Amends ambiguous row.",
      `${form4TransactionXml({ shares: "100" })}${form4TransactionXml({ shares: "200" })}`,
    ) as never,
  );
  const correction = parseOwnershipFiling(
    form4AmendmentFixture(
      form4TransactionXml(),
      "The original filing was previously reported in error and should not have been reported.",
      form4TransactionXml(),
    ) as never,
  );
  const noParent = parseOwnershipFiling({
    formType: "4/A",
    accessionNumber: "0000000000-26-004199",
    filingText: form4OwnershipXml(form4TransactionXml(), "Amends transaction line."),
  } as never);

  assert.ok(omitted.warnings.includes("Form 4/A omits one or more original rows; parser did not treat omission alone as deletion."));
  assert.ok(((derivativeChanged.facts as any).amendment.local_comparison.labels as string[]).includes("AMEND_LINE"));
  assert.ok(((derivativeChanged.facts as any).amendment.local_comparison.changed_fields as string[]).includes("underlying_security_shares"));
  assert.ok(((ambiguous.facts as any).amendment.local_comparison.labels as string[]).includes("UNKNOWN_AMENDMENT"));
  assert.ok(ambiguous.warnings.includes("Local Form 4/A row comparison is ambiguous; parser did not guess row mapping."));
  assert.ok(((correction.facts as any).amendment.local_comparison.labels as string[]).includes("VOID_OR_ERROR_CANDIDATE"));
  assert.equal((noParent.facts as any).amendment.local_comparison.local_parent_available, false);
  assert.ok(((noParent.facts as any).amendment.local_comparison.labels as string[]).includes("UNKNOWN_AMENDMENT"));
  assert.equal(noParent.signals.includes("insider_purchase"), false);
});

test("ownership parser locally classifies Form 144/A proposed amount, date, class, and broker amendments", () => {
  const cases = [
    ["PROPOSED_SALE_AMOUNT_CHANGED", form144Xml({ units: "2000", value: "40000" })],
    ["PROPOSED_SALE_DATE_CHANGED", form144Xml({ approxDate: "06/10/2026" })],
    ["SECURITY_CLASS_CHANGED", form144Xml({ classTitle: "Preferred Stock" })],
    ["BROKER_CHANGED", form144Xml({ broker: "New Broker LLC" })],
  ] as const;

  for (const [label, amendmentXml] of cases) {
    const parsed = parseOwnershipFiling(form144AmendmentFixture(amendmentXml, form144Xml()) as never);
    const labels = (parsed.facts as any).amendment.local_comparison.labels as string[];

    assert.ok(labels.includes(label), `${label} expected`);
    assert.equal((parsed.facts as any).form144.sale_status, "proposed_not_executed");
    assert.equal(parsed.signals.includes("insider_sale"), false);
  }
});

test("ownership parser locally classifies Form 144/A acquisition, prior sales, plan date, remarks, metadata, and correction changes", () => {
  const acquisition = parseOwnershipFiling(form144AmendmentFixture(form144Xml({ acquisitionNature: "Option exercise from issuer" }), form144Xml()) as never);
  const priorSales = parseOwnershipFiling(form144AmendmentFixture(form144Xml({ priorAmount: "750" }), form144Xml()) as never);
  const planDate = parseOwnershipFiling(form144AmendmentFixture(form144Xml({ planDate: "2026-02-02" }), form144Xml()) as never);
  const remarksOnly = parseOwnershipFiling(form144AmendmentFixture(form144Xml({ remarks: "Clarifies broker instruction only." }), form144Xml()) as never);
  const metadataOnly = parseOwnershipFiling(form144AmendmentFixture(form144Xml({ seller: "Updated Seller Name" }), form144Xml()) as never);
  const correction = parseOwnershipFiling(
    form144AmendmentFixture(form144Xml({ remarks: "This amendment corrects a proposed amount previously reported in error." }), form144Xml()) as never,
  );

  assert.ok(((acquisition.facts as any).amendment.local_comparison.labels as string[]).includes("ACQUISITION_HISTORY_CHANGED"));
  assert.ok(((priorSales.facts as any).amendment.local_comparison.labels as string[]).includes("PAST_SALES_CHANGED"));
  assert.ok(((planDate.facts as any).amendment.local_comparison.labels as string[]).includes("PLAN_DATE_CHANGED"));
  assert.ok(((remarksOnly.facts as any).amendment.local_comparison.labels as string[]).includes("REMARKS_ONLY"));
  assert.ok(((metadataOnly.facts as any).amendment.local_comparison.labels as string[]).includes("METADATA_ONLY"));
  assert.ok(((correction.facts as any).amendment.local_comparison.labels as string[]).includes("VOID_OR_ERROR_CANDIDATE"));
  assert.equal((correction.facts as any).form144.sale_status, "proposed_not_executed");
});

test("ownership parser uses rawPayload ownership_original_filing for clean Form 144/A metadata comparison facts", () => {
  const parsed = parseOwnershipFiling({
    formType: "144/A",
    accessionNumber: "0000000000-26-014601",
    filingText: form144Xml({ seller: "Updated Seller Name" }),
    rawPayload: {
      ownership_original_filing: {
        formType: "144",
        accessionNumber: "0000000000-26-014500",
        filingText: form144Xml({ submissionType: "144" }),
      },
    },
  } as never);
  const facts = parsed.facts as Record<string, any>;

  assert.equal(facts.amendment.local_comparison.local_parent_available, true);
  assert.ok((facts.amendment.local_comparison.labels as string[]).includes("METADATA_ONLY"));
  assert.equal(facts.ownership_handoff.analysis_llm_needed, false);
  assert.equal(parsed.raw.deterministic_result_available, true);
  assert.equal(facts.form144.sale_status, "proposed_not_executed");
});

test("ownership parser locally keeps Form 144/A parent-unavailable and ambiguous multi-row comparisons safe", () => {
  const noParent = parseOwnershipFiling({
    formType: "144/A",
    accessionNumber: "0000000000-26-014599",
    filingText: form144Xml({ submissionType: "144/A" }),
  } as never);
  const ambiguous = parseOwnershipFiling(
    form144AmendmentFixture(
      form144Xml({ units: "1500", multipleRows: true }),
      form144Xml({ multipleRows: true }).replace(
        "<noOfUnitsSold>2000</noOfUnitsSold><aggregateMarketValue>40000</aggregateMarketValue><noOfUnitsOutstanding>1000000</noOfUnitsOutstanding><approxSaleDate>06/02/2026</approxSaleDate>",
        "<noOfUnitsSold>2000</noOfUnitsSold><aggregateMarketValue>20000</aggregateMarketValue><noOfUnitsOutstanding>1000000</noOfUnitsOutstanding><approxSaleDate>06/01/2026</approxSaleDate>",
      ),
    ) as never,
  );

  assert.equal((noParent.facts as any).amendment.local_comparison.local_parent_available, false);
  assert.ok(((noParent.facts as any).amendment.local_comparison.labels as string[]).includes("UNKNOWN_AMENDMENT"));
  assert.equal((noParent.facts as any).form144.sale_status, "proposed_not_executed");
  assert.ok(((ambiguous.facts as any).amendment.local_comparison.labels as string[]).includes("UNKNOWN_AMENDMENT"));
  assert.ok(ambiguous.warnings.includes("Local Form 144/A row comparison is ambiguous; parser did not guess row mapping."));
});

test("ownership parser locally returns no-match Form 144 to Form 4 connection status only when local candidates are supplied", () => {
  const parsed = form144WithLocalForm4([], { approxDate: "06/01/2026" });
  const connection = (parsed.facts as any).form144.local_form4_connection;

  assert.equal(connection.local_form4_available, false);
  assert.ok((connection.labels as string[]).includes("NO_MATCH_YET"));
  assert.equal((parsed.facts as any).form144.sale_status, "proposed_not_executed");
  assertNoExecutionConclusion(connection);
});

test("ownership parser locally creates full, partial, and multiple Form 144 to Form 4 sale candidates without confirmation", () => {
  const full = form144WithLocalForm4([form4ForConnection(form4TransactionXml({ code: "S", acquiredDisposed: "D", shares: "1000", date: "2026-06-01" }))]);
  const partial = form144WithLocalForm4([form4ForConnection(form4TransactionXml({ code: "S", acquiredDisposed: "D", shares: "400", date: "2026-06-01" }))]);
  const multiple = form144WithLocalForm4([
    form4ForConnection(
      `${form4TransactionXml({ code: "S", acquiredDisposed: "D", shares: "400", date: "2026-06-01" })}${form4TransactionXml({ code: "S", acquiredDisposed: "D", shares: "600", date: "2026-06-02" })}`,
    ),
  ]);

  assert.ok(((full.facts as any).form144.local_form4_connection.labels as string[]).includes("FULL_MATCH_CANDIDATE"));
  assert.ok(((partial.facts as any).form144.local_form4_connection.labels as string[]).includes("PARTIAL_MATCH_CANDIDATE"));
  assert.ok(((multiple.facts as any).form144.local_form4_connection.labels as string[]).includes("MULTIPLE_MATCH_CANDIDATE"));
  assert.ok(((multiple.facts as any).form144.local_form4_connection.labels as string[]).includes("FULL_MATCH_CANDIDATE"));
  assert.equal((multiple.facts as any).form144.local_form4_connection.aggregate.eligible_sale_row_count, 2);
  assertNoExecutionConclusion((full.facts as any).form144.local_form4_connection);
  assertNoExecutionConclusion((multiple.facts as any).form144.local_form4_connection);
});

test("ownership parser locally rejects non-execution Form 4 rows as Form 144 sale candidates", () => {
  for (const [code, acquiredDisposed] of [
    ["F", "D"],
    ["M", "A"],
    ["A", "A"],
    ["G", "D"],
  ]) {
    const parsed = form144WithLocalForm4([form4ForConnection(form4TransactionXml({ code, acquiredDisposed, shares: "1000", date: "2026-06-01" }))]);
    const connection = (parsed.facts as any).form144.local_form4_connection;
    assert.ok((connection.labels as string[]).includes("NOT_EXECUTION_RELATED"), `${code} should not be execution-related`);
    assert.equal(connection.aggregate.eligible_sale_row_count, 0);
  }

  const mPlusS = form144WithLocalForm4([
    form4ForConnection(
      `${form4DerivativeXml({ derivativeShares: "1000", underlyingShares: "1000" })}${form4TransactionXml({ code: "S", acquiredDisposed: "D", shares: "1000", date: "2026-06-01" })}`,
    ),
  ]);
  const connection = (mPlusS.facts as any).form144.local_form4_connection;
  assert.ok((connection.labels as string[]).includes("FULL_MATCH_CANDIDATE"));
  assert.equal(connection.aggregate.eligible_sale_row_count, 1);
  assert.ok(connection.aggregate.non_execution_row_count >= 1);
});

test("ownership parser locally marks issuer, security, date, and amount conflicts without strong Form 144 match", () => {
  const issuerConflict = form144WithLocalForm4([
    form4ForConnection(form4TransactionXml({ code: "S", acquiredDisposed: "D", shares: "1000", date: "2026-06-01" }), { issuerCik: "0009999001" }),
  ]);
  const securityConflict = form144WithLocalForm4([
    form4ForConnection(form4TransactionXml({ code: "S", acquiredDisposed: "D", shares: "1000", date: "2026-06-01", securityTitle: "Class B Common Stock" })),
  ]);
  const dateConflict = form144WithLocalForm4([form4ForConnection(form4TransactionXml({ code: "S", acquiredDisposed: "D", shares: "1000", date: "2026-07-15" }))]);
  const amountConflict = form144WithLocalForm4([form4ForConnection(form4TransactionXml({ code: "S", acquiredDisposed: "D", shares: "5000", date: "2026-06-01" }))]);

  for (const parsed of [issuerConflict, securityConflict, dateConflict, amountConflict]) {
    const labels = (parsed.facts as any).form144.local_form4_connection.labels as string[];
    assert.ok(labels.includes("CONFLICT_CANDIDATE"));
    assert.ok(!labels.includes("FULL_MATCH_CANDIDATE"));
  }
});

test("ownership parser locally keeps missing person, trust/entity, duplicate rows, 10b5-1, and value-only cases conservative", () => {
  const missingPerson = form144WithLocalForm4([form4ForConnection(form4TransactionXml({ code: "S", acquiredDisposed: "D", shares: "1000", date: "2026-06-01" }), { ownerName: "" })]);
  const trustEntity = form144WithLocalForm4([form4ForConnection(form4TransactionXml({ code: "S", acquiredDisposed: "D", shares: "1000", date: "2026-06-01" }))], { seller: "Amend Seller Trust" });
  const duplicateRows = form144WithLocalForm4([
    form4ForConnection(
      `${form4TransactionXml({ code: "S", acquiredDisposed: "D", shares: "1000", date: "2026-06-01" })}${form4TransactionXml({ code: "S", acquiredDisposed: "D", shares: "1000", date: "2026-06-01" })}`,
    ),
  ]);
  const planOnly = form144WithLocalForm4(
    [form4ForConnection(form4TransactionXml({ code: "S", acquiredDisposed: "D", shares: "1000", date: "2026-01-01" }))],
    { units: "N/A", planDate: "2026-01-01" },
  );
  const valueOnly = form144WithLocalForm4(
    [form4ForConnection(form4TransactionXml({ code: "S", acquiredDisposed: "D", shares: "1000", date: "2026-06-01" }))],
    { units: "N/A", value: "20000" },
  );

  assert.equal((missingPerson.facts as any).form144.local_form4_connection.candidates[0].match_factors.person, "missing");
  assert.ok(((trustEntity.facts as any).form144.local_form4_connection.labels as string[]).includes("AMBIGUOUS_CANDIDATE"));
  assert.ok(((duplicateRows.facts as any).form144.local_form4_connection.labels as string[]).includes("MULTIPLE_MATCH_CANDIDATE"));
  assert.ok(((planOnly.facts as any).form144.local_form4_connection.labels as string[]).includes("AMBIGUOUS_CANDIDATE"));
  assert.ok(!((planOnly.facts as any).form144.local_form4_connection.labels as string[]).includes("FULL_MATCH_CANDIDATE"));
  assert.ok(!((valueOnly.facts as any).form144.local_form4_connection.labels as string[]).includes("FULL_MATCH_CANDIDATE"));
});

test("ownership parser safety classifies clean Form 4 non-market rows as parser-resolvable facts", () => {
  const cases = [
    ["fixtures/form4-code-a-award-safety.json", "A_ONLY_NOT_OPEN_MARKET_PURCHASE"],
    ["fixtures/form4-code-f-tax-withholding-safety.json", "F_ONLY_NOT_ORDINARY_SALE"],
    ["fixtures/form4-code-m-option-exercise-safety.json", "M_ONLY_NOT_ORDINARY_PURCHASE_OR_SALE"],
    ["fixtures/form4-code-v-voluntary-safety.json", "V_ONLY_NON_ECONOMIC_MARKER"],
    ["fixtures/form4-holding-only-safety.json", "HOLDING_ONLY_NON_TRANSACTION"],
  ];

  for (const [fixtureName, label] of cases) {
    const parsed = parseOwnershipFiling(readJson<Record<string, unknown>>(fixtureName) as never);
    const safety = safetyOf(parsed);
    assert.equal(safety.status, "parser_resolvable_low_noise", `${fixtureName} should be parser-resolvable`);
    assert.equal(safety.parser_resolvable, true);
    assert.ok((safety.labels as string[]).includes(label));
    assertNoInvestorConclusion(safety);
  }
});

test("ownership parser classifies clean Form 4 low-noise rows as limited archive facts", () => {
  const fOnly = parseOwnershipFiling(readJson<Record<string, unknown>>("fixtures/form4-code-f-tax-withholding-safety.json") as never);
  const mOnly = parseOwnershipFiling(readJson<Record<string, unknown>>("fixtures/form4-code-m-option-exercise-safety.json") as never);
  const mixedNonMarket = parseOwnershipFiling({
    formType: "4",
    filingText: form4OwnershipXml(
      `${form4TransactionXml({ code: "A", acquiredDisposed: "A", shares: "1000", price: "0", securityTitle: "Restricted Stock Units" })}${form4TransactionXml({ code: "F", acquiredDisposed: "D", shares: "250", price: "12.00", securityTitle: "Common Stock" })}${form4DerivativeXml({ derivativeShares: "500", underlyingShares: "500" })}`,
      null,
    ),
  } as never);

  for (const parsed of [fOnly, mOnly, mixedNonMarket]) {
    const facts = parsed.facts as Record<string, any>;
    assert.equal(facts.parser_completion.completion_kind, "limited_archive");
    assert.equal(facts.parser_completion.can_finish_without_llm, true);
  }
  assert.ok(((mixedNonMarket.facts as any).parser_completion.labels as string[]).includes("MIXED_NON_MARKET_FORM4"));
  assert.ok(((mixedNonMarket.facts as any).parser_safety_classification.labels as string[]).includes("MIXED_NON_MARKET_FORM4"));
});

test("ownership parser treats routine previously-reported equity-plan footnotes as low-noise unless correction language is present", () => {
  const aOnlyPreviouslyReported = parseOwnershipFiling({
    formType: "4",
    filingText: form4OwnershipXml(
      form4TransactionXml({ code: "A", acquiredDisposed: "A", shares: "3120", price: "0", rowFootnote: "F1" }),
      null,
      {
        footnotes: [
          "Represents dividend equivalent units accrued on restricted stock unit awards, the grant of which was previously reported. Such dividend equivalent units vest with the underlying awards.",
        ],
      },
    ),
  } as never);
  const fOnlyPreviouslyReported = parseOwnershipFiling({
    formType: "4",
    filingText: form4OwnershipXml(
      form4TransactionXml({ code: "F", acquiredDisposed: "D", shares: "12053", price: "11.98", rowFootnote: "F1" }),
      "President and Director",
      {
        footnotes: [
          "Represents shares withheld by the issuer to satisfy income tax withholding obligations in connection with vesting and net settlement of equity awards previously reported on Form 3, and does not represent a sale by the Reporting Person.",
        ],
      },
    ),
  } as never);
  const mixedPreviouslyReported = parseOwnershipFiling({
    formType: "4",
    filingText: form4OwnershipXml(
      `${form4TransactionXml({ code: "M", acquiredDisposed: "A", shares: "3301", price: "0", rowFootnote: "F1" })}${form4DerivativeXml({ derivativeShares: "3301", underlyingShares: "3301" })}${form4DerivativeXml({ derivativeShares: "5513", underlyingShares: "5513" }).replace("<transactionCode>M</transactionCode>", "<transactionCode>A</transactionCode>")}`,
      null,
      {
        footnotes: [
          "Granted but unvested RSUs were previously reported in Table I. Going forward, granted but unvested RSUs will be reported in Table II and in Table I when they vest and convert into Class A common stock.",
        ],
      },
    ),
  } as never);
  const correctionPreviouslyReported = parseOwnershipFiling({
    formType: "4",
    filingText: form4OwnershipXml(
      form4TransactionXml({ code: "A", acquiredDisposed: "A", shares: "1000", price: "0", rowFootnote: "F1" }),
      null,
      {
        footnotes: [
          "The transaction was previously reported in error and should not have been reported.",
        ],
      },
    ),
  } as never);

  for (const parsed of [aOnlyPreviouslyReported, fOnlyPreviouslyReported, mixedPreviouslyReported]) {
    const facts = parsed.facts as Record<string, any>;
    assert.equal(facts.parser_completion.completion_kind, "limited_archive");
    assert.equal(facts.parser_completion.can_finish_without_llm, true);
    assert.equal(safetyOf(parsed).status, "parser_resolvable_low_noise");
  }

  assert.equal((correctionPreviouslyReported.facts as any).parser_completion.can_finish_without_llm, false);
});

test("ownership parser completes clear equity-plan D/F/A adjustments including low-noise entity ownership context", () => {
  const equityPlanAdmin = parseOwnershipFiling({
    formType: "4",
    filingText: form4OwnershipXml(
      `${form4TransactionXml({ code: "D", acquiredDisposed: "D", shares: "487", price: "0" })}${form4TransactionXml({ code: "F", acquiredDisposed: "D", shares: "10545", price: "52.94" })}${form4TransactionXml({ code: "A", acquiredDisposed: "A", shares: "97136", price: "52.72" })}`,
      null,
      {
        footnotes: [
          "Forfeiture of PSUs relating to prior equity grants due to recalculation of performance metrics. These transactions are exempt under Rule 16b-3(e).",
          "Shares withheld to pay tax liability resulting from distribution of deferred shares related to long-term equity grants.",
          "Acquisition of deferred shares as a dividend reinvestment in a transaction exempt under Rule 16b-3(d)(1) & (2).",
        ],
      },
    ),
  } as never);
  const entityAmbiguous = parseOwnershipFiling({
    formType: "4",
    filingText: form4OwnershipXml(
      `${form4TransactionXml({ code: "D", acquiredDisposed: "D", shares: "464", price: "0" })}${form4TransactionXml({ code: "A", acquiredDisposed: "A", shares: "29003", price: "52.72" })}`,
      null,
      {
        footnotes: [
          "Forfeiture of PSUs relating to prior equity grants due to recalculation of performance metrics. These transactions are exempt under Rule 16b-3(e).",
          "Acquisition of deferred shares as a dividend reinvestment in a transaction exempt under Rule 16b-3(d)(1) & (2).",
          "The Reporting Person disclaims beneficial ownership of the portion of shares held by the limited partnership in excess of his proportionate pecuniary interest in those shares.",
        ],
      },
    ),
  } as never);

  const adminFacts = equityPlanAdmin.facts as Record<string, any>;
  assert.equal(adminFacts.parser_completion.completion_kind, "limited_archive");
  assert.equal(adminFacts.parser_completion.can_finish_without_llm, true);
  assert.ok((adminFacts.parser_completion.labels as string[]).includes("EQUITY_PLAN_ADMIN_ADJUSTMENT"));

  const entityFacts = entityAmbiguous.facts as Record<string, any>;
  assert.equal(entityFacts.parser_completion.completion_kind, "limited_archive");
  assert.equal(entityFacts.parser_completion.can_finish_without_llm, true);
  assert.ok((entityFacts.parser_completion.labels as string[]).includes("EQUITY_PLAN_ADMIN_ADJUSTMENT"));
});

test("ownership parser completes clean G gifts and no-consideration J exchanges without treating them as market trades", () => {
  const giftOnly = parseOwnershipFiling({
    formType: "4",
    filingText: form4OwnershipXml(
      form4TransactionXml({ code: "G", acquiredDisposed: "D", shares: "5000", price: "6.60" }),
      "Chief Registrar & Shareholder Officer",
      { ownerName: "Sharon Ullman", issuerName: "American Clean Resources Group, Inc.", ticker: "ACRG" },
    ),
  } as never);
  const jExchangeOnly = parseOwnershipFiling({
    formType: "4",
    filingText: form4OwnershipXml(
      `${form4TransactionXml({ code: "J", acquiredDisposed: "D", shares: "1250000", price: "0", securityTitle: "Common Stock" })}
      <derivativeTransaction><securityTitle><value>Pre-funded Warrant</value></securityTitle><conversionOrExercisePrice><value>0.01</value></conversionOrExercisePrice><transactionDate><value>2026-05-27</value></transactionDate><transactionCoding><transactionCode>J</transactionCode><footnoteId id="F1"/></transactionCoding><transactionAmounts><transactionShares><value>1250000</value></transactionShares><transactionPricePerShare><value>0</value></transactionPricePerShare><transactionAcquiredDisposedCode><value>A</value></transactionAcquiredDisposedCode></transactionAmounts><underlyingSecurity><underlyingSecurityTitle><value>Common Stock</value></underlyingSecurityTitle><underlyingSecurityShares><value>1250000</value></underlyingSecurityShares></underlyingSecurity><postTransactionAmounts><sharesOwnedFollowingTransaction><value>1250000</value></sharesOwnedFollowingTransaction></postTransactionAmounts><ownershipNature><directOrIndirectOwnership><value>D</value></directOrIndirectOwnership></ownershipNature></derivativeTransaction>`,
      null,
      {
        ownerName: "Coastlands Capital LP",
        issuerName: "Eloxx Pharmaceuticals, Inc.",
        ticker: "ELOX",
        footnotes: [
          "The reporting person exchanged 1,250,000 shares of common stock for pre-funded warrants to purchase an equivalent number of shares for no consideration.",
        ],
      },
    ),
  } as never);
  const jPlusSale = parseOwnershipFiling({
    formType: "4",
    filingText: form4OwnershipXml(
      `${form4TransactionXml({ code: "J", acquiredDisposed: "D", shares: "1000", price: "0" })}${form4TransactionXml({ code: "S", acquiredDisposed: "D", shares: "500", price: "16.00" })}`,
      null,
      {
        footnotes: [
          "Shares were distributed pro rata for no consideration.",
          "These shares were sold in multiple transactions and proceeds were distributed to limited partners.",
        ],
      },
    ),
  } as never);
  const derivativeGift = parseOwnershipFiling(readJson<Record<string, unknown>>("fixtures/form4-derivative-gift-section16-exit.json") as never);
  const familyTrustGift = parseOwnershipFiling({
    formType: "4",
    filingText: form4OwnershipXml(
      form4TransactionXml({ code: "G", acquiredDisposed: "D", shares: "1200", price: "0", rowFootnote: "F1" }),
      "Director",
      {
        ownerName: "Family Trust Donor",
        footnotes: [
          "Represents a bona fide gift to a family trust for no consideration. The Reporting Person disclaims beneficial ownership except to the extent of pecuniary interest.",
        ],
      },
    ),
  } as never);

  for (const parsed of [giftOnly, jExchangeOnly, familyTrustGift]) {
    const facts = parsed.facts as Record<string, any>;
    assert.equal(facts.parser_completion.completion_kind, "limited_archive");
    assert.equal(facts.parser_completion.can_finish_without_llm, true);
  }

  assert.ok(((giftOnly.facts as any).parser_completion.labels as string[]).includes("G_ONLY_GIFT_NON_MARKET"));
  assert.ok(((familyTrustGift.facts as any).parser_completion.labels as string[]).includes("G_ONLY_GIFT_NON_MARKET"));
  assert.ok(((jExchangeOnly.facts as any).parser_completion.labels as string[]).includes("J_ONLY_NO_CONSIDERATION_EXCHANGE"));
  assert.ok(((giftOnly.facts as any).parser_safety_classification.labels as string[]).includes("G_ONLY_GIFT_NON_MARKET"));
  assert.ok(((jExchangeOnly.facts as any).parser_safety_classification.labels as string[]).includes("J_ONLY_NO_CONSIDERATION_EXCHANGE"));
  assert.equal((jPlusSale.facts as any).parser_completion.can_finish_without_llm, false);
  assert.equal((derivativeGift.facts as any).parser_completion.can_finish_without_llm, false);
});

test("ownership parser completes only small source-backed S sell-to-cover tax rows as limited archive", () => {
  const sellToCover = parseOwnershipFiling({
    formType: "4",
    filingText: form4OwnershipXml(
      form4TransactionXml({ code: "S", acquiredDisposed: "D", shares: "650", price: "12.38", securityTitle: "Common Stock" }),
      null,
      {
        ownerName: "Tax Cover Officer",
        footnotes: [
          "The sale reported on this Form 4 represents shares sold by the Reporting Person to cover tax withholding obligations in connection with the vesting and settlement of restricted stock units. The initial grant of such restricted stock units was previously reported in Table I.",
        ],
      },
    ),
  } as never);
  const ordinarySmallSale = parseOwnershipFiling({
    formType: "4",
    filingText: form4OwnershipXml(
      form4TransactionXml({ code: "S", acquiredDisposed: "D", shares: "650", price: "12.38", securityTitle: "Common Stock" }),
      null,
      { ownerName: "Ordinary Seller", footnotes: ["Open-market sale reported by the reporting person."] },
    ),
  } as never);
  const multiRowSellToCover = parseOwnershipFiling({
    formType: "4",
    filingText: form4OwnershipXml(
      `${form4TransactionXml({ code: "S", acquiredDisposed: "D", shares: "650", price: "12.38", securityTitle: "Common Stock" })}${form4TransactionXml({ code: "S", acquiredDisposed: "D", shares: "400", price: "12.50", securityTitle: "Common Stock" })}`,
      null,
      {
        ownerName: "Multi Row Seller",
        footnotes: [
          "The sales reported on this Form 4 represent shares sold to cover tax withholding obligations in connection with restricted stock unit vesting.",
        ],
      },
    ),
  } as never);

  const facts = sellToCover.facts as Record<string, any>;
  assert.equal(facts.parser_completion.completion_kind, "limited_archive");
  assert.equal(facts.parser_completion.can_finish_without_llm, true);
  assert.ok((facts.parser_completion.labels as string[]).includes("S_ONLY_SELL_TO_COVER_TAX"));

  assert.ok(!((ordinarySmallSale.facts as any).parser_completion.labels as string[]).includes("S_ONLY_SELL_TO_COVER_TAX"));
  assert.ok(!((multiRowSellToCover.facts as any).parser_completion.labels as string[]).includes("S_ONLY_SELL_TO_COVER_TAX"));
});

test("ownership parser blocks limited archive completion when non-sale codes contain sale-like or private-placement wording", () => {
  const mWithSaleText = parseOwnershipFiling({
    formType: "4",
    accessionNumber: "0000000000-26-099001",
    filingText:
      "<?xml version=\"1.0\"?><ownershipDocument><documentType>4</documentType><issuer><issuerName>Blocker Corp</issuerName><issuerTradingSymbol>BLKR</issuerTradingSymbol></issuer><reportingOwner><reportingOwnerId><rptOwnerName>Exercise Holder</rptOwnerName></reportingOwnerId></reportingOwner><footnotes><footnote id=\"F1\">The reported price is a weighted average sale price for shares sold in multiple transactions.</footnote></footnotes><derivativeTable><derivativeTransaction><securityTitle><value>Stock Option</value></securityTitle><transactionDate><value>2026-05-20</value></transactionDate><transactionCoding><transactionCode>M</transactionCode></transactionCoding><transactionAmounts><transactionShares><value>1000</value></transactionShares><transactionPricePerShare><value>0</value></transactionPricePerShare><transactionAcquiredDisposedCode><value>A</value></transactionAcquiredDisposedCode></transactionAmounts><postTransactionAmounts><sharesOwnedFollowingTransaction><value>1000</value></sharesOwnedFollowingTransaction></postTransactionAmounts><ownershipNature><directOrIndirectOwnership><value>D</value></directOrIndirectOwnership></ownershipNature></derivativeTransaction></derivativeTable></ownershipDocument>",
  } as never);
  const aWithPrivatePlacementText = parseOwnershipFiling({
    formType: "4",
    accessionNumber: "0000000000-26-099002",
    filingText:
      "<?xml version=\"1.0\"?><ownershipDocument><documentType>4</documentType><issuer><issuerName>Placement Corp</issuerName><issuerTradingSymbol>PLCE</issuerTradingSymbol></issuer><reportingOwner><reportingOwnerId><rptOwnerName>Award Holder</rptOwnerName></reportingOwnerId></reportingOwner><footnotes><footnote id=\"F1\">Shares were acquired under a securities purchase agreement in a private placement with warrant coverage.</footnote></footnotes><nonDerivativeTable><nonDerivativeTransaction><securityTitle><value>Common Stock</value></securityTitle><transactionDate><value>2026-05-20</value></transactionDate><transactionCoding><transactionCode>A</transactionCode></transactionCoding><transactionAmounts><transactionShares><value>1000</value></transactionShares><transactionPricePerShare><value>0</value></transactionPricePerShare><transactionAcquiredDisposedCode><value>A</value></transactionAcquiredDisposedCode></transactionAmounts><postTransactionAmounts><sharesOwnedFollowingTransaction><value>1000</value></sharesOwnedFollowingTransaction></postTransactionAmounts></nonDerivativeTransaction></nonDerivativeTable></ownershipDocument>",
  } as never);

  for (const parsed of [mWithSaleText, aWithPrivatePlacementText]) {
    const facts = parsed.facts as Record<string, any>;
    assert.equal(facts.parser_completion.can_finish_without_llm, false);
    assert.ok(facts.parser_completion.blockers.length > 0);
  }
});

test("ownership parser safety requires downstream analysis for Form 4 market, unusual, correction, and ambiguous rows", () => {
    const cases = [
    parseOwnershipFiling(readJson<Record<string, unknown>>("fixtures/form4-insider-purchase.json") as never),
    parseOwnershipFiling(readJson<Record<string, unknown>>("fixtures/form4-10b5-1-sale.json") as never),
    parseOwnershipFiling({ formType: "4", filingText: form4OwnershipXml(form4TransactionXml({ code: "J", acquiredDisposed: "D" }), null) } as never),
    parseOwnershipFiling({ formType: "4", filingText: form4OwnershipXml(form4TransactionXml({ code: "K", acquiredDisposed: "D" }), null) } as never),
    parseOwnershipFiling({ formType: "4", filingText: form4OwnershipXml(form4TransactionXml({ code: "U", acquiredDisposed: "D" }), null) } as never),
    parseOwnershipFiling(readJson<Record<string, unknown>>("fixtures/form4-multiple-owners-unknown-code.json") as never),
    parseOwnershipFiling({ formType: "4", filingText: form4OwnershipXml(form4TransactionXml({ code: "S", acquiredDisposed: "D", date: "2026-06-01" }), "Sale under a Rule 10b5-1 trading plan adopted on 2026-01-01.") } as never),
    parseOwnershipFiling(readJson<Record<string, unknown>>("fixtures/form4a-correction-row-safety.json") as never),
  ];

  for (const parsed of cases) {
    const safety = safetyOf(parsed);
    assert.equal(safety.downstream_analysis_required || safety.status === "ambiguous_or_unsafe", true);
    assert.equal(safety.parser_resolvable, false);
    assertNoInvestorConclusion(safety);
  }

  const mPlusS = parseOwnershipFiling({
    formType: "4",
    filingText: form4OwnershipXml(
      `${form4DerivativeXml({ derivativeShares: "1000", underlyingShares: "1000" })}${form4TransactionXml({ code: "S", acquiredDisposed: "D", shares: "1000", date: "2026-06-01" })}`,
      null,
    ),
  } as never);
  assert.equal(safetyOf(mPlusS).status, "downstream_analysis_required");
  assert.ok((safetyOf(mPlusS).labels as string[]).includes("M_PLUS_S_REQUIRES_ANALYSIS"));
});

test("ownership parser safety classifies Form 4/A clean metadata or footnote amendments separately from changed amendments", () => {
  const metadataOnly = parseOwnershipFiling(form4AmendmentFixture(form4TransactionXml(), "", form4TransactionXml(), { ownerTitle: "Chief Accounting Officer" }) as never);
  const amendLine = parseOwnershipFiling(form4AmendmentFixture(form4TransactionXml({ shares: "200" }), "", form4TransactionXml()) as never);
  const addLine = parseOwnershipFiling(form4AmendmentFixture(`${form4TransactionXml()}${form4TransactionXml({ shares: "200", price: "11.00" })}`, "", form4TransactionXml()) as never);
  const ambiguous = parseOwnershipFiling(
    form4AmendmentFixture(
      form4TransactionXml({ shares: "150", price: "10.00" }),
      "",
      `${form4TransactionXml({ shares: "100", price: "10.00" })}${form4TransactionXml({ shares: "200", price: "10.00" })}`,
    ) as never,
  );

  assert.equal(safetyOf(metadataOnly).status, "parser_resolvable_low_noise");
  assert.ok((safetyOf(metadataOnly).labels as string[]).includes("AMENDMENT_CLEAN_METADATA_OR_FOOTNOTE_ONLY"));
  assert.equal(safetyOf(amendLine).status, "downstream_analysis_required");
  assert.equal(safetyOf(addLine).status, "downstream_analysis_required");
  assert.equal(safetyOf(ambiguous).status, "ambiguous_or_unsafe");
});

test("ownership parser safety blocks unresolved footnote and fallback-derived strong parser resolution", () => {
  const unresolved = parseOwnershipFiling({
    formType: "4",
    filingText: form4OwnershipXml(form4TransactionXml({ code: "A", acquiredDisposed: "A", rowFootnote: "MISSING" }), null).replace('<footnote id="F1">Original footnote.</footnote>', ""),
  } as never);
  const fallback = parseOwnershipFiling(readJson<Record<string, unknown>>("fixtures/form4-malformed-xml-fallback-safety.json") as never);

  assert.equal(safetyOf(unresolved).status, "ambiguous_or_unsafe");
  assert.equal(safetyOf(unresolved).parser_resolvable, false);
  assert.equal(safetyOf(fallback).parser_resolvable, false);
});

test("ownership parser safety keeps Form 144 proposed-sale and local Form 4 candidates downstream-analysis-only", () => {
  const ordinary = parseOwnershipFiling(readJson<Record<string, unknown>>("fixtures/form144-proposed-sale-safety.json") as never);
  const noLocalCandidate = form144WithLocalForm4([], { approxDate: "06/01/2026" });
  const fullCandidate = form144WithLocalForm4([form4ForConnection(form4TransactionXml({ code: "S", acquiredDisposed: "D", shares: "1000", date: "2026-06-01" }))]);
  const partialCandidate = form144WithLocalForm4([form4ForConnection(form4TransactionXml({ code: "S", acquiredDisposed: "D", shares: "400", date: "2026-06-01" }))]);
  const multipleCandidate = form144WithLocalForm4([
    form4ForConnection(`${form4TransactionXml({ code: "S", acquiredDisposed: "D", shares: "400", date: "2026-06-01" })}${form4TransactionXml({ code: "S", acquiredDisposed: "D", shares: "600", date: "2026-06-02" })}`),
  ]);

  for (const parsed of [ordinary, noLocalCandidate, fullCandidate, partialCandidate, multipleCandidate]) {
    const safety = safetyOf(parsed);
    assert.equal(safety.status, "downstream_analysis_required");
    assert.equal(safety.parser_resolvable, false);
    assertNoExecutionConclusion(safety);
  }
  assert.ok((safetyOf(ordinary).labels as string[]).includes("FORM_144_PROPOSED_ONLY"));
});

test("ownership parser identifies small clean Form 144 proposed-sale facts without final analysis", () => {
  const cleanSmall = parseOwnershipFiling({
    formType: "144",
    filingText: form144Xml({ submissionType: "144", noPriorSales: true, omitPlanDate: true }),
  } as never);
  const withSmallPriorSales = parseOwnershipFiling({
    formType: "144",
    filingText: form144Xml({ submissionType: "144", omitPlanDate: true }),
  } as never);
  const withSmallPlanDate = parseOwnershipFiling({
    formType: "144",
    filingText: form144Xml({ submissionType: "144", noPriorSales: true }),
  } as never);
  const withMediumPlanDateNoPriorSales = parseOwnershipFiling({
    formType: "144",
    filingText: form144Xml({
      submissionType: "144",
      units: "3000",
      value: "300000",
      outstanding: "20000000",
      noPriorSales: true,
    }),
  } as never);
  const withLargerPlanDateNoPriorSalesTinyFloatPercent = parseOwnershipFiling({
    formType: "144",
    filingText: form144Xml({
      submissionType: "144",
      units: "9000",
      value: "900000",
      outstanding: "50000000",
      noPriorSales: true,
    }),
  } as never);
  const withLargerPlanDateNoPriorSalesHigherFloatPercent = parseOwnershipFiling({
    formType: "144",
    filingText: form144Xml({
      submissionType: "144",
      units: "9000",
      value: "900000",
      outstanding: "1000000",
      noPriorSales: true,
    }),
  } as never);
  const withClassACommonStockTitle = parseOwnershipFiling({
    formType: "144",
    filingText: form144Xml({
      submissionType: "144",
      classTitle: "Class A Common Stock",
      noPriorSales: true,
      omitPlanDate: true,
    }),
  } as never);
  const withCommonSharesNoParValueTitle = parseOwnershipFiling({
    formType: "144",
    filingText: form144Xml({
      submissionType: "144",
      classTitle: "Common Shares no par value",
      noPriorSales: true,
      omitPlanDate: true,
    }),
  } as never);
  const withCommonStockParValueTitle = parseOwnershipFiling({
    formType: "144",
    filingText: form144Xml({
      submissionType: "144",
      classTitle: "Common Stock, par value $0.01 per share",
      noPriorSales: true,
      omitPlanDate: true,
    }),
  } as never);
  const withClassOnlyTitle = parseOwnershipFiling({
    formType: "144",
    filingText: form144Xml({
      submissionType: "144",
      classTitle: "Class B",
      noPriorSales: true,
      omitPlanDate: true,
    }),
  } as never);
  const withNoPlanNoPriorUnderOneMillion = parseOwnershipFiling({
    formType: "144",
    filingText: form144Xml({
      submissionType: "144",
      units: "8364",
      value: "836454",
      outstanding: "3760000",
      noPriorSales: true,
      omitPlanDate: true,
    }),
  } as never);
  const withPriorModerateAggregate = parseOwnershipFiling({
    formType: "144",
    filingText: form144Xml({
      submissionType: "144",
      units: "15000",
      value: "1717620",
      outstanding: "44910180",
      omitPlanDate: true,
    }).replace(
      "</securitiesSoldInPast3Months>",
      "</securitiesSoldInPast3Months><securitiesSoldInPast3Months><sellerDetails><name>Amend Seller</name></sellerDetails><securitiesClassTitle>Common Stock</securitiesClassTitle><saleDate>04/02/2026</saleDate><amountOfSecuritiesSold>6000</amountOfSecuritiesSold><grossProceeds>600000</grossProceeds></securitiesSoldInPast3Months><securitiesSoldInPast3Months><sellerDetails><name>Amend Seller</name></sellerDetails><securitiesClassTitle>Common Stock</securitiesClassTitle><saleDate>04/03/2026</saleDate><amountOfSecuritiesSold>7000</amountOfSecuritiesSold><grossProceeds>780640</grossProceeds></securitiesSoldInPast3Months>",
    ),
  } as never);
  const withSmallThreePriorSales = parseOwnershipFiling({
    formType: "144",
    filingText: form144Xml({
      submissionType: "144",
      omitPlanDate: true,
    }).replace(
      "</securitiesSoldInPast3Months>",
      "</securitiesSoldInPast3Months><securitiesSoldInPast3Months><sellerDetails><name>Amend Seller</name></sellerDetails><securitiesClassTitle>Common Stock</securitiesClassTitle><saleDate>04/02/2026</saleDate><amountOfSecuritiesSold>600</amountOfSecuritiesSold><grossProceeds>12000</grossProceeds></securitiesSoldInPast3Months><securitiesSoldInPast3Months><sellerDetails><name>Amend Seller</name></sellerDetails><securitiesClassTitle>Common Stock</securitiesClassTitle><saleDate>04/03/2026</saleDate><amountOfSecuritiesSold>700</amountOfSecuritiesSold><grossProceeds>15000</grossProceeds></securitiesSoldInPast3Months>",
    ),
  } as never);
  const withSmallRoutineTwoPriorSales = parseOwnershipFiling({
    formType: "144",
    filingText: form144Xml({
      submissionType: "144",
      omitPlanDate: true,
      remarks: "Sale includes an amount necessary to cover a tax obligation resulting from the settlement of a vested equity award distribution.",
    }).replace(
      "</securitiesSoldInPast3Months>",
      "</securitiesSoldInPast3Months><securitiesSoldInPast3Months><sellerDetails><name>Amend Seller</name></sellerDetails><securitiesClassTitle>Common Stock</securitiesClassTitle><saleDate>04/02/2026</saleDate><amountOfSecuritiesSold>600</amountOfSecuritiesSold><grossProceeds>12000</grossProceeds></securitiesSoldInPast3Months>",
    ),
  } as never);
  const withSmallRoutineTwoPriorSalesAndPlan = parseOwnershipFiling({
    formType: "144",
    filingText: form144Xml({
      submissionType: "144",
      remarks: "Sale includes an amount necessary to cover a tax obligation resulting from the settlement of a vested equity award distribution.",
    }).replace(
      "</securitiesSoldInPast3Months>",
      "</securitiesSoldInPast3Months><securitiesSoldInPast3Months><sellerDetails><name>Amend Seller</name></sellerDetails><securitiesClassTitle>Common Stock</securitiesClassTitle><saleDate>04/02/2026</saleDate><amountOfSecuritiesSold>600</amountOfSecuritiesSold><grossProceeds>12000</grossProceeds></securitiesSoldInPast3Months>",
    ),
  } as never);
  const withAffiliateOnlyModerateSale = parseOwnershipFiling({
    formType: "144",
    filingText: form144Xml({
      submissionType: "144",
      units: "12000",
      value: "1200000",
      outstanding: "20000000",
      noPriorSales: true,
      omitPlanDate: true,
      relationship: "May be deemed affiliate",
    }),
  } as never);
  const withSmallPlanAndThreePriorSales = parseOwnershipFiling({
    formType: "144",
    filingText: form144Xml({
      submissionType: "144",
      units: "10000",
      value: "267000",
      outstanding: "100000000",
    }).replace(
      "</securitiesSoldInPast3Months>",
      "</securitiesSoldInPast3Months><securitiesSoldInPast3Months><sellerDetails><name>Amend Seller</name></sellerDetails><securitiesClassTitle>Common Stock</securitiesClassTitle><saleDate>04/02/2026</saleDate><amountOfSecuritiesSold>6000</amountOfSecuritiesSold><grossProceeds>350000</grossProceeds></securitiesSoldInPast3Months><securitiesSoldInPast3Months><sellerDetails><name>Amend Seller</name></sellerDetails><securitiesClassTitle>Common Stock</securitiesClassTitle><saleDate>04/03/2026</saleDate><amountOfSecuritiesSold>7000</amountOfSecuritiesSold><grossProceeds>350000</grossProceeds></securitiesSoldInPast3Months>",
    ),
  } as never);
  const withBrokerLlcInPriorSellerName = parseOwnershipFiling({
    formType: "144",
    filingText: form144Xml({
      submissionType: "144",
      units: "3300",
      value: "94050",
      outstanding: "6097552",
      omitPlanDate: true,
    }).replace("<name>Amend Seller</name>", "<name>Seller C/O RBC CAPITAL MARKETS LLC</name>"),
  } as never);
  const withModeratePlanDateNoPriorSalesLowOutstandingPercent = parseOwnershipFiling({
    formType: "144",
    filingText: form144Xml({
      submissionType: "144",
      units: "15000",
      value: "1326900",
      outstanding: "40407065",
      noPriorSales: true,
    }),
  } as never);
  const withSmallFivePriorSalesNoPlan = parseOwnershipFiling({
    formType: "144",
    filingText: form144Xml({
      submissionType: "144",
      units: "10000",
      value: "509000",
      outstanding: "15000000",
      omitPlanDate: true,
    }).replace(
      "</securitiesSoldInPast3Months>",
      "</securitiesSoldInPast3Months><securitiesSoldInPast3Months><sellerDetails><name>Amend Seller</name></sellerDetails><securitiesClassTitle>Common Stock</securitiesClassTitle><saleDate>04/02/2026</saleDate><amountOfSecuritiesSold>600</amountOfSecuritiesSold><grossProceeds>15000</grossProceeds></securitiesSoldInPast3Months><securitiesSoldInPast3Months><sellerDetails><name>Amend Seller</name></sellerDetails><securitiesClassTitle>Common Stock</securitiesClassTitle><saleDate>04/03/2026</saleDate><amountOfSecuritiesSold>700</amountOfSecuritiesSold><grossProceeds>12000</grossProceeds></securitiesSoldInPast3Months><securitiesSoldInPast3Months><sellerDetails><name>Amend Seller</name></sellerDetails><securitiesClassTitle>Common Stock</securitiesClassTitle><saleDate>04/04/2026</saleDate><amountOfSecuritiesSold>800</amountOfSecuritiesSold><grossProceeds>18000</grossProceeds></securitiesSoldInPast3Months><securitiesSoldInPast3Months><sellerDetails><name>Amend Seller</name></sellerDetails><securitiesClassTitle>Common Stock</securitiesClassTitle><saleDate>04/05/2026</saleDate><amountOfSecuritiesSold>900</amountOfSecuritiesSold><grossProceeds>20000</grossProceeds></securitiesSoldInPast3Months>",
    ),
  } as never);
  const withHardComplexRelationship = parseOwnershipFiling({
    formType: "144",
    filingText: form144Xml({
      submissionType: "144",
      units: "1000",
      value: "20000",
      outstanding: "1000000",
      noPriorSales: true,
      omitPlanDate: true,
      relationship: "10% holder; control person",
    }),
  } as never);
  const withLargePriorSales = parseOwnershipFiling({
    formType: "144",
    filingText: form144Xml({ submissionType: "144", omitPlanDate: true }).replace(
      "<grossProceeds>10000</grossProceeds>",
      "<grossProceeds>6000000</grossProceeds>",
    ),
  } as never);
  const largeProposedSale = parseOwnershipFiling({
    formType: "144",
    filingText: form144Xml({ submissionType: "144", units: "100000", value: "1000000", noPriorSales: true, omitPlanDate: true }),
  } as never);

  for (const parsed of [
    cleanSmall,
    withSmallPriorSales,
    withSmallPlanDate,
    withMediumPlanDateNoPriorSales,
    withLargerPlanDateNoPriorSalesTinyFloatPercent,
    withClassACommonStockTitle,
    withCommonSharesNoParValueTitle,
    withCommonStockParValueTitle,
    withClassOnlyTitle,
    withNoPlanNoPriorUnderOneMillion,
    withPriorModerateAggregate,
    withSmallThreePriorSales,
    withSmallRoutineTwoPriorSales,
    withSmallRoutineTwoPriorSalesAndPlan,
    withSmallPlanAndThreePriorSales,
    withBrokerLlcInPriorSellerName,
    withModeratePlanDateNoPriorSalesLowOutstandingPercent,
    withLargePriorSales,
  ]) {
    assert.ok(parsed.signals.includes("routine_form_144"));
  }
  assert.equal((withSmallThreePriorSales.facts as any).form144.prior_sales.length, 3);
  assert.deepEqual((withMediumPlanDateNoPriorSales.facts as any).form144.plan_adoption_dates, ["2026-01-01"]);
  assert.equal((withClassACommonStockTitle.facts as any).form144.securities_class_title, "Class A Common Stock");
  assert.equal((withCommonSharesNoParValueTitle.facts as any).form144.securities_class_title, "Common Shares no par value");
  assert.equal((withCommonStockParValueTitle.facts as any).form144.securities_class_title, "Common Stock, par value $0.01 per share");
  assert.equal((withClassOnlyTitle.facts as any).form144.securities_class_title, "Class B");
  assert.equal((withNoPlanNoPriorUnderOneMillion.facts as any).form144.aggregate_market_value, 836454);
  assert.equal((withPriorModerateAggregate.facts as any).form144.prior_sales.length, 3);
  assert.equal((withSmallRoutineTwoPriorSales.facts as any).form144.prior_sales.length, 2);
  assert.equal((withSmallPlanAndThreePriorSales.facts as any).form144.prior_sales.length, 3);
  assert.equal((withBrokerLlcInPriorSellerName.facts as any).form144.aggregate_market_value, 94050);
  assert.equal((withModeratePlanDateNoPriorSalesLowOutstandingPercent.facts as any).form144.aggregate_market_value, 1326900);
  assert.deepEqual((withSmallPlanDate.facts as any).form144.plan_adoption_dates, ["2026-01-01"]);
  assert.deepEqual((withSmallRoutineTwoPriorSalesAndPlan.facts as any).form144.plan_adoption_dates, ["2026-01-01"]);
  assert.equal((withLargePriorSales.facts as any).form144.prior_sales[0].gross_proceeds, 6000000);
  assert.equal((withAffiliateOnlyModerateSale.facts as any).form144.issuer_relationships[0], "May be deemed affiliate");
  assert.equal((withSmallFivePriorSalesNoPlan.facts as any).form144.prior_sales.length, 5);

  for (const parsed of [
    withLargerPlanDateNoPriorSalesHigherFloatPercent,
    withAffiliateOnlyModerateSale,
    withSmallFivePriorSalesNoPlan,
    withHardComplexRelationship,
    largeProposedSale,
  ]) {
    assert.equal(parsed.signals.includes("routine_form_144"), false);
  }
});

test("ownership parser safety preserves non-execution Form 144 local rows and classifies Form 144/A amendments conservatively", () => {
  const fOnly = form144WithLocalForm4([form4ForConnection(form4TransactionXml({ code: "F", acquiredDisposed: "D", shares: "1000", date: "2026-06-01" }))]);
  const mOnly = form144WithLocalForm4([form4ForConnection(form4TransactionXml({ code: "M", acquiredDisposed: "A", shares: "1000", date: "2026-06-01" }))]);
  const metadataOnly = parseOwnershipFiling(form144AmendmentFixture(form144Xml({ seller: "Updated Seller Name" }), form144Xml()) as never);
  const changed = parseOwnershipFiling(form144AmendmentFixture(form144Xml({ units: "2000", value: "40000" }), form144Xml()) as never);
  const correction = parseOwnershipFiling(form144AmendmentFixture(form144Xml({ remarks: "This amendment corrects the proposed amount previously reported in error." }), form144Xml()) as never);
  const ambiguous = parseOwnershipFiling(
    form144AmendmentFixture(
      form144Xml({ units: "1500", multipleRows: true }),
      form144Xml({ multipleRows: true }).replace(
        "<noOfUnitsSold>2000</noOfUnitsSold><aggregateMarketValue>40000</aggregateMarketValue><noOfUnitsOutstanding>1000000</noOfUnitsOutstanding><approxSaleDate>06/02/2026</approxSaleDate>",
        "<noOfUnitsSold>2000</noOfUnitsSold><aggregateMarketValue>20000</aggregateMarketValue><noOfUnitsOutstanding>1000000</noOfUnitsOutstanding><approxSaleDate>06/01/2026</approxSaleDate>",
      ),
    ) as never,
  );

  assert.ok((safetyOf(fOnly).deterministic_statements as string[]).some((statement) => statement.includes("not normal execution-sale matches")));
  assert.ok((safetyOf(mOnly).deterministic_statements as string[]).some((statement) => statement.includes("not normal execution-sale matches")));
  assert.equal(safetyOf(metadataOnly).status, "parser_resolvable_low_noise");
  assert.equal(safetyOf(changed).status, "downstream_analysis_required");
  assert.equal(safetyOf(correction).status, "downstream_analysis_required");
  assert.equal(safetyOf(ambiguous).status, "ambiguous_or_unsafe");
});

test("ownership parser safety blocks ambiguous Form 144 10b5-1 and malformed fallback sources", () => {
  const ambiguous10b5 = parseOwnershipFiling(readJson<Record<string, unknown>>("fixtures/form144-ambiguous-10b5-multiple-rows.json") as never);
  const fallback144 = parseOwnershipFiling(readJson<Record<string, unknown>>("fixtures/form144-malformed-xml-fallback.json") as never);

  assert.equal(safetyOf(ambiguous10b5).status, "downstream_analysis_required");
  assert.equal(safetyOf(ambiguous10b5).parser_resolvable, false);
  assert.equal(safetyOf(fallback144).parser_resolvable, false);
});

test("ownership handoff defaults clear Form 4 and Form 144 filings to insider ownership without router", () => {
  const form4 = parseOwnershipFiling(readJson<Record<string, unknown>>("fixtures/form4-insider-purchase.json") as never);
  const form144 = parseOwnershipFiling(readJson<Record<string, unknown>>("fixtures/form144-proposed-sale-safety.json") as never);

  for (const parsed of [form4, form144]) {
    const handoff = handoffOf(parsed);
    assert.equal(handoff.event_type, "insider_ownership");
    assert.equal(handoff.router_needed, false);
    assert.ok((handoff.labels as string[]).includes("OWNERSHIP_DEFAULT_EVENT_TYPE"));
    assert.equal(handoff.display_version, "ownership_v1");
  }
});

test("ownership handoff separates analysis-needed from router-needed for ordinary ownership cases", () => {
  const sale = parseOwnershipFiling(readJson<Record<string, unknown>>("fixtures/form4-10b5-1-sale.json") as never);
  const proposedSale = parseOwnershipFiling(readJson<Record<string, unknown>>("fixtures/form144-proposed-sale-safety.json") as never);
  const candidate = form144WithLocalForm4([form4ForConnection(form4TransactionXml({ code: "S", acquiredDisposed: "D", shares: "1000", date: "2026-06-01" }))]);

  const saleHandoff = handoffOf(sale);
  assert.equal(saleHandoff.analysis_llm_needed, true);
  assert.equal(saleHandoff.router_needed, false);
  assert.ok((saleHandoff.labels as string[]).includes("ANALYSIS_LLM_NEEDED"));

  for (const parsed of [proposedSale, candidate]) {
    const handoff = handoffOf(parsed);
    assert.equal(handoff.analysis_llm_needed, true);
    assert.equal(handoff.router_needed, false);
    assert.ok((handoff.labels as string[]).includes("ANALYSIS_LLM_NEEDED"));
    assert.equal(handoff.event_type, "insider_ownership");
  }
  assert.ok((handoffOf(candidate).analysis_needed_reasons as string[]).some((reason) => reason.includes("candidate-only")));
});

test("ownership handoff keeps ambiguous ownership filings on analysis path without router", () => {
  const ambiguousFallback = parseOwnershipFiling({
    formType: "4",
    filingText: "<html><body>Form 4 text excerpt mentions a tender offer, merger consideration, and inconsistent ownership tables.</body></html>",
  } as never);
  const handoff = handoffOf(ambiguousFallback);

  assert.equal(handoff.router_needed, false);
  assert.equal(handoff.analysis_llm_needed, true);
  assert.equal(handoff.event_type, "insider_ownership");
  assert.equal(handoff.event_type_confidence, "high");
  assert.deepEqual(handoff.router_needed_reasons, []);
  assert.ok((handoff.analysis_needed_reasons as string[]).length > 0);
  assert.ok((handoff.labels as string[]).includes("OWNERSHIP_DEFAULT_EVENT_TYPE"));
});

test("ownership handoff exposes parser-built UI payload fact groups without analysis invention", () => {
  const parsed = form144WithLocalForm4([form4ForConnection(form4TransactionXml({ code: "S", acquiredDisposed: "D", shares: "1000", date: "2026-06-01" }))]);
  const handoff = handoffOf(parsed);
  const facts = parsed.facts as any;

  assert.ok((handoff.ui_handoff_fact_groups as string[]).includes("form144_form4_connection_candidates"));
  assert.equal(facts.ownership_handoff.display_version, "ownership_v1");
  assert.equal(facts.ownership_handoff.event_type, "insider_ownership");
  assert.equal(facts.form144.local_form4_connection.labels.includes("FULL_MATCH_CANDIDATE"), true);
  assertNoInvestorConclusion(facts.ownership_handoff);
});

function pick(source: Record<string, unknown>, keys: string[]) {
  return Object.fromEntries(keys.map((key) => [key, source[key]]));
}

function safetyOf(parsed: ReturnType<typeof parseOwnershipFiling>) {
  return (parsed.facts as any).parser_safety_classification;
}

function handoffOf(parsed: ReturnType<typeof parseOwnershipFiling>) {
  return (parsed.facts as any).ownership_handoff;
}

function form144WithLocalForm4(localForm4Filings: ReturnType<typeof parseOwnershipFiling>[], options: Parameters<typeof form144Xml>[0] = {}) {
  return parseOwnershipFiling({
    formType: "144",
    accessionNumber: "0000000000-26-014700",
    filingText: form144Xml({
      submissionType: "144",
      approxDate: "06/01/2026",
      seller: "Amend Seller",
      ...options,
    }),
    localForm4Filings,
  } as never);
}

function form4ForConnection(rows: string, options: { ownerName?: string; issuerCik?: string; issuerName?: string; ticker?: string } = {}) {
  return parseOwnershipFiling({
    formType: "4",
    accessionNumber: "0000000000-26-004700",
    filingText: form4OwnershipXml(rows, null, {
      ownerName: options.ownerName ?? "Amend Seller",
      issuerCik: options.issuerCik ?? "0008888001",
      issuerName: options.issuerName ?? "Amend 144 Corp",
      ticker: options.ticker ?? "A144C",
    }),
  } as never);
}

function assertNoExecutionConclusion(value: unknown) {
  const serialized = JSON.stringify(value).toLowerCase();
  assert.ok(!serialized.includes("confirmed_sale"));
  assert.ok(!serialized.includes("executed_sale"));
  assert.ok(!serialized.includes("definitely"));
}

function assertNoInvestorConclusion(value: unknown) {
  const serialized = JSON.stringify(value).toLowerCase();
  assert.ok(!serialized.includes("bullish"));
  assert.ok(!serialized.includes("bearish"));
  assert.ok(!serialized.includes("suspicious"));
  assert.ok(!serialized.includes("important"));
  assert.ok(!serialized.includes("harmless"));
  assert.ok(!serialized.includes("trigger an alert"));
}

function form4AmendmentFixture(amendmentRows: string, remarks: string, originalRows: string, options: { ownerTitle?: string } = {}) {
  return {
    formType: "4/A",
    accessionNumber: "0000000000-26-004200",
    filingText: form4OwnershipXml(amendmentRows, remarks, options),
    originalFiling: {
      formType: "4",
      accessionNumber: "0000000000-26-004100",
      filingText: form4OwnershipXml(originalRows, null),
    },
  };
}

function form4OwnershipXml(
  rows: string,
  remarks: string | null,
  options: { ownerTitle?: string; ownerName?: string; issuerCik?: string; issuerName?: string; ticker?: string; footnotes?: string[] } = {},
) {
  const nonDerivativeRows = rows.match(/<nonDerivativeTransaction[\s\S]*?<\/nonDerivativeTransaction>/g)?.join("") ?? "";
  const derivativeRows = rows.match(/<derivativeTransaction[\s\S]*?<\/derivativeTransaction>/g)?.join("") ?? "";
  const footnotes = options.footnotes?.length
    ? options.footnotes.map((text, index) => `<footnote id="F${index + 1}">${text}</footnote>`).join("")
    : '<footnote id="F1">Original footnote.</footnote><footnote id="F2">Amended footnote.</footnote>';
  return `<?xml version="1.0"?><ownershipDocument><documentType>4</documentType><issuer><issuerCik>${options.issuerCik ?? "0007777001"}</issuerCik><issuerName>${options.issuerName ?? "Amend Compare Corp"}</issuerName><issuerTradingSymbol>${options.ticker ?? "AMND"}</issuerTradingSymbol></issuer><reportingOwner><reportingOwnerId><rptOwnerName>${options.ownerName ?? "Amend Owner"}</rptOwnerName></reportingOwnerId><reportingOwnerRelationship><isOfficer>1</isOfficer><officerTitle>${options.ownerTitle ?? "Chief Financial Officer"}</officerTitle></reportingOwnerRelationship></reportingOwner><nonDerivativeTable>${nonDerivativeRows}</nonDerivativeTable><derivativeTable>${derivativeRows}</derivativeTable>${remarks ? `<remarks>${remarks}</remarks>` : ""}<footnotes>${footnotes}</footnotes></ownershipDocument>`;
}

function form4TransactionXml(options: { shares?: string; price?: string; date?: string; code?: string; acquiredDisposed?: string; rowFootnote?: string; footnoteText?: string; securityTitle?: string } = {}) {
  return `<nonDerivativeTransaction><securityTitle><value>${options.securityTitle ?? "Common Stock"}</value></securityTitle><transactionDate><value>${options.date ?? "2026-05-20"}</value></transactionDate><transactionCoding><transactionCode>${options.code ?? "P"}</transactionCode><footnoteId id="${options.rowFootnote ?? "F1"}"/></transactionCoding><transactionAmounts><transactionShares><value>${options.shares ?? "100"}</value></transactionShares><transactionPricePerShare><value>${options.price ?? "10.00"}</value></transactionPricePerShare><transactionAcquiredDisposedCode><value>${options.acquiredDisposed ?? "A"}</value></transactionAcquiredDisposedCode></transactionAmounts><postTransactionAmounts><sharesOwnedFollowingTransaction><value>1000</value></sharesOwnedFollowingTransaction></postTransactionAmounts><ownershipNature><directOrIndirectOwnership><value>D</value></directOrIndirectOwnership></ownershipNature></nonDerivativeTransaction>`;
}

function form4DerivativeXml(options: { derivativeShares?: string; underlyingShares?: string } = {}) {
  return `<derivativeTransaction><securityTitle><value>Employee Option</value></securityTitle><conversionOrExercisePrice><value>5.00</value></conversionOrExercisePrice><transactionDate><value>2026-05-20</value></transactionDate><transactionCoding><transactionCode>M</transactionCode></transactionCoding><transactionAmounts><transactionShares><value>${options.derivativeShares ?? "1000"}</value></transactionShares><transactionPricePerShare><value>0</value></transactionPricePerShare><transactionAcquiredDisposedCode><value>A</value></transactionAcquiredDisposedCode></transactionAmounts><exerciseDate><value>2026-05-20</value></exerciseDate><expirationDate><value>2030-05-20</value></expirationDate><underlyingSecurity><underlyingSecurityTitle><value>Common Stock</value></underlyingSecurityTitle><underlyingSecurityShares><value>${options.underlyingShares ?? "1000"}</value></underlyingSecurityShares></underlyingSecurity><postTransactionAmounts><sharesOwnedFollowingTransaction><value>0</value></sharesOwnedFollowingTransaction></postTransactionAmounts><ownershipNature><directOrIndirectOwnership><value>D</value></directOrIndirectOwnership></ownershipNature></derivativeTransaction>`;
}

function form144AmendmentFixture(amendmentXml: string, originalXml: string) {
  return {
    formType: "144/A",
    accessionNumber: "0000000000-26-014600",
    filingText: amendmentXml,
    originalFiling: {
      formType: "144",
      accessionNumber: "0000000000-26-014500",
      filingText: originalXml,
    },
  };
}

function form144Xml(options: {
  submissionType?: string;
  classTitle?: string;
  broker?: string;
  units?: string;
  value?: string;
  outstanding?: string;
  approxDate?: string;
  acquisitionNature?: string;
  priorAmount?: string;
  planDate?: string;
  remarks?: string;
  seller?: string;
  multipleRows?: boolean;
  noPriorSales?: boolean;
  omitPlanDate?: boolean;
  relationship?: string;
} = {}) {
  const row = (classTitle: string, units: string, value: string, approxDate: string, broker: string) =>
    `<securitiesInformation><securitiesClassTitle>${classTitle}</securitiesClassTitle><brokerOrMarketmakerDetails><name>${broker}</name></brokerOrMarketmakerDetails><noOfUnitsSold>${units}</noOfUnitsSold><aggregateMarketValue>${value}</aggregateMarketValue><noOfUnitsOutstanding>${options.outstanding ?? "1000000"}</noOfUnitsOutstanding><approxSaleDate>${approxDate}</approxSaleDate><securitiesExchangeName>NYSE</securitiesExchangeName></securitiesInformation>`;
  const rows = options.multipleRows
    ? `${row("Common Stock", options.units ?? "1000", options.value ?? "20000", options.approxDate ?? "06/01/2026", options.broker ?? "Original Broker LLC")}${row("Common Stock", "2000", "40000", "06/02/2026", "Original Broker LLC")}`
    : row(options.classTitle ?? "Common Stock", options.units ?? "1000", options.value ?? "20000", options.approxDate ?? "06/01/2026", options.broker ?? "Original Broker LLC");
  const priorSalesBlock = options.noPriorSales
    ? ""
    : `<securitiesSoldInPast3Months><sellerDetails><name>Amend Seller</name></sellerDetails><securitiesClassTitle>Common Stock</securitiesClassTitle><saleDate>04/01/2026</saleDate><amountOfSecuritiesSold>${options.priorAmount ?? "500"}</amountOfSecuritiesSold><grossProceeds>10000</grossProceeds></securitiesSoldInPast3Months>`;
  const planDateBlock = options.omitPlanDate ? "" : `<planAdoptionDate>${options.planDate ?? "2026-01-01"}</planAdoptionDate>`;
  const relationshipBlock = options.relationship ? `<relationshipToIssuer>${options.relationship}</relationshipToIssuer>` : "";
  return `<?xml version="1.0"?><edgarSubmission><headerData><submissionType>${options.submissionType ?? "144/A"}</submissionType><previousAccessionNumber>0000000000-26-014500</previousAccessionNumber></headerData><formData><issuerInfo><issuerCik>0008888001</issuerCik><issuerName>Amend 144 Corp</issuerName><issuerTradingSymbol>A144C</issuerTradingSymbol><nameOfPersonForWhoseAccountTheSecuritiesAreToBeSold>${options.seller ?? "Amend Seller"}</nameOfPersonForWhoseAccountTheSecuritiesAreToBeSold>${relationshipBlock}</issuerInfo>${rows}<securitiesToBeSold><securitiesClassTitle>Common Stock</securitiesClassTitle><acquiredDate>01/01/2024</acquiredDate><natureOfAcquisitionTransaction>${options.acquisitionNature ?? "Restricted stock grant"}</natureOfAcquisitionTransaction><nameOfPersonfromWhomAcquired>Issuer</nameOfPersonfromWhomAcquired><amountOfSecuritiesAcquired>1000</amountOfSecuritiesAcquired><paymentDate>01/01/2024</paymentDate><natureOfPayment>Services</natureOfPayment></securitiesToBeSold><nothingToReportFlagOnSecuritiesSoldInPast3Months>${options.noPriorSales ? "Y" : "N"}</nothingToReportFlagOnSecuritiesSoldInPast3Months>${priorSalesBlock}<remarks>${options.remarks ?? "Original remarks."}</remarks><noticeSignature><noticeDate>05/20/2026</noticeDate>${planDateBlock}<signature>/s/ Amend Seller</signature></noticeSignature></formData></edgarSubmission>`;
}
