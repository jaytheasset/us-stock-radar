import Link from "next/link";
import { getIntegrationRegistry } from "@/lib/integrationRegistry";

export const dynamic = "force-dynamic";

export default function AdminIntegrationsPage() {
  const registry = getIntegrationRegistry();

  return (
    <main className="shell">
      <header className="topbar">
        <div className="title-block">
          <h1>Integrations</h1>
          <p className="muted">Non-secret integration/env registry.</p>
        </div>
        <Link className="text-link" href="/admin">
          Admin
        </Link>
      </header>

      <section className="definition-list">
        {registry.integrations.map((integration) => (
          <article className="definition-card" key={integration.key}>
            <div className="definition-card-header">
              <div>
                <h2>{integration.label}</h2>
                <p className="muted">
                  {integration.key} · {integration.category}
                </p>
              </div>
              <span
                className={`pill ${
                  integration.env.every((item) => item.present) ? "ok" : "warn"
                }`}
              >
                {integration.env.filter((item) => item.present).length}/
                {integration.env.length} env
              </span>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Env Key</th>
                    <th>Present</th>
                  </tr>
                </thead>
                <tbody>
                  {integration.env.map((item) => (
                    <tr key={item.key}>
                      <td className="ticker">{item.key}</td>
                      <td>
                        <span className={`pill ${item.present ? "ok" : "bad"}`}>
                          {item.present ? "yes" : "no"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </article>
        ))}
      </section>
    </main>
  );
}
