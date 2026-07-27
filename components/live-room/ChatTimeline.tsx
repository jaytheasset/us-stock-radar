import { MessageCircle, Sparkles } from "lucide-react";
import { getDirectionalScoreTone } from "@/lib/directionalScore";
import { getPlanDisplayName } from "@/lib/subscriptionPolicy";
import type { LiveRoomTimelineItem } from "@/lib/live-room/types";
import { formatEventTime } from "./CompanyEventCard";
import styles from "./LiveRoom.module.css";

type ChatTimelineProps = {
  currentProfileName: string;
  items: readonly LiveRoomTimelineItem[];
  onRetry?: () => void;
  state: "empty" | "error" | "loading" | "ready";
};

export function ChatTimeline({
  currentProfileName,
  items,
  onRetry,
  state,
}: ChatTimelineProps) {
  if (state === "loading") {
    return (
      <div aria-busy="true" className={styles.timelineState}>
        <span className={styles.loadingBar} />
        <span className={styles.loadingBar} />
        <span className={styles.loadingBar} />
        <strong>Loading room messages…</strong>
      </div>
    );
  }

  if (state === "error") {
    return (
      <div className={styles.timelineState} role="alert">
        <MessageCircle aria-hidden="true" size={22} />
        <strong>Messages could not be loaded.</strong>
        <span>Check the connection and try again.</span>
        {onRetry ? (
          <button onClick={onRetry} type="button">
            Retry
          </button>
        ) : null}
      </div>
    );
  }

  if (state === "empty" || !items.length) {
    return (
      <div className={styles.timelineState}>
        <MessageCircle aria-hidden="true" size={22} />
        <strong>Start this company discussion.</strong>
        <span>Mention an event or share the first view.</span>
      </div>
    );
  }

  return (
    <ol aria-label="Live Room messages" className={styles.timelineList}>
      {items.map((item) => {
        if (item.kind === "company_update") {
          return (
            <li className={styles.systemUpdate} key={item.id}>
              <div>
                <Sparkles aria-hidden="true" size={14} />
                <strong>New company update</strong>
                <time dateTime={item.createdAt}>
                  {formatMessageTime(item.createdAt)}
                </time>
              </div>
              <span>{item.event.kind === "filing" ? "Filing" : "News"}</span>
              <p>{item.event.title}</p>
              <small>
                {item.event.signal} · score{" "}
                <b
                  data-score-tone={getDirectionalScoreTone(
                    item.event.score,
                    item.event.signal,
                  )}
                >
                  {item.event.score === null ? "—" : item.event.score}
                </b>{" "}
                ·{" "}
                {formatEventTime(item.event.occurredAt)}
              </small>
            </li>
          );
        }

        const mine =
          item.isMine === true ||
          (item.isMine === undefined &&
            item.author.isGuest &&
            item.author.displayName === currentProfileName);
        return (
          <li
            className={mine ? styles.myMessage : styles.otherMessage}
            key={item.id}
          >
            <div className={styles.messageAvatar} aria-hidden="true">
              {item.author.emoji}
            </div>
            <article>
              <header>
                <strong>{item.author.displayName}</strong>
                <span>{getPlanDisplayName(item.author.plan)}</span>
                {item.author.isGuest ? <small>Guest</small> : null}
                <time dateTime={item.createdAt}>
                  {formatMessageTime(item.createdAt)}
                </time>
              </header>
              {item.eventReference ? (
                <div className={styles.messageReference}>
                  <span>
                    {item.eventReference.kind === "filing" ? "Filing" : "News"}
                  </span>
                  <strong>{item.eventReference.title}</strong>
                </div>
              ) : null}
              <p>{item.body}</p>
            </article>
          </li>
        );
      })}
    </ol>
  );
}

function formatMessageTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Time unavailable";
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
  }).format(date);
}
