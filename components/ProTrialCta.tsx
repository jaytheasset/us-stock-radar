"use client";

import Link from "next/link";
import { useState } from "react";

type ProTrialCtaProps = {
  guestMode?: boolean;
  children?: string;
  guestLabel?: string;
  className?: string;
  reloadOnSuccess?: boolean;
};

type TrialStartResponse =
  | {
      ok: true;
      trial?: {
        active: boolean;
        daysRemaining?: number;
      };
    }
  | {
      ok: false;
      message?: string;
    };

export function ProTrialCta({
  guestMode = false,
  children = "Start 14-day Pro Trial",
  guestLabel = "Create account to start Pro trial",
  className = "",
  reloadOnSuccess = true,
}: ProTrialCtaProps) {
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  if (guestMode) {
    return (
      <Link className={className || undefined} href="/signup">
        {guestLabel}
      </Link>
    );
  }

  async function startTrial() {
    setLoading(true);
    setMessage("");

    try {
      const response = await fetch("/api/trials/pro/start", {
        method: "POST",
        cache: "no-store",
      });
      const payload = (await response.json().catch(() => null)) as TrialStartResponse | null;

      if (!response.ok || !payload?.ok) {
        throw new Error(payload && !payload.ok ? payload.message || "Could not start Pro trial." : "Could not start Pro trial.");
      }

      setMessage("Pro trial started.");
      if (reloadOnSuccess) {
        window.location.reload();
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not start Pro trial.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <span className="pro-trial-cta-wrap">
      <button className={className || undefined} disabled={loading} onClick={startTrial} type="button">
        {loading ? "Starting trial..." : children}
      </button>
      {message ? <small>{message}</small> : null}
    </span>
  );
}
