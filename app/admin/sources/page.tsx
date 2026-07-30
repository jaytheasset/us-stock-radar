import styles from "@/components/admin/AdminSection.module.css";
import { listFailedSourceRuns } from "@/lib/admin/operations";
import { requireAdminPermission } from "@/lib/admin/server";
import { getSourceJobRegistry } from "@/lib/sourceJobs";

export const dynamic = "force-dynamic";

export default async function AdminSourcesPage() {
  await requireAdminPermission("data.read");
  const [failures, sources] = await Promise.all([
    listFailedSourceRuns(200),
    Promise.resolve(getSourceJobRegistry()),
  ]);
  return (
    <div className={styles.page}>
      <header className={styles.heading}>
        <div>
          <span className={styles.eyebrow}>Data operations</span>
          <h1>Source operations</h1>
          <p>
            Failure detail and the configured collection registry. This screen
            cannot run jobs or change cron state.
          </p>
        </div>
        <span className={styles.badge}>Read only</span>
      </header>

      <section className={styles.stack}>
        <h2>Failed source runs</h2>
        {failures.length ? (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Started</th>
                  <th>Source</th>
                  <th>Group</th>
                  <th>Run type</th>
                  <th>Error</th>
                  <th>Stats</th>
                </tr>
              </thead>
              <tbody>
                {failures.map((run) => (
                  <tr key={run.id}>
                    <td>{new Date(run.startedAt).toLocaleString("en-US")}</td>
                    <td>
                      <strong>{run.sourceCode}</strong>
                    </td>
                    <td>{run.sourceGroup}</td>
                    <td>{run.runType}</td>
                    <td>{run.errorMessage || "No error message"}</td>
                    <td className={styles.mono}>
                      {JSON.stringify(run.stats).slice(0, 240)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className={styles.notice}>No failed source runs.</p>
        )}
      </section>

      <section className={styles.stack}>
        <h2>Source registry</h2>
        <div className={styles.detailGrid}>
          {sources.map((source) => (
            <article className={styles.detailCard} key={source.source}>
              <h3>{source.label}</h3>
              <p className={styles.mono}>
                {source.source} · {source.jobRoute}
              </p>
              <ul className={styles.compactList}>
                {source.sourceUrls.map((item) => (
                  <li key={item.url}>
                    <span>{item.label}</span>
                    <strong>{item.primary ? "Primary" : "Fallback"}</strong>
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
