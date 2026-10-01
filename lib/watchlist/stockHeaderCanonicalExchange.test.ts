import assert from "node:assert/strict";
import test from "node:test";
import { readStockHeaderCanonicalExchange } from "./stockHeaderCanonicalExchange.ts";
import type { Attachment } from "../sec-listing-status/observation.ts";

const id = "11111111-1111-4111-8111-111111111111", cik = "0001476963";
const identity = { id, issuer_cik: cik, identity_payload: {
  before: { tradingSymbol: "SCPX" }, after: { tradingSymbol: "SCPX", securityTitle: "Common Stock", exchange: "NYSE American" },
} };
const attached: Attachment = { status: "attached", securityIdentityId: id, decisionId: null,
  knownAt: "2024-05-01T12:00:00Z", proofHash: "a".repeat(64), reason: "validated_stable_sec_security_exchange" };

function deps(data: unknown[] = [identity], result: Attachment = attached) {
  return {
    now: new Date("2026-10-01"),
    repository: { select: async (table: string) => {
      assert.equal(table, "sec_ticker_security_identities");
      return { ok: true, status: 200, data };
    }, rpc: async () => { throw Error("no writes"); } },
    resolveAttachment: async (scope: unknown, _repo: unknown, date?: string) => {
      assert.deepEqual(scope, { issuerCik: cik, securityTitle: "Common Stock", exchange: "NYSE American" });
      assert.equal(date, "2026-10-01"); return result;
    },
  };
}

test("exact current pair is revalidated through today, without reading status history", async () => {
  assert.equal(await readStockHeaderCanonicalExchange("SCPX", cik, deps()), "NYSE American");
});
test("ambiguous securities, wrong issuer and changed/historical symbols stay unavailable", async () => {
  for (const rows of [[], [identity, { ...identity, id: "22222222-2222-4222-8222-222222222222" }],
    [{ ...identity, issuer_cik: "0000000001" }],
    [{ ...identity, identity_payload: { ...identity.identity_payload, before: { tradingSymbol: "OLD" } } }],
    [{ ...identity, identity_payload: { ...identity.identity_payload, after: { ...identity.identity_payload.after, tradingSymbol: "NEW" } } }]]) {
    const input = deps(rows);
    input.resolveAttachment = async () => { throw Error("must not select unsafe identity"); };
    assert.equal(await readStockHeaderCanonicalExchange("SCPX", cik, input), "");
  }
});
test("failed source validation, changed class/exchange, stale or future identity cannot supply exchange", async () => {
  for (const result of [
    { ...attached, status: "unresolved" as const }, { ...attached, status: "conflict" as const },
    { ...attached, reason: "stable_identity_transition_or_ambiguity_requires_change_evidence" },
    { ...attached, securityIdentityId: "22222222-2222-4222-8222-222222222222" },
    { ...attached, knownAt: "2027-01-01T00:00:00Z" },
  ]) assert.equal(await readStockHeaderCanonicalExchange("SCPX", cik, deps([identity], result)), "");
});
