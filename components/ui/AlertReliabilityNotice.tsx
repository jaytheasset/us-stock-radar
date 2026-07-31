import { TriangleAlert } from "lucide-react";
import styles from "./AlertReliabilityNotice.module.css";

export const ALERT_RELIABILITY_NOTICE =
  "Alerts may be delayed, changed, duplicated, or unavailable. Do not rely on an alert as the sole basis for a trading decision.";

export function AlertReliabilityNotice() {
  return (
    <aside aria-label="Alert reliability notice" className={styles.notice}>
      <TriangleAlert aria-hidden="true" size={16} />
      <p>{ALERT_RELIABILITY_NOTICE}</p>
    </aside>
  );
}
