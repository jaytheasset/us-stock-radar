"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import styles from "./AdminSection.module.css";

type HumanAction = "reviewed" | "approved" | "rejected" | "withdrawn";

type HistoryItem = {
  id: string;
  automaticDecisionId: string;
  automaticDecisionSha256: string;
  revision: number;
  action: HumanAction;
  actorRole: string;
  reason: string;
  resultingEffectiveAction: "approved" | "rejected" | null;
  evidenceReferences: Record<string, unknown>;
  auditLogId: string;
  createdAt: string;
};

export function TickerResolutionHumanReview(props: {
  canWrite: boolean;
  automaticDecisionId: string;
  automaticDecisionSha256: string;
  automaticState: string;
  effectiveDisposition: string;
  expectedRevision: number;
  availableActions: readonly HumanAction[];
  approvalBlockedReason: string | null;
  reconsiderationRequired: boolean;
  history: readonly HistoryItem[];
}) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState<HumanAction | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState<{
    action: HumanAction;
    reason: string;
    requestId: string;
  } | null>(null);

  async function submit(action: HumanAction) {
    const normalizedReason = reason.trim();
    if (normalizedReason.length < 4) {
      setError("Enter a reason of at least four characters.");
      return;
    }
    const requestId =
      retry?.action === action && retry.reason === normalizedReason
        ? retry.requestId
        : crypto.randomUUID();
    setRetry({ action, reason: normalizedReason, requestId });
    setBusy(action);
    setError("");
    try {
      const response = await fetch(
        `/api/admin/data/ticker-resolution/${encodeURIComponent(props.automaticDecisionId)}/human-review`,
        {
          method: "POST",
          credentials: "same-origin",
          headers: {
            "Content-Type": "application/json",
            "X-Request-Id": requestId,
          },
          body: JSON.stringify({
            action,
            expectedAutomaticSha256: props.automaticDecisionSha256,
            expectedRevision: props.expectedRevision,
            reason: normalizedReason,
          }),
        },
      );
      const payload = (await response.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      if (!response.ok) {
        setError(
          payload?.error?.message ||
            "The review was not saved. Refresh before retrying.",
        );
        return;
      }
      setRetry(null);
      setReason("");
      router.refresh();
    } catch {
      setError(
        "The response is unknown. Retry the same action and reason to safely replay the request.",
      );
    } finally {
      setBusy(null);
    }
  }

  return (
    <section aria-labelledby="human-review-heading" className={styles.stack}>
      <div className={styles.sectionHeading}>
        <div>
          <h2 id="human-review-heading">Human review and override</h2>
          <p>
            Append-only decisions bound to this automatic filing pair. No ticker
            or relationship can be entered manually.
          </p>
        </div>
        <span className={styles.badge}>Effective: {props.effectiveDisposition}</span>
      </div>

      {props.reconsiderationRequired ? (
        <div className={styles.error} role="alert">
          Automatic source or evidence changed after the human decision. The
          prior decision remains in history; no relationship becomes effective
          from it until an administrator reconsiders the current evidence.
        </div>
      ) : null}

      <article className={styles.detailCard}>
        <h3>{props.canWrite ? "Record a decision" : "Decision controls"}</h3>
        <p className={styles.muted}>
          Automatic state: <strong>{props.automaticState}</strong> · Expected
          human revision: <strong>{props.expectedRevision}</strong>
        </p>
        {props.approvalBlockedReason ? (
          <div className={styles.notice} role="status">
            {props.approvalBlockedReason}
          </div>
        ) : (
          <div className={styles.success} role="status">
            Approval is limited to the displayed source-bound candidate and its
            exact evidence hashes.
          </div>
        )}
        {props.canWrite ? (
          <>
            <label className={styles.field}>
              <span>Reason</span>
              <textarea
                className={styles.textarea}
                maxLength={2000}
                onChange={(event) => setReason(event.target.value)}
                placeholder="Explain what was reviewed and why this action is safe."
                value={reason}
              />
            </label>
            <div className={styles.actions}>
              {props.availableActions.map((action) => (
                <button
                  className={action === "rejected" ? styles.buttonDanger : styles.button}
                  disabled={Boolean(busy)}
                  key={action}
                  onClick={() => void submit(action)}
                  type="button"
                >
                  {busy === action ? "Saving…" : actionLabel(action)}
                </button>
              ))}
            </div>
          </>
        ) : (
          <div className={styles.notice} role="status">
            Your role can inspect this append-only history but cannot record a decision.
          </div>
        )}
        {error ? (
          <div className={styles.error} role="alert">
            {error}
          </div>
        ) : null}
      </article>

      <article className={styles.detailCard}>
        <h3>Append-only human history</h3>
        {props.history.length ? (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Revision</th>
                  <th>Time</th>
                  <th>Action</th>
                  <th>Result</th>
                  <th>Actor role</th>
                  <th>Reason and evidence</th>
                  <th>Audit</th>
                </tr>
              </thead>
              <tbody>
                {[...props.history].reverse().map((item) => (
                  <tr key={item.id}>
                    <td>{item.revision}</td>
                    <td>{formatTimestamp(item.createdAt)}</td>
                    <td><strong>{item.action}</strong></td>
                    <td>{item.resultingEffectiveAction || "automatic / pending"}</td>
                    <td>{item.actorRole.replaceAll("_", " ")}</td>
                    <td>
                      {item.reason}
                      <div className={styles.mono}>
                        auto {shortHash(item.automaticDecisionSha256)} · evidence {shortHash(readString(item.evidenceReferences.evidenceSha256))}
                      </div>
                    </td>
                    <td>
                      <a href={`/admin/audit?target=${encodeURIComponent(item.automaticDecisionId)}`}>
                        {shortId(item.auditLogId)}
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className={styles.notice} role="status">
            No human decision has been recorded for this filing pair.
          </div>
        )}
      </article>
    </section>
  );
}

function actionLabel(action: HumanAction) {
  if (action === "reviewed") return "Mark AUTO reviewed";
  if (action === "approved") return "Approve source-bound candidate";
  if (action === "rejected") return "Reject relationship";
  return "Withdraw current human decision";
}

function readString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function shortHash(value: string) {
  return value ? `${value.slice(0, 10)}…` : "none";
}

function shortId(value: string) {
  return value ? `${value.slice(0, 8)}…` : "—";
}

function formatTimestamp(value: string) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString("en-US");
}
