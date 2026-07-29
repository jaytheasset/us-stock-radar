import styles from "@/components/admin/AdminSection.module.css";
import { requireAdminPermission } from "@/lib/admin/server";

export default async function AdminBillingPage() {
  await requireAdminPermission("billing.read");
  return (
    <div className={styles.page}>
      <header className={styles.heading}>
        <div>
          <span className={styles.eyebrow}>Subscriptions</span>
          <h1>Billing</h1>
          <p>Past-due counts are visible on Overview. Provider actions and customer mutations are not connected.</p>
        </div>
        <span className={styles.badge}>Coming next</span>
      </header>
      <section className={styles.empty}>
        <strong>Provider controls are disabled.</strong>
        <p>Paddle-first billing operations require webhook reconciliation, role-scoped actions, and append-only auditing.</p>
      </section>
    </div>
  );
}
