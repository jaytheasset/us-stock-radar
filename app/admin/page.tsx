import { AlertTriangle, ArrowRight, CheckCircle2 } from "lucide-react";
import Link from "next/link";
import styles from "@/components/admin/AdminDashboard.module.css";
import { buildAdminDashboardSnapshot } from "@/lib/admin/dashboard";
import {
  rolesHavePermission,
  type AdminPermission,
  type AdminRole,
} from "@/lib/admin/policy";
import { requireAdminPermission } from "@/lib/admin/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const METRIC_PERMISSIONS: Record<string, AdminPermission> = {
  verification: "verifications.read",
  reports: "moderation.read",
  sources: "data.read",
  alerts: "alerts.read",
  billing: "billing.read",
  integrations: "system.read",
};

function canSee(roles: AdminRole[], metricKey: string) {
  const permission = METRIC_PERMISSIONS[metricKey];
  return permission ? rolesHavePermission(roles, permission) : false;
}

export default async function AdminHome() {
  const access = await requireAdminPermission("overview.read");
  const dashboard = await buildAdminDashboardSnapshot();
  const metrics = dashboard.metrics.filter((item) =>
    canSee(access.roles, item.key),
  );
  const showModeration = rolesHavePermission(access.roles, "moderation.read");
  const showIntegrations = rolesHavePermission(access.roles, "system.read");

  return (
    <div className={styles.page}>
      <header className={styles.heading}>
        <div>
          <span>Operations overview</span>
          <h1>Admin dashboard</h1>
          <p>
            Live operational signals from Stock Radar services. Values are
            read-only in this first admin foundation release.
          </p>
        </div>
        <time dateTime={dashboard.generatedAt}>
          Updated {new Date(dashboard.generatedAt).toLocaleString("en-US")}
        </time>
      </header>

      {dashboard.degradedSources.length ? (
        <section className={styles.degraded} role="status">
          <AlertTriangle aria-hidden="true" size={17} />
          <div>
            <strong>Some operational data is unavailable.</strong>
            <p>{dashboard.degradedSources.join(", ")}</p>
          </div>
        </section>
      ) : null}

      <section aria-label="Operational metrics" className={styles.metrics}>
        {metrics.map((item) => (
          <Link className={styles.metric} href={item.href} key={item.key}>
            <span>{item.label}</span>
            <strong>{item.degraded ? "Unavailable" : item.value}</strong>
            <small>
              Open queue <ArrowRight aria-hidden="true" size={13} />
            </small>
          </Link>
        ))}
      </section>

      <div className={styles.columns}>
        <section className={styles.panel}>
          <header className={styles.panelHeading}>
            <div>
              <span>Queue</span>
              <h2>Recent raw reports</h2>
            </div>
            {showModeration ? (
              <Link href="/admin/moderation">View all</Link>
            ) : null}
          </header>
          {showModeration ? (
            dashboard.recentReports.length ? (
              <div className={styles.reportList}>
                {dashboard.recentReports.map((report) => (
                  <article className={styles.report} key={`${report.type}-${report.id}`}>
                    <div>
                      <strong>{report.type}</strong>
                      <span>{report.reason}</span>
                    </div>
                    <time dateTime={report.createdAt}>
                      {new Date(report.createdAt).toLocaleString("en-US", {
                        month: "short",
                        day: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                    </time>
                  </article>
                ))}
              </div>
            ) : (
              <p className={styles.empty}>No report records are available.</p>
            )
          ) : (
            <p className={styles.empty}>
              Your current role does not include moderation report access.
            </p>
          )}
        </section>

        <div className={styles.stack}>
          {showIntegrations ? (
            <section className={styles.panel}>
              <header className={styles.panelHeading}>
                <div>
                  <span>System</span>
                  <h2>Integration environment</h2>
                </div>
                <Link href="/admin/integrations">Inspect</Link>
              </header>
              {dashboard.integrationMissing.length ? (
                <ul className={styles.issueList}>
                  {dashboard.integrationMissing.slice(0, 6).map((item) => (
                    <li key={item}>
                      <AlertTriangle aria-hidden="true" size={14} /> {item}
                    </li>
                  ))}
                </ul>
              ) : (
                <div className={styles.healthy}>
                  <CheckCircle2 aria-hidden="true" size={16} />
                  Required environment entries are present.
                </div>
              )}
            </section>
          ) : null}

          <section className={styles.panel}>
            <header className={styles.panelHeading}>
              <div>
                <span>Attention</span>
                <h2>Schema and workflow warnings</h2>
              </div>
            </header>
            <ul className={styles.warningList}>
              {dashboard.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}
