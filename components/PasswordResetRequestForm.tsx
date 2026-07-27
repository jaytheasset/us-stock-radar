"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { AuthShell } from "@/components/AuthShell";
import styles from "@/components/AuthForm.module.css";

export function PasswordResetRequestForm() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<
    "idle" | "saving" | "success" | "error"
  >("idle");
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
    <AuthShell
      description="Enter your account email and we will send a secure reset link."
      eyebrow="Account recovery"
      footer={
        <>
          Remember your password? <Link href="/login">Log in</Link>
        </>
      }
      title="Reset your password"
    >
      <form
        aria-busy={status === "saving"}
        className={styles.form}
        onSubmit={handleSubmit}
      >
        <label>
          Email address
          <input
            autoComplete="email"
            inputMode="email"
            maxLength={320}
            name="email"
            placeholder="you@example.com"
            required
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>
        {message ? (
          <p
            className={`${styles.message} ${styles[status] || ""}`}
            role={status === "error" ? "alert" : "status"}
          >
            {message}
          </p>
        ) : null}
        <button
          className={styles.primaryButton}
          disabled={status === "saving"}
          type="submit"
        >
          {status === "saving" ? "Sending..." : "Send reset link"}
        </button>
      </form>
    </AuthShell>
  );
}
