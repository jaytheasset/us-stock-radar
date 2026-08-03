import type { Metadata } from "next";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { CreatorVerificationClient } from "@/components/social-verification/CreatorVerificationClient";
import styles from "@/components/social-verification/SocialVerification.module.css";
import { StockRadarAppShell } from "@/components/shell/StockRadarAppShell";
import { getOptionalCurrentUserId } from "@/lib/currentUser";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Creator verification",
  description: "Verify ownership of a public Instagram, X, or YouTube account.",
  robots: { index: false, follow: false },
};

export default async function CreatorVerificationPage() {
  if (!(await getOptionalCurrentUserId())) {
    redirect("/login?next=%2Faccount%2Fcreator");
  }
  return (
    <StockRadarAppShell activeNavigationItem={null} themeMode="user-selectable">
      <main className={styles.page}>
        <Link className={styles.backLink} href="/account">
          <ArrowLeft aria-hidden="true" size={14} /> Account
        </Link>
        <CreatorVerificationClient />
      </main>
    </StockRadarAppShell>
  );
}
