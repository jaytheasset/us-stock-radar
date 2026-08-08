import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SecDevelopmentClient } from "@/app/development/sec/SecDevelopmentClient";
import { getFilingUiConsoleEntries } from "@/lib/development/filingUiConsoleData";
import { getNewsUiConsoleEntries } from "@/lib/development/newsUiConsoleData";
import { getSecDevRoomSnapshots } from "@/lib/development/secFormDevDashboard";
import { requireAdminPermission } from "@/lib/admin/server";
import styles from "./sec-development.module.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "SEC Debug Console",
  robots: { follow: false, index: false },
};

export default async function SecDevelopmentPage() {
  if (process.env.NODE_ENV === "production") notFound();
  await requireAdminPermission("system.read");

  const [rooms, filingUiEntries, newsUiEntries] = await Promise.all([
    getSecDevRoomSnapshots(),
    getFilingUiConsoleEntries(),
    getNewsUiConsoleEntries(),
  ]);

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

      <SecDevelopmentClient initialFilingUiEntries={[...filingUiEntries, ...newsUiEntries]} initialRooms={rooms} />
    </main>
  );
}
