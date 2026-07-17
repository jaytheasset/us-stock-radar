import {
  filingsV2HighImpactMinimum,
  isFilingsV2Today,
  type FilingsV2Record,
} from "@/lib/mock/filingsV2Data";
import styles from "./StockRadarFilingsV2.module.css";

export function FilingsV2Summary({ records }: { records: readonly FilingsV2Record[] }) {
  const metrics = [
    { label: "Filed Today", value: records.filter((record) => isFilingsV2Today(record.filedAt)).length },
    { label: "Alerts", value: records.filter((record) => record.impact >= filingsV2HighImpactMinimum).length },
    { label: "Earnings", value: records.filter((record) => record.events.includes("earnings")).length },
    { label: "Insider", value: records.filter((record) => record.events.includes("insider")).length },
    { label: "Offering", value: records.filter((record) => record.events.includes("offering")).length },
    { label: "Listing Risk", value: records.filter((record) => record.events.includes("listing")).length },
  ];

  return (
    <section aria-label="Filing summary" className={styles.summaryStrip}>
      {metrics.map((metric) => (
        <div className={styles.summaryCell} key={metric.label}>
          <span>{metric.label}</span>
          <strong>{metric.value}</strong>
        </div>
      ))}
    </section>
  );
}
