import type { CalendarEventFollowUsage } from "@/lib/alerts/types";

export function buildCalendarEventFollowUsage(
  activeCount: number,
  limit: number | null,
): CalendarEventFollowUsage {
  const normalizedCount = Math.max(0, Math.trunc(activeCount));
  return {
    activeCount: normalizedCount,
    limit,
    remaining: limit === null ? null : Math.max(0, limit - normalizedCount),
  };
}

export function formatCalendarEventFollowUsage({
  activeCount,
  limit,
}: CalendarEventFollowUsage) {
  return limit === null
    ? `${activeCount} active · Unlimited`
    : `${activeCount} / ${limit} active`;
}
