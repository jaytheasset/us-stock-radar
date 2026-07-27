import type { Metadata } from "next";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { DirectMessageSettingsClient } from "@/components/direct-messages/DirectMessageSettingsClient";
import styles from "@/components/direct-messages/DirectMessageSettings.module.css";
import { StockRadarAppShell } from "@/components/shell/StockRadarAppShell";
import { getOptionalCurrentUserId } from "@/lib/currentUser";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Message privacy | Stock Radar",
  description: "Choose who may send you private member message requests.",
  robots: { index: false, follow: false },
};

export default async function MessagePrivacyPage() {
  if (!(await getOptionalCurrentUserId())) {
    redirect("/login?next=%2Faccount%2Fmessages");
  }
  return (
    <StockRadarAppShell activeNavigationItem={null} themeMode="user-selectable">
      <main className={styles.page}>
        <Link className={styles.backLink} href="/account">
          <ArrowLeft aria-hidden="true" size={14} /> Account
        </Link>
        <DirectMessageSettingsClient />
      </main>
    </StockRadarAppShell>
  );
}
