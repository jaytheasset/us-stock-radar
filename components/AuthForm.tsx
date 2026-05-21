"use client";

import Link from "next/link";
import { useMemo, useState, type FormEvent } from "react";
import styles from "@/components/AuthForm.module.css";

type AuthMode = "login" | "signup";

type AuthFormProps = {
  mode: AuthMode;
};

export function AuthForm({ mode }: AuthFormProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | "error" | "success">("idle");
  const [message, setMessage] = useState("");

  const nextPath = useMemo(() => {
    if (typeof window === "undefined") return "/alerts";
    const value = new URLSearchParams(window.location.search).get("next") || "/alerts";
    return value.startsWith("/") ? value : "/alerts";
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("saving");
    setMessage("");

    try {
      const response = await fetch(`/api/auth/${mode}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email, password }),
      });
      const payload = await response.json();

      if (!response.ok || !payload.ok) {
        throw new Error(payload.message || "Authentication failed.");
      }

      if (mode === "signup" && payload.emailConfirmationRequired) {
        setStatus("success");
        setMessage("Account created. Check your email to confirm the account before logging in.");
        return;
      }

      window.location.assign(nextPath);
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "Authentication failed.");
    }
  }

  const isSignup = mode === "signup";

  return (
    <main className={styles.page}>
      <section className={styles.shell}>
        <Link className={`brand-lockup ${styles.brand}`} href="/feed" aria-label="US Stock Radar feed">
          <span className="brand-mark">SR</span>
          <span>STOCK RADAR</span>
        </Link>

        <div className={styles.panel}>
          <div>
            <span className={styles.eyebrow}>{isSignup ? "Create account" : "Welcome back"}</span>
            <h1>{isSignup ? "Start tracking market alerts." : "Log in to Stock Radar."}</h1>
            <p>
              {isSignup
                ? "Create an account to manage watchlist alerts and Market Discovery delivery settings."
                : "Access your watchlist, alert settings, and delivered alert history."}
            </p>
          </div>

          <form className={styles.form} onSubmit={handleSubmit}>
            <label>
              Email
              <input
                autoComplete="email"
                inputMode="email"
                name="email"
                placeholder="you@example.com"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </label>
            <label>
              Password
              <input
                autoComplete={isSignup ? "new-password" : "current-password"}
                name="password"
                placeholder={isSignup ? "At least 8 characters" : "Password"}
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>

            {message ? <p className={`${styles.message} ${styles[status] || ""}`}>{message}</p> : null}

            <button disabled={status === "saving"} type="submit">
              {status === "saving" ? "Please wait..." : isSignup ? "Create Account" : "Log In"}
            </button>
          </form>

          <p className={styles.switch}>
            {isSignup ? "Already have an account?" : "Need an account?"}{" "}
            <Link href={isSignup ? `/login?next=${encodeURIComponent(nextPath)}` : `/signup?next=${encodeURIComponent(nextPath)}`}>
              {isSignup ? "Log in" : "Create one"}
            </Link>
          </p>
        </div>
      </section>
    </main>
  );
}
