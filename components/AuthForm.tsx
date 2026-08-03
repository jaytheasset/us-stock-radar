"use client";

import { Eye, EyeOff } from "lucide-react";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { AuthShell } from "@/components/AuthShell";
import styles from "@/components/AuthForm.module.css";
import { sanitizeAuthRedirect } from "@/lib/auth/authPolicy";

type AuthMode = "login" | "signup";

type AuthFormProps = {
  mode: AuthMode;
  next?: unknown;
};

export function AuthForm({ mode, next }: AuthFormProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [status, setStatus] = useState<
    "idle" | "saving" | "error" | "success"
  >("idle");
  const [oauthStatus, setOauthStatus] = useState<"idle" | "saving">("idle");
  const [message, setMessage] = useState("");
  const [resendStatus, setResendStatus] = useState<
    "idle" | "saving" | "sent"
  >("idle");
  const [confirmationPending, setConfirmationPending] = useState(false);

  const nextPath = sanitizeAuthRedirect(next, "/alerts");

  const isSignup = mode === "signup";
  const loginHref = `/login?next=${encodeURIComponent(nextPath)}`;
  const signupHref = `/signup?next=${encodeURIComponent(nextPath)}`;
  const isBusy = status === "saving" || oauthStatus === "saving";

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("saving");
    setMessage("");
    setConfirmationPending(false);

    if (isSignup && password !== confirmPassword) {
      setStatus("error");
      setMessage("Passwords do not match.");
      return;
    }

    try {
      const response = await fetch(`/api/auth/${mode}`, {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email, password }),
      });
      const payload = (await response.json()) as {
        emailConfirmationRequired?: boolean;
        error?: string;
        message?: string;
        ok?: boolean;
      };

      if (!response.ok || !payload.ok) {
        if (payload.error === "EMAIL_NOT_CONFIRMED") {
          setConfirmationPending(true);
        }
        throw new Error(payload.message || "Authentication failed.");
      }

      if (isSignup && payload.emailConfirmationRequired) {
        setConfirmationPending(true);
        setStatus("success");
        setMessage(
          "Check your email to confirm your account, then log in to continue.",
        );
        return;
      }

      window.location.assign(nextPath);
    } catch (error) {
      setStatus("error");
      setMessage(
        error instanceof Error ? error.message : "Authentication failed.",
      );
    }
  }

  async function handleGoogleAuth() {
    if (isBusy) return;
    setOauthStatus("saving");
    setStatus("idle");
    setMessage("");
    setConfirmationPending(false);

    try {
      const response = await fetch("/api/auth/oauth/google", {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ next: nextPath }),
      });
      const payload = (await response.json()) as {
        message?: string;
        ok?: boolean;
        url?: string;
      };

      if (!response.ok || !payload.ok || !payload.url) {
        throw new Error(
          payload.message || "Google sign-in is temporarily unavailable.",
        );
      }

      window.location.assign(payload.url);
    } catch (error) {
      setOauthStatus("idle");
      setStatus("error");
      setMessage(
        error instanceof Error
          ? error.message
          : "Google sign-in is temporarily unavailable.",
      );
    }
  }

  async function handleResendConfirmation() {
    if (!email || resendStatus === "saving") return;
    setResendStatus("saving");
    try {
      await fetch("/api/auth/resend", {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email }),
      });
    } finally {
      setResendStatus("sent");
    }
  }

  return (
    <AuthShell
      description={
        isSignup
          ? "Create one account for your watchlist, alert settings, and bookmarks."
          : "Continue to your watchlist, alerts, and delivered market activity."
      }
      eyebrow={isSignup ? "Free account" : "Secure access"}
      footer={
        <>
          {isSignup ? "Already have an account? " : "New to US Stock Radar? "}
          <Link href={isSignup ? loginHref : signupHref}>
            {isSignup ? "Log in" : "Create an account"}
          </Link>
        </>
      }
      title={isSignup ? "Create your account" : "Welcome back"}
    >
      <form
        aria-busy={isBusy}
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

        <label>
          Password
          <span className={styles.passwordField}>
            <input
              autoComplete={isSignup ? "new-password" : "current-password"}
              maxLength={256}
              minLength={isSignup ? 8 : undefined}
              name="password"
              placeholder={isSignup ? "At least 8 characters" : "Your password"}
              required
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
            <button
              aria-label={showPassword ? "Hide password" : "Show password"}
              className={styles.passwordToggle}
              type="button"
              onClick={() => setShowPassword((value) => !value)}
            >
              {showPassword ? (
                <EyeOff aria-hidden="true" size={17} />
              ) : (
                <Eye aria-hidden="true" size={17} />
              )}
            </button>
          </span>
        </label>

        {isSignup ? (
          <label>
            Confirm password
            <span className={styles.passwordField}>
              <input
                autoComplete="new-password"
                maxLength={256}
                minLength={8}
                name="confirmPassword"
                placeholder="Enter the same password"
                required
                type={showConfirmPassword ? "text" : "password"}
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
              />
              <button
                aria-label={
                  showConfirmPassword
                    ? "Hide password confirmation"
                    : "Show password confirmation"
                }
                className={styles.passwordToggle}
                type="button"
                onClick={() => setShowConfirmPassword((value) => !value)}
              >
                {showConfirmPassword ? (
                  <EyeOff aria-hidden="true" size={17} />
                ) : (
                  <Eye aria-hidden="true" size={17} />
                )}
              </button>
            </span>
          </label>
        ) : null}

        {message ? (
          <p
            className={`${styles.message} ${styles[status] || ""}`}
            role={status === "error" ? "alert" : "status"}
          >
            {message}
          </p>
        ) : null}

        {confirmationPending ? (
          <div className={styles.confirmationActions}>
            <button
              className={styles.textButton}
              disabled={
                resendStatus === "saving" || resendStatus === "sent"
              }
              type="button"
              onClick={handleResendConfirmation}
            >
              {resendStatus === "saving"
                ? "Sending..."
                : resendStatus === "sent"
                  ? "Confirmation sent"
                  : "Resend confirmation email"}
            </button>
            {isSignup ? (
              <Link className={styles.inlineAction} href={loginHref}>
                Go to login
              </Link>
            ) : null}
          </div>
        ) : null}

        <button
          className={styles.primaryButton}
          disabled={isBusy}
          type="submit"
        >
          {status === "saving"
            ? "Please wait..."
            : isSignup
              ? "Create free account"
              : "Log in"}
        </button>

        {!isSignup ? (
          <Link className={styles.forgotPasswordLink} href="/forgot-password">
            Forgot your password?
          </Link>
        ) : null}
      </form>

      <div className={styles.divider}>
        <span>or</span>
      </div>

      <button
        className={styles.googleButton}
        disabled={isBusy}
        type="button"
        onClick={handleGoogleAuth}
      >
        <GoogleMark />
        {oauthStatus === "saving" ? "Opening Google..." : "Continue with Google"}
      </button>

      {isSignup ? (
        <div className={styles.signupNotes}>
          <p>Free plan included. No payment required.</p>
          <p>
            By creating an account, you agree to our{" "}
            <Link href="/terms">Terms</Link> and{" "}
            <Link href="/privacy">Privacy Policy</Link>.
          </p>
        </div>
      ) : null}
    </AuthShell>
  );
}

function GoogleMark() {
  return (
    <svg
      aria-hidden="true"
      className={styles.googleMark}
      viewBox="0 0 18 18"
    >
      <path
        d="M17.64 9.205c0-.638-.057-1.252-.164-1.841H9v3.482h4.844a4.14 4.14 0 0 1-1.797 2.716v2.258h2.909c1.702-1.567 2.684-3.874 2.684-6.615Z"
        fill="#4285F4"
      />
      <path
        d="M9 18c2.43 0 4.468-.806 5.956-2.18l-2.91-2.258c-.805.54-1.835.859-3.046.859-2.344 0-4.328-1.585-5.037-3.714H.956v2.332A9 9 0 0 0 9 18Z"
        fill="#34A853"
      />
      <path
        d="M3.963 10.707A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.281-1.707V4.961H.956A9 9 0 0 0 0 9c0 1.452.347 2.827.956 4.039l3.007-2.332Z"
        fill="#FBBC05"
      />
      <path
        d="M9 3.58c1.321 0 2.507.454 3.441 1.346l2.581-2.581C13.464.892 11.426 0 9 0A9 9 0 0 0 .956 4.961l3.007 2.332C4.672 5.165 6.656 3.58 9 3.58Z"
        fill="#EA4335"
      />
    </svg>
  );
}
