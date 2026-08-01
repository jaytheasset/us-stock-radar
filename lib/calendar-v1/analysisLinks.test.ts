import assert from "node:assert/strict";
import test from "node:test";
import {
  matchCalendarEventToAnalysis,
  selectPrimaryCalendarAnalysis,
  type CalendarAnalysisMatchRecord,
  type CalendarCompanyMatchRecord,
} from "./analysisLinks.ts";

const calendarBase: CalendarCompanyMatchRecord = {
  calendarEventId: "calendar-1",
  eventDate: "2026-08-06",
  eventType: "earnings",
  facts: {
    companyName: "Example Corp.",
    ticker: "EXM",
  },
};

const analysisBase: CalendarAnalysisMatchRecord = {
  analysisEventId: "11111111-1111-4111-8111-111111111111",
  analysisEventType: "earnings",
  calendarEventDate: "2026-08-06",
  calendarEventType: "earnings_release",
  facts: {
    companyName: "Example Corporation",
    ticker: "EXM",
  },
  publishedAt: "2026-08-06T20:00:00Z",
};

test("exact accession and trusted fiscal-period rules create high-confidence links", () => {
  const exact = matchCalendarEventToAnalysis(
    { ...calendarBase, facts: { ...calendarBase.facts, accessionNumber: "0000000000-26-000001" } },
    { ...analysisBase, facts: { ...analysisBase.facts, accessionNumber: "0000000000-26-000001" } },
  );
  assert.equal(exact.linkStatus, "linked");
  assert.equal(exact.matchMethod, "exact");
  assert.equal(exact.matchScore, 100);

  const sourceEventExact = matchCalendarEventToAnalysis(
    {
      ...calendarBase,
      facts: {
        ...calendarBase.facts,
        sourceEventId: analysisBase.analysisEventId,
      },
    },
    {
      ...analysisBase,
      analysisEventType: "other",
      facts: { ...analysisBase.facts, analysisEventId: analysisBase.analysisEventId },
    },
  );
  assert.equal(sourceEventExact.linkStatus, "linked");
  assert.equal(sourceEventExact.matchMethod, "exact");

  const rules = matchCalendarEventToAnalysis(
    {
      ...calendarBase,
      facts: { ...calendarBase.facts, fiscalPeriod: "2026 Q2", fiscalPeriodTrusted: true },
    },
    {
      ...analysisBase,
      facts: { ...analysisBase.facts, fiscalPeriod: "Q2 2026", fiscalPeriodTrusted: true },
    },
  );
  assert.equal(rules.linkStatus, "linked");
  assert.ok(rules.matchScore >= 90);
});

test("same ticker and date alone cannot link earnings and fiscal-period mismatch rejects", () => {
  const dateOnly = matchCalendarEventToAnalysis(calendarBase, analysisBase);
  assert.equal(dateOnly.linkStatus, "rejected");
  assert.ok(dateOnly.matchScore < 70);

  const mismatch = matchCalendarEventToAnalysis(
    {
      ...calendarBase,
      facts: { ...calendarBase.facts, fiscalPeriod: "2026 Q2", fiscalPeriodTrusted: true },
    },
    {
      ...analysisBase,
      facts: { ...analysisBase.facts, fiscalPeriod: "2026 Q1", fiscalPeriodTrusted: true },
    },
  );
  assert.deepEqual(mismatch.reason.codes, ["earnings_fiscal_period_mismatch"]);
});

test("dividend date kinds and amounts must describe the same occurrence", () => {
  const calendar: CalendarCompanyMatchRecord = {
    calendarEventId: "calendar-dividend",
    eventDate: "2026-08-10",
    eventType: "dividend",
    facts: { companyName: "Example Corp", dividendAmount: 0.25, ticker: "EXM" },
  };
  const wrongKind = matchCalendarEventToAnalysis(calendar, {
    ...analysisBase,
    analysisEventType: "dividends",
    calendarEventDate: "2026-08-10",
    calendarEventType: "dividend_record_date",
    facts: { ...analysisBase.facts, dividendAmount: 0.25, dividendDateKind: "record" },
  });
  assert.deepEqual(wrongKind.reason.codes, ["dividend_date_kind_mismatch"]);

  const linked = matchCalendarEventToAnalysis(calendar, {
    ...analysisBase,
    analysisEventType: "dividends",
    calendarEventDate: "2026-08-10",
    calendarEventType: "ex_dividend_date",
    facts: { ...analysisBase.facts, dividendAmount: 0.25, dividendDateKind: "ex-dividend" },
  });
  assert.equal(linked.linkStatus, "linked");
});

test("split ratio mismatch blocks a date coincidence", () => {
  const calendar: CalendarCompanyMatchRecord = {
    calendarEventId: "calendar-split",
    eventDate: "2026-08-12",
    eventType: "split",
    facts: { companyName: "Example Corp", effectiveDate: "2026-08-12", splitRatio: "1:10", ticker: "EXM" },
  };
  const mismatch = matchCalendarEventToAnalysis(calendar, {
    ...analysisBase,
    analysisEventType: "capital_return",
    calendarEventDate: "2026-08-12",
    calendarEventType: "stock_split_effective_date",
    facts: { ...analysisBase.facts, effectiveDate: "2026-08-12", splitRatio: "1:5" },
  });
  assert.deepEqual(mismatch.reason.codes, ["split_ratio_mismatch"]);

  const linked = matchCalendarEventToAnalysis(calendar, {
    ...analysisBase,
    analysisEventType: "capital_return",
    calendarEventDate: "2026-08-12",
    calendarEventType: "stock_split_effective_date",
    facts: { ...analysisBase.facts, effectiveDate: "2026-08-12", splitRatio: "10-for-100" },
  });
  assert.equal(linked.linkStatus, "linked");
});

test("IPO company, exchange, symbol, and date without offer terms remain a candidate", () => {
  const decision = matchCalendarEventToAnalysis(
    {
      calendarEventId: "calendar-ipo",
      eventDate: "2026-08-20",
      eventType: "ipo",
      facts: { companyName: "Example Holdings", exchange: "NASDAQ", symbol: "EXM", ticker: "EXM" },
    },
    {
      ...analysisBase,
      analysisEventType: "ipo_listing",
      calendarEventDate: "2026-08-20",
      calendarEventType: "ipo_expected_date",
      facts: { companyName: "Example Holdings Inc.", exchange: "NASDAQ", symbol: "EXM", ticker: "EXM" },
    },
  );
  assert.equal(decision.linkStatus, "candidate");
  assert.equal(decision.matchScore, 89);
});

test("amendments remain related while a deterministic result becomes primary", () => {
  const announcement = {
    ...matchCalendarEventToAnalysis(
      { ...calendarBase, facts: { ...calendarBase.facts, accessionNumber: "0000000000-26-000001" } },
      { ...analysisBase, facts: { ...analysisBase.facts, accessionNumber: "0000000000-26-000001" } },
    ),
    matchScore: 95,
  };
  const amendment = {
    ...announcement,
    analysisEventId: "22222222-2222-4222-8222-222222222222",
    relationType: "amendment" as const,
  };
  const result = {
    ...announcement,
    analysisEventId: "33333333-3333-4333-8333-333333333333",
    relationType: "result" as const,
  };
  const decisions = [announcement, amendment, result];
  assert.equal(decisions.length, 3);
  assert.equal(selectPrimaryCalendarAnalysis(decisions)?.analysisEventId, result.analysisEventId);
  assert.equal(selectPrimaryCalendarAnalysis(decisions)?.analysisEventId, result.analysisEventId);

  const distinctAmendmentAccession = matchCalendarEventToAnalysis(
    {
      ...calendarBase,
      facts: {
        ...calendarBase.facts,
        accessionNumber: "0000000000-26-000001",
        fiscalPeriod: "2026 Q2",
        fiscalPeriodTrusted: true,
      },
    },
    {
      ...analysisBase,
      facts: {
        ...analysisBase.facts,
        accessionNumber: "0000000000-26-000002",
        fiscalPeriod: "Q2 2026",
        fiscalPeriodTrusted: true,
      },
      relationType: "amendment",
    },
  );
  assert.equal(distinctAmendmentAccession.linkStatus, "linked");
  assert.equal(distinctAmendmentAccession.relationType, "amendment");
});
