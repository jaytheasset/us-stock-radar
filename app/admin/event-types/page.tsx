import Link from "next/link";
import { eventTypeDefinitions, eventTypeStats } from "@/lib/eventTypeRegistry";

export const dynamic = "force-dynamic";

const categories = Array.from(new Set(eventTypeDefinitions.map((definition) => definition.category)));

export default function AdminEventTypesPage() {
  return (
    <main className="shell">
      <header className="topbar">
        <div className="title-block">
          <h1>Event Type Registry</h1>
          <p className="muted">
            Normalized event labels for feed badges, alert filters, and future filing families.
          </p>
        </div>
        <Link className="text-link" href="/admin">
          Admin
        </Link>
      </header>

      <section className="status-strip event-type-status">
        <article className="status-tile">
          <span className="status-label">Event Types</span>
          <span className="status-value">{eventTypeStats.total}</span>
          <span className="pill ok">registry</span>
        </article>
        <article className="status-tile">
          <span className="status-label">Active</span>
          <span className="status-value">{eventTypeStats.active}</span>
          <span className="pill ok">shown in feed</span>
        </article>
        <article className="status-tile">
          <span className="status-label">Planned</span>
          <span className="status-value">{eventTypeStats.planned}</span>
          <span className="pill warn">reserved</span>
        </article>
        <article className="status-tile">
          <span className="status-label">Filing Backed</span>
          <span className="status-value">{eventTypeStats.filingBacked}</span>
          <span className="pill warn">6-K / 8-K seed</span>
        </article>
      </section>

      <section className="data-panel">
        <div className="panel-header">
          <div>
            <h2>Display Contract</h2>
            <p className="muted">
              Source group stays in the data. The visible feed badge uses the event type because it is more clickable.
            </p>
          </div>
          <span className="pill ok">single source</span>
        </div>
        <dl className="readout-grid">
          <div>
            <dt>DB field</dt>
            <dd>
              <code>events.event_type</code>
            </dd>
          </div>
          <div>
            <dt>Feed badge</dt>
            <dd>Uses label and tone from this registry.</dd>
          </div>
          <div>
            <dt>Current filing coverage</dt>
            <dd>Seeded around 6-K and 8-K current-report analysis.</dd>
          </div>
          <div>
            <dt>Expansion rule</dt>
            <dd>Add new filing families here first, then wire parser and filters.</dd>
          </div>
        </dl>
      </section>

      <section className="definition-list">
        {categories.map((category) => {
          const rows = eventTypeDefinitions.filter((definition) => definition.category === category);

          return (
            <article className="definition-card" key={category}>
              <div className="definition-card-header">
                <div>
                  <h2>{category}</h2>
                  <p className="muted">{rows.length} normalized event types</p>
                </div>
                <span className="pill ok">event_type</span>
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Badge</th>
                      <th>Code</th>
                      <th>Groups</th>
                      <th>Forms</th>
                      <th>Status</th>
                      <th>Description</th>
                      <th>Examples</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.code}>
                        <td>
                          <EventTypeBadge label={row.label} tone={row.tone} />
                        </td>
                        <td>
                          <code>{row.code}</code>
                        </td>
                        <td>{row.sourceGroups.join(", ")}</td>
                        <td>{row.coveredForms?.length ? row.coveredForms.join(", ") : "-"}</td>
                        <td>
                          <span className={`pill ${row.status === "active" ? "ok" : "warn"}`}>{row.status}</span>
                        </td>
                        <td>{row.description}</td>
                        <td>{row.examples.join(", ")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </article>
          );
        })}
      </section>
    </main>
  );
}

function EventTypeBadge({ label, tone }: { label: string; tone: string }) {
  return (
    <span className={`event-type-badge ${tone}`} aria-label={label}>
      {label.split(" ").map((word, index) => (
        <span key={`${word}-${index}`}>{word}</span>
      ))}
    </span>
  );
}
