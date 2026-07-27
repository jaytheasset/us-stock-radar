"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { AuthShell } from "@/components/AuthShell";
import styles from "@/components/AuthForm.module.css";

export function AuthCallbackClient() {
  const started = useRef(false);
  const [status, setStatus] = useState<"loading" | "error">("loading");

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    async function completeCallback() {
      const url = new URL(window.location.href);
      const fragment = new URLSearchParams(url.hash.replace(/^#/, ""));
      const accessToken = fragment.get("access_token") || "";
      const refreshToken = fragment.get("refresh_token") || "";
      const code = url.searchParams.get("code") || "";
      const providerError =
        url.searchParams.get("error") ||
        url.searchParams.get("error_code") ||
        "";
      const type =
        fragment.get("type") || url.searchParams.get("type") || "";
      const next = url.searchParams.get("next") || "";
      const cleanUrl = new URL(url.pathname, url.origin);
      if (next) cleanUrl.searchParams.set("next", next);
      if (type) cleanUrl.searchParams.set("type", type);

      window.history.replaceState(
        null,
        "",
        `${cleanUrl.pathname}${cleanUrl.search}`,
      );

      if (providerError) {
        setStatus("error");
        return;
      }

      try {
        const request = code
          ? {
              endpoint: "/api/auth/oauth/callback",
              body: { code, next },
            }
          : {
              endpoint: "/api/auth/session",
              body: {
                accessToken,
                refreshToken,
                type,
                next,
              },
            };

        if (
          !code &&
          (!accessToken ||
            !refreshToken ||
            (type !== "signup" && type !== "recovery"))
        ) {
          setStatus("error");
          return;
        }

        const response = await fetch(request.endpoint, {
          method: "POST",
          cache: "no-store",
          credentials: "same-origin",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(request.body),
        });
        const payload = (await response.json()) as {
          ok?: boolean;
          next?: string;
        };

        if (!response.ok || !payload.ok || !payload.next) {
          setStatus("error");
          return;
        }

        window.location.replace(payload.next);
      } catch {
        setStatus("error");
      }
    }

    void completeCallback();
  }, []);

  if (status === "loading") {
    return (
      <AuthShell
        description="We are verifying the callback and securing your session."
        eyebrow="Secure sign-in"
        title="Finishing your account setup"
      >
        <div aria-live="polite" className={styles.callbackStatus}>
          <span className={styles.callbackProgress} />
          <span>Verifying your session...</span>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      description="The request may have expired, been used already, or been cancelled."
      eyebrow="Sign-in unavailable"
      footer={
        <>
          Need another option? <Link href="/signup">Create an account</Link>
        </>
      }
      title="We could not complete sign-in"
    >
      <div className={`${styles.message} ${styles.error}`} role="alert">
        Request a new confirmation or password reset email, or try Google
        sign-in again.
      </div>
      <div className={styles.utilityActions}>
        <Link className={styles.secondaryButtonLink} href="/login">
          Back to login
        </Link>
        <Link className={styles.primaryButtonLink} href="/forgot-password">
          Reset password
        </Link>
      </div>
    </AuthShell>
  );
}
