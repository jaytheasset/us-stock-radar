"use client";

import { useEffect, useState } from "react";
import { Check, Clipboard, ExternalLink, RefreshCw, X } from "lucide-react";
import {
  socialPlatformLabel,
} from "@/lib/social-verification/policy";
import type {
  SocialVerificationPlatform,
  SocialVerificationRequest,
} from "@/lib/social-verification/types";
import styles from "./SocialVerification.module.css";

type MemberResponse = {
  ok: boolean;
  data?: { item?: SocialVerificationRequest; items?: SocialVerificationRequest[] };
  message?: string;
};

export function CreatorVerificationClient() {
  const [items, setItems] = useState<SocialVerificationRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [platform, setPlatform] =
    useState<SocialVerificationPlatform>("x");
  const [handle, setHandle] = useState("");
  const [profileUrl, setProfileUrl] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/account/creator-verifications", {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(readResponse)
      .then((payload) => {
        setItems(payload.data?.items || []);
        setNotice("");
      })
      .catch((error: unknown) => {
        if ((error as Error).name !== "AbortError") {
          setNotice(readErrorMessage(error));
        }
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, []);

  async function createRequest(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusyId("create");
    setNotice("");
    try {
      const payload = await mutate("/api/account/creator-verifications", {
        method: "POST",
        body: JSON.stringify({ handle, platform, profileUrl }),
      });
      if (payload.data?.item) {
        setItems((current) => [payload.data!.item!, ...current]);
      }
      setHandle("");
      setProfileUrl("");
      setNotice("Proof code created. Publish it before it expires.");
    } catch (error) {
      setNotice(readErrorMessage(error));
    } finally {
      setBusyId(null);
    }
  }

  async function updateRequest(
    request: SocialVerificationRequest,
    input: Record<string, unknown>,
  ) {
    setBusyId(request.publicRequestId);
    setNotice("");
    try {
      const payload = await mutate(
        `/api/account/creator-verifications/${encodeURIComponent(
          request.publicRequestId,
        )}`,
        { method: "PATCH", body: JSON.stringify(input) },
      );
      if (payload.data?.item) {
        setItems((current) =>
          current.map((item) =>
            item.publicRequestId === request.publicRequestId
              ? payload.data!.item!
              : item,
          ),
        );
      }
      setNotice("Verification request updated.");
    } catch (error) {
      setNotice(readErrorMessage(error));
    } finally {
      setBusyId(null);
    }
  }

  const activePlatforms = new Set(
    items
      .filter((item) =>
        ["draft", "proof_ready", "pending_review", "verified"].includes(
          item.status,
        ),
      )
      .map((item) => item.platform),
  );

  return (
    <div className={styles.memberLayout}>
      <section className={styles.panel}>
        <div className={styles.panelHeader}>
          <div>
            <span className={styles.eyebrow}>Ownership proof</span>
            <h1>Social account verification</h1>
          </div>
        </div>
        <p className={styles.intro}>
          Verify that you control a public X, YouTube, or Instagram account.
          This does not verify investing experience, performance, or financial
          advice.
        </p>
        <form className={styles.form} onSubmit={createRequest}>
          <label>
            Platform
            <select
              onChange={(event) =>
                setPlatform(event.target.value as SocialVerificationPlatform)
              }
              value={platform}
            >
              <option value="x">X</option>
              <option value="youtube">YouTube</option>
              <option value="instagram">Instagram</option>
            </select>
          </label>
          <label>
            Public handle
            <input
              autoComplete="off"
              maxLength={65}
              onChange={(event) => setHandle(event.target.value)}
              placeholder="@handle"
              required
              value={handle}
            />
          </label>
          <label className={styles.fullField}>
            Public profile URL
            <input
              inputMode="url"
              onChange={(event) => setProfileUrl(event.target.value)}
              placeholder={profilePlaceholder(platform)}
              required
              type="url"
              value={profileUrl}
            />
          </label>
          <button
            className={styles.primaryButton}
            disabled={busyId === "create" || activePlatforms.has(platform)}
            type="submit"
          >
            {busyId === "create" ? "Creating…" : "Create proof code"}
          </button>
          {activePlatforms.has(platform) ? (
            <small>An active request already exists for this platform.</small>
          ) : null}
        </form>
      </section>

      <section aria-busy={loading} className={styles.panel}>
        <div className={styles.panelHeader}>
          <div>
            <span className={styles.eyebrow}>Your requests</span>
            <h2>Verification status</h2>
          </div>
        </div>
        {notice ? (
          <p aria-live="polite" className={styles.notice}>
            {notice}
          </p>
        ) : null}
        {loading ? (
          <p className={styles.empty}>Loading requests…</p>
        ) : items.length ? (
          <div className={styles.requestList}>
            {items.map((item) => (
              <VerificationRequestCard
                busy={busyId === item.publicRequestId}
                item={item}
                key={`${item.publicRequestId}:${item.proofCode}`}
                onUpdate={updateRequest}
              />
            ))}
          </div>
        ) : (
          <p className={styles.empty}>
            No social account verification requests yet.
          </p>
        )}
      </section>
    </div>
  );
}

function VerificationRequestCard({
  busy,
  item,
  onUpdate,
}: {
  busy: boolean;
  item: SocialVerificationRequest;
  onUpdate: (
    request: SocialVerificationRequest,
    input: Record<string, unknown>,
  ) => Promise<void>;
}) {
  const [proofUrl, setProofUrl] = useState(item.proofUrl || "");
  const canEditProof = item.status === "draft" || item.status === "proof_ready";

  return (
    <article className={styles.requestCard}>
      <header>
        <div>
          <strong>{socialPlatformLabel(item.platform)}</strong>
          <span>@{item.normalizedHandle}</span>
        </div>
        <span className={styles.status} data-status={item.status}>
          {statusLabel(item.status)}
        </span>
      </header>
      <a
        className={styles.externalLink}
        href={item.profileUrl}
        rel="noopener noreferrer"
        target="_blank"
      >
        Open public profile <ExternalLink aria-hidden="true" size={13} />
      </a>
      {canEditProof ? (
        <>
          <div className={styles.proofCode}>
            <div>
              <small>Public proof code · expires in 24 hours</small>
              <code>{item.proofCode}</code>
            </div>
            <button
              aria-label="Copy proof code"
              onClick={() => void navigator.clipboard?.writeText(item.proofCode)}
              type="button"
            >
              <Clipboard aria-hidden="true" size={14} />
            </button>
          </div>
          <label className={styles.proofField}>
            URL where the code is publicly visible
            <input
              disabled={busy}
              inputMode="url"
              onChange={(event) => setProofUrl(event.target.value)}
              placeholder="https://…"
              type="url"
              value={proofUrl}
            />
          </label>
        </>
      ) : null}
      {item.reviewNote ? (
        <p className={styles.reviewNote}>
          Review note: {item.reviewNote}
        </p>
      ) : null}
      {item.status === "verified" ? (
        <label className={styles.toggleRow}>
          <input
            checked={item.showOnProfile}
            disabled={busy}
            onChange={(event) =>
              void onUpdate(item, {
                action: "set_visibility",
                showOnProfile: event.target.checked,
              })
            }
            type="checkbox"
          />
          <span>
            <strong>Show on my Live Room profile</strong>
            <small>
              Displays the verified platform and public profile URL beside your
              Live Room messages.
            </small>
          </span>
        </label>
      ) : null}
      <div className={styles.actions}>
        {canEditProof ? (
          <button
            disabled={busy || !proofUrl}
            onClick={() =>
              void onUpdate(item, { action: "save_proof", proofUrl })
            }
            type="button"
          >
            Save proof URL
          </button>
        ) : null}
        {item.status === "proof_ready" ? (
          <button
            disabled={busy}
            onClick={() => void onUpdate(item, { action: "submit_review" })}
            type="button"
          >
            <Check aria-hidden="true" size={14} /> Submit for review
          </button>
        ) : null}
        {canEditProof ? (
          <button
            disabled={busy}
            onClick={() => void onUpdate(item, { action: "reissue_code" })}
            type="button"
          >
            <RefreshCw aria-hidden="true" size={14} /> New code
          </button>
        ) : null}
        {["draft", "proof_ready", "pending_review", "verified"].includes(
          item.status,
        ) ? (
          <button
            className={styles.quietDanger}
            disabled={busy}
            onClick={() => void onUpdate(item, { action: "cancel" })}
            type="button"
          >
            <X aria-hidden="true" size={14} /> Cancel
          </button>
        ) : null}
      </div>
    </article>
  );
}

async function mutate(url: string, init: RequestInit) {
  const response = await fetch(url, {
    ...init,
    cache: "no-store",
    headers: { "Content-Type": "application/json", ...init.headers },
  });
  const payload = (await response.json().catch(() => null)) as
    | MemberResponse
    | null;
  if (!response.ok || !payload?.ok) {
    throw new Error(payload?.message || "The request could not be completed.");
  }
  return payload;
}

async function readResponse(response: Response) {
  const payload = (await response.json().catch(() => null)) as
    | MemberResponse
    | null;
  if (!response.ok || !payload?.ok) {
    throw new Error(payload?.message || "Requests could not be loaded.");
  }
  return payload;
}

function statusLabel(status: SocialVerificationRequest["status"]) {
  const labels = {
    cancelled: "Cancelled",
    draft: "Draft",
    expired: "Expired",
    pending_review: "Pending review",
    proof_ready: "Proof ready",
    rejected: "Rejected",
    verified: "Verified",
  };
  return labels[status];
}

function profilePlaceholder(platform: SocialVerificationPlatform) {
  if (platform === "x") return "https://x.com/handle";
  if (platform === "youtube") return "https://www.youtube.com/@handle";
  return "https://www.instagram.com/handle";
}

function readErrorMessage(error: unknown) {
  return error instanceof Error
    ? error.message
    : "The request could not be completed.";
}
