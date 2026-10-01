import assert from "node:assert/strict";
import test from "node:test";
import { readStockListingStatus } from "./stockListingStatusServer.ts";
import type { HistoryItem } from "../sec-listing-status/observation.ts";
import type { ListingDateReview } from "../sec-listing-status/review.ts";

// Adapter unit fixtures; not represented as live or source-validation evidence.
const id = "25000000-0000-4000-8000-000000000090";
const oid = "25000000-0000-4000-8000-000000000001";
const scope = { issuerCik: "0001476963", securityTitle: "Common Stock", exchange: "NYSE American" };
const accession = "0001079973-24-000891";
const url = `https://www.sec.gov/Archives/edgar/data/1476963/${accession.replaceAll("-", "")}/form8k.htm`;
function fixture() {
  const identity = { id, issuer_cik: scope.issuerCik, identity_payload: {
    before: { ...scope, tradingSymbol: "SCPX" }, after: { ...scope, tradingSymbol: "SCPX" },
  } };
  const attachment = { status: "attached" as const, securityIdentityId: id, decisionId: null,
    knownAt: "2024-05-14T12:00:00Z", proofHash: "a".repeat(64), reason: "validated_stable_sec_security_exchange" };
  const item: HistoryItem = { id: oid, usable: true, reason: null, observation: {
    version: "sec_listing_observation_v1", readerVersion: "sec_delisting_state_v3",
    rawItemId: oid, sourceHash: "a".repeat(64), eventId: null, listingRisk: null, evaluatedAsOf: "2024-06-17",
    filingDate: "2024-06-17", form: "8-K", accession, scope, attachment,
    reported: { listing: "removal_pending", trading: "unresolved", removalDate: null,
      suspensionDate: null, reasons: [], parserVersion: "unit_fixture", sources: [{ url, sha256: "a".repeat(64) }] },
    sourceSnapshot: { raw_payload: { private: "DO_NOT_EXPOSE" } },
  } };
  const projection = { asOf: "2026-10-01", scope, securityIdentityId: id,
    coverage: "stored_sec_observations_only" as const, listing: "removal_pending" as const,
    trading: "unresolved" as const, removalDate: null, suspensionDate: null,
    withdrawalNoticeDate: null, resumptionDate: null, reasons: ["trading_no_status_evidence"],
    observationIds: [oid], excludedObservations: [] as { id: string; reason: string; sourceHash: string }[],
    closedObservations: [] as { id: string; targetId: string; followUpId: string }[],
  };
  const review = { reviewStatus: "not_reviewed", reviewedFacts: null, documents: [],
    history: [{ actor_user_id: "DO_NOT_EXPOSE" }] } as unknown as ListingDateReview;
  let identities = [identity];
  const queries: Record<string, string>[] = [];
  const deps = {
    now: new Date("2026-10-01T12:00:00Z"),
    repository: { select: async (_table: string, query: Record<string, string>) => {
      queries.push(query); return { ok: true, status: 200, data: identities };
    }, rpc: async () => { throw Error("No writes allowed"); } },
    resolveAttachment: async () => attachment,
    readHistory: async () => [item],
    readAsOf: async () => projection,
    readReview: async () => review,
  };
  return { deps, identity, item, projection, review, attachment, queries,
    setIdentities: (values: typeof identities) => { identities = values; } };
}

test("missing identity stays unknown; no canonical state or ACTIVE is invented", async () => {
  const f = fixture(); f.setIdentities([]);
  const r = await readStockListingStatus("PLTR", f.deps);
  assert.equal(r.reason, "identity_unresolved"); assert.equal(r.automatic.listing, "unresolved");
  assert.equal(r.security, null); assert.deepEqual(r.sources, []);
  assert.match(f.queries[0].or, /tradingSymbol.eq.PLTR/);
});
test("same ticker on multiple securities is not resolved by choosing the first", async () => {
  const f = fixture(); f.setIdentities([f.identity, { ...f.identity, id: oid }]);
  assert.equal((await readStockListingStatus("SCPX", f.deps)).reason, "conflicting_evidence");
});
test("stored identity is discovery only; failed/wrong identity validation cannot expose facts", async () => {
  for (const status of ["unresolved", "conflict"] as const) {
    const f = fixture(); const r = await readStockListingStatus("SCPX", { ...f.deps,
      resolveAttachment: async () => ({ ...f.attachment, status, securityIdentityId: null }) });
    assert.equal(r.automatic.listing, "unresolved"); assert.equal(r.security, null);
  }
  const f = fixture(); const r = await readStockListingStatus("SCPX", { ...f.deps,
    resolveAttachment: async () => ({ ...f.attachment, securityIdentityId: oid }) });
  assert.equal(r.reason, "identity_unresolved");
});
test("old symbols and future identity evidence cannot claim today's canonical status", async () => {
  const f = fixture(); f.identity.identity_payload.after.tradingSymbol = "OTHER";
  assert.equal((await readStockListingStatus("SCPX", f.deps)).reason, "identity_unresolved");
  f.identity.identity_payload.after.tradingSymbol = "SCPX"; f.attachment.knownAt = "2027-01-01";
  assert.equal((await readStockListingStatus("SCPX", f.deps)).reason, "identity_unresolved");
});
test("copies official axes/dates without filling unknown date from filing date; whitelists sources", async () => {
  const f = fixture(); const r = await readStockListingStatus("SCPX", f.deps);
  assert.equal(r.availability, "available"); assert.equal(r.automatic.listing, "removal_pending");
  assert.equal(r.automatic.trading, "unresolved"); assert.equal(r.automatic.suspensionDate, null);
  assert.deepEqual(r.sources, [{ form: "8-K", accession, filingDate: "2024-06-17", url, role: "evidence" }]);
  assert.ok(!JSON.stringify(r).includes("DO_NOT_EXPOSE"));
});
test("unknown reviewed effective date is separate from automatic facts and original records", async () => {
  const f = fixture(); f.review.reviewStatus = "reviewed";
  f.review.documents = [{ id: "primary", url, sha256: "a".repeat(64), text: "source" }];
  const base = { sourceRef: "primary", sourceHash: "a".repeat(64), quote: "private full review quote" };
  f.review.reviewedFacts = { notice_date: { ...base, availability: "available", value: "2024-06-14" },
    suspension_effective_date: { ...base, availability: "unknown", value: null } };
  const before = JSON.stringify([f.item, f.review, f.projection]);
  const r = await readStockListingStatus("SCPX", f.deps);
  assert.equal(r.reviewedDates[0].value, "2024-06-14"); assert.equal(r.reviewedDates[1].value, null);
  assert.equal(r.automatic.suspensionDate, null); assert.equal(r.automatic.trading, "unresolved");
  assert.equal(JSON.stringify([f.item, f.review, f.projection]), before);
  f.review.reviewStatus = "stale_or_invalid";
  assert.deepEqual((await readStockListingStatus("SCPX", f.deps)).reviewedDates, []);
});
test("excluded observations cannot become public supporting sources or human facts", async () => {
  const f = fixture(); f.projection.excludedObservations.push({ id: oid, reason: "invalid", sourceHash: "a" });
  assert.deepEqual((await readStockListingStatus("SCPX", f.deps)).sources, []);
  f.projection.excludedObservations = []; f.projection.closedObservations.push({ id: oid, targetId: oid, followUpId: id });
  assert.equal((await readStockListingStatus("SCPX", f.deps)).sources[0].role, "closed_event");
});
test("non-SEC/mismatched-accession URLs never reach the public response", async () => {
  const f = fixture(); f.item.observation.reported.sources[0].url = "https://example.com/private";
  assert.deepEqual((await readStockListingStatus("SCPX", f.deps)).sources, []);
});
test("reader and permission failures are unavailable, not empty evidence; error details stay private", async () => {
  const f = fixture(); const r = await readStockListingStatus("SCPX", { ...f.deps,
    readAsOf: async () => { throw Error("private_database_detail"); } });
  assert.equal(r.availability, "unavailable"); assert.equal(r.reason, "reader_unavailable");
  assert.equal(r.security, null); assert.ok(!JSON.stringify(r).includes("private_database_detail"));
});
test("the reader's combined unresolved/conflicting reason is not represented as a proven conflict", async () => {
  const f = fixture(); f.projection.reasons = ["trading_evidence_unresolved_or_conflicting"];
  assert.equal((await readStockListingStatus("SCPX", f.deps)).reason, "evidence_unresolved_or_conflicting");
  f.projection.reasons = ["identity_conflict"];
  assert.equal((await readStockListingStatus("SCPX", f.deps)).reason, "conflicting_evidence");
});
