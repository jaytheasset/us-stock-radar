import Link from "next/link";
import { requireAdminPermission } from "@/lib/admin/server";
import { rolesHavePermission } from "@/lib/admin/policy";
import { KiwoomTickerVerification } from "@/components/admin/KiwoomTickerVerification";
import styles from "@/components/admin/AdminSection.module.css";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export default async function KiwoomVerificationPage() {
  const access = await requireAdminPermission("system.read");
  return <div className={styles.page}>
    <header className={styles.heading}><div>
      <span className={styles.eyebrow}>Ticker verification · secondary source</span>
      <h1>Kiwoom notice evidence</h1>
      <p>Capture official bulletin evidence and record a human comparison for a US security. This does not publish or modify ticker identities.</p>
      <Link href="/admin/data/ticker-resolution">Back to SEC ticker resolution</Link>
    </div><span className={styles.badge}>Human review · no ticker writes</span></header>
    <KiwoomTickerVerification canWrite={rolesHavePermission(access.roles, "data.run")} />
  </div>;
}
