import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { parseSec425Filing } from "./parser";
import type { Sec425ParseInput } from "./types";

const fixturesDir = join(process.cwd(), "lib", "sources", "sec", "forms", "425", "fixtures");

const mergerTerms = parseSec425Filing(readFixture("merger-terms-strategic-transaction.json"));
assert.equal(mergerTerms.parserVersion, "sec_425_parser_v2");
assert.equal(mergerTerms.parserGroup, "425");
assert.equal(mergerTerms.formType, "425");
assert.equal(mergerTerms.accessionNumber, "0000000000-26-000425");
assert.equal(mergerTerms.facts.primary_ticker, "ALPH");
assert.ok(mergerTerms.facts.communication_types.includes("press_release"));
assert.equal(mergerTerms.facts.deal.transaction_type, "merger");
assert.equal(mergerTerms.facts.deal.exchange_ratio, "0.60");
assert.equal(mergerTerms.facts.deal.transaction_value, "$4.2 billion");
assert.equal(mergerTerms.facts.deal.premium, "37% premium");
assert.ok(mergerTerms.signals.some((signal) => signal.type === "deal_terms_present"));
assert.equal(mergerTerms.facts.market_context?.market_cap, 3500000000);

const shareholderVote = parseSec425Filing(readFixture("shareholder-vote-solicitation.json"));
assert.equal(shareholderVote.facts.primary_ticker, "NDEV");
assert.ok(shareholderVote.facts.communication_types.includes("proxy_solicitation"));
assert.equal(shareholderVote.facts.vote.solicitation_present, true);
assert.equal(shareholderVote.facts.vote.meeting_date, "2026-07-15");
assert.equal(shareholderVote.facts.vote.record_date, "2026-06-12");
assert.equal(shareholderVote.facts.vote.vote_recommendation, "for");
assert.deepEqual(shareholderVote.calendarItems.map((item) => item.date), ["2026-07-15"]);

const litigationRisk = parseSec425Filing(readFixture("deal-litigation-risk.json"));
assert.equal(litigationRisk.facts.primary_ticker, "MRSW");
assert.ok(litigationRisk.facts.communication_types.includes("supplemental_disclosure"));
assert.ok(litigationRisk.facts.legal.litigation_or_claims.length > 0);
assert.ok(litigationRisk.facts.legal.injunction_or_delay_risk.length > 0);
assert.ok(litigationRisk.facts.legal.regulatory_risk.some((item) => /HSR Act/i.test(item)));
assert.ok(litigationRisk.signals.some((signal) => signal.type === "legal_or_regulatory_risk"));

const financingRisk = parseSec425Filing(readFixture("financing-condition-risk.json"));
assert.equal(financingRisk.facts.primary_ticker, "SLRA");
assert.ok(financingRisk.facts.financing.financing_risk.length > 0);
assert.ok(financingRisk.facts.financing.going_concern_or_liquidity_risk.length > 0);
assert.ok(financingRisk.signals.some((signal) => signal.type === "financial_risk"));
assert.equal(financingRisk.facts.market_context?.price, 8.2);

const routineArchive = parseSec425Filing(readFixture("routine-investor-faq-deterministic-archive.json"));
assert.equal(routineArchive.facts.primary_ticker, "CDBK");
assert.equal(routineArchive.raw.document_inventory[0]?.document_role, "faq");
assert.equal(routineArchive.facts.no_new_material_info, true);
assert.equal(routineArchive.facts.material_change, false);
assert.ok(routineArchive.facts.deterministic_archive_reason);
assert.ok(routineArchive.signals.some((signal) => signal.type === "deterministic_archive_candidate"));
assert.equal(routineArchive.calendarItems.length, 0);

const investorDay = parseSec425Filing(readFixture("investor-day-notice.json"));
assert.equal(investorDay.facts.primary_ticker, "FACT");
assert.ok(investorDay.facts.communication_types.includes("investor_day_notice"));
assert.equal(investorDay.facts.spac.is_spac_business_combination, true);
assert.deepEqual(investorDay.calendarItems.map((item) => item.date), ["2026-02-25"]);

const meetingAdjournment = parseSec425Filing(readFixture("shareholder-meeting-adjournment.json"));
assert.equal(meetingAdjournment.facts.primary_ticker, "MCIV");
assert.equal(meetingAdjournment.facts.vote.adjourned, true);
assert.equal(meetingAdjournment.facts.vote.reconvened_date, "2026-03-27");
assert.equal(meetingAdjournment.facts.vote.record_date, "2026-02-21");
assert.ok(meetingAdjournment.signals.some((signal) => signal.type === "meeting_adjournment"));

const voteResults = parseSec425Filing(readFixture("shareholder-vote-results.json"));
assert.equal(voteResults.facts.primary_ticker, "VBHC");
assert.ok(voteResults.facts.communication_types.includes("vote_results"));
assert.equal(voteResults.facts.vote.vote_results.length, 2);
assert.equal(voteResults.facts.vote.vote_results[0].status, "approved");
assert.equal(voteResults.facts.vote.vote_results[0].votes_for, 46211799);
assert.ok(voteResults.facts.vote.quorum);
assert.ok(hasRawCandidate(voteResults.facts.raw_data.signal_candidates, /No adjournment|not adjourned/i));

const hostileOffer = parseSec425Filing(readFixture("hostile-exchange-offer.json"));
assert.equal(hostileOffer.facts.primary_ticker, "ORLB");
assert.equal(hostileOffer.facts.subject_company, "Photon Wireless, Inc.");
assert.equal(hostileOffer.facts.offer.offer_type, "exchange_offer");
assert.equal(hostileOffer.facts.offer.is_hostile_or_unsolicited, true);
assert.ok(hostileOffer.signals.some((signal) => signal.type === "tender_or_exchange_offer"));
assert.ok(hasRawCandidate(hostileOffer.facts.raw_data.signal_candidates, /mix of cash and Orion Labs common stock/i));

const spacPipe = parseSec425Filing(readFixture("spac-pipe-business-combination.json"));
assert.equal(spacPipe.facts.primary_ticker, "VACI");
assert.equal(spacPipe.facts.spac.is_spac_business_combination, true);
assert.equal(spacPipe.facts.spac.pre_money_valuation, "$300 million");
assert.equal(spacPipe.facts.spac.pipe_amount, "$30 million");
assert.equal(spacPipe.facts.spac.expected_ticker, "NSTR");
assert.ok(spacPipe.signals.some((signal) => signal.type === "spac_financing_or_security_terms"));
assert.ok(hasRawCandidate(spacPipe.facts.raw_data.signal_candidates, /3,000,000 Founder Shares/i));
assert.ok(hasRawCandidate(spacPipe.facts.raw_data.signal_candidates, /\$30 million/i));

const rawExtraction = parseSec425Filing(readFixture("raw-extraction-candidates.json"));
assert.equal(rawExtraction.raw.textStats.filingTextChars > 0, true);
assert.equal(rawExtraction.facts.filed_by, "Raw Labs, Inc.");
assert.equal(rawExtraction.facts.subject_company, "Target Wireless, Inc.");
assert.ok(/mix of cash and Raw Labs common stock/i.test(rawExtraction.facts.deal.consideration_text || ""));
assert.equal(/Title of each class|Trading Symbol|par value/i.test(rawExtraction.facts.deal.consideration_text || ""), false);
assert.equal(rawExtraction.facts.deal.cash_component, null);
assert.equal(rawExtraction.facts.legal.litigation_or_claims.length, 0);
assert.equal(rawExtraction.facts.legal.injunction_or_delay_risk.length, 0);
assert.ok(hasRawCandidate(rawExtraction.facts.raw_data.signal_candidates, /Subject Company: Target Wireless|Target Wireless, Inc/i));
assert.ok(hasRawCandidate(rawExtraction.facts.raw_data.signal_candidates, /mix of cash and Raw Labs common stock/i));
assert.ok(hasRawCandidate(rawExtraction.facts.raw_data.signal_candidates, /all-stock merger of equals/i));
assert.ok(hasRawCandidate(rawExtraction.facts.raw_data.signal_candidates, /expected to be completed in the second half of 2026/i));
assert.ok(hasRawCandidate(rawExtraction.facts.raw_data.signal_candidates, /46,211,799.*469,418.*13,751/i));
assert.ok(hasRawCandidate(rawExtraction.facts.raw_data.signal_candidates, /not adjourned|No adjournment/i));
assert.ok(hasRawCandidate(rawExtraction.facts.raw_data.signal_candidates, /\$30 million common stock PIPE/i));
assert.ok(hasRawCandidate(rawExtraction.facts.raw_data.signal_candidates, /Public warrants will remain outstanding after closing/i));
assert.ok(hasRawCandidate(rawExtraction.facts.raw_data.signal_candidates, /3,000,000 Founder Shares/i));
assert.ok(hasRawCandidate(rawExtraction.facts.raw_data.signal_candidates, /under the ticker NSTR/i));
assert.ok(hasRawCandidate(rawExtraction.facts.raw_data.noise_candidates, /par value \$0.01/i));
assert.ok(hasRawCandidate(rawExtraction.facts.raw_data.noise_candidates, /headline capacity of up to \$100 million/i));
assert.equal(rawExtraction.facts.raw_data.signal_candidates.some((candidate) => candidate.kind === "pipe_mention" && /pipeline/i.test(candidate.value)), false);
assert.equal(rawExtraction.facts.raw_data.signal_candidates.some((candidate) => candidate.kind === "filed_by" && /with the SEC|obtained free/i.test(candidate.value)), false);
assert.ok(rawExtraction.facts.raw_data.table_rows.length >= 4);
assert.ok(hasRawCandidate(rawExtraction.facts.raw_data.table_rows, /Warrant Treatment.*Public warrants/i));

const coverOnly = parseInline("cover-only", `
UNITED STATES
SECURITIES AND EXCHANGE COMMISSION
FORM 8-K
CURRENT REPORT
Exact name of registrant as specified in its charter: Cover Only Corp.
Title of each class | Trading Symbol | Name of each exchange on which registered
Common Stock, par value $0.01 per share | COVR | Nasdaq
`);
assert.ok(coverOnly.facts.raw_data.content_types.includes("cover-only"));
assert.equal(coverOnly.facts.raw_data.parser_only_case, "cover_only_no_substantive_body");
assert.ok(coverOnly.facts.deterministic_archive_reason);
assert.ok(coverOnly.warnings.includes("cover_only_filing"));

const coverWithUnknownBody = parseInline("cover-body", `
UNITED STATES
SECURITIES AND EXCHANGE COMMISSION
FORM 8-K
Filed by: Body Test Corp.
Subject Company: Target Body Inc.

Transaction Update
Management posted talking points for employees regarding integration planning and customer communications after the pending transaction.
The parties continue to prepare for closing and regulatory approval.
`);
assert.equal(coverWithUnknownBody.facts.raw_data.parser_only_case, null);
assert.equal(coverWithUnknownBody.facts.deterministic_archive_reason, null);
assert.ok(coverWithUnknownBody.facts.raw_data.content_types.includes("deal update"));
assert.equal(coverWithUnknownBody.facts.raw_data.content_types.includes("cover-only"), false);

const coverWithStakeholderBody = parseInline("cover-stake", `
UNITED STATES
SECURITIES AND EXCHANGE COMMISSION
FORM 8-K
Filed by: Stakeholder Test Corp.
Subject Company: Target Stakeholder Inc.

Dear customers,
This integration communication explains that existing service contacts remain available.
Our customer teams will continue normal support during the transition period.
`);
assert.equal(coverWithStakeholderBody.facts.raw_data.parser_only_case, null);
assert.equal(coverWithStakeholderBody.facts.raw_data.content_types.includes("cover-only"), false);
assert.ok(coverWithStakeholderBody.facts.raw_data.content_types.includes("employee / customer / shareholder communication"));
assert.ok(/Dear customers|integration communication/i.test(coverWithStakeholderBody.facts.raw_data.candidate_text));

const parValueOnly = parseInline("par-value", `
UNITED STATES
SECURITIES AND EXCHANGE COMMISSION
FORM 8-K
Title of each class | Trading Symbol | Name of each exchange on which registered
Class A common stock, par value $0.0001 per share | PVTX | Nasdaq
Shares authorized: 500,000,000
Shares outstanding: 31,250,000
`);
assert.equal(parValueOnly.facts.deal.consideration_text, null);
assert.equal(parValueOnly.facts.deal.cash_component, null);
assert.equal(parValueOnly.signals.some((signal) => signal.type === "deal_terms_present"), false);
assert.ok(hasRawCandidate(parValueOnly.facts.raw_data.noise_candidates, /\$0\.0001 per share|par value/i));

const truePerShareConsideration = parseInline("true-share", `
Press Release
Each share will be converted into the right to receive $10.75 per share in cash.
The offer price implies an equity value of approximately $650 million and a 42% premium.
`);
assert.ok(/right to receive \$10\.75 per share in cash/i.test(truePerShareConsideration.facts.deal.consideration_text || ""));
assert.equal(truePerShareConsideration.facts.deal.cash_component, "$10.75 per share in cash");
assert.ok(truePerShareConsideration.signals.some((signal) => signal.type === "deal_terms_present"));

const offerWithRegisteredSecuritiesTable = parseInline("offer-securities-table", `
UNITED STATES
SECURITIES AND EXCHANGE COMMISSION
FORM 425
Title of each class | Trading Symbol | Name of each exchange on which registered
Class A Common Stock | GME | NYSE
Warrants to Purchase Common Stock, par value $0.001 per share | GME WS | NYSE

GameStop publicly proposes to acquire Example Marketplace for $125.00 per share.
The proposed consideration would consist of 50% cash and 50% GameStop Class A common stock.
`);
assert.equal(/Trading Symbol|NYSE|par value/i.test(offerWithRegisteredSecuritiesTable.facts.offer.consideration || ""), false);
assert.ok(/publicly proposes to acquire Example Marketplace for \$125\.00 per share/i.test(offerWithRegisteredSecuritiesTable.facts.offer.consideration || ""));

const signedMergerPackage = parseInline("signed-merger-terms", `
On March 30, 2026, Sysco Corporation entered into an Agreement and Plan of Merger with JRD Unico, Inc.
The aggregate purchase price paid by Sysco will consist of $21.6 billion in cash and 91.5 million shares of HoldCo Common Stock.
"Aggregate Merger Consideration" means the Maverick OpCo Estimated Cash Consideration plus the Maverick PropCo Estimated Cash Consideration.
Debt Financing Sources | 130 | Exhibits Exhibit A - Form of Stockholders Agreement
The completion of the mergers is subject to expiration or termination of the applicable Hart-Scott-Rodino waiting period.
`);
assert.equal(signedMergerPackage.facts.deal.transaction_status, "agreement_signed");
assert.match(signedMergerPackage.facts.deal.consideration_text || "", /\$21\.6 billion in cash and 91\.5 million shares/i);
assert.doesNotMatch(signedMergerPackage.facts.deal.consideration_text || "", /^Aggregate Merger Consideration means/i);
assert.equal(signedMergerPackage.facts.financing.financing_condition, null);

const premiumFalsePositive = parseInline("premium-false", `
Investor Note
The company discussed premium brand positioning and insurance premium expense trends.
The note also referenced Exchange Act reporting obligations and ordinary stock exchange listing standards.
`);
assert.equal(premiumFalsePositive.facts.raw_data.content_types.includes("deal update"), false);
assert.equal(premiumFalsePositive.facts.deal.consideration_text, null);
assert.equal(premiumFalsePositive.signals.some((signal) => signal.type === "deal_terms_present"), false);

const exhibitAttachmentBody = parseSec425Filing({
  title: "425 - exhibit attachment",
  formType: "425",
  accessionNumber: "0000000000-26-000442",
  primaryTicker: "EXBT",
  filingText: `
Filed pursuant to Rule 425
Subject Company: Exhibit Target Inc.
The following press release was issued by Exhibit Buyer Corp.
Exhibit 99.1
`,
  attachments: [
    {
      documentType: "EX-99.1",
      description: "Press Release",
      text: `
FOR IMMEDIATE RELEASE
Exhibit Buyer Corp. and Exhibit Target Inc. to Combine
The companies announced an all-stock transaction with an exchange ratio of 0.1234 shares of Exhibit Buyer common stock.
The transaction implies an equity value of $1.2 billion and a premium to unaffected trading price.
`,
    },
  ],
});
assert.ok(exhibitAttachmentBody.facts.raw_data.content_types.includes("press release"));
assert.ok(exhibitAttachmentBody.facts.raw_data.content_types.includes("deal update"));
assert.equal(exhibitAttachmentBody.facts.raw_data.parser_only_case, null);
assert.ok(/to Combine|all-stock transaction|exchange ratio of 0\.1234/i.test(exhibitAttachmentBody.facts.raw_data.candidate_text));
assert.ok(hasRawCandidate(exhibitAttachmentBody.facts.raw_data.signal_candidates, /exchange ratio of 0\.1234|equity value of \$1\.2 billion/i));

const boilerplateOnly = parseInline("boilerplate-only", `
Forward-Looking Statements
This communication contains forward-looking statements within the meaning of federal securities laws.
No Offer or Solicitation
This communication is for informational purposes only and does not constitute an offer or solicitation.
Where You Can Find Additional Information
Documents filed with the SEC may be obtained free of charge at the SEC website.
`);
assert.ok(boilerplateOnly.facts.raw_data.content_types.includes("boilerplate-only"));
assert.equal(boilerplateOnly.facts.raw_data.parser_only_case, "boilerplate_only_no_deal_specific_language");
assert.ok(boilerplateOnly.facts.deterministic_archive_reason);

const riskyBoilerplate = parseInline("risk-boilerplate", `
Cautionary Statement Regarding Forward-Looking Statements
Risks include the possibility that the board receives a superior proposal, pays a termination fee, or fails to obtain antitrust approval.
No Offer or Solicitation
This paragraph is generic legal text.
`);
assert.ok(riskyBoilerplate.facts.raw_data.content_types.includes("deal update"));
assert.equal(riskyBoilerplate.facts.deterministic_archive_reason, null);
assert.ok(/superior proposal/i.test(riskyBoilerplate.facts.raw_data.candidate_text));
assert.ok(hasRawCandidate(riskyBoilerplate.facts.raw_data.signal_candidates, /termination fee|superior proposal|antitrust approval/i));

assert.ok(mergerTerms.facts.raw_data.content_types.includes("press release"));
assert.ok(mergerTerms.facts.raw_data.content_types.includes("deal update"));
assert.ok(/\$12\.50 in cash/i.test(mergerTerms.facts.raw_data.candidate_text));

const investorPresentation = parseInline("investor-presentation", `
Investor Presentation
Slide 1 Transaction Overview
Alpha Corp announced a definitive agreement to acquire Beta Robotics in an all-stock merger.
Slide 4 Financial Outlook
The combined company expects projected revenue of $500 million and adjusted EBITDA of $80 million in 2027.
`);
assert.ok(investorPresentation.facts.raw_data.content_types.includes("investor presentation"));
assert.equal(investorPresentation.facts.deterministic_archive_reason, null);
assert.ok(/adjusted EBITDA/i.test(investorPresentation.facts.raw_data.candidate_text));
assert.ok(hasRawCandidate(investorPresentation.facts.raw_data.signal_candidates, /projected revenue|adjusted EBITDA/i));

const mixedPresentationFaq = parseInline("mixed-presentation-faq", `
UNITED STATES
SECURITIES AND EXCHANGE COMMISSION
FORM 8-K
Filed pursuant to Rule 425

Investment Highlights
Combined Company
The combined company expects pro forma revenue growth and adjusted EBITDA expansion after the business combination.

Frequently Asked Questions
Q. What will shareholders vote on?
A. Shareholders will vote on the merger proposal at the special meeting.
`);
assert.ok(mixedPresentationFaq.facts.raw_data.content_types.includes("investor presentation"));
assert.ok(mixedPresentationFaq.facts.raw_data.content_types.includes("FAQ"));
assert.ok(mixedPresentationFaq.facts.raw_data.content_types.includes("deal update"));
assert.equal(mixedPresentationFaq.facts.raw_data.parser_only_case, null);
assert.ok(/Investment Highlights|Q\. What will shareholders vote on|adjusted EBITDA/i.test(mixedPresentationFaq.facts.raw_data.candidate_text));

const imageHeavyPresentation = parseSec425Filing({
  title: "Image Heavy Presentation",
  formType: "425",
  accessionNumber: "0000000000-26-000441",
  primaryTicker: "IMGX",
  filingText: `<html><body><h1>Investor Presentation</h1><img alt="Slide 1 merger overview" src="s1.jpg"><img alt="Slide 2 exchange ratio" src="s2.jpg"><img alt="Slide 3 premium" src="s3.jpg"></body></html>`,
  rawPayload: {
    documents: [
      { type: "425", description: "425", url: "https://example.test/filing.htm", isPrimary: true },
      { type: "GRAPHIC", description: "slide 1", url: "https://example.test/s1.jpg" },
      { type: "GRAPHIC", description: "slide 2", url: "https://example.test/s2.jpg" },
      { type: "GRAPHIC", description: "slide 3", url: "https://example.test/s3.jpg" },
      { type: "GRAPHIC", description: "slide 4", url: "https://example.test/s4.jpg" },
      { type: "GRAPHIC", description: "slide 5", url: "https://example.test/s5.jpg" },
    ],
  },
});
assert.ok(imageHeavyPresentation.facts.raw_data.content_types.includes("image-heavy / extraction failure"));
assert.equal(imageHeavyPresentation.facts.raw_data.parser_only_case, null);
assert.equal(imageHeavyPresentation.facts.deterministic_archive_reason, null);
assert.ok(imageHeavyPresentation.warnings.includes("extraction_failure_route_to_ocr_or_vision"));
assert.ok(/Slide 2 exchange ratio|Slide 3 premium/i.test(imageHeavyPresentation.facts.raw_data.candidate_text));

const transcript = parseInline("transcript", `
Conference Call Transcript
Operator: Welcome to today's call.
CEO: We entered into a merger agreement to acquire Delta Health for $14.00 per share in cash.
Analyst: When is the transaction expected to close?
CFO: The acquisition is expected to close in the second half of 2026.
`);
assert.ok(transcript.facts.raw_data.content_types.includes("transcript / conference call"));
assert.ok(/Operator:|CEO:/i.test(transcript.facts.raw_data.candidate_text));
assert.equal(transcript.facts.deal.cash_component, "$14.00 per share in cash");

const speakerNameTranscript = parseInline("speaker-transcript", `
Merger Discussion
Jane Smith: We appreciate everyone joining to discuss the transaction.
John Lee: The business combination remains subject to regulatory approval and closing conditions.
Jane Smith: We will now take questions from employees.
`);
assert.ok(speakerNameTranscript.facts.raw_data.content_types.includes("transcript / conference call"));
assert.equal(speakerNameTranscript.facts.raw_data.parser_only_case, null);
assert.ok(/Jane Smith:|John Lee:/i.test(speakerNameTranscript.facts.raw_data.candidate_text));

const webcastTranscript = parseInline("webcast", `
Webcast
Prepared Remarks
CFO: The business combination remains expected to close after shareholder approval.
Question-and-Answer Session
Operator: We will now begin Q&A.
`);
assert.ok(webcastTranscript.facts.raw_data.content_types.includes("transcript / conference call"));
assert.equal(webcastTranscript.facts.raw_data.parser_only_case, null);
assert.ok(/Question-and-Answer Session|Q&A/i.test(webcastTranscript.facts.raw_data.candidate_text));

const stakeholderCommunication = parseInline("stakeholder", `
Team Member Communication
Dear colleagues,
This integration communication is being sent to employees and suppliers after announcement of the merger agreement.
Customers should continue to use their existing contacts while the transaction is pending.
`);
assert.ok(stakeholderCommunication.facts.raw_data.content_types.includes("employee / customer / shareholder communication"));
assert.equal(stakeholderCommunication.facts.raw_data.parser_only_case, null);
assert.ok(/Dear colleagues|integration communication/i.test(stakeholderCommunication.facts.raw_data.candidate_text));

const competingProposal = parseInline("competing-proposal", `
Press Release
The board received an unsolicited competing proposal that could reasonably be expected to lead to a superior proposal.
The company remains bound by a no-shop covenant and the merger agreement includes a termination fee.
`);
assert.ok(competingProposal.facts.raw_data.content_types.includes("deal update"));
assert.equal(competingProposal.facts.deterministic_archive_reason, null);
assert.ok(hasRawCandidate(competingProposal.facts.raw_data.signal_candidates, /unsolicited competing proposal|superior proposal|no-shop|termination fee/i));

const spacDespac = parseInline("spac-despac", `
Transaction Overview
Apex Acquisition Corp. announced a de-SPAC transaction with Target Mobility that will result in a combined company expected to list on Nasdaq.
The financing includes a $50 million PIPE, cash held in trust account, possible redemption requests, and sponsor support agreement terms.
The extraordinary general meeting will ask shareholders to approve the business combination after the registration statement/proxy statement/prospectus is declared effective.
Metric | Amount
Enterprise Value | $800 million
Pro Forma Ownership | Existing Target holders 72%
Synergies | $25 million
`);
assert.ok(spacDespac.facts.raw_data.content_types.includes("investor presentation"));
assert.ok(spacDespac.facts.raw_data.content_types.includes("deal update"));
assert.equal(spacDespac.facts.spac.is_spac_business_combination, true);
assert.equal(spacDespac.facts.vote.solicitation_present, true);
assert.equal(spacDespac.facts.raw_data.parser_only_case, null);
assert.ok(/PIPE|trust account|redemption|Pro Forma Ownership/i.test(spacDespac.facts.raw_data.candidate_text));
assert.ok(hasRawCandidate(spacDespac.facts.raw_data.table_rows, /Enterprise Value|Pro Forma Ownership|Synergies/i));

const changedDuplicate = parseInline("changed-duplicate", `
This communication repeats the previously announced transaction information and contains no new material information except that the parties increased the offer price to $12.00 per share.
The amendment changes the merger consideration payable to target shareholders.
`);
assert.equal(changedDuplicate.facts.material_change, true);
assert.equal(changedDuplicate.facts.deterministic_archive_reason, null);
assert.ok(/\$12\.00 per share/i.test(changedDuplicate.facts.raw_data.candidate_text));

const projectionTable = parseInline("projection-table", `
Investor Presentation
<table><tr><th>Metric</th><th>2027E</th></tr><tr><td>Projected Revenue</td><td>$500 million</td></tr><tr><td>Adjusted EBITDA</td><td>$80 million</td></tr><tr><td>Free Cash Flow</td><td>$45 million</td></tr></table>
`);
assert.ok(projectionTable.facts.raw_data.content_types.includes("investor presentation"));
assert.ok(hasRawCandidate(projectionTable.facts.raw_data.table_rows, /Projected Revenue|Adjusted EBITDA|Free Cash Flow/i));
assert.ok(/Projected Revenue|Adjusted EBITDA|Free Cash Flow/i.test(projectionTable.facts.raw_data.candidate_text));

const multiDocumentOffer = parseSec425Filing(readFixture("multi-document-offer-package.json"));
assert.deepEqual(
  multiDocumentOffer.raw.document_inventory.map((document) => document.document_role),
  ["offer_letter", "offer_letter", "press_release", "investor_presentation", "fact_sheet"],
);
assert.equal(new Set(multiDocumentOffer.raw.cleaned_source_blocks.map((block) => block.block_id)).size, multiDocumentOffer.raw.cleaned_source_blocks.length);
assert.ok(multiDocumentOffer.raw.cleaned_source_blocks.some((block) => block.source_ref === "attachment_1" && /\$42\.00 per share/i.test(block.text)));
assert.ok(multiDocumentOffer.raw.cleaned_source_blocks.some((block) => block.source_ref === "attachment_3" && block.block_type === "table"));
assert.ok(multiDocumentOffer.raw.cleaned_source_blocks.some((block) => block.source_ref === "attachment_4" && /no definitive agreement signed/i.test(block.text)));
assert.ok(multiDocumentOffer.raw.router_source_blocks.length <= 18);
assert.ok(multiDocumentOffer.raw.router_source_blocks.every((block) => block.char_count <= 1_503));

const transactionAgreement = parseSec425Filing(readFixture("transaction-agreement-package.json"));
assert.deepEqual(
  transactionAgreement.raw.document_inventory.map((document) => document.document_role),
  ["transaction_agreement", "transaction_agreement", "stakeholder_communication"],
);
assert.ok(transactionAgreement.raw.cleaned_source_blocks.some((block) => block.document_role === "transaction_agreement" && block.block_type === "agreement_section"));
assert.ok(transactionAgreement.raw.cleaned_source_blocks.some((block) => block.document_role === "stakeholder_communication" && block.block_type === "stakeholder_message"));
assert.ok(transactionAgreement.raw.cleaned_source_blocks.every((block) => block.text.length <= 4_500));

const thirdAmendmentPackage = parseSec425Filing({
  title: "425 - third merger agreement amendment",
  formType: "425",
  filingText: "The parties entered into a third amendment to their merger agreement.",
  attachments: [{
    documentType: "EX-2.1",
    description: "EXHIBIT 2.1",
    filename: "third-amendment.htm",
    text: "THIRD AMENDMENT TO AGREEMENT AND PLAN OF MERGER\nRECITALS\nThe parties amend the outside date to August 31, 2026.\nNOW, THEREFORE, the parties agree as follows.",
  }],
});
assert.equal(thirdAmendmentPackage.raw.document_inventory[1]?.document_role, "agreement_amendment");
assert.ok(thirdAmendmentPackage.raw.router_source_blocks.some((block) => block.document_role === "agreement_amendment"));

const embeddedExhibitPackage = parseInline("embedded-exhibits", `
Exhibit No. | Description
99.1 | Offer Letter
99.2 | Press Release
99.3 | Investor Presentation
99.4 | Fact Sheet

Exhibit 99.1
The buyer proposes to acquire all outstanding shares for $42.00 per share in cash.

Exhibit 99.2
FOR IMMEDIATE RELEASE
The buyer announced its non-binding acquisition proposal.

Exhibit 99.3
Transaction Overview
Offer price | $42.00 per share
Premium | 35%

Exhibit 99.4
Transaction Fact Sheet
No definitive agreement has been signed.
`);
assert.ok(embeddedExhibitPackage.raw.cleaned_source_blocks.some((block) => block.content_role === "offer_letter" && block.exhibit_number === "99.1"));
assert.ok(embeddedExhibitPackage.raw.cleaned_source_blocks.some((block) => block.content_role === "press_release" && block.exhibit_number === "99.2"));
assert.ok(embeddedExhibitPackage.raw.cleaned_source_blocks.some((block) => block.content_role === "investor_presentation"));
assert.ok(embeddedExhibitPackage.raw.cleaned_source_blocks.some((block) => block.content_role === "fact_sheet"));
assert.deepEqual(
  new Set(embeddedExhibitPackage.raw.router_source_blocks.map((block) => block.content_role)),
  new Set(["offer_letter", "press_release", "investor_presentation", "fact_sheet"]),
);

const stockholderAgreementPackage = parseSec425Filing({
  title: "425 - stockholder agreement",
  formType: "425",
  filingText: "The transaction documents are attached.",
  attachments: [{
    documentType: "EX-10.1",
    filename: "stockholders-agreement.htm",
    text: "STOCKHOLDERS AGREEMENT\nBoard designation rights, transfer restrictions, and registration rights apply after closing.",
  }],
});
assert.equal(stockholderAgreementPackage.raw.document_inventory[1]?.document_role, "stockholder_agreement");
assert.ok(stockholderAgreementPackage.raw.cleaned_source_blocks.some((block) => block.document_role === "stockholder_agreement" && block.block_type === "agreement_section"));

const eventNoticePackage = parseInline("event-notice", `
Filed by: Sample SPAC Corp.
Subject Company: Sample Target Inc.
Commission File Number: 001-12345

Business Combination Update Webcast
The company will host a conference call on April 21, 2026. Registration and replay details are available at the event URL.
`);
assert.ok(eventNoticePackage.raw.router_source_blocks.some((block) => block.content_role === "meeting_notice"));
assert.equal(eventNoticePackage.raw.router_source_blocks.some((block) => block.content_role === "transcript"), false);
assert.equal(eventNoticePackage.raw.router_source_blocks.some((block) => /Filed by|Subject Company/i.test(block.text)), false);

const presentationDisclaimerPackage = parseInline("presentation-disclaimer", `
Investor Presentation
Not for release, publication or distribution in any jurisdiction where doing so would be unlawful.

Transaction Overview
The proposed business combination values the target at $500 million and remains subject to shareholder approval.
`);
assert.ok(presentationDisclaimerPackage.raw.router_source_blocks.some((block) => /values the target at \$500 million/i.test(block.text)));
assert.equal(presentationDisclaimerPackage.raw.router_source_blocks.some((block) => /not for release, publication or distribution/i.test(block.text)), false);

const filedPresentationPackage = parseInline("filed-presentation", `
Presentation is being filed in connection with the proposed merger of equals transaction.
Transaction Overview
The parties expect the combined company to close after shareholder and regulatory approvals.\u0085
`);
assert.ok(filedPresentationPackage.raw.router_source_blocks.some((block) => block.content_role === "investor_presentation"));
assert.equal(filedPresentationPackage.raw.cleaned_source_blocks.some((block) => block.text.includes("\u0085")), false);

const mojibakePackage = parseInline("mojibake", `
Transaction Update
eBay\u00e2\u20ac\u2122s board is reviewing the proposal\u00e2\u20ac\u201dthe parties expect the process to continue.
`);
assert.ok(mojibakePackage.raw.cleaned_source_blocks.some((block) => block.text.includes("eBay's board")));
assert.ok(mojibakePackage.raw.cleaned_source_blocks.some((block) => block.text.includes("proposal-the parties")));
assert.equal(mojibakePackage.raw.cleaned_source_blocks.some((block) => /[\u0080-\u009f]/.test(block.text)), false);

const faqWithLegalNoticePackage = parseInline("faq-with-legal-notice", `
Frequently Asked Questions
Additional Information
The parties intend to file a registration statement with the SEC. This document is not a substitute for that registration statement, and investors are urged to read it.

Q. What was announced today?
A. The companies signed an all-stock merger agreement, subject to shareholder approval.
`);
assert.ok(faqWithLegalNoticePackage.raw.router_source_blocks.some((block) => /What was announced today/i.test(block.text)));
assert.equal(faqWithLegalNoticePackage.raw.router_source_blocks.some((block) => /not a substitute/i.test(block.text)), false);

const transcriptWithLegalNoticePackage = parseInline("transcript-with-legal-notice", `
Conference Call Transcript
Additional Information
This document is not a substitute for the proxy statement, and investors and security holders are urged to read it.

CEO: We signed the transaction agreement today and expect the deal to close after regulatory approval.
CFO: The stated consideration is $25.00 per share in cash.
`);
assert.ok(transcriptWithLegalNoticePackage.raw.router_source_blocks.some((block) => /\$25\.00 per share/i.test(block.text)));
assert.equal(transcriptWithLegalNoticePackage.raw.router_source_blocks.some((block) => /not a substitute/i.test(block.text)), false);

const employeeQaPackage = parseInline("employee-qa", `
Q&A
What happens now that the merger is announced?
The companies will begin integration planning, while normal operations continue until closing.

Will my compensation change?
No immediate base-pay change is planned for employees who remain in comparable roles.
`);
assert.ok(employeeQaPackage.raw.router_source_blocks.some((block) => block.content_role === "faq"));
assert.equal(employeeQaPackage.raw.router_source_blocks.some((block) => block.content_role === "transcript"), false);

const changedMeetingPackage = parseInline("changed-meeting", `
Special Meeting Update
The adjournment proposal would permit the meeting to be adjourned from time to time to solicit additional proxies.

The Special Meeting will now be held on August 25, 2026. The record date and proposals are unchanged.
`);
assert.ok(changedMeetingPackage.raw.router_source_blocks.some((block) => /will now be held on August 25, 2026/i.test(block.text)));

const pressReleaseMeetingUpdate = parseSec425Filing({
  title: "425 - press release meeting update",
  formType: "425",
  accessionNumber: "0000000000-26-000426",
  primaryDocumentDescription: "Press Release",
  filingText: `
SunLink Announces Special Meeting Adjournment
ATLANTA, July 24, 2025 (GLOBE NEWSWIRE) -- SunLink previously announced a proposed merger transaction.

Meeting Update
Stockholders approved the adjournment proposal. The Special Meeting was adjourned and will reconvene on August 4, 2025.

Additional Information
Investors are urged to read the proxy statement and other documents filed with the SEC.
`,
});
assert.equal(pressReleaseMeetingUpdate.raw.document_inventory[0]?.document_role, "press_release");
assert.ok(pressReleaseMeetingUpdate.raw.router_source_blocks.some((block) =>
  block.content_role === "meeting_notice" && /will reconvene on August 4, 2025/i.test(block.text)
));

const secViewerArtifactPackage = parseInline("sec-viewer-artifact", `
00000001 - Document - Cover link:presentationLink link:calculationLink link:definitionLink

Transaction Update
The parties rescheduled the shareholder meeting to September 15, 2026.
`);
assert.equal(secViewerArtifactPackage.raw.router_source_blocks.some((block) => /presentationLink|calculationLink|definitionLink/i.test(block.text)), false);

const newswireRegulatoryUpdate = parseInline("newswire-regulatory-update", `
425
Filed by Test Company
Subject Company: Test Company
Pursuant to Rule 425 under the Securities Act of 1933

Test Company Schedules Special Meeting After Proxy Becomes Effective
NEW YORK (GLOBE NEWSWIRE) -- The SEC declared the Form F-4 effective. The company filed its definitive proxy statement and scheduled the shareholder meeting for August 5, 2026.
Completion remains subject to shareholder approval and customary closing conditions.
`);
assert.ok(newswireRegulatoryUpdate.raw.router_source_blocks.some((block) => block.content_role === "meeting_notice" && /definitive proxy statement/i.test(block.text)));
assert.equal(newswireRegulatoryUpdate.raw.router_source_blocks.some((block) => block.block_type === "cover"), false);

const datelinePressRelease = parseInline("dateline-press-release", `
Test Company Supports the Proposed Transaction
HOLLYWOOD, Calif., January 7, 2026 — Test Company welcomed the board's decision to maintain the existing merger agreement.
`);
assert.ok(datelinePressRelease.raw.router_source_blocks.some((block) => block.content_role === "press_release"));

const publishedPresentation = parseInline("published-presentation", `
On June 1, 2026, the company published the following presentation:

Transaction Overview
The proposed transaction remains subject to regulatory approval and customary closing conditions.
`);
assert.ok(publishedPresentation.raw.router_source_blocks.some((block) => block.content_role === "investor_presentation"));

const imageBasedSocialPost = parseSec425Filing({
  title: "425 - image social post",
  formType: "425",
  filingText: `425
Filed by: Buyer Corp.
Subject Company: Target Corp.
Pursuant to Rule 425 under the Securities Act of 1933
Item 1 Explanatory Note: The buyer's CEO reposted the following post on X under the CEO's X handle.
X Post:`,
  attachments: [{
    documentType: "GRAPHIC",
    description: "X post screenshot image",
    filename: "social-post.jpg",
    text: "binary image payload",
  }],
});
assert.ok(imageBasedSocialPost.raw.router_source_blocks.some((block) => block.content_role === "social_media" && /reposted/i.test(block.text)));
assert.equal(imageBasedSocialPost.raw.router_source_blocks.some((block) => /Filed by:/i.test(block.text)), false);
assert.ok(imageBasedSocialPost.warnings.includes("social_media_content_may_be_in_graphic"));

const proxyCardPackage = parseSec425Filing({
  title: "425 - proxy card",
  formType: "425",
  filingText: "Special Meeting Notice\nThe meeting will now be held on September 15, 2026.",
  attachments: [{
    documentType: "DEFA14A",
    description: "Proxy card",
    filename: "proxy-card.htm",
    text: "Vote by Internet. Please vote today to approve the amended merger agreement.",
  }],
});
assert.equal(proxyCardPackage.raw.document_inventory[1]?.document_role, "other");

const graphicAttachmentPackage = parseSec425Filing({
  title: "425 - graphic attachment package",
  formType: "425",
  accessionNumber: "0000000000-26-000425",
  filingText: "Investor Presentation\nTransaction overview and proposed business combination terms.",
  attachments: [{
    documentType: "GRAPHIC",
    description: "Presentation image",
    filename: "slide001.jpg",
    text: "M][_S BBBMA 1110 4444 binary image payload",
  }],
});
assert.equal(graphicAttachmentPackage.raw.document_inventory.length, 2);
assert.equal(graphicAttachmentPackage.raw.document_inventory[1]?.source_block_count, 0);
assert.equal(graphicAttachmentPackage.raw.cleaned_source_blocks.some((block) => block.document_type === "GRAPHIC"), false);
assert.equal(graphicAttachmentPackage.raw.router_source_blocks.some((block) => block.document_type === "GRAPHIC"), false);

const xbrlAttachmentPackage = parseSec425Filing({
  title: "425 - XBRL attachment package",
  formType: "425",
  filingText: "Transaction Update\nThe parties amended the proposed business combination.",
  attachments: [{
    documentType: "JSON",
    description: "IDEA: XBRL DOCUMENT",
    filename: "FilingSummary.json",
    text: "presentation role calculation link definition link",
  }],
});
assert.equal(xbrlAttachmentPackage.raw.document_inventory[1]?.source_block_count, 0);
assert.equal(xbrlAttachmentPackage.raw.router_source_blocks.some((block) => block.document_type === "JSON"), false);

console.log("sec 425 parser fixtures passed");

function readFixture(name: string): Sec425ParseInput {
  return JSON.parse(readFileSync(join(fixturesDir, name), "utf8")) as Sec425ParseInput;
}

function parseInline(name: string, filingText: string): ReturnType<typeof parseSec425Filing> {
  return parseSec425Filing({
    title: `425 - ${name}`,
    formType: "425",
    accessionNumber: `0000000000-26-${name.replace(/[^a-z0-9]/gi, "").slice(0, 6).padEnd(6, "0")}`,
    primaryTicker: "TST",
    exchange: "NASDAQ",
    filingText,
  });
}

function hasRawCandidate(candidates: Array<{ value: string; context: string }>, pattern: RegExp) {
  return candidates.some((candidate) => pattern.test(`${candidate.value} ${candidate.context}`));
}
