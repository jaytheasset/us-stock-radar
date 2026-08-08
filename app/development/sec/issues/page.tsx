import Link from "next/link";
import { notFound } from "next/navigation";
import { SecDevelopmentAllIssuesClient } from "@/app/development/sec/SecDevelopmentAllIssuesClient";
import { getSecDevAllRoomIssueData } from "@/lib/development/secFormDevDashboard";
import { requireAdminPermission } from "@/lib/admin/server";
import styles from "../sec-development.module.css";

export const dynamic = "force-dynamic";

export default async function SecDevelopmentIssuesPage() {
  if (process.env.NODE_ENV === "production") notFound();
  await requireAdminPermission("system.read");

  const rooms = await getSecDevAllRoomIssueData();

  return (
    <main className={styles.page}>
      <header className={styles.topbar}>
        <div>
          <span>SEC Development</span>
          <h1>All Form-Room Issues</h1>
          <p>Failures, warnings, review flags, and skipped filings collected from every SEC development room.</p>
        </div>
        <div className={styles.topLinks}>
          <Link href="/development/sec">Debug Console</Link>
          <Link href="/admin">Admin</Link>
          <Link href="/filings">Filings</Link>
        </div>
      </header>

      <SecDevelopmentAllIssuesClient rooms={rooms} />
    </main>
  );
}
