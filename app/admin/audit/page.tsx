import Link from "next/link";
import styles from "@/components/admin/AdminSection.module.css";
import { listAdminAuditLogs } from "@/lib/admin/audit";
import { requireAdminPermission } from "@/lib/admin/server";

export const dynamic = "force-dynamic";
type PageProps = {
  searchParams: Promise<{
    actor?: string;
    action?: string;
    target?: string;
    from?: string;
    to?: string;
  }>;
};

export default async function AdminAuditPage({ searchParams }: PageProps) {
  await requireAdminPermission("audit.read");
  const filters = await searchParams;
  const logs = await listAdminAuditLogs({ ...filters, limit: 250 });
  return (
    <div className={styles.page}>
      <header className={styles.heading}>
        <div>
          <span className={styles.eyebrow}>Accountability</span>
          <h1>Administrator audit log</h1>
          <p>
            Append-only records for role changes, verification reviews,
            moderation, warnings, and community suspensions.
          </p>
        </div>
        <span className={styles.badge}>Read only</span>
      </header>
      <form className={styles.toolbar}>
        <div className={styles.field}>
          <label htmlFor="audit-actor">Actor user ID</label>
          <input
            className={styles.input}
            defaultValue={filters.actor || ""}
            id="audit-actor"
            name="actor"
          />
        </div>
        <div className={styles.field}>
          <label htmlFor="audit-action">Action</label>
          <input
            className={styles.input}
            defaultValue={filters.action || ""}
            id="audit-action"
            name="action"
          />
        </div>
        <div className={`${styles.field} ${styles.fieldGrow}`}>
          <label htmlFor="audit-target">Target type or ID</label>
          <input
            className={styles.input}
            defaultValue={filters.target || ""}
            id="audit-target"
            name="target"
          />
        </div>
        <div className={styles.field}>
          <label htmlFor="audit-from">From</label>
          <input
            className={styles.input}
            defaultValue={filters.from || ""}
            id="audit-from"
            name="from"
            type="datetime-local"
          />
        </div>
        <div className={styles.field}>
          <label htmlFor="audit-to">To</label>
          <input
            className={styles.input}
            defaultValue={filters.to || ""}
            id="audit-to"
            name="to"
            type="datetime-local"
          />
        </div>
        <button className={styles.button} type="submit">
          Filter
        </button>
        <Link className={styles.button} href="/admin/audit">
          Reset
        </Link>
      </form>
      {logs.length ? (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Time</th>
                <th>Actor</th>
                <th>Role</th>
                <th>Action</th>
                <th>Target</th>
                <th>Reason</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((item) => (
                <tr key={item.id}>
                  <td>{new Date(item.createdAt).toLocaleString("en-US")}</td>
                  <td>
                    {item.actorName || "System"}
                    {item.actorUserId ? (
                      <>
                        <br />
                        <span className={styles.mono}>{item.actorUserId}</span>
                      </>
                    ) : null}
                  </td>
                  <td>{item.actorRole.replaceAll("_", " ")}</td>
                  <td>
                    <strong>{item.action}</strong>
                  </td>
                  <td>
                    {item.targetType}
                    <br />
                    <span className={styles.mono}>
                      {item.targetId || "No target ID"}
                    </span>
                  </td>
                  <td>{item.reason || "No reason recorded"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <section className={styles.empty}>
          <strong>No audit records match these filters.</strong>
          <p>The log is append-only and cannot be edited from the console.</p>
        </section>
      )}
    </div>
  );
}
