import "server-only";

import {
  deliverCalendarCandidateToUser,
  ensureCalendarCandidate,
} from "@/lib/alerts/calendarDelivery";
import { buildCalendarEventFollowUsage } from "@/lib/alerts/calendarFollowPolicy";
import type {
  CalendarEventFollowsViewModel,
  FollowedCalendarEventItem,
} from "@/lib/alerts/types";
import {
  supabaseRpc,
  supabaseSelect,
  supabaseUpdate,
  supabaseUpsert,
} from "@/lib/supabase";
import {
  getPlanDisplayName,
  getPlanLimits,
  type Plan,
} from "@/lib/subscriptionPolicy";

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

type CalendarFollowMutationRow = {
  follow_id?: unknown;
};

type CalendarFollowCountRow = {
  active_count?: unknown;
};

export class CalendarFollowError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: Record<string, unknown>;

  constructor(
    code: string,
    message: string,
    status = 400,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "CalendarFollowError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export async function getUserCalendarFollowsViewModel(
  userId: string,
  plan: Plan,
): Promise<CalendarEventFollowsViewModel> {
  const [follows, activeCount] = await Promise.all([
    getUserCalendarFollows(userId),
    getUserCalendarEventFollowActiveCount(userId),
  ]);

  return {
    follows,
    usage: buildCalendarEventFollowUsage(
      activeCount,
      getPlanLimits(plan).calendarEventFollowLimit,
    ),
  };
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
  plan,
}: {
  userId: string;
  eventId: string;
  enabled: boolean;
  plan: Plan;
}) {
  const normalizedEventId = normalizeEventId(eventId);
  const event = await getCalendarEvent(normalizedEventId);
  const limit = getPlanLimits(plan).calendarEventFollowLimit;
  const followResult = await supabaseRpc(
    "set_user_calendar_event_follow_with_limit",
    {
      p_user_id: userId,
      p_event_id: normalizedEventId,
      p_enabled: enabled,
      p_limit: limit,
    },
  );

  if (!followResult.ok) {
    if ((followResult.error || "").includes("CALENDAR_FOLLOW_LIMIT_REACHED")) {
      const activeCount = await getUserCalendarEventFollowActiveCount(userId);
      throwCalendarFollowLimitError(plan, limit, activeCount);
    }
    throw new CalendarFollowError(
      "CALENDAR_FOLLOW_SAVE_FAILED",
      followResult.error || "Failed to save calendar event follow.",
      followResult.status || 502,
    );
  }

  const row = Array.isArray(followResult.data)
    ? (followResult.data[0] as CalendarFollowMutationRow | undefined)
    : undefined;
  const followId = stringValue(row?.follow_id);
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
    ...(await getUserCalendarFollowsViewModel(userId, plan)),
  };
}

async function getUserCalendarEventFollowActiveCount(userId: string) {
  const result = await supabaseRpc(
    "get_user_calendar_event_follow_active_count",
    { p_user_id: userId },
  );
  if (!result.ok) {
    throw new Error(result.error || "Failed to count active followed calendar events.");
  }
  const row = Array.isArray(result.data)
    ? (result.data[0] as CalendarFollowCountRow | undefined)
    : undefined;
  return nonnegativeIntegerValue(row?.active_count);
}

function throwCalendarFollowLimitError(
  plan: Plan,
  limit: number | null,
  activeCount: number,
): never {
  const planName = getPlanDisplayName(plan);
  const upgradePlan = getCalendarFollowUpgradePlan(plan);
  const upgradeText = upgradePlan
    ? ` Upgrade to ${getPlanDisplayName(upgradePlan)} to follow more active events.`
    : "";
  throw new CalendarFollowError(
    "CALENDAR_FOLLOW_LIMIT_REACHED",
    `${planName} includes up to ${limit ?? "unlimited"} active Calendar event follows.${upgradeText}`,
    409,
    {
      limit,
      activeCount,
      remaining: limit === null ? null : Math.max(0, limit - activeCount),
      upgradePlan,
      upgradeTarget: upgradePlan ? "/premium" : null,
    },
  );
}

function getCalendarFollowUpgradePlan(plan: Plan): Plan | null {
  if (plan === "free") return "ad_free";
  if (plan === "ad_free") return "pro";
  if (plan === "pro") return "advanced";
  return null;
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

function nonnegativeIntegerValue(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.trunc(number)) : 0;
}
