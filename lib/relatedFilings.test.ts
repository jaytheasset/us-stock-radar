import assert from "node:assert/strict";
import test from "node:test";
import { selectRelatedFilingRows } from "./relatedFilings.ts";

test("selects related filings through event ticker links and issuer/form/time context", () => {
  const selected = selectRelatedFilingRows({
    candidates: [
      {
        id: "linked",
        ticker: "",
        _linked_tickers: ["ACME"],
        detected_at: "2026-07-20T12:00:00Z",
        metadata: { form_type: "8-K/A", issuer: "Acme, Inc." },
      },
      {
        id: "issuer",
        ticker: "",
        detected_at: "2026-07-19T12:00:00Z",
        metadata: { form_type: "8-K", issuer: "Acme Corporation" },
      },
      {
        id: "unrelated",
        ticker: "OTHER",
        detected_at: "2026-07-21T12:00:00Z",
        metadata: { form_type: "8-K", issuer: "Other Corp" },
      },
    ],
    currentDate: "2026-07-21T12:00:00Z",
    currentId: "current",
    formType: "8-K",
    issuer: "Acme Inc",
    ticker: "ACME",
  });

  assert.deepEqual(selected.map((row) => row.id), ["linked", "issuer"]);
});
