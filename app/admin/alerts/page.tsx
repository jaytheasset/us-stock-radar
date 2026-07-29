import styles from "@/components/admin/AdminSection.module.css";
import { requireAdminPermission } from "@/lib/admin/server";

export default async function AdminAlertsPage() {
  await requireAdminPermission("alerts.read");
  return (
    <div className={styles.page}>
      <header className={styles.heading}>
        <div>
          <span className={styles.eyebrow}>Delivery operations</span>
          <h1>Alerts</h1>
          <p>Failed delivery inspection is summarized on Overview. Retry and suppression tools are not enabled yet.</p>
        </div>
        <span className={styles.badge}>Coming next</span>
      </header>
      <section className={styles.empty}>
        <strong>Read-only foundation</strong>
        <p>A later workflow will add delivery detail, safe retry controls, and an audit record for every mutation.</p>
      </section>
    </div>
  );
}
