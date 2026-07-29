import styles from "@/components/admin/AdminSection.module.css";
import { buildAdminDashboardSnapshot } from "@/lib/admin/dashboard";
import { requireAdminPermission } from "@/lib/admin/server";

export default async function AdminModerationPage() {
  await requireAdminPermission("moderation.read");
  const dashboard = await buildAdminDashboardSnapshot();
  return (
    <div className={styles.page}>
      <header className={styles.heading}>
        <div>
          <span className={styles.eyebrow}>Trust and safety</span>
          <h1>Moderation reports</h1>
          <p>Raw Live Room reports only. No report is treated as resolved because a case workflow does not exist yet.</p>
        </div>
        <span className={styles.badge}>Read only</span>
      </header>
      {dashboard.recentReports.length ? (
        <section className={styles.reportList}>
          {dashboard.recentReports.map((report) => (
            <article className={styles.report} key={`${report.type}-${report.id}`}>
              <strong>{report.type}</strong>
              <span>{report.reason}</span>
              <time dateTime={report.createdAt}>
                {new Date(report.createdAt).toLocaleString("en-US")}
              </time>
            </article>
          ))}
        </section>
      ) : (
        <section className={styles.empty}>
          <strong>No report records are available.</strong>
          <p>This may mean the queues are empty or one of the report sources is temporarily unavailable.</p>
        </section>
      )}
    </div>
  );
}
