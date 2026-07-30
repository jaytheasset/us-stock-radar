"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { AdminRoomStatus } from "@/lib/admin/rooms";
import styles from "./AdminSection.module.css";

type RoomAction = "archive" | "lock" | "restore" | "unlock";

export function AdminRoomActions({
  roomId,
  status,
}: {
  roomId: string;
  status: AdminRoomStatus;
}) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState<RoomAction | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const actions: RoomAction[] =
    status === "archived"
      ? ["restore"]
      : status === "locked"
        ? ["unlock", "archive"]
        : ["lock", "archive"];

  async function run(action: RoomAction) {
    setBusy(action);
    setNotice("");
    setError("");
    try {
      const response = await fetch(`/api/admin/rooms/${roomId}/status`, {
        body: JSON.stringify({ action, reason }),
        headers: { "Content-Type": "application/json" },
        method: "PATCH",
      });
      const payload = (await response.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      if (!response.ok) {
        throw new Error(payload?.error?.message || `HTTP ${response.status}`);
      }
      setNotice(`Room ${action} completed.`);
      setReason("");
      router.refresh();
    } catch (actionError) {
      setError(
        actionError instanceof Error
          ? actionError.message
          : "Room action failed.",
      );
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className={styles.detailCard}>
      <h2>Room controls</h2>
      <div className={styles.stack}>
        <label className={styles.field}>
          <span>Required reason</span>
          <textarea
            className={styles.textarea}
            maxLength={2000}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Explain why this room state must change."
            value={reason}
          />
        </label>
        <div className={styles.actions}>
          {actions.map((action) => (
            <button
              className={
                action === "archive" ? styles.buttonDanger : styles.button
              }
              disabled={Boolean(busy) || reason.trim().length < 4}
              key={action}
              onClick={() => void run(action)}
              type="button"
            >
              {busy === action ? "Working..." : actionLabel(action)}
            </button>
          ))}
        </div>
        {notice ? (
          <p className={styles.success} role="status">
            {notice}
          </p>
        ) : null}
        {error ? (
          <p className={styles.error} role="alert">
            {error}
          </p>
        ) : null}
        <p className={styles.muted}>
          Lock keeps public history readable but blocks new participation.
          Archive also removes the room from public discovery. Hard delete and
          owner transfer are intentionally unavailable.
        </p>
      </div>
    </section>
  );
}

function actionLabel(action: RoomAction) {
  const labels: Record<RoomAction, string> = {
    archive: "Archive room",
    lock: "Lock room",
    restore: "Restore room",
    unlock: "Unlock room",
  };
  return labels[action];
}
