import { EventBadge } from "@/components/dashboard-v2/EventBadge";
import type { DashboardV2Event } from "@/lib/dashboardV2Types";

export function EventTimeline({ events }: { events: DashboardV2Event[] }) {
  return (
    <section className="dashboard-v2-event-timeline" aria-label="Recent events">
      <h2>Recent Events</h2>
      {events.length ? (
        <div className="dashboard-v2-timeline-list">
          {events.map((event) => (
            <article
              className={`dashboard-v2-timeline-item event-${event.tone}`}
              key={event.id}
            >
              <div className="dashboard-v2-timeline-marker" aria-hidden="true" />
              <div className="dashboard-v2-timeline-content">
                <EventBadge event={event} />
                <div>
                  <strong>{event.title}</strong>
                  <time dateTime={event.timestamp}>{formatEventTime(event.timestamp)}</time>
                </div>
                {event.impact ? (
                  <span className={`dashboard-v2-timeline-impact impact-${event.impact}`}>
                    {capitalize(event.impact)} Impact
                  </span>
                ) : (
                  <span className="dashboard-v2-timeline-impact">—</span>
                )}
              </div>
            </article>
          ))}
        </div>
      ) : (
        <p className="dashboard-v2-events-unavailable">—</p>
      )}
    </section>
  );
}

function formatEventTime(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Unavailable";
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "America/New_York",
  }).format(date);
}

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
