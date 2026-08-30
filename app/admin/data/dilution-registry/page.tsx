import Link from "next/link";
import { DilutionRegistryPreview } from "@/components/admin/DilutionRegistryPreview";
import styles from "@/components/admin/AdminSection.module.css";
import { requireAdminPermission } from "@/lib/admin/server";
import { rolesHavePermission } from "@/lib/admin/policy";

export default async function DilutionRegistryPreviewPage() {
  const access = await requireAdminPermission("data.read");

  return (
    <div className={styles.page}>
      <header className={styles.heading}>
        <div>
          <span className={styles.eyebrow}>Admin Data</span>
          <h1>Dilution Registry Preview</h1>
          <p>
            Paste one GPT Dilution Registry JSON and check its linked items. Optional Shares Outstanding rows are Preview-only and disable Apply.
          </p>
        </div>
        <Link className={styles.button} href="/admin/data">
          Back to Data
        </Link>
      </header>

      <DilutionRegistryPreview
        canApply={rolesHavePermission(access.roles, "data.run")}
      />
    </div>
  );
}
