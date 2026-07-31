import "server-only";

import {
  deliverCalendarCandidateToUser,
  ensureCalendarCandidate,
} from "@/lib/alerts/calendarDelivery";
import type { FollowedCalendarEventItem } from "@/lib/alerts/types";
import {
  supabaseSelect,
  supabaseUpdate,
  supabaseUpsert,
} from "@/lib/supabase";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type CalendarFollowRow = {
  id?: unknown;
  event_id?: unknown;
  enabled?: unknown;
};

type CalendarEventRow = {
  id?: unknown;
  title?: unknown;
  event_type?: unknown;
  event_date?: unknown;
  event_time?: unknown;
  lifecycle_status?: unknown;
  current_revision?: unknown;
};

type CalendarSecurityRow = {
  event_id?: unknown;
  ticker?: unknown;
  role?: unknown;
};

export class CalendarFollowError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = "CalendarFollowError";
    this.code = code;
    this.status = status;
  }
}

export async function getUserCalendarFollows(
  userId: string,
): Promise<FollowedCalendarEventItem[]> {
  const followResult = await supabaseSelect("user_calendar_event_follows", {
    select: "id,event_id,enabled,created_at,updated_at",
    user_id: `eq.${userId}`,
    enabled: "eq.true",
    order: "created_at.desc",
    limit: "500",
  });

  if (!followResult.ok) {
    throw new Error(followResult.error || "Failed to read followed calendar events.");
  }

  const follows = Array.isArray(followResult.data)
    ? (followResult.data as CalendarFollowRow[])
    : [];
  const eventIds = uniqueStrings(follows.map((row) => stringValue(row.event_id)));
  if (!eventIds.length) return [];

  const [eventResult, securityResult] = await Promise.all([
    supabaseSelect("calendar_events", {
      select:
        "id,title,event_type,event_date,event_time,lifecycle_status,current_revision",
      id: `in.(${eventIds.join(",")})`,
      limit: String(eventIds.length),
    }),
    supabaseSelect("calendar_event_securities", {
      select: "event_id,ticker,role",
      event_id: `in.(${eventIds.join(",")})`,
      order: "role.asc",
      limit: String(Math.max(eventIds.length * 5, 20)),
    }),
  ]);

  if (!eventResult.ok) {
    throw new Error(eventResult.error || "Failed to read followed calendar event details.");
  }

  const eventsById = new Map(
    (Array.isArray(eventResult.data)
      ? (eventResult.data as CalendarEventRow[])
      : []
    ).map((row) => [stringValue(row.id), row]),
  );
  const tickerByEventId = buildPrimaryTickerMap(
    Array.isArray(securityResult.data)
      ? (securityResult.data as CalendarSecurityRow[])
      : [],
  );

  return follows.flatMap((follow) => {
    const eventId = stringValue(follow.event_id);
    const event = eventsById.get(eventId);
    const followId = stringValue(follow.id);
    const title = stringValue(event?.title);
    const eventDate = stringValue(event?.event_date);
    if (!event || !followId || !eventId || !title || !eventDate) return [];

    return [
      {
        followId,
        eventId,
        title,
        eventType: stringValue(event.event_type),
        eventDate,
        eventTime: nullableString(event.event_time),
        lifecycleStatus: stringValue(event.lifecycle_status),
        ticker: tickerByEventId.get(eventId) ?? null,
        enabled: follow.enabled === true,
      },
    ];
  });
}

export async function setUserCalendarFollow({
  userId,
  eventId,
  enabled,
}: {
  userId: string;
  eventId: string;
  enabled: boolean;
}) {
  const normalizedEventId = normalizeEventId(eventId);
  const event = await getCalendarEvent(normalizedEventId);
  const existingResult = await supabaseSelect("user_calendar_event_follows", {
    select: "id,event_id,enabled",
    user_id: `eq.${userId}`,
    event_id: `eq.${normalizedEventId}`,
    limit: "1",
  });
  const existing = Array.isArray(existingResult.data)
    ? (existingResult.data[0] as CalendarFollowRow | undefined)
    : undefined;

  const followResult = await supabaseUpsert(
    "user_calendar_event_follows",
    {
      user_id: userId,
      event_id: normalizedEventId,
      enabled,
    },
    {
      onConflict: "user_id,event_id",
      prefer: "resolution=merge-duplicates,return=representation",
    },
  );

  if (!followResult.ok) {
    throw new CalendarFollowError(
      "CALENDAR_FOLLOW_SAVE_FAILED",
      followResult.error || "Failed to save calendar event follow.",
      followResult.status || 502,
    );
  }

  const row = Array.isArray(followResult.data)
    ? (followResult.data[0] as CalendarFollowRow | undefined)
    : undefined;
  const followId = stringValue(row?.id) || stringValue(existing?.id);
  if (!followId) {
    throw new CalendarFollowError(
      "CALENDAR_FOLLOW_SAVE_FAILED",
      "Calendar follow saved without a follow identifier.",
      502,
    );
  }

  if (enabled) {
    const reminderResult = await supabaseUpsert(
      "calendar_reminder_rules",
      {
        follow_id: followId,
        minutes_before: 30,
        channel: "web",
        enabled: true,
      },
      {
        onConflict: "follow_id,minutes_before,channel",
        prefer: "resolution=merge-duplicates,return=representation",
      },
    );
    if (!reminderResult.ok) {
      throw new CalendarFollowError(
        "CALENDAR_REMINDER_SAVE_FAILED",
        reminderResult.error || "Failed to save the in-app reminder.",
        reminderResult.status || 502,
      );
    }

    const lifecycleStatus = stringValue(event.lifecycle_status);
    const candidate = await ensureCalendarCandidate({
      eventId: normalizedEventId,
      eventRevision: numberValue(event.current_revision, 1),
      kind:
        lifecycleStatus === "cancelled"
          ? "cancelled"
          : lifecycleStatus === "postponed"
            ? "postponed"
            : "event-registered",
      availableAt: new Date().toISOString(),
      payload: { followedAt: new Date().toISOString() },
    });
    await deliverCalendarCandidateToUser({
      candidate,
      event,
      followId,
      userId,
    });
  } else {
    await supabaseUpdate(
      "calendar_reminder_rules",
      { follow_id: `eq.${followId}` },
      { enabled: false },
    );
  }

  return {
    followed: enabled,
    follows: await getUserCalendarFollows(userId),
  };
}

async function getCalendarEvent(eventId: string) {
  const [result, securityResult] = await Promise.all([
    supabaseSelect("calendar_events", {
      select:
        "id,title,event_type,event_date,event_time,event_instant,lifecycle_status,current_revision,impact_level",
      id: `eq.${eventId}`,
      limit: "1",
    }),
    supabaseSelect("calendar_event_securities", {
      select: "event_id,ticker,role",
      event_id: `eq.${eventId}`,
      order: "role.asc",
      limit: "20",
    }),
  ]);
  const event = Array.isArray(result.data)
    ? (result.data[0] as CalendarEventRow | undefined)
    : undefined;
  if (!result.ok || !event) {
    throw new CalendarFollowError(
      "CALENDAR_EVENT_NOT_FOUND",
      "The calendar event is no longer available.",
      404,
    );
  }
  return {
    ...event,
    ticker:
      buildPrimaryTickerMap(
        Array.isArray(securityResult.data)
          ? (securityResult.data as CalendarSecurityRow[])
          : [],
      ).get(eventId) ?? null,
  } as CalendarEventRow & Record<string, unknown>;
}

function normalizeEventId(value: string) {
  const eventId = value.trim();
  if (!UUID_PATTERN.test(eventId)) {
    throw new CalendarFollowError(
      "INVALID_CALENDAR_EVENT_ID",
      "Select a valid calendar event.",
    );
  }
  return eventId;
}

function buildPrimaryTickerMap(rows: CalendarSecurityRow[]) {
  const map = new Map<string, string>();
  for (const row of rows) {
    const eventId = stringValue(row.event_id);
    const ticker = stringValue(row.ticker).toUpperCase();
    if (!eventId || !ticker) continue;
    if (!map.has(eventId) || stringValue(row.role) === "primary") {
      map.set(eventId, ticker);
    }
  }
  return map;
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function nullableString(value: unknown) {
  const valueString = stringValue(value);
  return valueString || null;
}

function numberValue(value: unknown, fallback: number) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(1, Math.trunc(number)) : fallback;
}
