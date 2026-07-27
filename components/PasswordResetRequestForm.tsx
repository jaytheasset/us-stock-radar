"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import styles from "@/components/AuthForm.module.css";

export function PasswordResetRequestForm() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | "success" | "error">("idle");
  const [message, setMessage] = useState("");

  useEffect(() => {
    const value = new URLSearchParams(window.location.search).get("email");
    if (value) setEmail(value);
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("saving");
    setMessage("");

    try {
      const response = await fetch("/api/auth/password/reset-request", {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email }),
      });
      const payload = (await response.json()) as { message?: string };
      setStatus("success");
      setMessage(
        payload.message ||
          "If an account exists for that email, a password reset link will arrive shortly.",
      );
    } catch {
      setStatus("error");
      setMessage("Could not submit the request. Please try again.");
    }
  }

  return (
    <main className={styles.authUtilityPage}>
      <section className={styles.authUtilityPanel}>
        <Link className={`brand-lockup ${styles.brand}`} href="/feed">
          <span className="brand-mark">SR</span>
          <span>STOCK RADAR</span>
        </Link>
        <span className={styles.eyebrow}>Account recovery</span>
        <h1>Reset your password</h1>
        <p>Enter your account email and we will send a secure reset link.</p>
        <form className={styles.form} onSubmit={handleSubmit}>
          <label>
            Email address
            <input
              autoComplete="email"
              inputMode="email"
              required
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>
          {message ? (
            <p className={`${styles.message} ${styles[status] || ""}`}>{message}</p>
          ) : null}
          <button className={styles.primaryButton} disabled={status === "saving"} type="submit">
            {status === "saving" ? "Sending..." : "Send reset link"}
          </button>
        </form>
        <p className={styles.switch}>
          Remember your password? <Link href="/login">Log in</Link>
        </p>
      </section>
    </main>
  );
}
