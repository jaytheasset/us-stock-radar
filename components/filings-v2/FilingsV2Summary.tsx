import type { FilingsV2SummaryMetrics } from "@/lib/filingsV2Model";
import { ChevronDown } from "lucide-react";
import styles from "./StockRadarFilingsV2.module.css";

export function FilingsV2Summary({
  summary,
}: {
  summary: FilingsV2SummaryMetrics;
}) {
  const metrics = [
    { label: "Filed Today", value: summary.filedToday },
    { label: "Alerts", value: summary.alerts },
    { label: "Earnings", value: summary.earnings },
    { label: "Insider", value: summary.insider },
    { label: "Offering", value: summary.offering },
    { label: "Listing Risk", value: summary.listing },
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
        <details className={styles.summaryDisclosure}>
          <summary aria-label="Toggle additional filing summary metrics">
            <div className={styles.summaryMobilePrimaryMetrics}>
              {primaryMetrics.map((metric) => (
                <div className={styles.summaryCell} key={metric.label}>
                  <span>{metric.label}</span>
                  <strong>{metric.value}</strong>
                </div>
              ))}
            </div>
            <span aria-hidden="true" className={styles.summaryChevron}>
              <ChevronDown size={18} strokeWidth={2} />
            </span>
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
