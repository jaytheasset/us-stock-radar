"use client";

import { useEffect, useState } from "react";
import { Check, ExternalLink, X } from "lucide-react";
import { socialPlatformLabel } from "@/lib/social-verification/policy";
import type { SocialVerificationReview } from "@/lib/social-verification/types";
import styles from "./SocialVerification.module.css";

type AdminResponse = {
  ok: boolean;
  data?: {
    items?: SocialVerificationReview[];
    nextCursor?: string | null;
  };
  message?: string;
};

export function AdminVerificationClient() {
  const [items, setItems] = useState<SocialVerificationReview[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    void loadReviews(null, controller.signal)
      .then((payload) => {
        setItems(payload.data?.items || []);
        setNextCursor(payload.data?.nextCursor || null);
      })
      .catch((error: unknown) => {
        if ((error as Error).name !== "AbortError") {
          setNotice(readErrorMessage(error));
        }
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, []);

  async function review(
    item: SocialVerificationReview,
    decision: "approve" | "reject",
    note: string,
  ) {
    setBusyId(item.publicRequestId);
    setNotice("");
    try {
      const response = await fetch(
        `/api/admin/creator-verifications/${encodeURIComponent(
          item.publicRequestId,
        )}`,
        {
          method: "PATCH",
          cache: "no-store",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ decision, note }),
        },
      );
      const payload = (await response.json().catch(() => null)) as
        | AdminResponse
        | null;
      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.message || "Review could not be saved.");
      }
      setItems((current) =>
        current.filter(
          (request) => request.publicRequestId !== item.publicRequestId,
        ),
      );
      setNotice(decision === "approve" ? "Request approved." : "Request rejected.");
    } catch (error) {
      setNotice(readErrorMessage(error));
    } finally {
      setBusyId(null);
    }
  }

  async function loadMore() {
    if (!nextCursor) return;
    setLoading(true);
    try {
      const payload = await loadReviews(nextCursor);
      setItems((current) => [...current, ...(payload.data?.items || [])]);
      setNextCursor(payload.data?.nextCursor || null);
    } catch (error) {
      setNotice(readErrorMessage(error));
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className={styles.adminPanel}>
      <header className={styles.panelHeader}>
        <div>
          <span className={styles.eyebrow}>Admin review</span>
          <h1>Creator verifications</h1>
          <p>
            Confirm only that the public proof shows account ownership. Approval
            does not endorse investment knowledge or advice.
          </p>
        </div>
      </header>
      {notice ? (
        <p aria-live="polite" className={styles.notice}>
          {notice}
        </p>
      ) : null}
      {loading && !items.length ? (
        <p className={styles.empty}>Loading pending requests…</p>
      ) : items.length ? (
        <div className={styles.reviewList}>
          {items.map((item) => (
            <ReviewCard
              busy={busyId === item.publicRequestId}
              item={item}
              key={item.publicRequestId}
              onReview={review}
            />
          ))}
        </div>
      ) : (
        <p className={styles.empty}>No pending verification requests.</p>
      )}
      {nextCursor ? (
        <button
          className={styles.loadMore}
          disabled={loading}
          onClick={() => void loadMore()}
          type="button"
        >
          {loading ? "Loading…" : "Load more"}
        </button>
      ) : null}
    </section>
  );
}

function ReviewCard({
  busy,
  item,
  onReview,
}: {
  busy: boolean;
  item: SocialVerificationReview;
  onReview: (
    item: SocialVerificationReview,
    decision: "approve" | "reject",
    note: string,
  ) => Promise<void>;
}) {
  const [note, setNote] = useState("");
  return (
    <article className={styles.reviewCard}>
      <header>
        <span className={styles.applicantEmoji} aria-hidden="true">
          {item.applicantEmoji}
        </span>
        <div>
          <strong>{item.applicantDisplayName}</strong>
          <span>
            {socialPlatformLabel(item.platform)} · @{item.normalizedHandle}
          </span>
        </div>
        <time dateTime={item.submittedAt}>
          {new Date(item.submittedAt).toLocaleDateString("en-US")}
        </time>
      </header>
      <dl>
        <div>
          <dt>Profile</dt>
          <dd>
            <a href={item.profileUrl} rel="noopener noreferrer" target="_blank">
              Open profile <ExternalLink aria-hidden="true" size={13} />
            </a>
          </dd>
        </div>
        <div>
          <dt>Proof</dt>
          <dd>
            <a href={item.proofUrl} rel="noopener noreferrer" target="_blank">
              Open proof <ExternalLink aria-hidden="true" size={13} />
            </a>
          </dd>
        </div>
        <div>
          <dt>Code</dt>
          <dd><code>{item.proofCode}</code></dd>
        </div>
        <div>
          <dt>Expires</dt>
          <dd><time dateTime={item.expiresAt}>{formatDate(item.expiresAt)}</time></dd>
        </div>
      </dl>
      <label>
        Rejection reason
        <input
          disabled={busy}
          maxLength={240}
          onChange={(event) => setNote(event.target.value)}
          placeholder="Required only when rejecting"
          value={note}
        />
      </label>
      <div className={styles.actions}>
        <button
          disabled={busy}
          onClick={() => void onReview(item, "approve", "")}
          type="button"
        >
          <Check aria-hidden="true" size={14} /> Approve ownership
        </button>
        <button
          className={styles.quietDanger}
          disabled={busy || !note.trim()}
          onClick={() => void onReview(item, "reject", note)}
          type="button"
        >
          <X aria-hidden="true" size={14} /> Reject
        </button>
      </div>
    </article>
  );
}

async function loadReviews(cursor: string | null, signal?: AbortSignal) {
  const search = new URLSearchParams({ limit: "25" });
  if (cursor) search.set("cursor", cursor);
  const response = await fetch(
    `/api/admin/creator-verifications?${search.toString()}`,
    { cache: "no-store", signal },
  );
  const payload = (await response.json().catch(() => null)) as
    | AdminResponse
    | null;
  if (!response.ok || !payload?.ok) {
    throw new Error(payload?.message || "Reviews could not be loaded.");
  }
  return payload;
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Unavailable"
    : date.toLocaleString("en-US", {
        dateStyle: "medium",
        timeStyle: "short",
      });
}

function readErrorMessage(error: unknown) {
  return error instanceof Error
    ? error.message
    : "The request could not be completed.";
}
