import type { SecFormParserInput } from "../common/parserContract";
import { parseSecS4F4Filing } from "./parser";

export type SecS4F4ParserFixture = {
  name: string;
  input: SecFormParserInput;
  expect: {
    form_type?: string;
    deal_type?: string;
    shares_to_be_issued?: number;
    meeting_date?: string;
    record_date?: string;
    limited_scope_amendment?: boolean;
    amendment_number?: number;
    calendar_event_count_at_least?: number;
  };
};

export function checkSecS4F4ParserFixture(fixture: SecS4F4ParserFixture) {
  const parsed = parseSecS4F4Filing(fixture.input);
  const expected = fixture.expect;
  const failures: string[] = [];

  if (expected.form_type && parsed.facts.form_type !== expected.form_type) {
    failures.push(`expected form_type ${expected.form_type}, got ${parsed.facts.form_type}`);
  }
  if (expected.deal_type && parsed.facts.transaction.deal_type?.value !== expected.deal_type) {
    failures.push(`expected deal_type ${expected.deal_type}, got ${parsed.facts.transaction.deal_type?.value || "null"}`);
  }
  if (
    typeof expected.shares_to_be_issued === "number" &&
    parsed.facts.transaction.shares_to_be_issued?.value !== expected.shares_to_be_issued
  ) {
    failures.push(
      `expected shares_to_be_issued ${expected.shares_to_be_issued}, got ${
        parsed.facts.transaction.shares_to_be_issued?.value ?? "null"
      }`,
    );
  }
  if (expected.meeting_date && parsed.facts.shareholder_vote.meeting_date?.value !== expected.meeting_date) {
    failures.push(`expected meeting_date ${expected.meeting_date}, got ${parsed.facts.shareholder_vote.meeting_date?.value || "null"}`);
  }
  if (expected.record_date && parsed.facts.shareholder_vote.record_date?.value !== expected.record_date) {
    failures.push(`expected record_date ${expected.record_date}, got ${parsed.facts.shareholder_vote.record_date?.value || "null"}`);
  }
  if (
    typeof expected.limited_scope_amendment === "boolean" &&
    parsed.facts.amendment.appears_limited_scope !== expected.limited_scope_amendment
  ) {
    failures.push(
      `expected limited_scope_amendment ${expected.limited_scope_amendment}, got ${parsed.facts.amendment.appears_limited_scope}`,
    );
  }
  if (
    typeof expected.amendment_number === "number" &&
    parsed.facts.amendment.amendment_number?.value !== expected.amendment_number
  ) {
    failures.push(`expected amendment_number ${expected.amendment_number}, got ${parsed.facts.amendment.amendment_number?.value ?? "null"}`);
  }
  if (
    typeof expected.calendar_event_count_at_least === "number" &&
    (parsed.calendarItems || []).length < expected.calendar_event_count_at_least
  ) {
    failures.push(`expected at least ${expected.calendar_event_count_at_least} calendar events, got ${(parsed.calendarItems || []).length}`);
  }

  return {
    ok: failures.length === 0,
    failures,
    parsed,
  };
}
