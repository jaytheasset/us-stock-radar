import type { Metadata } from "next";
import { PasswordResetRequestForm } from "@/components/PasswordResetRequestForm";

export const metadata: Metadata = {
  title: "Reset Password",
  robots: {
    index: false,
    follow: false,
  },
};

export default function ForgotPasswordPage() {
  return <PasswordResetRequestForm />;
}
