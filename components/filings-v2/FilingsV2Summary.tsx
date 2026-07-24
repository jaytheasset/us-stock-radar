import {
  filingsV2HighImpactMinimum,
  isFilingsV2Today,
  type FilingsV2Record,
} from "@/lib/filingsV2Model";
import styles from "./StockRadarFilingsV2.module.css";

export function FilingsV2Summary({
  records,
  referenceDate,
}: {
  records: readonly FilingsV2Record[];
  referenceDate: string;
}) {
  const metrics = [
    { label: "Filed Today", value: records.filter((record) => isFilingsV2Today(record.filedAt, referenceDate)).length },
    { label: "Alerts", value: records.filter((record) => record.impact >= filingsV2HighImpactMinimum).length },
    { label: "Earnings", value: records.filter((record) => record.events.includes("earnings")).length },
    { label: "Insider", value: records.filter((record) => record.events.includes("insider")).length },
    { label: "Offering", value: records.filter((record) => record.events.includes("offering")).length },
    { label: "Listing Risk", value: records.filter((record) => record.events.includes("listing")).length },
  ];
  const primaryMetrics = metrics.slice(0, 2);
  const additionalMetrics = metrics.slice(2);

  return (
    <section aria-label="Filing summary" className={styles.summaryStrip}>
      <div className={styles.summaryDesktopGrid}>
        {metrics.map((metric) => (
          <div className={styles.summaryCell} key={metric.label}>
            <span>{metric.label}</span>
            <strong>{metric.value}</strong>
          </div>
        ))}
      </div>

      <div className={styles.summaryMobileGrid}>
        {primaryMetrics.map((metric) => (
          <div className={styles.summaryCell} key={metric.label}>
            <span>{metric.label}</span>
            <strong>{metric.value}</strong>
          </div>
        ))}

        <details className={styles.summaryDisclosure}>
          <summary>
            <span className={styles.summaryShowMore}>Show {additionalMetrics.length} more</span>
            <span className={styles.summaryShowLess}>Show less</span>
          </summary>
          <div className={styles.summaryExpandedGrid}>
            {additionalMetrics.map((metric) => (
              <div className={styles.summaryCell} key={metric.label}>
                <span>{metric.label}</span>
                <strong>{metric.value}</strong>
              </div>
            ))}
          </div>
        </details>
      </div>
    </section>
  );
}
