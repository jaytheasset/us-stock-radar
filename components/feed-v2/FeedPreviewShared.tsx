import { Badge } from "@/components/ui/Badge";
import { getDirectionalScoreTone } from "@/lib/directionalScore";
import type {
  LiveFeedV2Kind,
  LiveFeedV2Sentiment,
} from "@/lib/liveFeedV2Contract";
import { getLiveFeedV2EventPresentation } from "@/lib/liveFeedV2EventType";
import styles from "./FeedFilingPreview.module.css";

const signalClassNames: Record<LiveFeedV2Sentiment, string> = {
  Bearish: styles.bearish,
  Bullish: styles.bullish,
  Neutral: styles.neutral,
  Volatile: styles.volatile,
};

export function FeedPreviewEventBadge({
  category,
  feedType,
}: {
  category: string;
  feedType: LiveFeedV2Kind;
}) {
  const eventPresentation = getLiveFeedV2EventPresentation(category, feedType);
  return (
    <Badge
      data-event-emphasis={eventPresentation.emphasis}
      size="small"
      tone={eventPresentation.tone}
    >
      {eventPresentation.label}
    </Badge>
  );
}

export function FeedPreviewImpactScore({
  score,
  signal,
}: {
  score: number;
  signal: LiveFeedV2Sentiment;
}) {
  return (
    <span
      aria-label={`Impact score ${score} out of 99`}
      className={styles.impactScore}
      data-score-tone={getDirectionalScoreTone(score, signal)}
    >
      {score}
    </span>
  );
}

export function FeedPreviewSignal({
  signal,
}: {
  signal: LiveFeedV2Sentiment;
}) {
  return (
    <i className={`${styles.signal} ${signalClassNames[signal]}`}>
      {signal}
    </i>
  );
}

export function formatPreviewTimestamp(timestamp: string) {
  const date = new Date(timestamp);
  if (!timestamp || Number.isNaN(date.getTime())) return "—";

  return `${new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
    timeZone: "America/New_York",
    year: "numeric",
  }).format(date)} ET`;
}

export function previewValue(value: string | null | undefined) {
  return value?.trim() || "—";
}
