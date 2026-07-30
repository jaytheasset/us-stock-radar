import Link from "next/link";
import styles from "@/components/admin/AdminSection.module.css";
import { listFailedAlertDeliveries } from "@/lib/admin/operations";
import { requireAdminPermission } from "@/lib/admin/server";

export const dynamic = "force-dynamic";

export default async function AdminAlertsPage() {
  await requireAdminPermission("alerts.read");
  const deliveries = await listFailedAlertDeliveries(200);
  return (
    <div className={styles.page}>
      <header className={styles.heading}>
        <div>
          <span className={styles.eyebrow}>Delivery operations</span>
          <h1>Failed alerts</h1>
          <p>
            Read-only failure detail. Destinations and channel credentials are
            not exposed, and retry controls remain intentionally disabled.
          </p>
        </div>
        <span className={styles.badge}>Read only</span>
      </header>
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
        <section className={styles.empty}>
          <strong>No failed alert deliveries.</strong>
          <p>The queue is empty or delivery data is temporarily unavailable.</p>
        </section>
      )}
    </div>
  );
}
