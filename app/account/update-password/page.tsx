import type { Metadata } from "next";
import { UpdatePasswordForm } from "@/components/UpdatePasswordForm";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Update Password | Stock Radar",
  robots: {
    index: false,
    follow: false,
  },
};

export default function UpdatePasswordPage() {
  return <UpdatePasswordForm />;
}
