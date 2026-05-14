import Link from "next/link";
import {
  sectorMappings,
  taxonomyStats,
  themeGroups,
  themeSubThemes,
} from "@/lib/taxonomyRegistry";

export const dynamic = "force-dynamic";

const sectors = Array.from(new Set(sectorMappings.map((item) => item.sector)));
const subThemeCounts = themeSubThemes.reduce<Record<string, number>>((counts, subTheme) => {
  counts[subTheme.themeGroupSlug] = (counts[subTheme.themeGroupSlug] || 0) + 1;
  return counts;
}, {});

export default function AdminTaxonomyPage() {
  return (
    <main className="shell">
      <header className="topbar">
        <div className="title-block">
          <h1>Taxonomy Read-Out</h1>
          <p className="muted">Sector, sub-category, FMP industry, and theme-group seed registry.</p>
        </div>
        <Link className="text-link" href="/admin">
          Admin
        </Link>
      </header>

      <section className="status-strip taxonomy-status">
        <article className="status-tile">
          <span className="status-label">Sectors</span>
          <span className="status-value">{taxonomyStats.sectors}</span>
          <span className="pill ok">canonical</span>
        </article>
        <article className="status-tile">
          <span className="status-label">Sub Categories</span>
          <span className="status-value">{taxonomyStats.subCategories}</span>
          <span className="pill ok">mapped</span>
        </article>
        <article className="status-tile">
          <span className="status-label">FMP Industries</span>
          <span className="status-value">{taxonomyStats.fmpIndustries}</span>
          <span className="pill warn">rule seed</span>
        </article>
        <article className="status-tile">
          <span className="status-label">Theme Groups</span>
          <span className="status-value">{taxonomyStats.themeGroups}</span>
          <span className="pill ok">{taxonomyStats.implementedThemes} implemented</span>
        </article>
        <article className="status-tile">
          <span className="status-label">Sub Themes</span>
          <span className="status-value">{taxonomyStats.themeSubThemes}</span>
          <span className="pill ok">{taxonomyStats.implementedSubThemes} implemented</span>
        </article>
      </section>

      <section className="data-panel">
        <div className="panel-header">
          <h2>Theme Groups</h2>
          <span className="muted">ticker membership and event links stay separate</span>
        </div>
        <div className="taxonomy-card-grid">
          {themeGroups.map((theme) => (
            <article className="taxonomy-card" key={theme.slug}>
              <div>
                <h3>{theme.name}</h3>
                <code>{theme.slug}</code>
                <p className="muted">{theme.description}</p>
                <p className="muted">{subThemeCounts[theme.slug] || 0} sub themes</p>
              </div>
              <span className={`pill ${theme.status === "implemented" ? "ok" : ""}`}>
                {theme.status}
              </span>
            </article>
          ))}
        </div>
      </section>

      <section className="data-panel">
        <div className="panel-header">
          <h2>Theme Sub Themes</h2>
          <span className="muted">manual keywords and seed symbols for LLM/event matching</span>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Theme Group</th>
                <th>Sub Theme</th>
                <th>Keywords</th>
                <th>Seed Symbols</th>
                <th>Description</th>
                <th>Sources</th>
              </tr>
            </thead>
            <tbody>
              {themeSubThemes.map((subTheme) => (
                <tr key={subTheme.slug}>
                  <td>
                    <code>{subTheme.themeGroupSlug}</code>
                  </td>
                  <td className="ticker">
                    {subTheme.name}
                    <br />
                    <code>{subTheme.slug}</code>
                  </td>
                  <td>{subTheme.keywords.join(", ")}</td>
                  <td>{subTheme.seedSymbols.join(", ")}</td>
                  <td>{subTheme.description}</td>
                  <td>
                    {subTheme.references.map((reference) => (
                      <a className="text-link" href={reference.url} key={reference.url}>
                        {reference.label}
                      </a>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="definition-list">
        {sectors.map((sector) => {
          const rows = sectorMappings.filter((item) => item.sector === sector);
          const industryCount = rows.reduce((count, row) => count + row.fmpIndustries.length, 0);

          return (
            <article className="definition-card" key={sector}>
              <div className="definition-card-header">
                <div>
                  <h2>{sector}</h2>
                  <p className="muted">
                    {rows.length} sub categories, {industryCount} FMP industry mappings
                  </p>
                </div>
                <span className="pill ok">sector</span>
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Sub Category</th>
                      <th>Slug</th>
                      <th>FMP Industries</th>
                      <th>Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.slug}>
                        <td className="ticker">{row.subCategory}</td>
                        <td>
                          <code>{row.slug}</code>
                        </td>
                        <td>{row.fmpIndustries.length ? row.fmpIndustries.join(", ") : "-"}</td>
                        <td>{row.notes || "-"}</td>
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
