import Link from "next/link";
import { getDbReadout } from "@/lib/dbReadout";

export const dynamic = "force-dynamic";

export default async function AdminDbPage() {
  const readout = await getDbReadout();
  const requiredCount = readout.canonicalTables.filter(
    (table) => table.status === "required",
  ).length;

  return (
    <main className="shell">
      <header className="topbar">
        <div className="title-block">
          <h1>DB Read-Out</h1>
          <p className="muted">Draft canonical schema plus current Supabase reference counts.</p>
        </div>
        <Link className="text-link" href="/admin">
          Admin
        </Link>
      </header>

      <section className="status-strip">
        <article className="status-tile">
          <span className="status-label">Mode</span>
          <span className="status-value">{readout.mode}</span>
          <span className="pill warn">No schema writes</span>
        </article>
        <article className="status-tile">
          <span className="status-label">Canonical Tables</span>
          <span className="status-value">{readout.canonicalTables.length}</span>
          <span className="pill ok">{requiredCount} required</span>
        </article>
        <article className="status-tile">
          <span className="status-label">Current Reference</span>
          <span className="status-value">{readout.currentReference.length}</span>
          <span className={`pill ${readout.ok ? "ok" : "bad"}`}>
            {readout.ok ? "Readable" : "Check"}
          </span>
        </article>
      </section>

      <section className="data-panel">
        <div className="panel-header">
          <h2>Event Scoring Contract</h2>
          <span className="muted">score decides archive, feed, or alert</span>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Score</th>
                <th>Delivery Level</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              {readout.eventScoringPolicy.score.map((rule) => (
                <tr key={rule.range}>
                  <td className="ticker">{rule.range}</td>
                  <td>{rule.deliveryLevel}</td>
                  <td>{rule.notes}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <dl className="readout-grid">
          <div>
            <dt>Impact</dt>
            <dd>{readout.eventScoringPolicy.impact.join(", ")}</dd>
          </div>
          <div>
            <dt>Signal</dt>
            <dd>{readout.eventScoringPolicy.signal.join(", ")}</dd>
          </div>
        </dl>
      </section>

      <section className="data-panel">
        <div className="panel-header">
          <h2>Current Supabase Reference</h2>
          <span className="muted">Existing DB, not the new contract</span>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Table</th>
                <th>Status</th>
                <th>Rows</th>
                <th>Error</th>
              </tr>
            </thead>
            <tbody>
              {readout.currentReference.map((table) => (
                <tr key={table.table}>
                  <td className="ticker">{table.table}</td>
                  <td>
                    <span className={`pill ${table.ok ? "ok" : "bad"}`}>
                      HTTP {table.status}
                    </span>
                  </td>
                  <td>{table.count ?? "-"}</td>
                  <td>{table.error || "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="definition-list">
        {readout.canonicalTables.map((table) => (
          <article className="definition-card" key={table.name}>
            <div className="definition-card-header">
              <div>
                <h2>{table.name}</h2>
                <p className="muted">{table.purpose}</p>
              </div>
              <span className={`pill ${table.status === "required" ? "ok" : "warn"}`}>
                {table.group} / {table.status}
              </span>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Column</th>
                    <th>Type</th>
                    <th>Required</th>
                    <th>Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {table.columns.map((column) => (
                    <tr key={column.name}>
                      <td className="ticker">{column.name}</td>
                      <td>{column.type}</td>
                      <td>{column.required ? "yes" : "no"}</td>
                      <td>{column.notes}</td>
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
