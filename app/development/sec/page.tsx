import Link from "next/link";
import { notFound } from "next/navigation";
import { SecDevelopmentClient } from "@/app/development/sec/SecDevelopmentClient";
import { getSecDevRoomSnapshots } from "@/lib/development/secFormDevDashboard";
import styles from "./sec-development.module.css";

export const dynamic = "force-dynamic";

export default async function SecDevelopmentPage() {
  if (process.env.NODE_ENV === "production") notFound();

  const rooms = await getSecDevRoomSnapshots();

  return (
    <main className={styles.page}>
      <header className={styles.topbar}>
        <div>
          <span>SEC Development</span>
          <h1>Form-Room Debug Console</h1>
          <p>Parser files, LLM prompt files, fixture outputs, and local test results for the current worktree.</p>
        </div>
        <div className={styles.topLinks}>
          <Link href="/development/sec/issues">All Issues</Link>
          <Link href="/admin">Admin</Link>
          <Link href="/filings">Filings</Link>
        </div>
      </header>

      <SecDevelopmentClient initialRooms={rooms} />
    </main>
  );
}
