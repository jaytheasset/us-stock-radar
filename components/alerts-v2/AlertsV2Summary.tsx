import type { AlertsV2Alert } from "@/lib/mock/alertsV2Data";
import styles from "./StockRadarAlertsV2.module.css";

export function AlertsV2Summary({ alerts }: { alerts: readonly AlertsV2Alert[] }) {
  const summary = [
    { label: "Unread", value: alerts.filter((alert) => alert.unread).length },
    {
      label: "High Impact",
      value: alerts.filter((alert) => alert.impact === "major" || alert.impact === "high").length,
    },
    {
      label: "Filing Alerts",
      value: alerts.filter((alert) => ["dilution", "filing", "insider", "listing"].includes(alert.eventType)).length,
    },
    { label: "Price / Volume", value: alerts.filter((alert) => alert.eventType === "volume").length },
    { label: "Watchlist Matches", value: alerts.filter((alert) => alert.scope === "watchlist").length },
  ];

  return (
    <section aria-label="Alert summary" className={styles.summaryStrip}>
      {summary.map((item) => (
        <div className={styles.summaryCell} key={item.label}>
          <span>{item.label}</span>
          <strong>{item.value}</strong>
        </div>
      ))}
    </section>
  );
}
