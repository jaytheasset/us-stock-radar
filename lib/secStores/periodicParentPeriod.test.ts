import assert from "node:assert/strict";

import {
  isMatchingNtLifecyclePeriod,
  normalizePeriodicReportingPeriod,
  readPeriodicReportingPeriodFromFilingPackage,
  readPeriodicReportingPeriodFromRawRow,
} from "./periodicParentPeriod";

assert.equal(normalizePeriodicReportingPeriod("December 31, 2025"), "2025-12-31");
assert.equal(normalizePeriodicReportingPeriod("Dec. 31, 2025"), "2025-12-31");
assert.equal(normalizePeriodicReportingPeriod("2025-12-31"), "2025-12-31");
assert.equal(normalizePeriodicReportingPeriod("2025-02-30"), "");

assert.equal(
  readPeriodicReportingPeriodFromRawRow({
    raw_payload: {
      periodic_report_core_xbrl_facts: [
        {
          name: "dei:DocumentPeriodEndDate",
          value: "2025-12-31",
          period: "2025-12-31",
        },
      ],
    },
    body_text: "The registrant also discusses an older year ended December 31, 2021.",
  }),
  "2025-12-31",
);

assert.equal(
  readPeriodicReportingPeriodFromRawRow({
    raw_payload: {
      primary_document_url: "https://www.sec.gov/Archives/edgar/data/1876042/crcl-20251231.htm",
    },
  }),
  "2025-12-31",
);

assert.equal(
  readPeriodicReportingPeriodFromFilingPackage({
    hard_parsers: {
      nt: {
        facts: {
          periodOfReport: "December 31, 2025",
        },
      },
    },
  }),
  "2025-12-31",
);

assert.equal(
  readPeriodicReportingPeriodFromRawRow({
    body_text: "FORM 12b-25 NOTIFICATION OF LATE FILING\nFor Period Ended: March 31, 2026",
  }),
  "2026-03-31",
);

assert.equal(isMatchingNtLifecyclePeriod({
  reportForm: "10-Q",
  noticeForm: "NT 10-Q/A",
  reportPeriod: "2026-03-31",
  noticePeriod: "March 31, 2026",
}), true);
assert.equal(isMatchingNtLifecyclePeriod({
  reportForm: "10-Q",
  noticeForm: "NT 10-Q",
  reportPeriod: "2026-03-31",
  noticePeriod: "2025-12-31",
}), false);

console.log("periodic parent reporting-period tests passed");
