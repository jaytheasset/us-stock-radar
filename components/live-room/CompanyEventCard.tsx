import Link from "next/link";
import { ArrowUpRight, Newspaper, ScrollText } from "lucide-react";
import type {
  CompanyEvent,
  CompanyEventReference,
} from "@/lib/live-room/types";
import { CompanyEventSignalScore } from "./CompanyEventSignalScore";
import styles from "./LiveRoom.module.css";

type CompanyEventCardProps = {
  event: CompanyEvent;
  latest?: boolean;
  onMention?: (reference: CompanyEventReference) => void;
};

export function CompanyEventCard({
  event,
  latest = false,
  onMention,
}: CompanyEventCardProps) {
  const Icon = event.kind === "filing" ? ScrollText : Newspaper;
  const reference = {
    eventId: event.eventId,
    kind: event.kind,
    title: event.title,
  } satisfies CompanyEventReference;

  return (
    <article
      className={latest ? styles.latestEventCard : styles.historyEventCard}
    >
      <div className={styles.eventMeta}>
        <span data-kind={event.kind}>
          <Icon aria-hidden="true" size={13} />
          {event.kind === "filing" ? "Filing" : "News"}
        </span>
        <time dateTime={event.occurredAt}>
          {formatEventTime(event.occurredAt)}
        </time>
        <CompanyEventSignalScore
          score={event.score}
          signal={event.signal}
        />
      </div>
      <h2>{event.title}</h2>
      <footer>
        <span>{event.source}</span>
        <div>
          {onMention ? (
            <button onClick={() => onMention(reference)} type="button">
              Mention
            </button>
          ) : null}
          {event.detailHref ? (
            <Link href={event.detailHref}>
              Analysis
              <ArrowUpRight aria-hidden="true" size={13} />
            </Link>
          ) : null}
        </div>
      </footer>
    </article>
  );
}

export function formatEventTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Time unavailable";
  return `${new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
    timeZone: "America/New_York",
  }).format(date)} ET`;
}
