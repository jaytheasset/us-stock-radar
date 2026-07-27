"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
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
      const type = fragment.get("type") || url.searchParams.get("type") || "";
      const next = url.searchParams.get("next") || "";

      window.history.replaceState(
        null,
        "",
        `${url.pathname}${url.search}`,
      );

      if (!accessToken || !refreshToken || (type !== "signup" && type !== "recovery")) {
        setStatus("error");
        return;
      }

      try {
        const response = await fetch("/api/auth/session", {
          method: "POST",
          cache: "no-store",
          credentials: "same-origin",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            accessToken,
            refreshToken,
            type,
            next,
          }),
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

  return (
    <main className={styles.authUtilityPage}>
      <section className={styles.authUtilityPanel}>
        <Link className={`brand-lockup ${styles.brand}`} href="/feed">
          <span className="brand-mark">SR</span>
          <span>STOCK RADAR</span>
        </Link>
        {status === "loading" ? (
          <>
            <span className={styles.eyebrow}>Secure sign-in</span>
            <h1>Finishing your account setup</h1>
            <p>We are verifying the link and securing your session.</p>
            <span className={styles.callbackProgress} aria-label="Verifying" />
          </>
        ) : (
          <>
            <span className={styles.eyebrow}>Link unavailable</span>
            <h1>This link is invalid or has expired.</h1>
            <p>Request a new confirmation or password reset email to continue.</p>
            <div className={styles.utilityActions}>
              <Link className={styles.secondaryButtonLink} href="/login">
                Back to login
              </Link>
              <Link className={styles.primaryButtonLink} href="/forgot-password">
                Reset password
              </Link>
            </div>
          </>
        )}
      </section>
    </main>
  );
}
