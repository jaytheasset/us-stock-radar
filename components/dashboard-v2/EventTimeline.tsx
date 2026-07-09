import { EventBadge } from "@/components/dashboard-v2/EventBadge";
import type { DashboardV2TimelineEvent } from "@/lib/mock/dashboardV2Data";

export function EventTimeline({ events }: { events: DashboardV2TimelineEvent[] }) {
  return (
    <section className="dashboard-v2-event-timeline" aria-label="Recent events">
      <h2>Recent Events</h2>
      <div className="dashboard-v2-timeline-list">
        {events.map((event) => (
          <article className={`dashboard-v2-timeline-item event-${event.type}`} key={event.id}>
            <div className="dashboard-v2-timeline-marker" aria-hidden="true" />
            <div className="dashboard-v2-timeline-content">
              <EventBadge type={event.type} />
              <div>
                <strong>{event.title}</strong>
                <time>{event.timestamp}</time>
              </div>
              <span className={`dashboard-v2-timeline-impact impact-${event.impact}`}>
                {event.impact === "high" ? "High Impact" : "Medium Impact"}
              </span>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
