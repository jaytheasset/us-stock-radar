import Link from "next/link";
import styles from "@/components/admin/AdminSection.module.css";
import { requireAdminPermission } from "@/lib/admin/server";

const tools = [
  ["Dilution identity review", "/admin/data/dilution-identity-review", "Manually review unresolved or conflicting economic-exposure identity decisions."],
  ["Database", "/admin/db", "Canonical schema and current Supabase reference counts."],
  ["Sources", "/admin/sources", "Source jobs and external collection routes."],
  ["News ingest", "/admin/news-ingest", "Run and inspect the current news ingestion flow."],
  ["Prompts", "/admin/prompts", "Prompt versions, drafts, and output targets."],
  ["Event types", "/admin/event-types", "Event families, labels, and filter keys."],
  ["Taxonomy", "/admin/taxonomy", "Sector, industry, and theme registry."],
] as const;

export default async function AdminDataPage() {
  await requireAdminPermission("data.read");
  return (
    <div className={styles.page}>
      <header className={styles.heading}>
        <div>
          <span className={styles.eyebrow}>Data operations</span>
          <h1>Data control surface</h1>
          <p>Existing source, schema, prompt, and taxonomy tools in one controlled area.</p>
        </div>
      </header>
      <section className={styles.grid}>
        {tools.map(([label, href, description]) => (
          <Link className={styles.card} href={href} key={href}>
            <strong>{label}</strong>
            <p>{description}</p>
          </Link>
        ))}
      </section>
    </div>
  );
}
