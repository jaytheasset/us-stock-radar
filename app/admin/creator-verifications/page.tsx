import type { Metadata } from "next";
import { AdminVerificationClient } from "@/components/social-verification/AdminVerificationClient";
import styles from "@/components/social-verification/SocialVerification.module.css";
import { requireAdminPermission } from "@/lib/admin/server";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Creator verification review | Stock Radar",
  robots: { index: false, follow: false },
};

export default async function CreatorVerificationAdminPage() {
  await requireAdminPermission("verifications.read");
  return (
    <main className={styles.page}>
      <AdminVerificationClient />
    </main>
  );
}
