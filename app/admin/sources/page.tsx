import Link from "next/link";
import { getSourceJobRegistry } from "@/lib/sourceJobs";

export const dynamic = "force-dynamic";

export default function AdminSourcesPage() {
  const sources = getSourceJobRegistry();

  return (
    <main className="shell">
      <header className="topbar">
        <div className="title-block">
          <h1>Source Jobs</h1>
          <p className="muted">Job route registry and collection URLs. This page does not run jobs.</p>
        </div>
        <Link className="text-link" href="/admin">
          Admin
        </Link>
      </header>

      <section className="definition-list">
        {sources.map((source) => (
          <article className="definition-card" key={source.source}>
            <div className="definition-card-header">
              <div>
                <h2>{source.label}</h2>
                <p className="muted">
                  {source.source} · {source.jobRoute}
                </p>
              </div>
              <span className="pill ok">{source.sourceUrls.length} URL</span>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Label</th>
                    <th>Primary</th>
                    <th>URL</th>
                  </tr>
                </thead>
                <tbody>
                  {source.sourceUrls.map((item) => (
                    <tr key={item.url}>
                      <td>{item.label}</td>
                      <td>{item.primary ? "yes" : "no"}</td>
                      <td className="url-cell">{item.url}</td>
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
