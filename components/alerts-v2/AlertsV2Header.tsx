import { BellRing, CheckCheck, Plus } from "lucide-react";
import styles from "./StockRadarAlertsV2.module.css";

export function AlertsV2Header({
  onCreateAlert,
  onMarkAllRead,
  unreadCount,
}: {
  onCreateAlert: (opener: HTMLButtonElement) => void;
  onMarkAllRead: () => void;
  unreadCount: number;
}) {
  return (
    <header className={styles.pageHeader}>
      <div className={styles.pageHeading}>
        <span className={styles.pageHeadingIcon} aria-hidden="true">
          <BellRing size={18} />
        </span>
        <div>
          <div className={styles.pageTitleLine}>
            <h1>Alerts</h1>
            <span className={styles.unreadCount} aria-label={`${unreadCount} unread alerts`}>
              {unreadCount} unread
            </span>
          </div>
          <p>Personalized events matched to your rules and watchlist.</p>
        </div>
      </div>

      <div className={styles.headerActions}>
        <span className={styles.mockStatus}>Local mock · ET</span>
        <button
          className={styles.secondaryAction}
          disabled={unreadCount === 0}
          onClick={onMarkAllRead}
          type="button"
        >
          <CheckCheck aria-hidden="true" size={16} />
          <span>Mark all as read</span>
        </button>
        <button className={styles.primaryAction} onClick={(event) => onCreateAlert(event.currentTarget)} type="button">
          <Plus aria-hidden="true" size={16} />
          <span>Create Alert</span>
        </button>
      </div>
    </header>
  );
}
