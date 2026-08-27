import type { Metadata } from "next";
import { DilutionIdentityReviewClient } from "./DilutionIdentityReviewClient";
import { requireAdminPermission } from "@/lib/admin/server";
import { listDilutionIdentityReviewCases } from "@/lib/dilution/dilutionIdentityReviewExchange";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Dilution Identity Review",
};

export default async function DilutionIdentityReviewPage() {
  await requireAdminPermission("data.read");
  const cases = await listDilutionIdentityReviewCases();
  return <DilutionIdentityReviewClient initialCases={cases} />;
}
