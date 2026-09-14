import assert from "node:assert/strict";
import test from "node:test";
import { evaluateListingMonitorConditions, evaluateListingMonitorEvent } from "../listingMonitorMatcher.ts";
import { readCurrentListingRiskFacts } from "../monitor/listingRiskPersistence.ts";
import { form25AnalysisAllowsPrimaryAlert, form25HumanMonitorField, projectForm25AnalysisEvent, type Form25AnalysisReviewRead } from "./consumer.ts";

const eventId = "9d8ce777-1111-4111-8111-111111111111";
const source = { id: "sec:1", url: "https://www.sec.gov/Archives/example.xml", text: "Trading suspended February 3. Removal effective February 13.", label: "Retained SEC source" };
function reviewed(): Form25AnalysisReviewRead { return {
  status: "available", reviewState: "HUMAN_CORRECTED", analysis: { ticker: "TTWO", summary: "Original AI" },
  sourceEvidence: [source], history: [], corrections: {
    trading_suspension_date: { value: "2025-02-03", availability: "available", dateStatus: "occurred", sourceRef: source.id },
    removal_effective_date: { value: "2025-02-13", availability: "available", dateStatus: "scheduled", sourceRef: source.id },
    event_kind: { value: "listing_removal", availability: "available", sourceRef: source.id },
  },
}; }
const conditions = [{ key: "listing.suspension_date", operator: "eq", value: "2025-02-03" }, { key: "listing.removal_effective_date", operator: "eq", value: "2025-02-13" }];
test("official reader exposes only explicit human fields when canonical Form25 facts do not exist", async () => {
  const original = { status: "not_ready", reason: "no_current_facts" };
  const current = await readCurrentListingRiskFacts(eventId, {
    rpc: async name => { assert.equal(name, "read_current_event_listing_risk_facts"); return { ok: true, status: 200, data: original }; },
    readForm25Review: async () => reviewed(),
  });
  assert.equal(current.status, "not_ready"); assert.equal("facts" in current, false);
  assert.equal(evaluateListingMonitorConditions(current, conditions, { evaluationDate: "2025-02-04" }).status, "match");
  assert.equal(evaluateListingMonitorConditions(current, [{ key: "listing.exchange", operator: "eq", value: "Nasdaq" }], { evaluationDate: "2025-02-04" }).status, "ineligible");
  assert.deepEqual(original, { status: "not_ready", reason: "no_current_facts" });
});
test("product Matcher event entrypoint consumes human dates without inventing lineage and still requires issuer identity", async () => {
  const input = { eventId, evaluationDate: "2025-02-04", conditionSets: [{ id: "date", conditions }] };
  const dependencies = { readFacts: async () => ({ status: "not_ready" as const, reason: "no_current_facts", form25HumanReview: reviewed() }),
    readEventIdentity: async () => ({ status: "available" as const, ticker: "TTOO", exchange: "Nasdaq", reason: "human_approved" }) };
  assert.equal((await evaluateListingMonitorEvent(input, dependencies)).evaluations[0].result.status, "match");
  assert.equal((await evaluateListingMonitorEvent(input, { ...dependencies, readEventIdentity: async () => ({ status: "blocked" as const, ticker: null, exchange: null, reason: "unresolved" }) })).evaluations[0].result.status, "ineligible");
});
test("unavailable fields are independent; scheduled and conditional dates retain their source status", () => {
  const review = reviewed(); review.corrections!.trading_suspension_date = { value: null, availability: "unavailable", sourceRef: source.id };
  const current = { status: "not_ready" as const, reason: "no_facts", form25HumanReview: review };
  assert.equal(evaluateListingMonitorConditions(current, [conditions[0]], { evaluationDate: "2025-02-04" }).status, "ineligible");
  assert.equal(evaluateListingMonitorConditions(current, [conditions[1]], { evaluationDate: "2025-02-04" }).status, "match");
  assert.equal(form25HumanMonitorField(review, "listing.removal_effective_date")?.dateStatus, "scheduled");
  review.corrections!.removal_effective_date!.dateStatus = "conditional";
  assert.equal(form25HumanMonitorField(review, "listing.removal_effective_date")?.dateStatus, "conditional");
});
test("human exchange feeds existing listing condition while security title is evidence only",()=>{
 const review=reviewed();review.corrections!.exchange={value:"Nasdaq",availability:"available",sourceRef:source.id};
 review.corrections!.security_title={value:"Common Stock",availability:"available",sourceRef:source.id};
 const current={status:"not_ready" as const,reason:"no_facts",form25HumanReview:review};
 assert.equal(evaluateListingMonitorConditions(current,[{key:"listing.exchange",operator:"eq",value:"Nasdaq"}],{evaluationDate:"2025-02-04"}).status,"match");
 assert.equal(evaluateListingMonitorConditions(current,[{key:"listing.exchange",operator:"eq",value:"NYSE"}],{evaluationDate:"2025-02-04"}).status,"no_match");
 assert.equal(evaluateListingMonitorConditions(current,[{key:"listing.security_title",operator:"eq",value:"Common Stock"}],{evaluationDate:"2025-02-04"}).status,"ineligible");
 assert.equal(form25HumanMonitorField({...review,reviewState:"ORIGINAL",corrections:{}},"listing.exchange"),null);
 review.corrections!.exchange={value:null,availability:"unavailable",sourceRef:source.id};
 assert.equal(evaluateListingMonitorConditions(current,[{key:"listing.exchange",operator:"eq",value:"Nasdaq"}],{evaluationDate:"2025-02-04"}).status,"ineligible");
 assert.equal(evaluateListingMonitorConditions(current,[conditions[0]],{evaluationDate:"2025-02-04"}).status,"match");
});
test("pending/failed review, detached evidence, and withdraw never invent effective fields", () => {
  for (const reviewState of ["REVIEW", "UNAVAILABLE", "AWAITING_FILING"] as const) assert.equal(form25HumanMonitorField({ ...reviewed(), reviewState }, "listing.event_kind")?.availability, "unavailable");
  assert.equal(form25HumanMonitorField({ ...reviewed(), sourceEvidence: [] }, "listing.event_kind")?.availability, "unavailable");
  assert.equal(form25HumanMonitorField({ ...reviewed(), reviewState: "ORIGINAL", corrections: {} }, "listing.event_kind"), null);
  assert.equal(form25HumanMonitorField({ ...reviewed(), baseAnalysisRequiresReview: true }, "listing.event_outcome")?.availability, "unavailable");
  assert.equal(form25HumanMonitorField({ ...reviewed(), baseAnalysisRequiresReview: true }, "listing.exchange")?.availability, "unavailable");
  assert.equal(form25HumanMonitorField(reviewed(), "listing.exchange"), null);
  assert.equal(form25HumanMonitorField(reviewed(), "listing.event_outcome"), null);
});
test("primary narrative sends are blocked for human changes, pending review and successful retries with stale event payload", () => {
  assert.equal(form25AnalysisAllowsPrimaryAlert(reviewed()), false);
  assert.equal(form25AnalysisAllowsPrimaryAlert({ ...reviewed(), reviewState: "ORIGINAL" }), true);
  assert.equal(form25AnalysisAllowsPrimaryAlert({ ...reviewed(), reviewState: "ORIGINAL", history: [{ action: "retry_completed" }] }), false);
  assert.equal(form25AnalysisAllowsPrimaryAlert({ ...reviewed(), reviewState: "REVIEW" }), false);
  assert.equal(form25AnalysisAllowsPrimaryAlert({ status: "not_applicable" }), true);
});
test("read-only display attaches review without replacing original AI article or identity", () => {
  const row = { ticker: "TTOO", title: "Original title", summary: "Old AI", metadata: { display_payload: { previous: true } } };
  const before = JSON.stringify(row); const projected = projectForm25AnalysisEvent(row, reviewed());
  assert.equal(projected.ticker, "TTOO"); assert.equal(projected.title, "Original title"); assert.equal(projected.summary, "Old AI");
  assert.deepEqual((projected.metadata as Record<string, unknown>).display_payload, { previous: true }); assert.equal(JSON.stringify(row), before);
  const publicReview = (projected.metadata as Record<string, unknown>).form25_analysis_review as Form25AnalysisReviewRead;
  assert.equal(publicReview.analysis, undefined); assert.equal(publicReview.history, undefined);
  assert.equal(publicReview.baseVersion, undefined); assert.equal(publicReview.sourceEvidence?.[0].text, undefined);
});
