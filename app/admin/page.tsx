import Link from "next/link";

const adminSections = [
  {
    href: "/admin/db",
    title: "DB Read-Out",
    description: "Draft canonical schema and current Supabase reference counts.",
  },
  {
    href: "/admin/taxonomy",
    title: "Taxonomy",
    description: "Sector, sub-category, FMP industry, and theme-group registry.",
  },
  {
    href: "/admin/sources",
    title: "Source Jobs",
    description: "Source job routes and external collection URLs.",
  },
  {
    href: "/admin/prompts",
    title: "Prompt Registry",
    description: "LLM prompt drafts, versions, and output targets.",
  },
  {
    href: "/admin/integrations",
    title: "Integrations",
    description: "External API/env registry without exposing secrets.",
  },
];

export default function AdminHome() {
  return (
    <main className="shell">
      <header className="topbar">
        <div className="title-block">
          <h1>Admin Read-Out</h1>
          <p className="muted">Read-only control surface for schema, sources, prompts, and integrations.</p>
        </div>
        <Link className="text-link" href="/">
          Dashboard
        </Link>
      </header>

      <section className="admin-grid">
        {adminSections.map((section) => (
          <Link className="admin-card" href={section.href} key={section.href}>
            <strong>{section.title}</strong>
            <p className="muted">{section.description}</p>
          </Link>
        ))}
      </section>
    </main>
  );
}
