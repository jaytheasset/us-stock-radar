import type { Metadata } from "next";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AdminVerificationClient } from "@/components/social-verification/AdminVerificationClient";
import styles from "@/components/social-verification/SocialVerification.module.css";
import { StockRadarAppShell } from "@/components/shell/StockRadarAppShell";
import { getOptionalCurrentUserId } from "@/lib/currentUser";
import { isSocialVerificationAdmin } from "@/lib/social-verification/serverRepository";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Creator verification review | Stock Radar",
  robots: { index: false, follow: false },
};

export default async function CreatorVerificationAdminPage() {
  const userId = await getOptionalCurrentUserId();
  if (!userId) {
    redirect("/login?next=%2Fadmin%2Fcreator-verifications");
  }
  if (!(await isSocialVerificationAdmin(userId))) {
    redirect("/");
  }
  return (
    <StockRadarAppShell activeNavigationItem={null} themeMode="user-selectable">
      <main className={styles.page}>
        <Link className={styles.backLink} href="/admin">
          <ArrowLeft aria-hidden="true" size={14} /> Admin
        </Link>
        <AdminVerificationClient />
      </main>
    </StockRadarAppShell>
  );
}
