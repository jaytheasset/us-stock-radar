import { Badge, type BadgeTone } from "@/components/ui/Badge";
import type { LiveFeedV2Sentiment } from "@/lib/liveFeedV2Contract";
import styles from "./FeedFilingPreview.module.css";

const categoryTones: Record<string, BadgeTone> = {
  DILUTION: "neutral",
  DIVIDEND: "neutral",
  EARN: "earnings",
  FDA: "product",
  FILING: "neutral",
  INSIDER: "insider",
  LEGAL: "legal",
  LISTING: "neutral",
  MARKET: "neutral",
  NEWS: "neutral",
};

const signalClassNames: Record<LiveFeedV2Sentiment, string> = {
  Bearish: styles.bearish,
  Bullish: styles.bullish,
  Neutral: styles.neutral,
  Volatile: styles.volatile,
};

export function FeedPreviewEventBadge({ category }: { category: string }) {
  const normalized = category.trim().toUpperCase() || "NEWS";
  return (
    <Badge size="small" tone={categoryTones[normalized] || "neutral"}>
      {formatCategory(normalized)}
    </Badge>
  );
}

export function FeedPreviewImpactScore({ score }: { score: number }) {
  const toneClass =
    score >= 70
      ? styles.impactScoreHigh
      : score >= 40
        ? styles.impactScoreMedium
        : styles.impactScoreLow;

  return (
    <span
      aria-label={`Impact score ${score} out of 99`}
      className={`${styles.impactScore} ${toneClass}`}
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

function formatCategory(value: string) {
  if (value === "EARN") return "Earnings";
  if (value === "FDA") return "FDA";
  if (value === "DILUTION") return "Dilution";
  if (value === "DIVIDEND") return "Dividend";
  if (value === "INSIDER") return "Insider";
  if (value === "LEGAL") return "Legal";
  if (value === "LISTING") return "Listing";
  if (value === "MARKET") return "Market";
  if (value === "FILING") return "Filing";
  return "News";
}
