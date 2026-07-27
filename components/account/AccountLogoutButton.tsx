"use client";

import { LogOut } from "lucide-react";
import { useState } from "react";
import styles from "@/components/account/AccountPage.module.css";

export function AccountLogoutButton() {
  const [saving, setSaving] = useState(false);

  async function logout() {
    setSaving(true);
    try {
      await fetch("/api/auth/logout", {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
      });
    } finally {
      window.location.assign("/feed");
    }
  }

  return (
    <button
      className={styles.logoutButton}
      disabled={saving}
      type="button"
      onClick={logout}
    >
      <LogOut aria-hidden="true" size={16} />
      {saving ? "Logging out..." : "Log out"}
    </button>
  );
}
