export type CalendarCandidateKind =
  | "event-registered"
  | "schedule-changed"
  | "postponed"
  | "cancelled"
  | "reminder-due"
  | "released"
  | "result-updated";

export function buildCalendarCandidateKey({
  eventId,
  eventRevision,
  kind,
  reminderMinutes,
}: {
  eventId: string;
  eventRevision: number;
  kind: CalendarCandidateKind;
  reminderMinutes?: number;
}) {
  const reminderPart =
    kind === "reminder-due" ? `:minutes:${Math.max(0, reminderMinutes ?? 0)}` : "";
  return `calendar:event:${eventId}:revision:${eventRevision}:kind:${kind}${reminderPart}`;
}

export function buildCalendarDeliveryDedupeKey({
  candidateId,
  userId,
  channel,
}: {
  candidateId: string;
  userId: string;
  channel: string;
}) {
  return `calendar:candidate:${candidateId}:user:${userId}:channel:${channel}`;
}

export function shouldSuppressStaleCalendarCandidate({
  candidateRevision,
  currentRevision,
}: {
  candidateRevision: number;
  currentRevision: number;
}) {
  return candidateRevision < currentRevision;
}

export function buildCalendarAlertTitle(
  kind: CalendarCandidateKind,
  eventTitle: string,
) {
  const title = eventTitle || "Calendar event";
  if (kind === "event-registered") return `Following: ${title}`;
  if (kind === "schedule-changed") return `Schedule changed: ${title}`;
  if (kind === "postponed") return `Postponed: ${title}`;
  if (kind === "cancelled") return `Cancelled: ${title}`;
  if (kind === "reminder-due") return `Upcoming: ${title}`;
  if (kind === "released") return `Released: ${title}`;
  return `Updated: ${title}`;
}
