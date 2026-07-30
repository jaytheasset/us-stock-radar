"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import styles from "./AdminSection.module.css";

type ModeratorOption = {
  userId: string;
  label: string;
};

export function ModerationCaseActions({
  caseId,
  currentAssignee,
  currentSeverity,
  currentStatus,
  directMessage,
  moderators,
}: {
  caseId: string;
  currentAssignee: string | null;
  currentSeverity: string;
  currentStatus: string;
  directMessage: boolean;
  moderators: ModeratorOption[];
}) {
  const router = useRouter();
  const [mode, setMode] = useState<"triage" | "action">("triage");
  const [action, setAction] = useState("dismiss");
  const [status, setStatus] = useState(
    currentStatus === "in_review" ? "in_review" : "open",
  );
  const [severity, setSeverity] = useState(currentSeverity);
  const [assignedTo, setAssignedTo] = useState(currentAssignee || "");
  const [reason, setReason] = useState("");
  const [suspendUntil, setSuspendUntil] = useState("");
  const [state, setState] = useState({
    pending: false,
    error: "",
    success: "",
  });

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const chosenAction = mode === "triage" ? "triage" : action;
    setState({ pending: true, error: "", success: "" });
    try {
      const response = await fetch(
        `/api/admin/moderation/${encodeURIComponent(caseId)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: chosenAction,
            reason,
            status: mode === "triage" ? status : null,
            severity: mode === "triage" ? severity : null,
            assignedTo: assignedTo || null,
            suspendUntil:
              chosenAction === "temporary_suspend" && suspendUntil
                ? new Date(suspendUntil).toISOString()
                : null,
          }),
        },
      );
      const payload = (await response.json()) as {
        error?: { message?: string };
      };
      if (!response.ok) {
        throw new Error(payload.error?.message || "The case update failed.");
      }
      setReason("");
      setState({
        pending: false,
        error: "",
        success: "Case update recorded and audited.",
      });
      router.refresh();
    } catch (error) {
      setState({
        pending: false,
        error:
          error instanceof Error ? error.message : "The case update failed.",
        success: "",
      });
    }
  }

  return (
    <form className={styles.stack} onSubmit={submit}>
      <div className={styles.actions}>
        <button
          className={styles.button}
          onClick={() => setMode("triage")}
          type="button"
        >
          Triage
        </button>
        <button
          className={styles.button}
          onClick={() => setMode("action")}
          type="button"
        >
          Enforcement
        </button>
      </div>
      {mode === "triage" ? (
        <>
          <div className={styles.field}>
            <label htmlFor="moderation-status">Queue status</label>
            <select
              className={styles.select}
              id="moderation-status"
              onChange={(event) => setStatus(event.target.value)}
              value={status}
            >
              <option value="open">Open</option>
              <option value="in_review">In review</option>
            </select>
          </div>
          <div className={styles.field}>
            <label htmlFor="moderation-severity">Severity</label>
            <select
              className={styles.select}
              id="moderation-severity"
              onChange={(event) => setSeverity(event.target.value)}
              value={severity}
            >
              <option value="low">Low</option>
              <option value="normal">Normal</option>
              <option value="high">High</option>
              <option value="critical">Critical</option>
            </select>
          </div>
        </>
      ) : (
        <div className={styles.field}>
          <label htmlFor="moderation-action">Action</label>
          <select
            className={styles.select}
            id="moderation-action"
            onChange={(event) => setAction(event.target.value)}
            value={action}
          >
            <option value="dismiss">Dismiss report</option>
            {!directMessage ? (
              <>
                <option value="hide_content">Hide content</option>
                <option value="restore_content">Restore content</option>
              </>
            ) : null}
            <option value="warn_user">Warn user</option>
            <option value="temporary_suspend">Temporary suspension</option>
            <option value="permanent_suspend">Permanent suspension</option>
          </select>
        </div>
      )}
      <div className={styles.field}>
        <label htmlFor="moderation-assignee">Assignee</label>
        <select
          className={styles.select}
          id="moderation-assignee"
          onChange={(event) => setAssignedTo(event.target.value)}
          value={assignedTo}
        >
          <option value="">Unassigned</option>
          {moderators.map((moderator) => (
            <option key={moderator.userId} value={moderator.userId}>
              {moderator.label}
            </option>
          ))}
        </select>
      </div>
      {mode === "action" && action === "temporary_suspend" ? (
        <div className={styles.field}>
          <label htmlFor="moderation-suspend-until">Suspended until</label>
          <input
            className={styles.input}
            id="moderation-suspend-until"
            onChange={(event) => setSuspendUntil(event.target.value)}
            required
            type="datetime-local"
            value={suspendUntil}
          />
        </div>
      ) : null}
      <div className={styles.field}>
        <label htmlFor="moderation-reason">Required reason</label>
        <textarea
          className={styles.textarea}
          id="moderation-reason"
          minLength={4}
          onChange={(event) => setReason(event.target.value)}
          placeholder="Summarize the evidence and decision."
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
          mode === "action" && action.includes("suspend")
            ? styles.buttonDanger
            : styles.button
        }
        disabled={state.pending}
        type="submit"
      >
        {state.pending ? "Saving…" : "Record update"}
      </button>
    </form>
  );
}
