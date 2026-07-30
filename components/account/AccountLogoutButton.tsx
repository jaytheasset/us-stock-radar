"use client";

import { LogOut } from "lucide-react";
import { useState } from "react";
import styles from "@/components/account/AccountPage.module.css";
import { logoutAndReloadCurrentPage } from "@/lib/auth/clientLogout";

export function AccountLogoutButton() {
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);

  async function logout() {
    if (saving) return;
    setSaving(true);
    setFailed(false);
    try {
      await logoutAndReloadCurrentPage();
    } catch {
      setFailed(true);
      setSaving(false);
    }
  }

  return (
    <button
      className={styles.logoutButton}
      disabled={saving}
      aria-live="polite"
      type="button"
      onClick={logout}
    >
      <LogOut aria-hidden="true" size={16} />
      {saving
        ? "Logging out..."
        : failed
          ? "Logout failed — retry"
          : "Log out"}
    </button>
  );
}
