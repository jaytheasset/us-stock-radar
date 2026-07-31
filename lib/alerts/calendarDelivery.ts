import "server-only";

import {
  supabaseSelect,
  supabaseUpdate,
  supabaseUpsert,
} from "@/lib/supabase";
import {
  buildCalendarAlertTitle,
  buildCalendarCandidateKey,
  buildCalendarDeliveryDedupeKey,
  shouldSuppressStaleCalendarCandidate,
  type CalendarCandidateKind,
} from "@/lib/alerts/calendarDeliveryPolicy";
import type { CalendarAlertDeliveryResult } from "@/lib/alerts/delivery/types";

export type CalendarAlertCandidate = {
  id: string;
  eventId: string;
  eventRevision: number;
  kind: CalendarCandidateKind;
  candidateKey: string;
  payload: Record<string, unknown>;
};

type CandidateRow = {
  id?: unknown;
  event_id?: unknown;
  event_revision?: unknown;
  candidate_kind?: unknown;
  candidate_key?: unknown;
  payload?: unknown;
};

type FollowRow = {
  id?: unknown;
  user_id?: unknown;
  event_id?: unknown;
  enabled?: unknown;
};

type DeliveryChannelRow = {
  enabled?: unknown;
};

type EventRow = Record<string, unknown>;

export async function ensureCalendarCandidate({
  eventId,
  eventRevision,
  kind,
  availableAt,
  payload,
  reminderMinutes,
}: {
  eventId: string;
  eventRevision: number;
  kind: CalendarCandidateKind;
  availableAt: string;
  payload: Record<string, unknown>;
  reminderMinutes?: number;
}): Promise<CalendarAlertCandidate> {
  const candidateKey = buildCalendarCandidateKey({
    eventId,
    eventRevision,
    kind,
    reminderMinutes,
  });
  const existingResult = await supabaseSelect("calendar_alert_candidates", {
    select: "id,event_id,event_revision,candidate_kind,candidate_key,payload",
    candidate_key: `eq.${candidateKey}`,
    limit: "1",
  });
  const existing = Array.isArray(existingResult.data)
    ? mapCandidate(existingResult.data[0] as CandidateRow | undefined)
    : null;
  if (existing) return existing;

  const result = await supabaseUpsert(
    "calendar_alert_candidates",
    {
      event_id: eventId,
      event_revision: eventRevision,
      candidate_kind: kind,
      candidate_key: candidateKey,
      available_at: availableAt,
      status: "pending",
      payload,
    },
    {
      onConflict: "candidate_key",
      prefer: "resolution=merge-duplicates,return=representation",
    },
  );
  if (!result.ok) {
    throw new Error(result.error || "Failed to create calendar alert candidate.");
  }
  const row = Array.isArray(result.data)
    ? (result.data[0] as CandidateRow | undefined)
    : undefined;
  const candidate = mapCandidate(row);
  if (!candidate) throw new Error("Calendar alert candidate response was invalid.");
  return candidate;
}

export async function deliverCalendarCandidateToUser({
  candidate,
  event,
  followId,
  userId,
  webDeliveryEnabled,
}: {
  candidate: CalendarAlertCandidate;
  event: EventRow;
  followId: string;
  userId: string;
  webDeliveryEnabled?: boolean;
}) {
  const deliveryEnabled =
    webDeliveryEnabled ?? (await isWebDeliveryEnabled(userId));
  if (!deliveryEnabled) {
    return { delivered: false, duplicate: false, disabled: true };
  }

  const idempotencyKey = buildCalendarDeliveryDedupeKey({
    candidateId: candidate.id,
    userId,
    channel: "web",
  });
  const existing = await supabaseSelect("user_alert_deliveries", {
    select: "id",
    user_id: `eq.${userId}`,
    dedupe_key: `eq.${idempotencyKey}`,
    limit: "1",
  });
  if (Array.isArray(existing.data) && existing.data.length > 0) {
    return { delivered: false, duplicate: true, disabled: false };
  }

  const now = new Date().toISOString();
  const title = buildCalendarAlertTitle(candidate.kind, stringValue(event.title));
  const result = await supabaseUpsert("user_alert_deliveries", {
    user_id: userId,
    alert_event_id: null,
    calendar_event_id: candidate.eventId,
    ticker: nullableString(event.ticker),
    title,
    category: mapCalendarEventTypeToCategory(stringValue(event.event_type)),
    source_type: "calendar",
    source_label: "Calendar",
    alert_lane: "calendar_follow",
    severity: candidate.kind === "cancelled" ? "high" : "medium",
    delivered_channels: ["web"],
    delivery_status: "sent",
    delivered_at: now,
    scheduled_for: now,
    sent_at: now,
    attempted_at: now,
    last_error: null,
    dedupe_key: idempotencyKey,
  });

  if (!result.ok && (result.status === 409 || /duplicate|unique/i.test(result.error || ""))) {
    return { delivered: false, duplicate: true, disabled: false };
  }
  if (!result.ok) {
    await recordCalendarDeliveryAttempt({
      candidate,
      followId,
      userId,
      idempotencyKey,
      status: "failed",
      error: result.error || "Failed to create in-app calendar alert.",
    });
    throw new Error(result.error || "Failed to create in-app calendar alert.");
  }

  await recordCalendarDeliveryAttempt({
    candidate,
    followId,
    userId,
    idempotencyKey,
    status: "sent",
  });
  return { delivered: true, duplicate: false, disabled: false };
}

export async function runCalendarAlertDelivery({
  write,
  limit = 100,
}: {
  write: boolean;
  limit?: number;
}): Promise<CalendarAlertDeliveryResult> {
  if (write) await enqueueDueCalendarReminders();

  const candidateResult = await supabaseSelect("calendar_alert_candidates", {
    select: "id,event_id,event_revision,candidate_kind,candidate_key,payload,available_at,status",
    status: "in.(pending,failed)",
    available_at: `lte.${new Date().toISOString()}`,
    order: "available_at.asc",
    limit: String(Math.max(1, Math.min(limit, 250))),
  });
  if (!candidateResult.ok) {
    return {
      ok: false,
      write,
      scanned: 0,
      delivered: 0,
      duplicates: 0,
      disabled: 0,
      suppressed: 0,
      failed: 0,
      error: candidateResult.error || "Failed to read calendar alert candidates.",
    };
  }

  const candidates = (Array.isArray(candidateResult.data)
    ? candidateResult.data
    : []
  )
    .map((row) => mapCandidate(row as CandidateRow))
    .filter((candidate): candidate is CalendarAlertCandidate => Boolean(candidate));
  let delivered = 0;
  let duplicates = 0;
  let disabled = 0;
  let suppressed = 0;
  let failed = 0;

  for (const candidate of candidates) {
    const [eventResult, securityResult] = await Promise.all([
      supabaseSelect("calendar_events", {
        select:
          "id,title,event_type,event_date,event_time,event_instant,lifecycle_status,current_revision,impact_level",
        id: `eq.${candidate.eventId}`,
        limit: "1",
      }),
      supabaseSelect("calendar_event_securities", {
        select: "ticker,role",
        event_id: `eq.${candidate.eventId}`,
        order: "role.asc",
        limit: "20",
      }),
    ]);
    const event = Array.isArray(eventResult.data)
      ? (eventResult.data[0] as EventRow | undefined)
      : undefined;
    if (!event) {
      suppressed += 1;
      if (write) {
        await supabaseUpdate(
          "calendar_alert_candidates",
          { id: `eq.${candidate.id}` },
          { status: "cancelled", updated_at: new Date().toISOString() },
        );
      }
      continue;
    }
    const eventWithTicker = {
      ...event,
      ticker: readPrimaryTicker(securityResult.data),
    };

    const currentRevision = numberValue(event.current_revision, 1);
    if (
      shouldSuppressStaleCalendarCandidate({
        candidateRevision: candidate.eventRevision,
        currentRevision,
      })
    ) {
      suppressed += 1;
      if (write) {
        await supabaseUpdate(
          "calendar_alert_candidates",
          { id: `eq.${candidate.id}` },
          { status: "cancelled", updated_at: new Date().toISOString() },
        );
      }
      continue;
    }

    const followResult = await supabaseSelect("user_calendar_event_follows", {
      select: "id,user_id,event_id,enabled",
      event_id: `eq.${candidate.eventId}`,
      enabled: "eq.true",
      limit: "1000",
    });
    const follows = Array.isArray(followResult.data)
      ? (followResult.data as FollowRow[])
      : [];
    const eligibleFollows =
      candidate.kind === "reminder-due"
        ? await filterFollowsWithReminder(follows, candidate)
        : follows;

    if (!write) {
      delivered += eligibleFollows.length;
      continue;
    }

    let candidateFailed = false;
    for (const follow of eligibleFollows) {
      const followId = stringValue(follow.id);
      const userId = stringValue(follow.user_id);
      if (!followId || !userId) continue;
      try {
        const result = await deliverCalendarCandidateToUser({
          candidate,
          event: eventWithTicker,
          followId,
          userId,
        });
        if (result.duplicate) duplicates += 1;
        if (result.disabled) disabled += 1;
        if (result.delivered) delivered += 1;
      } catch {
        failed += 1;
        candidateFailed = true;
      }
    }

    await supabaseUpdate(
      "calendar_alert_candidates",
      { id: `eq.${candidate.id}` },
      {
        status: candidateFailed ? "failed" : "completed",
        updated_at: new Date().toISOString(),
      },
    );
  }

  return {
    ok: failed === 0,
    write,
    scanned: candidates.length,
    delivered,
    duplicates,
    disabled,
    suppressed,
    failed,
    error: failed
      ? `${failed} Calendar delivery attempt(s) failed and remain eligible for a deduplicated rerun.`
      : undefined,
  };
}

async function isWebDeliveryEnabled(userId: string) {
  const result = await supabaseSelect("user_delivery_channels", {
    select: "enabled",
    user_id: `eq.${userId}`,
    channel: "eq.web",
    limit: "1",
  });
  if (!result.ok) {
    throw new Error(result.error || "Failed to read in-app delivery settings.");
  }
  const row = Array.isArray(result.data)
    ? (result.data[0] as DeliveryChannelRow | undefined)
    : undefined;
  return row ? row.enabled === true : true;
}

async function enqueueDueCalendarReminders() {
  const followResult = await supabaseSelect("user_calendar_event_follows", {
    select: "id,event_id,user_id",
    enabled: "eq.true",
    limit: "1000",
  });
  const follows = Array.isArray(followResult.data)
    ? (followResult.data as FollowRow[])
    : [];
  const followIds = uniqueStrings(follows.map((row) => stringValue(row.id)));
  const eventIds = uniqueStrings(follows.map((row) => stringValue(row.event_id)));
  if (!followIds.length || !eventIds.length) return;

  const [ruleResult, eventResult] = await Promise.all([
    supabaseSelect("calendar_reminder_rules", {
      select: "follow_id,minutes_before,channel,enabled",
      follow_id: `in.(${followIds.join(",")})`,
      channel: "eq.web",
      enabled: "eq.true",
      limit: "2000",
    }),
    supabaseSelect("calendar_events", {
      select: "id,current_revision,event_instant,lifecycle_status",
      id: `in.(${eventIds.join(",")})`,
      lifecycle_status: "in.(scheduled,postponed)",
      limit: String(eventIds.length),
    }),
  ]);
  const rules = Array.isArray(ruleResult.data)
    ? (ruleResult.data as Record<string, unknown>[])
    : [];
  const events = Array.isArray(eventResult.data)
    ? (eventResult.data as EventRow[])
    : [];
  const followById = new Map(
    follows.map((follow) => [stringValue(follow.id), follow]),
  );
  const eventById = new Map(
    events.map((event) => [stringValue(event.id), event]),
  );
  const now = Date.now();

  for (const rule of rules) {
    const follow = followById.get(stringValue(rule.follow_id));
    const event = eventById.get(stringValue(follow?.event_id));
    const eventInstant = Date.parse(stringValue(event?.event_instant));
    const minutesBefore = numberValue(rule.minutes_before, 30);
    if (!Number.isFinite(eventInstant)) continue;
    const dueAt = eventInstant - minutesBefore * 60_000;
    if (dueAt > now || eventInstant <= now) continue;

    await ensureCalendarCandidate({
      eventId: stringValue(event?.id),
      eventRevision: numberValue(event?.current_revision, 1),
      kind: "reminder-due",
      reminderMinutes: minutesBefore,
      availableAt: new Date(dueAt).toISOString(),
      payload: { minutesBefore },
    });
  }
}

async function filterFollowsWithReminder(
  follows: FollowRow[],
  candidate: CalendarAlertCandidate,
) {
  const followIds = uniqueStrings(follows.map((row) => stringValue(row.id)));
  if (!followIds.length) return [];
  const minutesBefore = numberValue(candidate.payload.minutesBefore, 30);
  const result = await supabaseSelect("calendar_reminder_rules", {
    select: "follow_id",
    follow_id: `in.(${followIds.join(",")})`,
    minutes_before: `eq.${minutesBefore}`,
    channel: "eq.web",
    enabled: "eq.true",
    limit: String(followIds.length),
  });
  const eligibleIds = new Set(
    (Array.isArray(result.data) ? result.data : []).map((row) =>
      stringValue((row as Record<string, unknown>).follow_id),
    ),
  );
  return follows.filter((follow) => eligibleIds.has(stringValue(follow.id)));
}

async function recordCalendarDeliveryAttempt({
  candidate,
  followId,
  userId,
  idempotencyKey,
  status,
  error,
}: {
  candidate: CalendarAlertCandidate;
  followId: string;
  userId: string;
  idempotencyKey: string;
  status: "sent" | "failed";
  error?: string;
}) {
  const now = new Date().toISOString();
  return supabaseUpsert(
    "calendar_delivery_attempts",
    {
      candidate_id: candidate.id,
      follow_id: followId,
      user_id: userId,
      channel: "web",
      attempt_number: 1,
      idempotency_key: idempotencyKey,
      status,
      error_code: status === "failed" ? "IN_APP_DELIVERY_FAILED" : null,
      error_message: error || null,
      started_at: now,
      completed_at: now,
      next_retry_at: null,
    },
    {
      onConflict: "idempotency_key",
      prefer: "resolution=merge-duplicates,return=representation",
    },
  );
}

function mapCandidate(row?: CandidateRow): CalendarAlertCandidate | null {
  if (!row) return null;
  const id = stringValue(row.id);
  const eventId = stringValue(row.event_id);
  const candidateKey = stringValue(row.candidate_key);
  const kind = readCandidateKind(row.candidate_kind);
  if (!id || !eventId || !candidateKey || !kind) return null;
  return {
    id,
    eventId,
    eventRevision: numberValue(row.event_revision, 1),
    kind,
    candidateKey,
    payload:
      row.payload && typeof row.payload === "object" && !Array.isArray(row.payload)
        ? (row.payload as Record<string, unknown>)
        : {},
  };
}

function readCandidateKind(value: unknown): CalendarCandidateKind | null {
  const kind = stringValue(value);
  if (
    kind === "event-registered" ||
    kind === "schedule-changed" ||
    kind === "postponed" ||
    kind === "cancelled" ||
    kind === "reminder-due" ||
    kind === "released" ||
    kind === "result-updated"
  ) {
    return kind;
  }
  return null;
}

function mapCalendarEventTypeToCategory(value: string) {
  const categories: Record<string, string> = {
    earnings: "earnings",
    dividend: "dividends",
    ipo: "strategic_transaction",
    "fda-advisory-committee": "fda_clinical",
    "fomc-decision": "macro_market",
    "fomc-minutes": "macro_market",
    "fed-chair-testimony": "macro_market",
    "sec-open-meeting": "policy_regulation",
    "sec-rule-milestone": "policy_regulation",
    "trade-policy-action": "policy_regulation",
  };
  return categories[value] || null;
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

function stringValue(value: unknown) {
  if (typeof value === "string") return value.trim();
  return "";
}

function nullableString(value: unknown) {
  const string = stringValue(value);
  return string || null;
}

function readPrimaryTicker(data: unknown) {
  if (!Array.isArray(data)) return null;
  let fallback = "";
  for (const value of data as Record<string, unknown>[]) {
    const ticker = stringValue(value.ticker).toUpperCase();
    if (!ticker) continue;
    if (!fallback) fallback = ticker;
    if (stringValue(value.role) === "primary") return ticker;
  }
  return fallback || null;
}

function numberValue(value: unknown, fallback: number) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.trunc(number)) : fallback;
}
