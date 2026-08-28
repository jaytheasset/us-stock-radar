import Link from "next/link";
import { DilutionRegistryPreview } from "@/components/admin/DilutionRegistryPreview";
import styles from "@/components/admin/AdminSection.module.css";
import { requireAdminPermission } from "@/lib/admin/server";

export default async function DilutionRegistryPreviewPage() {
  await requireAdminPermission("data.read");

  return (
    <div className={styles.page}>
      <header className={styles.heading}>
        <div>
          <span className={styles.eyebrow}>Admin Data</span>
          <h1>Dilution Registry Preview</h1>
          <p>
            Paste one GPT Dilution Registry JSON, check its linked items, and review the result before any future save step.
          </p>
        </div>
        <Link className={styles.button} href="/admin/data">
          Back to Data
        </Link>
      </header>

      <DilutionRegistryPreview />
    </div>
  );
}
