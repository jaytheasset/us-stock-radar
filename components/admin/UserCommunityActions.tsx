"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import styles from "./AdminSection.module.css";

export function UserCommunityActions({
  currentStatus,
  userId,
}: {
  currentStatus: string;
  userId: string;
}) {
  const router = useRouter();
  const [action, setAction] = useState(
    currentStatus === "active" ? "temporary_suspend" : "unsuspend",
  );
  const [reason, setReason] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [state, setState] = useState<{
    pending: boolean;
    error: string;
    success: string;
  }>({ pending: false, error: "", success: "" });

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setState({ pending: true, error: "", success: "" });
    try {
      const response = await fetch(
        `/api/admin/users/${encodeURIComponent(userId)}/community-status`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action,
            reason,
            expiresAt:
              action === "temporary_suspend" && expiresAt
                ? new Date(expiresAt).toISOString()
                : null,
          }),
        },
      );
      const payload = (await response.json()) as {
        error?: { message?: string };
      };
      if (!response.ok) {
        throw new Error(payload.error?.message || "The action failed.");
      }
      setReason("");
      setState({
        pending: false,
        error: "",
        success: "Community action recorded.",
      });
      router.refresh();
    } catch (error) {
      setState({
        pending: false,
        error: error instanceof Error ? error.message : "The action failed.",
        success: "",
      });
    }
  }

  return (
    <form className={styles.stack} onSubmit={submit}>
      <div className={styles.field}>
        <label htmlFor="community-action">Action</label>
        <select
          className={styles.select}
          id="community-action"
          onChange={(event) => setAction(event.target.value)}
          value={action}
        >
          <option value="temporary_suspend">Temporary suspension</option>
          <option value="permanent_suspend">Permanent suspension</option>
          <option value="unsuspend">Restore community access</option>
        </select>
      </div>
      {action === "temporary_suspend" ? (
        <div className={styles.field}>
          <label htmlFor="community-expires">Suspended until</label>
          <input
            className={styles.input}
            id="community-expires"
            onChange={(event) => setExpiresAt(event.target.value)}
            required
            type="datetime-local"
            value={expiresAt}
          />
        </div>
      ) : null}
      <div className={styles.field}>
        <label htmlFor="community-reason">Required reason</label>
        <textarea
          className={styles.textarea}
          id="community-reason"
          minLength={4}
          onChange={(event) => setReason(event.target.value)}
          placeholder="Describe the evidence and why this action is necessary."
          required
          value={reason}
        />
      </div>
      {state.error ? <p className={styles.error}>{state.error}</p> : null}
      {state.success ? (
        <p className={styles.success}>{state.success}</p>
      ) : null}
      <button
        className={
          action.includes("suspend") && action !== "unsuspend"
            ? styles.buttonDanger
            : styles.button
        }
        disabled={state.pending}
        type="submit"
      >
        {state.pending ? "Saving…" : "Apply action"}
      </button>
    </form>
  );
}
