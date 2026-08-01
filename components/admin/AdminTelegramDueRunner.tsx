"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import styles from "./AdminTelegramCampaign.module.css";

export function AdminTelegramDueRunner() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function runMock() {
    if (!window.confirm("Process one due campaign with a local mock response? No Telegram message will be sent.")) {
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/admin/telegram-campaigns/run-due", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          confirmation: "RUN LOCAL MOCK",
          reason: "Local due-campaign workflow verification.",
        }),
      });
      const payload = (await response.json().catch(() => null)) as {
        ok?: boolean;
        data?: { scanned?: number; sent?: number };
        error?: { message?: string };
      } | null;
      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.error?.message || "Local mock run failed.");
      }
      setMessage(
        payload.data?.scanned
          ? `Processed ${payload.data.sent || 0} due campaign with a mock Telegram response.`
          : "No campaign is due.",
      );
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Local mock run failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.actions}>
      <button className={styles.button} disabled={busy} onClick={runMock} type="button">
        {busy ? "Running mock…" : "Run one due campaign (mock)"}
      </button>
      {message ? <span className={styles.muted}>{message}</span> : null}
    </div>
  );
}
