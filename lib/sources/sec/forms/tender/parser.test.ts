import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { SEC_TENDER_PARSER_VERSION, parseSecTenderArchiveSubmission, parseSecTenderFiling } from "./parser";
import { secTenderDeliveryLevelForScore, type SecTenderExpectedOutput, type SecTenderParseInput } from "./types";

type TenderFixture = {
  case_name: string;
  filing: SecTenderParseInput;
  market_context?: Record<string, unknown> | null;
  expected: {
    event_type: string;
    delivery_level: string;
    important_facts: Record<string, unknown>;
  };
};

type ArchiveSubmissionFixture = {
  case_name: string;
  source: {
    sec_archive_url: string;
  };
  submission_text: string;
  input: {
    rawItemId: string;
    sourceUrl: string;
    title: string;
    companyName: string;
  };
  expected: {
    form_type: string;
    min_document_count: number;
  };
};

const fixturesDir = join(process.cwd(), "lib", "sources", "sec", "forms", "tender", "fixtures");
const expectedDir = join(process.cwd(), "lib", "sources", "sec", "forms", "tender", "expected");

const issuerTender = parseSecTenderFiling(readFixture("issuer-tender-capital-return.json").filing);
assert.equal(issuerTender.parserGroup, "tender");
assert.equal(issuerTender.formType, "Tender / CB / 13E3");
assert.equal(issuerTender.isSupported, true);
assert.equal(issuerTender.facts.sec_form_type, "SC TO-I");
assert.equal(issuerTender.facts.tender_case, "issuer_tender_offer");
assert.equal(getPrice(issuerTender.facts.cash_price_per_share), 25);
assert.equal(getMoney(issuerTender.facts.aggregate_purchase_price), 50000000);
assert.equal(getDate(issuerTender.facts.expiration_date), "2026-06-20");
assert.equal(getMarketRequirements(issuerTender.facts).needed, true);
assert.equal(getArray(issuerTender.facts.source_documents).length, 1);
assert.equal(asRecord(getArray(issuerTender.facts.source_documents)[0]).role, "primary_form");

const thirdParty = parseSecTenderFiling(readFixture("third-party-acquisition-tender.json").filing);
assert.equal(thirdParty.facts.sec_form_type, "SC TO-T");
assert.equal(thirdParty.facts.tender_case, "third_party_tender_offer");
assert.equal(thirdParty.facts.target_company, "Alpine Data Systems Inc");
assert.equal(thirdParty.facts.offeror, "Summit Merger Sub Inc");
assert.equal(getPrice(thirdParty.facts.cash_price_per_share), 18.5);
assert.equal(getPercent(thirdParty.facts.premium_to_reference_price), 42);
assert.equal(getFieldValue(thirdParty.facts.board_recommendation), "recommend_tender");
assert.equal(getDate(thirdParty.facts.expiration_date), "2026-07-15");

const goingPrivate = parseSecTenderFiling(readFixture("schedule-13e3-going-private.json").filing);
assert.equal(goingPrivate.facts.sec_form_type, "SC 13E3");
assert.equal(goingPrivate.facts.tender_case, "going_private_13e3");
assert.equal(goingPrivate.facts.going_private, true);
assert.equal(getPrice(goingPrivate.facts.cash_price_per_share), 11.25);
assert.equal(getRouteHint(goingPrivate.facts).route_case, "going_private_13e3");
assert.equal(getRouteHint(goingPrivate.facts).analysis_bypass_candidate, false);

const crossBorder = parseSecTenderFiling(readFixture("schedule-cb-cross-border-exchange.json").filing);
assert.equal(crossBorder.facts.sec_form_type, "CB");
assert.equal(crossBorder.facts.tender_case, "schedule_cb_cross_border");
assert.equal(crossBorder.facts.cross_border, true);
assert.equal(getFieldValue(crossBorder.facts.consideration_type), "stock_or_security_exchange");
assert.ok(String(getFieldValue(crossBorder.facts.exchange_ratio)).includes("0.75 EuroMed plc ordinary shares"));
assert.equal(getDate(crossBorder.facts.expiration_date), "2026-08-03");

const materialAmendment = parseSecTenderFiling(readFixture("material-amendment-deadline-price.json").filing);
const materialAmendmentInfo = getAmendment(materialAmendment.facts);
assert.equal(materialAmendment.facts.sec_form_type, "SC TO-T/A");
assert.equal(materialAmendmentInfo.is_amendment, true);
assert.equal(getFieldValue(materialAmendmentInfo.amendment_number), 2);
assert.deepEqual(getSignalValues(materialAmendmentInfo.material_change_candidates), ["offer_price_change", "expiration_extension"]);
assert.equal(getPrice(materialAmendment.facts.cash_price_per_share), 20);
assert.equal(getDate(materialAmendment.facts.expiration_date), "2026-07-29");
assert.equal(getRouteHint(materialAmendment.facts).route_case, "material_amendment");
assert.equal(getRouteHint(materialAmendment.facts).analysis_bypass_candidate, false);

const routineAmendment = parseSecTenderFiling(readFixture("routine-amendment-deterministic.json").filing);
const routineAmendmentInfo = getAmendment(routineAmendment.facts);
assert.equal(routineAmendment.facts.sec_form_type, "SC TO-I/A");
assert.equal(routineAmendmentInfo.is_amendment, true);
assert.equal(getFieldValue(routineAmendmentInfo.amendment_number), 1);
assert.deepEqual(getSignalValues(routineAmendmentInfo.material_change_candidates), []);
assert.equal(getRoutineNoChangeCandidate(routineAmendmentInfo).is_candidate, true);
assert.equal(Array.isArray(getRoutineNoChangeCandidate(routineAmendmentInfo).source_evidence), true);
assert.equal(getRouteHint(routineAmendment.facts).route_case, "routine_amendment");
assert.equal(getRouteHint(routineAmendment.facts).analysis_bypass_candidate, false);
assert.equal(getRouteHint(routineAmendment.facts).router_must_decide_final_output, false);

const votingRightsRatioNoise = parseSecTenderFiling(readFixture("exchange-ratio-noise-voting-rights.json").filing);
assert.equal(votingRightsRatioNoise.facts.sec_form_type, "SC 13E3/A");
assert.equal(votingRightsRatioNoise.facts.tender_case, "going_private_13e3");
assert.equal(votingRightsRatioNoise.facts.exchange_ratio, null);

const cvrRatioNoise = parseSecTenderFiling(readFixture("exchange-ratio-noise-cvr-right.json").filing);
assert.equal(cvrRatioNoise.facts.sec_form_type, "SC TO-T");
assert.equal(cvrRatioNoise.facts.tender_case, "third_party_tender_offer");
assert.equal(cvrRatioNoise.facts.exchange_ratio, null);

const preComm = parseSecTenderFiling(minimalFiling("SC TO-C", `
SCHEDULE TO
[X] Check the box if the filing relates solely to preliminary communications made before the commencement of a tender offer.
Target Communications Inc.
(Name of Subject Company (Issuer))
Buyer Sub Inc.
(Name of Filing Person (Offeror))
This communication is being filed before commencement of a proposed tender offer.
`));
assert.equal(preComm.facts.tender_case, "tender_offer_communication");
assert.equal(asRecord(asRecord(preComm.facts.cover_page).checkbox_signals).pre_commencement_communication && asRecord(asRecord(asRecord(preComm.facts.cover_page).checkbox_signals).pre_commencement_communication).checked, true);
assert.equal(asRecord(getAmendment(preComm.facts).amendment_classification).type, "pre_commencement_communication_only");
assert.equal(asRecord(preComm.facts.parser_only_routing_hints).analysis_bypass_candidate, false);
assert.equal(preComm.facts.deterministic_classification, undefined);
assert.equal(preComm.facts.suggested_display_payload, undefined);

const checkboxAwareThirdParty = parseSecTenderFiling(minimalFiling("SC TO-T", `
SCHEDULE TO
[ ] Check the box if the filing relates solely to preliminary communications made before the commencement of a tender offer.
[X] third-party tender offer subject to Rule 14d-1.
[ ] issuer tender offer subject to Rule 13e-4.
[ ] going private transaction subject to Rule 13e-3
[ ] Rule 14d-1(d) (Cross-Border Third-Party Tender Offer)
Full Target Inc.
(Name of Subject Company (Issuer))
Full Buyer Inc.
(Name of Filing Person (Offeror))
Common stock
(Title of Class of Securities)
123456789
(CUSIP Number of Class of Securities)
Full Buyer Inc. offers to purchase up to $150,000,000 in aggregate amount of shares of Full Target Inc. at a price equal to $11.00 per share. The offer will expire on June 30, 2026.
`));
assert.equal(checkboxAwareThirdParty.facts.tender_case, "third_party_tender_offer");
assert.equal(checkboxAwareThirdParty.facts.going_private, false);
assert.equal(checkboxAwareThirdParty.facts.cross_border, false);
assert.equal(checkboxAwareThirdParty.facts.target_company, "Full Target Inc");
assert.equal(checkboxAwareThirdParty.facts.offeror, "Full Buyer Inc");
assert.equal(getPrice(checkboxAwareThirdParty.facts.cash_price_per_share), 11);
assert.equal(getMoney(checkboxAwareThirdParty.facts.aggregate_purchase_price), 150000000);
assert.equal(getDate(checkboxAwareThirdParty.facts.expiration_date), "2026-06-30");
assert.equal(getCoverString(checkboxAwareThirdParty, "security_class"), "Common stock");
assert.equal(getCoverString(checkboxAwareThirdParty, "cusip"), "123456789");

const extensionOnly = parseSecTenderFiling(minimalFiling("SC TO-T/A", `
SCHEDULE TO
(Amendment No. 1)
[X] third-party tender offer subject to Rule 14d-1.
Extension Target Inc.
(Name of Subject Company (Issuer))
Buyer Inc.
(Name of Filing Person (Offeror))
This Amendment No. 1 extends the expiration of the tender offer to July 15, 2026. Except for the extension, all other terms of the offer remain unchanged.
`));
assert.equal(asRecord(getAmendment(extensionOnly.facts).amendment_classification).type, "extension_only");
assert.equal(asRecord(extensionOnly.facts.parser_only_routing_hints).analysis_bypass_candidate, false);

const finalResultsOnly = parseSecTenderFiling(minimalFiling("SC TO-T/A", `
SCHEDULE TO
(Amendment No. 2)
[X] third-party tender offer subject to Rule 14d-1.
Check the following box if the filing is a final amendment reporting the results of the tender offer: [X]
Results Target Inc.
(Name of Subject Company (Issuer))
Buyer Inc.
(Name of Filing Person (Offeror))
The depositary has advised that 8,000,000 shares were validly tendered and not withdrawn. Purchaser accepted the shares for payment.
`));
assert.equal(asRecord(getAmendment(finalResultsOnly.facts).amendment_classification).type, "final_results_only");
assert.equal(asRecord(finalResultsOnly.facts.parser_only_routing_hints).analysis_bypass_candidate, false);

const combinedTo13e3 = parseSecTenderFiling(minimalFiling("SC TO-T", `
SCHEDULE TO
[X] third-party tender offer subject to Rule 14d-1.
[X] going private transaction subject to Rule 13e-3
Combined Target Inc.
(Name of Subject Company (Issuer))
Affiliate Buyer Inc.
(Name of Filing Person (Offeror))
Special Factors
The transaction may result in deregistration of the shares.
Fairness of the Transaction
The special committee considered fairness materials.
Reports, Opinions, Appraisals and Negotiations
A financial advisor delivered a fairness opinion.
`));
assert.equal(combinedTo13e3.facts.tender_case, "third_party_tender_offer");
assert.equal(combinedTo13e3.facts.combined_schedule_to_13e3, true);
assert.equal(combinedTo13e3.facts.going_private, true);
assert.equal(combinedTo13e3.facts.special_factors_section_present, true);
assert.equal(combinedTo13e3.facts.fairness_section_present, true);
assert.equal(combinedTo13e3.facts.reports_opinions_appraisals_section_present, true);

const schedule13e3ParserOnlyCheck = parseSecTenderFiling(minimalFiling("SC 13E3", `
SCHEDULE 13E-3
Going-private transaction statement.
Issuer 13E3 Inc.
(Name of the Issuer)
Special Factors
The filing describes special factors.
Fairness of the Transaction
The filing describes fairness considerations.
`));
assert.equal(schedule13e3ParserOnlyCheck.facts.tender_case, "going_private_13e3");
assert.equal(schedule13e3ParserOnlyCheck.facts.going_private, true);
assert.equal(asRecord(schedule13e3ParserOnlyCheck.facts.parser_only_routing_hints).analysis_bypass_candidate, false);
assert.equal(schedule13e3ParserOnlyCheck.facts.deterministic_classification, undefined);
assert.equal(schedule13e3ParserOnlyCheck.facts.suggested_display_payload, undefined);

const formCb = parseSecTenderFiling(minimalFiling("CB", `
FORM CB
[X] Rule 802 exchange offer or business combination.
CB Target plc
(Name of Subject Company)
Foreign Offeror Ltd.
(Name of Person(s) Furnishing Form)
The home jurisdiction document includes an English translation.
`));
assert.equal(formCb.facts.tender_case, "schedule_cb_cross_border");
assert.equal(asRecord(asRecord(formCb.facts.cover_page).form_cb).transaction_type, "exchange_offer_or_business_combination");
assert.equal(asRecord(asRecord(formCb.facts.cover_page).form_cb).home_jurisdiction_document_present, true);
assert.equal(asRecord(asRecord(formCb.facts.cover_page).form_cb).english_translation_or_summary_present, true);

const formCbAmendment = parseSecTenderFiling(minimalFiling("CB/A", `
FORM CB/A
Amendment No. 1
[X] Rule 13e-4(h)(8) issuer tender offer.
CB Issuer Ltd.
(Name of Subject Company)
The amendment furnishes an updated home jurisdiction document.
`));
assert.equal(formCbAmendment.facts.sec_form_type, "CB/A");
assert.equal(getAmendment(formCbAmendment.facts).is_amendment, true);
assert.equal(asRecord(asRecord(formCbAmendment.facts.cover_page).form_cb).transaction_type, "issuer_tender_offer");

const uncheckedScheduleToOptions = parseSecTenderFiling(minimalFiling("SC TO-T", `
SCHEDULE TO
<table><tr><td>x</td><td>third-party tender offer subject to Rule 14d-1.</td></tr></table>
<table><tr><td></td><td>going private transaction subject to Rule 13e-3</td></tr></table>
[ ] Rule 14d-1(d) (Cross-Border Third-Party Tender Offer)
Unchecked Options Target Inc.
(Name of Subject Company (Issuer))
Buyer Inc.
(Name of Filing Person (Offeror))
`));
assert.equal(uncheckedScheduleToOptions.facts.tender_case, "third_party_tender_offer");
assert.equal(uncheckedScheduleToOptions.facts.going_private, false);
assert.equal(uncheckedScheduleToOptions.facts.cross_border, false);
assert.equal(getCoverSignal(uncheckedScheduleToOptions, "third_party_tender").checked, true);
assert.equal(getCoverSignal(uncheckedScheduleToOptions, "going_private_13e3").checked, false);
assert.equal(getCoverSignal(uncheckedScheduleToOptions, "cross_border_third_party").checked, false);

const formCbCheckedOnly = parseSecTenderFiling(minimalFiling("CB", `
FORM CB
[ ] Rule 801 rights offering.
[X] Rule 802 exchange offer or business combination.
[ ] Rule 13e-4(h)(8) issuer tender offer.
[ ] Rule 14d-1(c) third-party tender offer.
[ ] Rule 14e-2(d) subject company response.
[ ] Rule 13e-3(g)(6) going-private transaction.
CB Checked Only plc
(Name of Subject Company)
Instructions refer to Form F-X but no Form F-X document is included.
`));
assert.equal(asRecord(asRecord(formCbCheckedOnly.facts.cover_page).form_cb).transaction_type, "exchange_offer_or_business_combination");
assert.equal(getCoverSignal(formCbCheckedOnly, "cb_rule_801_rights_offering").checked, false);
assert.equal(getCoverSignal(formCbCheckedOnly, "cb_rule_802_exchange_offer").checked, true);
assert.equal(asRecord(asRecord(formCbCheckedOnly.facts.cover_page).form_cb).form_fx_present, false);

const schedule13e3UncheckedMethods = parseSecTenderFiling(minimalFiling("SC 13E3", `
SCHEDULE 13E-3
[ ] purchase of securities
[ ] tender offer
[ ] merger
[ ] sale of assets
Special Factors
The filing lists transaction method options on the cover page.
Fairness of the Transaction
Fairness is discussed.
`));
assert.equal(schedule13e3UncheckedMethods.facts.tender_case, "going_private_13e3");
assert.equal(asRecord(schedule13e3UncheckedMethods.facts.parser_only_routing_hints).analysis_bypass_candidate, false);

const extensionWithConditionWaiver = parseSecTenderFiling(minimalFiling("SC TO-T/A", `
SCHEDULE TO
(Amendment No. 3)
[X] third-party tender offer subject to Rule 14d-1.
This Amendment extends the expiration of the offer to July 15, 2026 and waived the minimum tender condition.
`));
assert.equal(asRecord(getAmendment(extensionWithConditionWaiver.facts).amendment_classification).type, "substantive_amendment_likely");
assert.equal(asRecord(extensionWithConditionWaiver.facts.parser_only_routing_hints).analysis_bypass_candidate, false);

const finalResultsWithPriceChange = parseSecTenderFiling(minimalFiling("SC TO-T/A", `
SCHEDULE TO
(Amendment No. 4)
Check the following box if the filing is a final amendment reporting the results of the tender offer: [X]
The offer price was increased to $12.00 per share and the depositary has advised that 1,000,000 shares were tendered and not withdrawn.
`));
assert.equal(asRecord(getAmendment(finalResultsWithPriceChange.facts).amendment_classification).type, "substantive_amendment_likely");

const tenderedSharesWithRecommendationChange = parseSecTenderFiling(minimalFiling("SC TO-T/A", `
SCHEDULE TO
(Amendment No. 5)
Approximately 2,000,000 shares were validly tendered. The board recommendation changed and the special committee no longer recommends tendering.
`));
assert.equal(asRecord(getAmendment(tenderedSharesWithRecommendationChange.facts).amendment_classification).type, "substantive_amendment_likely");

const exhibitOnlyWithSubstantiveAgreement = parseSecTenderFiling(minimalFiling("SC 13E3/A", `
SCHEDULE 13E-3
(Amendment No. 6)
This Amendment is filed solely to add an exhibit. The merger agreement was amended and a fairness opinion was added.
`));
assert.equal(asRecord(getAmendment(exhibitOnlyWithSubstantiveAgreement.facts).amendment_classification).type, "substantive_amendment_likely");
assert.equal(asRecord(exhibitOnlyWithSubstantiveAgreement.facts.parser_only_routing_hints).analysis_bypass_candidate, false);

const final13e3Mechanical = parseSecTenderFiling(minimalFiling("SC 13E3/A", `
SCHEDULE 13E-3
(Amendment No. 7)
This final amendment reports completion of the transaction. The merger was completed and shares were accepted for payment.
`));
assert.equal(asRecord(getAmendment(final13e3Mechanical.facts).amendment_classification).type, "final_results_only");
assert.equal(asRecord(final13e3Mechanical.facts.parser_only_routing_hints).analysis_bypass_candidate, false);

const headingVariants = parseSecTenderFiling(minimalFiling("SC 13E3", `
SCHEDULE 13E-3
ITEM 4 TERMS OF THE TRANSACTION
Brief terms only.
Item 7 — Source and Amount of Funds or Other Consideration
Funding source summary.
Fairness of the Going-Private Transaction
Fairness summary.
Recommendation of the Board of Directors
Recommendation summary.
Interests of Certain Persons
Interests summary.
`));
const headingKeys = getArray(headingVariants.facts.heading_sections).map((section) => String(asRecord(section).key));
assert.ok(headingKeys.includes("terms_of_transaction"));
assert.ok(headingKeys.includes("source_and_amount_of_funds"));
assert.ok(headingKeys.includes("fairness_of_transaction"));
assert.ok(headingKeys.includes("recommendation_of_board"));
assert.ok(headingKeys.includes("interests_of_directors"));
assert.ok(getArray(headingVariants.facts.heading_sections).every((section) => String(asRecord(section).evidence).length <= 700));

const partyExtraction = parseSecTenderFiling(minimalFiling("SC TO-T", `
SCHEDULE TO
[X] third-party tender offer subject to Rule 14d-1.
Party Target Inc.
(Name of Subject Company (Issuer))
Buyer Parent LLC and Merger Sub Inc.
(Name of Filing Persons (Offerors))
Parent: Buyer Parent LLC
Purchaser: Merger Sub Inc.
The Depositary is Trust Company N.A. The financial advisor is Great Bank LLC.
`));
assert.equal(partyExtraction.facts.offeror, "Buyer Parent LLC and Merger Sub Inc");
assert.equal(getFieldValue(asRecord(partyExtraction.facts.party_extraction).parent), "Buyer Parent LLC");
assert.equal(getFieldValue(asRecord(partyExtraction.facts.party_extraction).merger_sub), "Merger Sub Inc");
assert.ok(getArray(asRecord(partyExtraction.facts.party_extraction).ignored_agent_candidates).some((item) => String(getFieldValue(item)).includes("Trust Company")));

const ambiguousParty = parseSecTenderFiling(minimalFiling("SC TO-T", `
SCHEDULE TO
[X] third-party tender offer subject to Rule 14d-1.
Ambiguous Target Inc.
(Name of Subject Company (Issuer))
The Depositary is Trust Company N.A. The dealer manager is Dealer Bank LLC.
`));
assert.ok(getArray(ambiguousParty.warnings).includes("party_extraction_ambiguous_agent_not_offeror"));
assert.equal(ambiguousParty.facts.offeror, null);

const formCbPartyJurisdiction = parseSecTenderFiling(minimalFiling("CB", `
FORM CB
[X] Rule 802 exchange offer or business combination.
CB Party plc
(Name of Subject Company)
Foreign Offeror Ltd.
(Name of Person(s) Furnishing Form)
The subject company is a foreign private issuer incorporated under the laws of England and Wales.
`));
assert.equal(getFieldValue(asRecord(asRecord(formCbPartyJurisdiction.facts.cover_page).form_cb).person_furnishing_form), "Foreign Offeror Ltd");
assert.ok(String(getFieldValue(asRecord(asRecord(formCbPartyJurisdiction.facts.cover_page).form_cb).foreign_issuer_or_jurisdiction)).includes("foreign private issuer"));

const securityIdentifiers = parseSecTenderFiling(minimalFiling("SC TO-T", `
SCHEDULE TO
[X] third-party tender offer subject to Rule 14d-1.
Identifier Target Inc.
(Name of Subject Company (Issuer))
American Depositary Shares, each representing two ordinary shares
(Title of Class of Securities)
123456789
(CUSIP Number of Class of Securities)
Trading Symbol: IDTG
`));
assert.equal(getCoverString(securityIdentifiers, "security_class"), "American Depositary Shares, each representing two ordinary shares");
assert.equal(getCoverString(securityIdentifiers, "cusip"), "123456789");
assert.equal(getFieldValue(asRecord(securityIdentifiers.facts.security_identifiers).ticker_symbol), "IDTG");

const noCusipFalsePositive = parseSecTenderFiling(minimalFiling("SC TO-T", `
SCHEDULE TO
[X] third-party tender offer subject to Rule 14d-1.
Commission File No. 001-12345
Telephone: 212-555-1212
(CUSIP Number of Class of Securities)
`));
assert.equal(asRecord(noCusipFalsePositive.facts.cover_page).cusip, null);

const offerEconomicsCash = parseSecTenderFiling(minimalFiling("SC TO-T", `
SCHEDULE TO
[X] third-party tender offer subject to Rule 14d-1.
The offer is for $12.50 per share in cash, net to the seller in cash, without interest and less any applicable withholding taxes.
`));
assert.equal(getPrice(offerEconomicsCash.facts.cash_price_per_share), 12.5);
assert.ok(String(asRecord(offerEconomicsCash.facts.cash_price_per_share).evidence).includes("net to the seller"));

const offerEconomicsMixed = parseSecTenderFiling(minimalFiling("CB", `
FORM CB
[X] Rule 802 exchange offer or business combination.
Holders will receive $5.00 in cash plus 0.25 Buyer plc ordinary shares for each Target ordinary share and one CVR.
`));
assert.equal(getFieldValue(offerEconomicsMixed.facts.consideration_type), "mixed_cash_stock");
assert.ok(String(getFieldValue(offerEconomicsMixed.facts.exchange_ratio)).includes("0.25 Buyer plc ordinary shares"));
assert.ok(asRecord(offerEconomicsMixed.facts.offer_economics).cvr_or_contingent_value_right);

const dutchAuction = parseSecTenderFiling(minimalFiling("SC TO-I", `
SCHEDULE TO
[X] issuer tender offer subject to Rule 13e-4.
The issuer is conducting a modified Dutch auction tender offer with a price range of $10.00 to $12.00 per share.
`));
assert.equal(asRecord(asRecord(asRecord(dutchAuction.facts.offer_economics).dutch_auction_range).value).low, 10);
assert.equal(asRecord(asRecord(asRecord(dutchAuction.facts.offer_economics).dutch_auction_range).value).high, 12);

const priceNoise = parseSecTenderFiling(minimalFiling("SC TO-T", `
SCHEDULE TO
[X] third-party tender offer subject to Rule 14d-1.
Filing Fee Table: transaction valuation is $100,000,000. Source and Amount of Funds: debt commitment of $250,000,000.
The fairness opinion reviewed a valuation range of $8.00 to $14.00 per share.
`));
assert.equal(priceNoise.facts.cash_price_per_share, null);

const priceConflict = parseSecTenderFiling(minimalFiling("SC TO-T", `
SCHEDULE TO
[X] third-party tender offer subject to Rule 14d-1.
Summary Term Sheet: The offer price is $12.00 per share.
Terms of the Offer: The purchase price is $13.00 per share.
`));
assert.equal(getPrice(priceConflict.facts.cash_price_per_share), 12);
assert.ok(getArray(priceConflict.warnings).includes("conflicting_offer_price_candidates"));
assert.ok(getArray(asRecord(priceConflict.facts.offer_economics).conflicting_price_candidates).length >= 2);

const dateExtraction = parseSecTenderFiling(minimalFiling("SC TO-T/A", `
SCHEDULE TO
(Amendment No. 1)
The offer has been extended to one minute after 11:59 p.m., Eastern Time, on July 15, 2026, unless further extended.
Withdrawal rights may be exercised until 5:00 p.m., Eastern time, on July 14, 2026.
The Merger Agreement dated May 1, 2026 is attached. /s/ Officer August 1, 2026
`));
assert.equal(getDate(dateExtraction.facts.expiration_date), "2026-07-15");
assert.ok(String(getFieldValue(asRecord(dateExtraction.facts.tender_dates).expiration_time)).includes("11:59 p.m."));
assert.equal(getDate(dateExtraction.facts.withdrawal_deadline), "2026-07-14");

const conditionSignals = parseSecTenderFiling(minimalFiling("SC TO-T/A", `
SCHEDULE TO
(Amendment No. 2)
The offer is not subject to a financing condition.
The minimum tender condition has been satisfied.
The HSR Act waiting period and antitrust approval remain conditions.
The offer includes a no material adverse effect condition.
Purchaser waived the minimum tender condition.
Offeror reserves the right to waive conditions in its discretion.
`));
const conditionFacts = asRecord(conditionSignals.facts.tender_condition_signals);
assert.ok(conditionFacts.no_financing_condition);
assert.equal(conditionFacts.financing_condition, null);
assert.ok(conditionFacts.minimum_tender_condition);
assert.ok(conditionFacts.condition_satisfaction);
assert.ok(conditionFacts.condition_waiver);
assert.ok(conditionFacts.hsr_condition);
assert.ok(conditionFacts.no_mae_condition);

const finalResultsExtraction = parseSecTenderFiling(minimalFiling("SC TO-T/A", `
SCHEDULE TO
(Amendment No. 3)
This final amendment reports the results of the tender offer.
The depositary has advised that 8,000,000 shares, representing 82.5% of the outstanding shares, were validly tendered and not withdrawn.
Purchaser accepted for payment 8,000,000 shares. The final proration factor was 76.4%. The offer expired at 5:00 p.m., New York City time, on August 5, 2026.
The company had 10,000,000 shares outstanding before the offer.
`));
const finalFacts = asRecord(finalResultsExtraction.facts.final_results);
assert.equal(asRecord(asRecord(finalFacts.shares_tendered).value).count, 8000000);
assert.equal(asRecord(asRecord(finalFacts.shares_accepted_for_payment).value).count, 8000000);
assert.equal(getFieldValue(finalFacts.percentage_tendered), 82.5);
assert.equal(getFieldValue(finalFacts.final_proration_factor), 76.4);
assert.equal(asRecord(getAmendment(finalResultsExtraction.facts).amendment_classification).type, "final_results_only");

const schedule13e3Facts = parseSecTenderFiling(minimalFiling("SC 13E3", `
SCHEDULE 13E-3
Special Factors
The special committee considered the interests of unaffiliated security holders.
Purpose, Alternatives, Reasons and Effects
The transaction may result in delisting and deregistration.
Fairness of the Going-Private Transaction
The board received a fairness opinion.
Reports, Opinions, Appraisals and Negotiations
Source and Amount of Funds or Other Consideration
The merger is conditioned on approval by a majority of unaffiliated shares.
`));
const e3Flags = asRecord(schedule13e3Facts.facts.schedule_13e3_flags);
assert.ok(e3Flags.special_factors);
assert.ok(e3Flags.fairness_of_transaction);
assert.ok(e3Flags.unaffiliated_security_holders);
assert.ok(e3Flags.special_committee);
assert.ok(e3Flags.majority_of_minority_condition);
assert.ok(e3Flags.delisting_deregistration_going_private);
assert.equal(asRecord(schedule13e3Facts.facts.parser_only_routing_hints).analysis_bypass_candidate, false);

const realisticEdgarHtml = parseSecTenderFiling({
  ...minimalFiling(
    "SC TO-T",
    `
<html><body>
<table><tr><td>&nbsp;</td><td>issuer tender offer subject to Rule 13e-4.</td></tr><tr><td>x</td><td>third-party tender offer subject to Rule 14d-1.</td></tr><tr><td>&nbsp;</td><td>going private transaction subject to Rule 13e-3</td></tr></table>
<table><tr><td>ITEM&nbsp;4</td><td>TERMS OF THE TRANSACTION</td></tr></table>
<table><tr><td>Conditions&nbsp;of&nbsp;the&nbsp;Offer</td></tr><tr><td>The Offer is not subject to a financing condition.</td></tr></table>
HTML Target Inc.
(Name of Subject Company (Issuer))
HTML Buyer Inc.
(Name of Filing Person (Offeror))
Common Stock
(Title of Class of Securities)
987654321
(CUSIP Number of Class of Securities)
The offer price is $14.00 per share, net to the seller in cash.
</body></html>
`,
  ),
  rawPayload: {
    form_type: "SC TO-T",
    documents: [
      { sequence: 1, type: "SC TO-T", description: "SC TO-T", document: "primary.htm", isPrimary: true, textCharCount: 2000 },
      { sequence: 2, type: "EX-99.(a)(1)(A)", description: "Offer to Purchase", document: "offer.htm", textCharCount: 1000 },
      { sequence: 3, type: "EX-99.(a)(1)(B)", description: "Letter of Transmittal", document: "letter.htm", textCharCount: 1000 },
      { sequence: 4, type: "EX-99.(d)(1)", description: "Agreement and Plan of Merger", document: "merger.htm", textCharCount: 1000 },
      { sequence: 5, type: "EX-99.(c)(1)", description: "Opinion of Financial Advisor", document: "opinion.htm", textCharCount: 1000 },
      { sequence: 6, type: "EX-99.(a)(5)", description: "Press Release", document: "press.htm", textCharCount: 1000 },
    ],
  },
});
assert.equal(realisticEdgarHtml.facts.tender_case, "third_party_tender_offer");
assert.equal(realisticEdgarHtml.facts.going_private, false);
assert.equal(getPrice(realisticEdgarHtml.facts.cash_price_per_share), 14);
assert.equal(getCoverString(realisticEdgarHtml, "cusip"), "987654321");
assertRoles(realisticEdgarHtml, ["offer_document", "letter_of_transmittal", "transaction_agreement", "fairness_or_presentation", "press_release"]);
assert.ok(getArray(realisticEdgarHtml.facts.heading_sections).some((section) => String(asRecord(section).key) === "terms_of_transaction"));
assert.equal(countWarnings(realisticEdgarHtml, "checkbox_state_uncertain:going_private_13e3"), 0);

const combinedRealisticCover = parseSecTenderFiling(minimalFiling("SC TO-T", `
SCHEDULE TO / SCHEDULE 13E-3
[X] third-party tender offer subject to Rule 14d-1.
[X] going private transaction subject to Rule 13e-3
Combined Real Target Inc.
(Name of Subject Company (Issuer))
Special Factors
The going-private transaction is described.
`));
assert.equal(combinedRealisticCover.facts.combined_schedule_to_13e3, true);
assert.equal(asRecord(combinedRealisticCover.facts.parser_only_routing_hints).analysis_bypass_candidate, false);

const formCbRealisticPackage = parseSecTenderFiling({
  ...minimalFiling("CB", `
FORM CB
<table><tr><td></td><td>Rule 801 rights offering.</td></tr><tr><td>x</td><td>Rule 802 exchange offer or business combination.</td></tr><tr><td></td><td>Rule 13e-4(h)(8) issuer tender offer.</td></tr></table>
CB Real Target plc
(Name of Subject Company)
CB Furnisher Ltd.
(Name of Person(s) Furnishing Form)
`),
  rawPayload: {
    form_type: "CB",
    documents: [
      { sequence: 1, type: "CB", description: "CB", document: "primary.htm", isPrimary: true, textCharCount: 800 },
      { sequence: 2, type: "EX-99", description: "Home Jurisdiction Document", document: "scheme-booklet.htm", textCharCount: 1000 },
      { sequence: 3, type: "EX-99", description: "English Summary", document: "english-summary.htm", textCharCount: 500 },
      { sequence: 4, type: "F-X", description: "Form F-X", document: "form-fx.htm", textCharCount: 500 },
    ],
  },
});
assert.equal(asRecord(asRecord(formCbRealisticPackage.facts.cover_page).form_cb).transaction_type, "exchange_offer_or_business_combination");
assert.equal(asRecord(asRecord(formCbRealisticPackage.facts.cover_page).form_cb).home_jurisdiction_document_present, true);
assert.equal(asRecord(asRecord(formCbRealisticPackage.facts.cover_page).form_cb).english_translation_or_summary_present, true);
assert.equal(asRecord(asRecord(formCbRealisticPackage.facts.cover_page).form_cb).form_fx_present, true);
assert.equal(formCbRealisticPackage.facts.issuer_tender, false);

const emptyPackage = parseSecTenderFiling({
  rawItemId: "empty-package",
  sourceUniqueId: "empty-package",
  sourceUrl: "https://www.sec.gov/empty",
  title: "",
  publishedAt: "2026-05-25T00:00:00.000Z",
  bodyText: "",
  rawPayload: { documents: [] },
});
assert.equal(emptyPackage.isSupported, false);
assert.ok(getArray(emptyPackage.warnings).includes("no_document_inventory"));
assert.ok(getArray(emptyPackage.warnings).includes("primary_document_not_identified"));
assert.ok(getArray(emptyPackage.warnings).includes("primary_text_not_available"));
assert.equal(emptyPackage.facts.cash_price_per_share, null);

const messyPackage = parseSecTenderFiling({
  rawItemId: "messy-package",
  sourceUniqueId: "messy-package",
  sourceUrl: "https://www.sec.gov/messy",
  title: "Messy SC TO-T/A",
  publishedAt: "2026-05-25T00:00:00.000Z",
  bodyText: "SC TO-T/A\nSCHEDULE TO\n(Amendment No. 9)\nThis Amendment No. 9 amends and supplements the Schedule TO.",
  rawPayload: {
    form_type: "SC TO-T/A",
    documents: [
      { sequence: 1, type: "SC TO-T/A", document: "primary.htm", isPrimary: true, textCharCount: 120 },
      { sequence: 2, type: "EX-99", document: "exhibit-no-description.htm", textCharCount: 0 },
      { sequence: 3, type: "EX-99", description: "Press Release", document: "press-1.htm", textCharCount: 0 },
      { sequence: 4, type: "EX-99", description: "Press Release", document: "press-2.htm", textCharCount: 0 },
    ],
  },
});
assert.equal(asRecord(getAmendment(messyPackage.facts).amendment_classification).type, "amendment_uncertain");
assert.ok(getArray(messyPackage.warnings).includes("exhibits_present_without_attachment_text"));
assert.equal(messyPackage.facts.cash_price_per_share, null);

const coverOnlyPrimary = parseSecTenderFiling(minimalFiling("SC TO-I", `
SCHEDULE TO
[X] issuer tender offer subject to Rule 13e-4.
Cover Only Issuer Inc.
(Name of Subject Company (Issuer))
`));
assert.equal(coverOnlyPrimary.facts.tender_case, "issuer_tender_offer");
assert.equal(coverOnlyPrimary.facts.cash_price_per_share, null);

const formCbCoverOnly = parseSecTenderFiling(minimalFiling("CB", `
FORM CB
[ ] Rule 801 rights offering.
[X] Rule 13e-4(h)(8) issuer tender offer.
[ ] Rule 802 exchange offer or business combination.
`));
assert.equal(asRecord(asRecord(formCbCoverOnly.facts.cover_page).form_cb).transaction_type, "issuer_tender_offer");
assert.equal(asRecord(asRecord(formCbCoverOnly.facts.cover_page).form_cb).english_translation_or_summary_present, false);
assert.equal(countWarnings(formCbCoverOnly, "checkbox_state_uncertain:issuer_tender"), 0);

const sparse13e3 = parseSecTenderFiling(minimalFiling("SC 13E3", `
SCHEDULE 13E-3
SPECIAL FACTORS
Only this heading is available in the source text.
`));
assert.equal(sparse13e3.facts.tender_case, "going_private_13e3");
assert.equal(sparse13e3.facts.fairness_section_present, false);
assert.equal(asRecord(sparse13e3.facts.parser_only_routing_hints).analysis_bypass_candidate, false);

const longConditions = parseSecTenderFiling(minimalFiling("SC TO-T", `
SCHEDULE TO
[X] third-party tender offer subject to Rule 14d-1.
Conditions of the Offer
The minimum tender condition applies. ${"Forward-looking statements and procedural boilerplate. ".repeat(250)}
The offer is not subject to a financing condition.
`));
const longConditionSections = getArray(longConditions.facts.heading_sections);
assert.ok(longConditionSections.every((section) => String(asRecord(section).evidence).length <= 700));
assert.ok(String(asRecord(asRecord(longConditions.facts.tender_condition_signals).minimum_tender_condition).evidence).length <= 700);

const longPressRelease = parseSecTenderFiling({
  ...minimalFiling("SC TO-T", "SC TO-T\n[X] third-party tender offer subject to Rule 14d-1."),
  rawPayload: {
    form_type: "SC TO-T",
    documents: [
      { sequence: 1, type: "SC TO-T", description: "SC TO-T", document: "primary.htm", isPrimary: true, textCharCount: 100 },
      { sequence: 2, type: "EX-99", description: "Press Release", document: "press.htm", text: `Press Release\n${"Offer terms boilerplate. ".repeat(300)}`, textCharCount: 7000 },
    ],
  },
});
assertRoles(longPressRelease, ["press_release"]);
assert.ok(String(asRecord(asRecord(longPressRelease.raw.source_package).text).primary_excerpt).length <= 900);

const repeatedBoilerplate = parseSecTenderFiling(minimalFiling("SC TO-T", `
SCHEDULE TO
[X] third-party tender offer subject to Rule 14d-1.
${"[ ] going private transaction subject to Rule 13e-3\n".repeat(20)}
The offer price is $16.00 per share.
`));
assert.equal(countWarnings(repeatedBoilerplate, "checkbox_state_uncertain:going_private_13e3"), 0);
assert.equal(getArray(repeatedBoilerplate.warnings).length, new Set(getArray(repeatedBoilerplate.warnings).map(String)).size);

const amendmentSupplementOnly = parseSecTenderFiling(minimalFiling("SC TO-T/A", `
SCHEDULE TO
(Amendment No. 2)
This Amendment No. 2 amends and supplements the Schedule TO.
`));
assert.equal(asRecord(getAmendment(amendmentSupplementOnly.facts).amendment_classification).type, "amendment_uncertain");

const amendmentWaivesMinimum = parseSecTenderFiling(minimalFiling("SC TO-T/A", `
SCHEDULE TO
(Amendment No. 3)
This Amendment amends the Offer to Purchase to waive the Minimum Condition.
`));
assert.equal(asRecord(getAmendment(amendmentWaivesMinimum.facts).amendment_classification).type, "substantive_amendment_likely");

const amendmentIncreasesPrice = parseSecTenderFiling(minimalFiling("SC TO-T/A", `
SCHEDULE TO
(Amendment No. 4)
The Amendment increases the offer price from $10.00 to $12.00 per share.
`));
assert.equal(asRecord(getAmendment(amendmentIncreasesPrice.facts).amendment_classification).type, "substantive_amendment_likely");

const amendedMergerAgreementExhibit = parseSecTenderFiling(minimalFiling("SC 13E3/A", `
SCHEDULE 13E-3
(Amendment No. 5)
This Amendment is filed solely to add an exhibit: Agreement and Plan of Merger, as amended and restated.
`));
assert.equal(asRecord(getAmendment(amendedMergerAgreementExhibit.facts).amendment_classification).type, "substantive_amendment_likely");

const scToICashPrice = parseSecTenderFiling(minimalFiling("SC TO-I", `
SCHEDULE TO
[X] issuer tender offer subject to Rule 13e-4.
The Company offers to purchase shares at an offer price of $21.00 per share in cash.
`));
const scToTCashPrice = parseSecTenderFiling(minimalFiling("SC TO-T", `
SCHEDULE TO
[X] third-party tender offer subject to Rule 14d-1.
Purchaser offers to purchase shares at an offer price of $21.00 per share in cash.
`));
assert.equal(getPrice(scToICashPrice.facts.cash_price_per_share), 21);
assert.equal(getPrice(scToTCashPrice.facts.cash_price_per_share), 21);

const ordinary13e3FinalWords = parseSecTenderFiling(minimalFiling("SC 13E3", `
SCHEDULE 13E-3
Background of the Offer
The background discusses final negotiations and possible transaction completion.
Special Factors
Fairness of the Transaction
`));
assert.equal(asRecord(ordinary13e3FinalWords.facts.parser_only_routing_hints).analysis_bypass_candidate, false);

const preCommWithSubstantiveTerms = parseSecTenderFiling(minimalFiling("SC TO-C", `
SCHEDULE TO
[X] Check the box if the filing relates solely to preliminary communications made before the commencement of a tender offer.
The communication announces that the offer price was increased and the minimum condition was waived.
`));
assert.equal(asRecord(getAmendment(preCommWithSubstantiveTerms.facts).amendment_classification).type, "initial_filing");
assert.equal(asRecord(preCommWithSubstantiveTerms.facts.parser_only_routing_hints).analysis_bypass_candidate, false);

const largeSyntheticBody = `SCHEDULE TO\n[X] third-party tender offer subject to Rule 14d-1.\nThe offer price is $18.00 per share.\nConditions of the Offer\n${"The minimum tender condition applies. ".repeat(2000)}`;
const largeStart = Date.now();
const largeSynthetic = parseSecTenderFiling(minimalFiling("SC TO-T", largeSyntheticBody));
assert.equal(getPrice(largeSynthetic.facts.cash_price_per_share), 18);
assert.ok(Date.now() - largeStart < 2_000);
assert.ok(getArray(largeSynthetic.facts.heading_sections).every((section) => String(asRecord(section).evidence).length <= 700));

const genericExhibitReview = parseSecTenderFiling(readFixture("raw-audit-generic-exhibit-review.json").filing);
const genericExhibitAudit = asRecord(genericExhibitReview.facts.raw_data_audit);
assert.equal(genericExhibitAudit.status, "raw_data_available");
assert.equal(asRecord(asRecord(genericExhibitAudit.useless_raw_data_candidates).counts_by_noise_category).graphic_asset, 1);
assert.equal(asRecord(asRecord(genericExhibitAudit.useless_raw_data_candidates).counts_by_noise_category).generic_exhibit, undefined);
assert.equal(asRecord(genericExhibitAudit.review_raw_data_candidates).document_count, 1);
assert.equal(asRecord(genericExhibitAudit.review_raw_data_candidates).important_attachment_candidate_count, 1);

const rawPackageOutput = parseSecTenderFiling({
  rawItemId: "fixture-tender-raw-package",
  sourceUniqueId: "0009999999-26-000001",
  sourceUrl: "https://www.sec.gov/Archives/edgar/data/9999999/000999999926000001/",
  title: "Raw Target Inc. SC TO-T package",
  publishedAt: "2026-08-01T12:00:00.000Z",
  bodyText:
    "SC TO-T\nSubject Company: Raw Target Inc.\nOfferor: Raw Buyer Inc.\nRaw Buyer Inc. has commenced a third-party tender offer. The offer will expire on September 1, 2026. Each registered holder of Shares has one vote for each Share. Each holder will be entitled to one CVR for each Share.",
  rawPayload: {
    accession_number: "0009999999-26-000001",
    form_type: "SC TO-T",
    company_name: "Raw Target Inc.",
    ticker: "RAW",
    exchange: "NASDAQ",
    documents: [
      {
        sequence: "1",
        type: "SC TO-T",
        description: "SC TO-T",
        document: "primary.htm",
        url: "https://www.sec.gov/fixture/raw-primary.htm",
        isPrimary: true,
        textCharCount: 800,
        textTruncated: false,
        fetchStatus: 200,
        fetchError: null,
      },
      {
        sequence: "2",
        type: "EX-99.(A)(1)(A)",
        description: "Offer to Purchase",
        document: "offer.htm",
        textCharCount: 3000,
      },
      {
        sequence: "3",
        type: "EX-99.(A)(1)(B)",
        description: "Letter of Transmittal",
        document: "letter.htm",
        textCharCount: 2000,
      },
      {
        sequence: "4",
        type: "EX-FILING FEES",
        description: "Filing Fee Table",
        document: "fee.htm",
        textCharCount: 1000,
      },
      {
        sequence: "5",
        type: "GRAPHIC",
        description: "GRAPHIC",
        document: "image_001.jpg",
        textCharCount: 0,
      },
    ],
    attachment_texts: [
      {
        type: "EX-99.(A)(1)(A)",
        description: "Offer to Purchase",
        text: "Offer to Purchase. This exhibit contains the tender offer procedures and conditions.",
      },
      {
        type: "EX-FILING FEES",
        description: "Filing Fee Table",
        text: "Calculation of Filing Fee Tables. Transaction valuation and filing fee details.",
      },
    ],
  },
});
const rawSourceDocuments = getArray(rawPackageOutput.facts.source_documents).map(asRecord);
assert.deepEqual(
  rawSourceDocuments.map((document) => document.role),
  ["primary_form", "offer_document", "letter_of_transmittal", "filing_fee", "graphic"],
);
assert.deepEqual(
  rawSourceDocuments.map((document) => document.noise_category),
  ["core_filing", "offer_material", "procedural_holder_form", "filing_fee", "graphic_asset"],
);
assert.deepEqual(
  rawSourceDocuments.map((document) => document.llm_relevance),
  ["core", "core", "low", "low", "exclude_candidate"],
);
assert.equal(rawSourceDocuments[1].filename, "offer.htm");
assert.equal(rawSourceDocuments[1].text_available, true);
assert.equal(rawPackageOutput.facts.exchange_ratio, null);
const rawSourcePackage = asRecord(rawPackageOutput.raw.source_package);
const rawDocumentCounts = asRecord(rawSourcePackage.document_counts);
assert.equal(rawDocumentCounts.total, 5);
assert.equal(rawDocumentCounts.exhibits, 3);
assert.equal(rawDocumentCounts.graphics, 1);
assert.equal(getArray(rawSourcePackage.attachment_texts).length, 2);
const rawSourceNoise = asRecord(rawPackageOutput.facts.source_noise);
assert.equal(asRecord(rawSourceNoise.document_counts_by_noise_category).filing_fee, 1);
assert.equal(asRecord(rawSourceNoise.document_counts_by_noise_category).graphic_asset, 1);
assert.ok(getArray(rawSourceNoise.flags).includes("filing_fee_present"));
const rawDataAudit = asRecord(rawPackageOutput.facts.raw_data_audit);
assert.equal(rawDataAudit.status, "raw_data_available");
assert.deepEqual(rawDataAudit.missing_raw_data, []);
assert.ok(String(rawDataAudit.parser_boundary).includes("Router and analysis LLM"));
assert.ok(getArray(asRecord(rawDataAudit.must_keep_raw_data).roles_present).includes("offer_document"));
assert.equal(asRecord(asRecord(rawDataAudit.useless_raw_data_candidates).counts_by_noise_category).filing_fee, 1);
assert.ok(String(asRecord(rawSourcePackage.text).primary_excerpt).includes("Raw Buyer Inc."));
assert.deepEqual(rawSourcePackage.fetch_warnings, []);

const documentRoleInventory = parseSecTenderFiling({
  ...minimalFiling("SC TO-T", "SC TO-T\nRole Target Inc.\n(Name of Subject Company (Issuer))\nRole Buyer Inc.\n(Name of Filing Person (Offeror))"),
  rawPayload: {
    accession_number: "0009999999-26-000002",
    form_type: "SC TO-T",
    company_name: "Role Target Inc.",
    documents: [
      { sequence: 1, type: "SC TO-T", description: "SC TO-T", document: "primary.htm", isPrimary: true, textCharCount: 500 },
      { sequence: 2, type: "EX-99.(A)(1)(A)", description: "Offer to Purchase", document: "offer.htm", textCharCount: 500 },
      { sequence: 3, type: "EX-99.(A)(1)(B)", description: "Letter of Transmittal", document: "letter.htm", textCharCount: 500 },
      { sequence: 4, type: "EX-2.1", description: "Agreement and Plan of Merger", document: "merger.htm", textCharCount: 500 },
      { sequence: 5, type: "EX-99", description: "Fairness Opinion of Financial Advisor", document: "fairness.htm", textCharCount: 500 },
      { sequence: 6, type: "EX-99", description: "Press Release", document: "press.htm", textCharCount: 500 },
      { sequence: 7, type: "EX-99", description: "Home Jurisdiction Offer Document", document: "home.htm", textCharCount: 500 },
      { sequence: 8, type: "EX-99", description: "English Translation", document: "translation.htm", textCharCount: 500 },
      { sequence: 9, type: "F-X", description: "Form F-X", document: "formfx.htm", textCharCount: 500 },
      { sequence: 10, type: "EX-99", description: "Dealer Manager Agreement", document: "dealer.htm", textCharCount: 500 },
    ],
  },
});
assertRoles(documentRoleInventory, [
  "offer_document",
  "letter_of_transmittal",
  "transaction_agreement",
  "fairness_or_presentation",
  "press_release",
  "home_jurisdiction_document",
  "english_translation_or_summary",
  "form_fx_related",
  "dealer_manager_agreement",
]);

const documentRoleConflicts = parseSecTenderFiling({
  ...minimalFiling("CB", "FORM CB\nConflict Role plc\n(Name of Subject Company)"),
  rawPayload: {
    accession_number: "0009999999-26-000003",
    form_type: "CB",
    company_name: "Conflict Role plc",
    documents: [
      { sequence: 1, type: "CB", description: "CB", document: "primary.htm", isPrimary: true, textCharCount: 500 },
      {
        sequence: 2,
        type: "EX-99",
        description: "Press Release",
        document: "press-release.htm",
        text: "The company announced offer terms and an offer to purchase shares.",
        textCharCount: 200,
      },
      {
        sequence: 3,
        type: "EX-99.(A)(1)(A)",
        description: "Offer to Purchase",
        document: "otp.htm",
        text: "Press release style introduction appears here.",
        textCharCount: 200,
      },
      {
        sequence: 4,
        type: "EX-99.(A)(1)(B)",
        description: "Letter of Transmittal",
        document: "letter.htm",
        text: "Securityholder instructions and offer mechanics.",
        textCharCount: 200,
      },
      {
        sequence: 5,
        type: "EX-2.1",
        description: "Agreement and Plan of Merger",
        document: "merger.htm",
        text: "The parties issued an announcement about the offer.",
        textCharCount: 200,
      },
      {
        sequence: 6,
        type: "EX-99",
        description: "Fairness Opinion of Financial Advisor",
        document: "fairness-opinion.htm",
        text: "Advisor references and summary.",
        textCharCount: 200,
      },
      {
        sequence: 7,
        type: "SC 14D9",
        description: "Schedule 14D-9 Solicitation/Recommendation Statement",
        document: "14d9.htm",
        text: "Fairness of the transaction section is included in the recommendation statement.",
        textCharCount: 200,
      },
      {
        sequence: 8,
        type: "EX-99",
        description: "Home Jurisdiction Offer Document",
        document: "home-jurisdiction.htm",
        text: "English summary of the home jurisdiction document.",
        textCharCount: 200,
      },
      {
        sequence: 9,
        type: "EX-99",
        description: "Transaction Materials",
        document: "materials.htm",
        text: "Offer agreement opinion presentation summary.",
        textCharCount: 200,
      },
      {
        sequence: 10,
        type: "EX-99",
        description: "English Summary of Home Jurisdiction Document",
        document: "english-summary.htm",
        textCharCount: 200,
      },
    ],
  },
});
assertRoles(documentRoleConflicts, [
  "press_release",
  "home_jurisdiction_document",
  "letter_of_transmittal",
  "transaction_agreement",
  "fairness_or_presentation",
  "recommendation_statement",
  "home_jurisdiction_document",
  "other_exhibit",
  "english_translation_or_summary",
]);
assert.ok(getArray(documentRoleConflicts.warnings).includes("ambiguous_document_role"));
assert.equal(asRecord(asRecord(documentRoleConflicts.facts.cover_page).form_cb).english_translation_or_summary_present, true);

const realRumble = parseSecTenderFiling(readFixture("real-rumble-sc-to-i.json").filing);
assert.equal(realRumble.accessionNumber, "0001213900-25-000757");
assert.equal(realRumble.facts.sec_form_type, "SC TO-I");
assert.equal(realRumble.facts.tender_case, "issuer_tender_offer");
assert.equal(getPrice(realRumble.facts.cash_price_per_share), 7.5);
assert.equal(getMoney(realRumble.facts.aggregate_purchase_price), 525000000);
assert.equal(getDate(realRumble.facts.expiration_date), "2025-02-04");
assertRoles(realRumble, ["primary_form", "offer_document", "letter_of_transmittal", "notice_of_guaranteed_delivery", "filing_fee", "graphic"]);
assert.equal(asRecord(realRumble.raw.source_package).source_url, "https://www.sec.gov/Archives/edgar/data/1830081/000121390025000757/");

const realUnitedRentals = parseSecTenderFiling(readFixture("real-united-rentals-he-sc-to-t.json").filing);
assert.equal(realUnitedRentals.accessionNumber, "0001104659-25-006713");
assert.equal(realUnitedRentals.facts.sec_form_type, "SC TO-T");
assert.equal(realUnitedRentals.facts.tender_case, "third_party_tender_offer");
assert.equal(realUnitedRentals.facts.target_company, "H&E EQUIPMENT SERVICES, INC");
assert.equal(getPrice(realUnitedRentals.facts.cash_price_per_share), 92);
assertRoles(realUnitedRentals, ["primary_form", "offer_document", "letter_of_transmittal", "financing_or_guaranty", "transaction_agreement", "filing_fee"]);
assert.ok(getArray(asRecord(realUnitedRentals.raw.source_package).attachment_texts).length >= 1);

const realCarlyleFinal = parseSecTenderFiling(readFixture("real-carlyle-final-sc-to-ia.json").filing);
assert.equal(realCarlyleFinal.accessionNumber, "0001702510-26-000009");
assert.equal(realCarlyleFinal.facts.sec_form_type, "SC TO-I/A");
assert.equal(realCarlyleFinal.facts.tender_case, "issuer_tender_offer");
assert.equal(getFieldValue(getAmendment(realCarlyleFinal.facts).amendment_number), 2);
assert.equal(getPrice(realCarlyleFinal.facts.cash_price_per_share), 18.82);
assert.equal(getMoney(realCarlyleFinal.facts.aggregate_purchase_price), 78673802);
assertRoles(realCarlyleFinal, ["primary_form", "filing_fee"]);
assert.ok(getArray(realCarlyleFinal.warnings).includes("exhibits_present_without_attachment_text"));

const realRoyalRoad = parseSecTenderFiling(readFixture("real-royal-road-caza-form-cb.json").filing);
assert.equal(realRoyalRoad.accessionNumber, "0001062993-17-000336");
assert.equal(realRoyalRoad.facts.sec_form_type, "CB");
assert.equal(realRoyalRoad.facts.tender_case, "schedule_cb_cross_border");
assert.equal(realRoyalRoad.facts.cross_border, true);
assert.equal(getFieldValue(realRoyalRoad.facts.consideration_type), "stock_or_security_exchange");
assert.ok(String(getFieldValue(realRoyalRoad.facts.exchange_ratio)).includes("0.16"));
assertRoles(realRoyalRoad, ["primary_form", "home_jurisdiction_document"]);

const realNordstrom = parseSecTenderFiling(readFixture("real-nordstrom-sc-13e3.json").filing);
assert.equal(realNordstrom.accessionNumber, "0001213900-25-019787");
assert.equal(realNordstrom.facts.sec_form_type, "SC 13E3");
assert.equal(realNordstrom.facts.tender_case, "going_private_13e3");
assert.equal(realNordstrom.facts.going_private, true);
assert.equal(getPrice(realNordstrom.facts.cash_price_per_share), 24.25);
assertRoles(realNordstrom, [
  "primary_form",
  "proxy_statement",
  "transaction_agreement",
  "financing_or_guaranty",
  "support_or_rollover_agreement",
  "fairness_or_presentation",
  "filing_fee",
]);

const archiveRumble = parseArchiveFixture("archive-rumble-sc-to-i-submission.json");
assert.equal(archiveRumble.output.accessionNumber, "0001213900-25-000757");
assert.equal(archiveRumble.output.facts.sec_form_type, "SC TO-I");
assert.equal(archiveRumble.output.facts.tender_case, "issuer_tender_offer");
assert.equal(getPrice(archiveRumble.output.facts.cash_price_per_share), 7.5);
assert.equal(getMoney(archiveRumble.output.facts.aggregate_purchase_price), 525000000);
assert.equal(getDate(archiveRumble.output.facts.expiration_date), "2025-02-04");
assert.ok(getArray(archiveRumble.output.facts.source_documents).length >= 11);
assertRoles(archiveRumble.output, ["primary_form", "offer_document", "letter_of_transmittal", "notice_of_guaranteed_delivery", "filing_fee", "graphic"]);
assert.ok(Number(asRecord(asRecord(archiveRumble.output.raw.source_package).text).attachment_chars) > 1_000_000);

const archiveCarlyle = parseArchiveFixture("archive-carlyle-final-sc-to-ia-submission.json");
assert.equal(archiveCarlyle.output.accessionNumber, "0001702510-26-000009");
assert.equal(archiveCarlyle.output.facts.sec_form_type, "SC TO-I/A");
assert.equal(archiveCarlyle.output.facts.tender_case, "issuer_tender_offer");
assert.equal(getFieldValue(getAmendment(archiveCarlyle.output.facts).amendment_number), 2);
assert.equal(getPrice(archiveCarlyle.output.facts.cash_price_per_share), 18.82);
assert.equal(getMoney(archiveCarlyle.output.facts.aggregate_purchase_price), 78673802);
assert.ok(getArray(archiveCarlyle.output.facts.source_documents).length >= 2);
assertRoles(archiveCarlyle.output, ["primary_form", "filing_fee"]);

const archiveNordstrom = parseArchiveFixture("archive-nordstrom-sc-13e3-submission.json");
assert.equal(archiveNordstrom.output.accessionNumber, "0001213900-25-019787");
assert.equal(archiveNordstrom.output.facts.sec_form_type, "SC 13E3");
assert.equal(archiveNordstrom.output.facts.tender_case, "going_private_13e3");
assert.equal(archiveNordstrom.output.facts.going_private, true);
assert.equal(getPrice(archiveNordstrom.output.facts.cash_price_per_share), 24.25);
assert.ok(getArray(archiveNordstrom.output.facts.source_documents).length >= 10);
assertRoles(archiveNordstrom.output, [
  "primary_form",
  "financing_or_guaranty",
  "support_or_rollover_agreement",
  "fairness_or_presentation",
  "filing_fee",
  "graphic",
]);
const archiveNordstromNoise = asRecord(archiveNordstrom.output.facts.source_noise);
assert.equal(archiveNordstromNoise.high_noise, true);
assert.ok(getArray(archiveNordstromNoise.flags).includes("graphic_asset_heavy"));
assert.ok(getArray(archiveNordstromNoise.flags).includes("fairness_or_banker_material_present"));
assert.ok(Number(asRecord(archiveNordstromNoise.document_counts_by_noise_category).graphic_asset) > 0);
const archiveNordstromAudit = asRecord(archiveNordstrom.output.facts.raw_data_audit);
assert.equal(archiveNordstromAudit.status, "raw_data_available");
assert.ok(Number(asRecord(archiveNordstromAudit.useless_raw_data_candidates).document_count) > 0);
assert.ok(getArray(asRecord(archiveNordstromAudit.must_keep_raw_data).roles_present).includes("fairness_or_presentation"));

for (const name of [
  "issuer-tender-capital-return.expected.json",
  "third-party-acquisition-tender.expected.json",
  "schedule-13e3-going-private.expected.json",
  "schedule-cb-cross-border-exchange.expected.json",
  "material-amendment-deadline-price.expected.json",
  "routine-amendment-deterministic.expected.json",
]) {
  const expected = readExpected(name);
  assert.equal(expected.parser_output.parserGroup, "tender");
  assert.equal(expected.parser_output.parserVersion, SEC_TENDER_PARSER_VERSION);
  assert.equal(secTenderDeliveryLevelForScore(expected.analysis_output.score), expected.fixture_expected.expected_delivery_level);
}

console.log("sec tender parser fixtures passed");

function readFixture(name: string): TenderFixture {
  return JSON.parse(readFileSync(join(fixturesDir, name), "utf8")) as TenderFixture;
}

function readExpected(name: string): SecTenderExpectedOutput {
  return JSON.parse(readFileSync(join(expectedDir, name), "utf8")) as SecTenderExpectedOutput;
}

function minimalFiling(formType: string, bodyText: string): SecTenderParseInput {
  return {
    rawItemId: `fixture-${formType.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
    sourceUniqueId: "0000000000-26-000001",
    sourceUrl: "https://www.sec.gov/fixture",
    title: `${formType} fixture`,
    publishedAt: "2026-05-24T00:00:00.000Z",
    bodyText,
    rawPayload: {
      accession_number: "0000000000-26-000001",
      form_type: formType,
      documents: [
        {
          sequence: 1,
          type: formType,
          description: formType,
          document: "primary.htm",
          isPrimary: true,
          textCharCount: bodyText.length,
        },
      ],
    },
  };
}

function readArchiveFixture(name: string): ArchiveSubmissionFixture {
  return JSON.parse(readFileSync(join(fixturesDir, name), "utf8").replace(/^\uFEFF/, "")) as ArchiveSubmissionFixture;
}

function parseArchiveFixture(name: string) {
  const fixture = readArchiveFixture(name);
  const output = parseSecTenderArchiveSubmission({
    ...fixture.input,
    submissionText: fixture.submission_text,
  });
  assert.equal(output.facts.sec_form_type, fixture.expected.form_type);
  assert.ok(getArray(output.facts.source_documents).length >= fixture.expected.min_document_count);
  return { fixture, output };
}

function asRecord(value: unknown) {
  assert.ok(value && typeof value === "object" && !Array.isArray(value));
  return value as Record<string, unknown>;
}

function getArray(value: unknown) {
  assert.ok(Array.isArray(value));
  return value;
}

function getFieldValue(value: unknown) {
  return asRecord(value).value;
}

function getPrice(value: unknown) {
  return asRecord(asRecord(value).value).price;
}

function getMoney(value: unknown) {
  return asRecord(asRecord(value).value).amount;
}

function getPercent(value: unknown) {
  return asRecord(value).value;
}

function getDate(value: unknown) {
  return asRecord(asRecord(value).value).date;
}

function getMarketRequirements(facts: Record<string, unknown>) {
  return asRecord(facts.market_context_requirements);
}

function getRouteHint(facts: Record<string, unknown>) {
  return asRecord(facts.route_hint);
}

function getAmendment(facts: Record<string, unknown>) {
  return asRecord(facts.amendment);
}

function getCoverString(output: ReturnType<typeof parseSecTenderFiling>, key: string) {
  return asRecord(asRecord(output.facts.cover_page)[key]).value;
}

function getCoverSignal(output: ReturnType<typeof parseSecTenderFiling>, key: string) {
  return asRecord(asRecord(asRecord(output.facts.cover_page).checkbox_signals)[key]);
}

function countWarnings(output: ReturnType<typeof parseSecTenderFiling>, warning: string) {
  return getArray(output.warnings).filter((item) => String(item) === warning).length;
}

function getRoutineNoChangeCandidate(amendment: Record<string, unknown>) {
  return asRecord(amendment.routine_no_change_candidate);
}

function getSignalValues(value: unknown) {
  assert.ok(Array.isArray(value));
  const items = value as unknown[];
  return items.map((item: unknown) => String(getFieldValue(item)));
}

function assertRoles(output: ReturnType<typeof parseSecTenderFiling>, expectedRoles: string[]) {
  const roles = getArray(output.facts.source_documents).map((document) => String(asRecord(document).role));
  for (const expectedRole of expectedRoles) {
    assert.ok(roles.includes(expectedRole), `missing role ${expectedRole}`);
  }
}
