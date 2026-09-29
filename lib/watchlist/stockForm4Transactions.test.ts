import assert from "node:assert/strict";
import { test } from "node:test";
import type { CurrentOwnershipReadResult } from "../monitor/ownershipMonitorPersistence.ts";
import { projectStockForm4Transactions } from "./stockForm4Transactions.ts";

const row = {
  symbol: "TEST",
  transaction_index: 0,
  transaction_date: "2026-09-01",
  transaction_code: "P",
  security_title: "Common Stock",
  shares: 33407,
  price_per_share: 5.56,
  direct_or_indirect_ownership: "I",
  reporting_owner_names: ["Company LLC", "Jane Doe"],
};
const inventory = {
  rows: [{
    rowRef: "row:form4:0",
    ownerNames: ["Company LLC", "Jane Doe"],
    ownerRefs: ["owner:form4:0:0", "owner:form4:0:1"],
  }],
  footnotes: [{ footnoteRef: "footnote:F3", xmlId: "F3", text: "Exact SEC footnote" }],
};
const base = {
  status: "available",
  form: "form4",
  filingForm: "4",
  eventId: "00000000-0000-4000-8000-000000000001",
  accessionNumber: "0000000000-26-000001",
  filedAt: "2026-09-02T00:00:00Z",
  rows: [row],
  contextEligibility: { status: "eligible", inventory },
};

test("multi-owner relations use accepted owner refs rather than the row D/I code", () => {
  const current = {
    ...base,
    context: {
      status: "available",
      rows: [{
        rowRef: "row:form4:0",
        context: { assertions: [
          { fact: "ownership_relation", status: "supported", value: "direct", owner_ref: "owner:form4:0:0", footnote_ref: "footnote:F3" },
          { fact: "ownership_relation", status: "supported", value: "indirect", owner_ref: "owner:form4:0:1", footnote_ref: "footnote:F3" },
        ] },
      }],
    },
  } as unknown as CurrentOwnershipReadResult;
  const [transaction] = projectStockForm4Transactions(current, "TEST");
  assert.equal(transaction?.shares, 33407);
  assert.deepEqual(transaction?.reportingOwners, [
    { name: "Company LLC", relation: "direct", footnoteIds: ["F3"] },
    { name: "Jane Doe", relation: "indirect", footnoteIds: ["F3"] },
  ]);
});

test("missing or stale context omits only the owner relation", () => {
  for (const status of ["absent", "stale"] as const) {
    const current = {
      ...base,
      context: { status },
    } as unknown as CurrentOwnershipReadResult;
    const [transaction] = projectStockForm4Transactions(current, "TEST");
    assert.equal(transaction?.transactionCode, "P");
    assert.equal(transaction?.shares, 33407);
    assert.deepEqual(transaction?.reportingOwners.map((owner) => owner.relation), [null, null]);
  }
});
