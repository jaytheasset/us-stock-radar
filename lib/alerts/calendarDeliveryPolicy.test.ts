import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCalendarAlertTitle,
  buildCalendarCandidateKey,
  buildCalendarDeliveryDedupeKey,
  shouldSuppressStaleCalendarCandidate,
} from "./calendarDeliveryPolicy.ts";

test("calendar candidates and deliveries use stable event, revision, user, and channel keys", () => {
  assert.equal(
    buildCalendarCandidateKey({
      eventId: "event-1",
      eventRevision: 3,
      kind: "schedule-changed",
    }),
    "calendar:event:event-1:revision:3:kind:schedule-changed",
  );
  assert.equal(
    buildCalendarCandidateKey({
      eventId: "event-1",
      eventRevision: 3,
      kind: "reminder-due",
      reminderMinutes: 30,
    }),
    "calendar:event:event-1:revision:3:kind:reminder-due:minutes:30",
  );
  assert.equal(
    buildCalendarDeliveryDedupeKey({
      candidateId: "candidate-1",
      userId: "user-1",
      channel: "web",
    }),
    "calendar:candidate:candidate-1:user:user-1:channel:web",
  );
});

test("superseded calendar revisions are suppressed before delivery", () => {
  assert.equal(
    shouldSuppressStaleCalendarCandidate({
      candidateRevision: 2,
      currentRevision: 3,
    }),
    true,
  );
  assert.equal(
    shouldSuppressStaleCalendarCandidate({
      candidateRevision: 3,
      currentRevision: 3,
    }),
    false,
  );
});

test("calendar delivery titles distinguish follow, schedule, reminder, and cancellation", () => {
  assert.equal(buildCalendarAlertTitle("event-registered", "Earnings"), "Following: Earnings");
  assert.equal(buildCalendarAlertTitle("schedule-changed", "Earnings"), "Schedule changed: Earnings");
  assert.equal(buildCalendarAlertTitle("reminder-due", "Earnings"), "Upcoming: Earnings");
  assert.equal(buildCalendarAlertTitle("cancelled", "Earnings"), "Cancelled: Earnings");
});
