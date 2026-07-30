import styles from "@/components/admin/AdminSection.module.css";
import { requireAdminPermission } from "@/lib/admin/server";
import { getIntegrationRegistry } from "@/lib/integrationRegistry";

export const dynamic = "force-dynamic";

export default async function AdminIntegrationsPage() {
  await requireAdminPermission("system.read");
  const registry = getIntegrationRegistry();
  return (
    <div className={styles.page}>
      <header className={styles.heading}>
        <div>
          <span className={styles.eyebrow}>System</span>
          <h1>Integrations</h1>
          <p>
            Non-secret environment readiness only. Values, tokens, brokerage
            user secrets, and account data are never rendered.
          </p>
        </div>
        <span className={styles.badge}>Read only</span>
      </header>
      <section className={styles.detailGrid}>
        {registry.integrations.map((integration) => {
          const present = integration.env.filter((item) => item.present).length;
          return (
            <article className={styles.detailCard} key={integration.key}>
              <div className={styles.actions}>
                <h2>{integration.label}</h2>
                <span
                  className={`${styles.pill} ${
                    present === integration.env.length
                      ? styles.pillPositive
                      : styles.pillNegative
                  }`}
                >
                  {present}/{integration.env.length} configured
                </span>
              </div>
              <p className={styles.muted}>
                {integration.key} · {integration.category}
              </p>
              <ul className={styles.compactList}>
                {integration.env.map((item) => (
                  <li key={item.key}>
                    <span className={styles.mono}>{item.key}</span>
                    <strong>{item.present ? "Present" : "Missing"}</strong>
                  </li>
                ))}
              </ul>
            </article>
          );
        })}
      </section>
    </div>
  );
}
