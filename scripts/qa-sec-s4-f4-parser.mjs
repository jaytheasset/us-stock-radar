#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseSecS4F4Filing } from "../lib/sources/sec/forms/s4-f4/parser.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturePath = resolve(__dirname, "../lib/sources/sec/forms/s4-f4/fixtures/sample-filings.json");
const fixtures = JSON.parse(readFileSync(fixturePath, "utf8"));
const checks = [];
const samples = [];

for (const fixture of fixtures) {
  const parsed = parseSecS4F4Filing(fixture.input);
  const summary = summarize(fixture.name, parsed);
  samples.push(summary);
  check(`${fixture.name} is supported`, parsed.isSupported, summary);
  checkExpected(fixture, parsed, summary);
}

const failed = checks.filter((item) => !item.ok);
console.log(
  JSON.stringify(
    {
      ok: failed.length === 0,
      summary: {
        fixture_count: fixtures.length,
        checks_passed: checks.length - failed.length,
        checks_failed: failed.length,
      },
      samples,
      checks,
    },
    null,
    2,
  ),
);
process.exitCode = failed.length === 0 ? 0 : 1;

function checkExpected(fixture, parsed, summary) {
  const expected = fixture.expect || {};
  if (expected.form_type) {
    check(`${fixture.name} extracts form type`, parsed.facts.form_type === expected.form_type, summary);
  }
  if (expected.deal_type) {
    check(`${fixture.name} extracts deal type`, parsed.facts.transaction.deal_type?.value === expected.deal_type, summary);
  }
  if (typeof expected.shares_to_be_issued === "number") {
    check(
      `${fixture.name} extracts issued shares`,
      parsed.facts.transaction.shares_to_be_issued?.value === expected.shares_to_be_issued,
      summary,
    );
  }
  if (expected.meeting_date) {
    check(`${fixture.name} extracts meeting date`, parsed.facts.shareholder_vote.meeting_date?.value === expected.meeting_date, summary);
  }
  if (expected.record_date) {
    check(`${fixture.name} extracts record date`, parsed.facts.shareholder_vote.record_date?.value === expected.record_date, summary);
  }
  if (typeof expected.limited_scope_amendment === "boolean") {
    check(
      `${fixture.name} detects limited-scope amendment`,
      parsed.facts.amendment.appears_limited_scope === expected.limited_scope_amendment,
      summary,
    );
  }
  if (typeof expected.amendment_number === "number") {
    check(
      `${fixture.name} extracts amendment number`,
      parsed.facts.amendment.amendment_number?.value === expected.amendment_number,
      summary,
    );
  }
  if (typeof expected.calendar_event_count_at_least === "number") {
    check(`${fixture.name} extracts calendar candidates`, parsed.calendarItems.length >= expected.calendar_event_count_at_least, summary);
  }
}

function summarize(name, parsed) {
  return {
    name,
    parser_version: parsed.parserVersion,
    form_type: parsed.facts.form_type,
    deal_type: parsed.facts.transaction.deal_type?.value || null,
    parties: parsed.facts.transaction.parties.map((party) => ({ name: party.name, role: party.role })),
    consideration_present: Boolean(parsed.facts.transaction.consideration),
    exchange_ratio: parsed.facts.transaction.exchange_ratio?.value || null,
    securities_registered: parsed.facts.transaction.securities_registered.map((item) => item.value),
    shares_to_be_issued: parsed.facts.transaction.shares_to_be_issued?.value || null,
    meeting_date: parsed.facts.shareholder_vote.meeting_date?.value || null,
    record_date: parsed.facts.shareholder_vote.record_date?.value || null,
    amendment: {
      is_amendment: parsed.facts.amendment.is_amendment,
      amendment_number: parsed.facts.amendment.amendment_number?.value || null,
      appears_limited_scope: parsed.facts.amendment.appears_limited_scope,
    },
    calendar_items: parsed.calendarItems.map((item) => ({
      calendar_event_type: item.calendarEventType,
      event_date: item.eventDate || null,
      date_precision: item.datePrecision || null,
    })),
    extracted_field_count: parsed.facts.extracted_field_count,
    needs_human_review: parsed.facts.needs_human_review,
    review_reasons: parsed.facts.review_reasons,
  };
}

function check(name, ok, detail) {
  checks.push({ name, ok: Boolean(ok), detail: ok ? undefined : detail });
}
