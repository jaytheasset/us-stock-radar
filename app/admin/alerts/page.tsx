import Link from "next/link";
import styles from "@/components/admin/AdminSection.module.css";
import {
  listAlertChannelAttemptErrors,
  listAlertDeliveryRuns,
  listFailedAlertDeliveries,
} from "@/lib/admin/operations";
import { requireAdminPermission } from "@/lib/admin/server";

export const dynamic = "force-dynamic";

export default async function AdminAlertsPage() {
  await requireAdminPermission("alerts.read");
  const [runs, deliveries, channelErrors] = await Promise.all([
    listAlertDeliveryRuns(50),
    listFailedAlertDeliveries(200),
    listAlertChannelAttemptErrors(100),
  ]);

  return (
    <div className={styles.page}>
      <header className={styles.heading}>
        <div>
          <span className={styles.eyebrow}>Delivery operations</span>
          <h1>Alert delivery operations</h1>
          <p>
            Recent protected cron runs and read-only delivery failures.
            Destinations, credentials, and unsafe retry controls are not
            exposed.
          </p>
        </div>
        <span className={styles.badge}>Read only</span>
      </header>

      <SectionHeading
        description="UTC schedule; browser-local timestamps are shown below."
        title="Recent cron runs"
      />
      {runs.length ? (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Started</th>
                <th>Status</th>
                <th>Mode</th>
                <th>Lock</th>
                <th>Scanned</th>
                <th>Sent</th>
                <th>Failed</th>
                <th>Duplicate</th>
                <th>Suppressed</th>
                <th>Error</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => (
                <tr key={run.id}>
                  <td>
                    {run.startedAt
                      ? new Date(run.startedAt).toLocaleString("en-US")
                      : "Unknown"}
                    <br />
                    <span className={styles.muted}>
                      {run.durationMs === null
                        ? "Running"
                        : `${run.durationMs} ms`}
                    </span>
                  </td>
                  <td>{run.status}</td>
                  <td>
                    {run.dryRun
                      ? "Dry run"
                      : run.writeEnabled
                        ? "Write"
                        : "Locked"}
                  </td>
                  <td>
                    {run.lockSkipped
                      ? "Skipped"
                      : run.lockAcquired
                        ? "Acquired"
                        : "Not acquired"}
                  </td>
                  <td>{run.scanned}</td>
                  <td>{run.sent}</td>
                  <td>{run.failed}</td>
                  <td>{run.duplicates}</td>
                  <td>{run.suppressed}</td>
                  <td>{run.lastError || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState
          description="Run the authenticated endpoint in dry-run mode to verify the operational path."
          title="No alert delivery cron runs yet."
        />
      )}

      <SectionHeading
        description="Uncertain attempts are never retried automatically."
        title="Channel attempts requiring review"
      />
      {channelErrors.length ? (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Updated</th>
                <th>Status</th>
                <th>Channel</th>
                <th>User</th>
                <th>Attempts</th>
                <th>Error</th>
              </tr>
            </thead>
            <tbody>
              {channelErrors.map((attempt) => (
                <tr key={attempt.id}>
                  <td>
                    {new Date(attempt.createdAt).toLocaleString("en-US")}
                  </td>
                  <td>{attempt.status}</td>
                  <td>{attempt.channel}</td>
                  <td>
                    <Link href={`/admin/users/${attempt.userId}`}>
                      {attempt.userId.slice(0, 8)}
                    </Link>
                  </td>
                  <td>{attempt.attemptCount}</td>
                  <td>{attempt.lastError || "No error detail"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState
          description="Successful and suppressed attempts remain available in the database audit trail."
          title="No failed or uncertain channel attempts."
        />
      )}

      <SectionHeading
        description="Final outbox failures, including Web and Telegram suppression detail."
        title="Failed delivery rows"
      />
      {deliveries.length ? (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Attempted</th>
                <th>Alert</th>
                <th>User</th>
                <th>Category</th>
                <th>Channels</th>
                <th>Error</th>
              </tr>
            </thead>
            <tbody>
              {deliveries.map((delivery) => (
                <tr key={delivery.id}>
                  <td>
                    {delivery.attemptedAt
                      ? new Date(delivery.attemptedAt).toLocaleString("en-US")
                      : "Not attempted"}
                  </td>
                  <td>
                    <strong>
                      {delivery.ticker ? `${delivery.ticker} · ` : ""}
                      {delivery.title}
                    </strong>
                    <br />
                    <span className={styles.muted}>
                      {delivery.sourceLabel || "Unknown source"}
                    </span>
                  </td>
                  <td>
                    <Link href={`/admin/users/${delivery.userId}`}>
                      {delivery.userId.slice(0, 8)}
                    </Link>
                  </td>
                  <td>{delivery.category || "Uncategorized"}</td>
                  <td>{delivery.deliveredChannels.join(", ") || "None"}</td>
                  <td>{delivery.lastError || "No error detail"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState
          description="The queue is empty or delivery data is temporarily unavailable."
          title="No failed alert deliveries."
        />
      )}
    </div>
  );
}

function SectionHeading({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className={styles.sectionHeading}>
      <div>
        <h2>{title}</h2>
        <p>{description}</p>
      </div>
    </div>
  );
}

function EmptyState({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <section className={styles.empty}>
      <strong>{title}</strong>
      <p>{description}</p>
    </section>
  );
}
