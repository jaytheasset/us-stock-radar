import type {
  CompanyEvent,
  CompanyEventReference,
} from "@/lib/live-room/types";
import { CompanyEventCard } from "./CompanyEventCard";
import styles from "./LiveRoom.module.css";

type EventHistoryPanelProps = {
  events: readonly CompanyEvent[];
  onMention: (reference: CompanyEventReference) => void;
  titleId?: string;
};

export function EventHistoryPanel({
  events,
  onMention,
  titleId,
}: EventHistoryPanelProps) {
  return (
    <div className={styles.historyPanel}>
      <div className={styles.panelHeading}>
        <div>
          <span>Company context</span>
          <h2 id={titleId}>Past news & filings</h2>
        </div>
        <small>Mention adds a compact reference to your draft.</small>
      </div>
      <div className={styles.historyList}>
        {events.length ? (
          events.map((event) => (
            <CompanyEventCard
              event={event}
              key={event.eventId}
              onMention={onMention}
            />
          ))
        ) : (
          <p className={styles.panelEmpty}>No company events are available.</p>
        )}
      </div>
    </div>
  );
}
