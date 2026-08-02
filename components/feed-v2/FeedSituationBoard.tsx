import { ChevronDown } from "lucide-react";
import type { SituationCardItem } from "@/lib/liveFeed";
import styles from "./StockRadarFeedV2.module.css";

const compactLabels: Readonly<Record<string, string>> = {
  "Dilution Risk": "Dilution",
  "Insider / Ownership": "Insider",
  "Listing Risk": "Listing",
};

const additionalSituationLabels = [
  "Dilution Risk",
  "Listing Risk",
  "Earnings",
  "Insider / Ownership",
  "Dividends",
  "FDA / Clinical",
] as const;

export function FeedSituationBoard({
  items,
  totalEvents,
}: {
  items: readonly SituationCardItem[];
  totalEvents: number | null;
}) {
  const alertItem = items.find((item) => item.label === "Today's Alerts");
  const additionalItems = additionalSituationLabels.flatMap((label) => {
    const item = items.find((candidate) => candidate.label === label);
    return item ? [item] : [];
  });
  const hasAllAdditionalItems =
    additionalItems.length === additionalSituationLabels.length;

  return (
    <section aria-label="Market situation summary" className={styles.situationSection}>
      <div className={styles.situationGrid}>
        {items.length ? (
          items.map((item) => (
            <article className={styles.situationCard} key={item.label}>
              <span>{item.label}</span>
              <strong>{item.value}</strong>
              <small>{item.window}</small>
            </article>
          ))
        ) : (
          <div className={styles.situationEmpty}>
            Situation counts are temporarily unavailable.
          </div>
        )}
      </div>

      <div className={styles.situationMobileGrid}>
        <details className={styles.situationDisclosure}>
          <summary aria-label="Toggle additional market summary metrics">
            <div className={styles.situationPrimaryMetrics}>
              <div className={styles.situationSummaryCell}>
                <span>Total Events</span>
                <strong>
                  {totalEvents === null ? "—" : totalEvents.toLocaleString("en-US")}
                </strong>
              </div>
              <div className={styles.situationSummaryCell}>
                <span>Alerts</span>
                <strong>{alertItem?.value ?? "—"}</strong>
              </div>
            </div>
            <span aria-hidden="true" className={styles.situationChevron}>
              <ChevronDown size={18} strokeWidth={2} />
            </span>
          </summary>

          <div className={styles.situationExpandedGrid}>
            {additionalItems.map((item) => (
              <article className={styles.situationExpandedItem} key={item.label}>
                <span>{compactLabels[item.label] ?? item.label}</span>
                <strong>{item.value}</strong>
                <small>{item.window}</small>
              </article>
            ))}
            {!hasAllAdditionalItems ? (
              <div className={styles.situationMobileEmpty}>
                Some additional metrics are temporarily unavailable.
              </div>
            ) : null}
          </div>
        </details>
      </div>
    </section>
  );
}
