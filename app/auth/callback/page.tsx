import type { Metadata } from "next";
import { AuthCallbackClient } from "@/components/AuthCallbackClient";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Secure Sign-in | Stock Radar",
  robots: {
    index: false,
    follow: false,
  },
};

export default function AuthCallbackPage() {
  return <AuthCallbackClient />;
}
