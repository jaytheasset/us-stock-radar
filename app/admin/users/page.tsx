import styles from "@/components/admin/AdminSection.module.css";
import { requireAdminPermission } from "@/lib/admin/server";

export default async function AdminUsersPage() {
  await requireAdminPermission("users.read");
  return (
    <div className={styles.page}>
      <header className={styles.heading}>
        <div>
          <span className={styles.eyebrow}>Accounts</span>
          <h1>Users</h1>
          <p>Account lookup and support workflows will be added after the protected admin foundation.</p>
        </div>
        <span className={styles.badge}>Coming next</span>
      </header>
      <section className={styles.empty}>
        <strong>No user mutation tools are enabled.</strong>
        <p>This placeholder intentionally does not expose account data or pretend that support actions exist.</p>
      </section>
    </div>
  );
}
