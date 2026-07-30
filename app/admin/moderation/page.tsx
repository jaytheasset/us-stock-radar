import Link from "next/link";
import styles from "@/components/admin/AdminSection.module.css";
import { listAdminModerationCases } from "@/lib/admin/moderation";
import { requireAdminPermission } from "@/lib/admin/server";

export const dynamic = "force-dynamic";
type PageProps = {
  searchParams: Promise<{
    status?: string;
    severity?: string;
    type?: string;
  }>;
};

export default async function AdminModerationPage({
  searchParams,
}: PageProps) {
  await requireAdminPermission("moderation.read");
  const filters = await searchParams;
  const cases = await listAdminModerationCases({
    ...filters,
    limit: 200,
  });
  return (
    <div className={styles.page}>
      <header className={styles.heading}>
        <div>
          <span className={styles.eyebrow}>Trust and safety</span>
          <h1>Moderation queue</h1>
          <p>
            One workflow for message, post, comment, and direct-message
            reports. Raw reports and captured evidence remain intact.
          </p>
        </div>
        <span className={styles.badge}>No bulk actions</span>
      </header>

      <form className={styles.toolbar}>
        <div className={styles.field}>
          <label htmlFor="case-status">Status</label>
          <select
            className={styles.select}
            defaultValue={filters.status || ""}
            id="case-status"
            name="status"
          >
            <option value="">All statuses</option>
            <option value="open">Open</option>
            <option value="in_review">In review</option>
            <option value="resolved">Resolved</option>
            <option value="dismissed">Dismissed</option>
          </select>
        </div>
        <div className={styles.field}>
          <label htmlFor="case-severity">Severity</label>
          <select
            className={styles.select}
            defaultValue={filters.severity || ""}
            id="case-severity"
            name="severity"
          >
            <option value="">All severities</option>
            <option value="critical">Critical</option>
            <option value="high">High</option>
            <option value="normal">Normal</option>
            <option value="low">Low</option>
          </select>
        </div>
        <div className={styles.field}>
          <label htmlFor="case-type">Report type</label>
          <select
            className={styles.select}
            defaultValue={filters.type || ""}
            id="case-type"
            name="type"
          >
            <option value="">All types</option>
            <option value="message">Message</option>
            <option value="post">Post</option>
            <option value="comment">Comment</option>
            <option value="direct_message">Direct message</option>
          </select>
        </div>
        <button className={styles.button} type="submit">
          Apply
        </button>
        <Link className={styles.button} href="/admin/moderation">
          Reset
        </Link>
      </form>

      {cases.length ? (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Case</th>
                <th>Report</th>
                <th>Target snapshot</th>
                <th>Severity</th>
                <th>Status</th>
                <th>Assignee</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {cases.map((item) => (
                <tr key={item.id}>
                  <td>
                    <Link href={`/admin/moderation/${item.id}`}>
                      {item.id.slice(0, 8)}
                    </Link>
                  </td>
                  <td>
                    <strong>{item.reportType.replaceAll("_", " ")}</strong>
                    <br />
                    <span className={styles.muted}>{item.reportReason}</span>
                  </td>
                  <td>
                    {snapshotSummary(item.targetSnapshot)}
                    <br />
                    <span className={styles.mono}>{item.targetId}</span>
                  </td>
                  <td>
                    <span
                      className={`${styles.pill} ${
                        item.severity === "critical" ||
                        item.severity === "high"
                          ? styles.pillNegative
                          : ""
                      }`}
                    >
                      {item.severity}
                    </span>
                  </td>
                  <td>
                    <span
                      className={`${styles.pill} ${
                        item.status === "open" ? styles.pillAccent : ""
                      }`}
                    >
                      {item.status.replaceAll("_", " ")}
                    </span>
                  </td>
                  <td>{item.assigneeName || "Unassigned"}</td>
                  <td>
                    {new Date(item.createdAt).toLocaleString("en-US", {
                      month: "short",
                      day: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <section className={styles.empty}>
          <strong>No moderation cases match these filters.</strong>
          <p>New raw reports are automatically captured in this queue.</p>
        </section>
      )}
    </div>
  );
}

function snapshotSummary(snapshot: Record<string, unknown>) {
  const title = typeof snapshot.title === "string" ? snapshot.title : "";
  const body = typeof snapshot.body === "string" ? snapshot.body : "";
  return (title || body || "Evidence unavailable").slice(0, 100);
}
