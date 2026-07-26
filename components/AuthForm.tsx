"use client";

import { Bell, Eye, EyeOff, FolderKanban, SearchCheck, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useMemo, useState, type FormEvent } from "react";
import { AuthStatus } from "@/components/AuthStatus";
import styles from "@/components/AuthForm.module.css";

type AuthMode = "login" | "signup";

type AuthFormProps = {
  mode: AuthMode;
};

export function AuthForm({ mode }: AuthFormProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
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

    if (mode === "signup" && password !== confirmPassword) {
      setStatus("error");
      setMessage("Passwords do not match.");
      return;
    }

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
        setMessage("Check your email to confirm your account, then log in to continue.");
        return;
      }

      window.location.assign(nextPath);
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "Authentication failed.");
    }
  }

  const isSignup = mode === "signup";

  const loginHref = `/login?next=${encodeURIComponent(nextPath)}`;
  const signupHref = `/signup?next=${encodeURIComponent(nextPath)}`;

  const form = (
    <form className={styles.form} onSubmit={handleSubmit}>
      <label>
        Email address
        <input
          autoComplete="email"
          inputMode="email"
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
            minLength={isSignup ? 8 : undefined}
            name="password"
            placeholder={isSignup ? "At least 8 characters" : "Password"}
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
            {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
          </button>
        </span>
      </label>

      {isSignup ? (
        <label>
          Confirm password
          <span className={styles.passwordField}>
            <input
              autoComplete="new-password"
              minLength={8}
              name="confirmPassword"
              placeholder="Confirm your password"
              required
              type={showConfirmPassword ? "text" : "password"}
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
            />
            <button
              aria-label={showConfirmPassword ? "Hide password confirmation" : "Show password confirmation"}
              className={styles.passwordToggle}
              type="button"
              onClick={() => setShowConfirmPassword((value) => !value)}
            >
              {showConfirmPassword ? <EyeOff size={17} /> : <Eye size={17} />}
            </button>
          </span>
        </label>
      ) : null}

      {message ? <p className={`${styles.message} ${styles[status] || ""}`}>{message}</p> : null}
      {isSignup && status === "success" ? (
        <Link className={styles.inlineAction} href={loginHref}>
          Go to login
        </Link>
      ) : null}

      <button className={styles.primaryButton} disabled={status === "saving"} type="submit">
        {status === "saving" ? "Please wait..." : isSignup ? "Create Free Account" : "Log In"}
      </button>

      {isSignup ? (
        <div className={styles.signupAfterSubmit}>
          <p className={styles.noPaymentNote}>Free plan included. No payment required.</p>
          <p className={styles.legalNote}>
            By creating an account, you agree to our <Link href="/terms">Terms</Link> and{" "}
            <Link href="/privacy">Privacy Policy</Link>.
          </p>
          <p className={styles.browseNote}>
            Not ready yet? <Link href="/feed">Continue browsing</Link>
          </p>
        </div>
      ) : null}
    </form>
  );

  if (isSignup) {
    return (
      <main className={styles.signupPage}>
        <header className={styles.signupHeader}>
          <Link className={`brand-lockup ${styles.headerBrand}`} href="/feed" aria-label="US Stock Radar feed">
            <span className="brand-mark">SR</span>
            <span>US Stock Radar</span>
          </Link>
          <nav className={styles.headerNav} aria-label="Primary navigation">
            <Link href="/feed">Feed</Link>
            <Link href="/news">News</Link>
            <Link href="/filings">Filings</Link>
            <Link href="/calendar">Calendar</Link>
            <Link href="/premium">Premium</Link>
          </nav>
          <div className={styles.headerAccount}>
            <AuthStatus loginHref={loginHref} showCreateAccount={false} />
          </div>
        </header>

        <section className={styles.signupShell}>
          <div className={styles.signupPanel}>
            <div className={styles.valueColumn}>
              <span className={styles.eyebrow}>Free plan included</span>
              <h1>Create your free account</h1>
              <p className={styles.lede}>Save your watchlist, alert settings, and Market Discovery categories.</p>

              <div className={styles.benefitList} aria-label="Account benefits">
                <div className={styles.benefitItem}>
                  <span className={styles.benefitIcon}>
                    <FolderKanban size={20} />
                  </span>
                  <div>
                    <strong>Save your watchlist</strong>
                    <p>Keep saved tickers available across devices and sessions.</p>
                  </div>
                </div>
                <div className={styles.benefitItem}>
                  <span className={styles.benefitIcon}>
                    <Bell size={20} />
                  </span>
                  <div>
                    <strong>Save alert settings</strong>
                    <p>Persist watchlist alerts, filing alerts, and delivery preferences.</p>
                  </div>
                </div>
                <div className={styles.benefitItem}>
                  <span className={styles.benefitIcon}>
                    <SearchCheck size={20} />
                  </span>
                  <div>
                    <strong>Track Market Discovery categories</strong>
                    <p>Choose event categories outside your watchlist and keep them saved.</p>
                  </div>
                </div>
                <div className={styles.benefitItem}>
                  <span className={styles.benefitIcon}>
                    <ShieldCheck size={20} />
                  </span>
                  <div>
                    <strong>Upgrade anytime for real-time delivery</strong>
                    <p>Advanced includes a 14-day card-backed trial when checkout becomes available.</p>
                  </div>
                </div>
              </div>

              <div className={styles.freeNote}>Free plan included. No payment required.</div>
            </div>

            <aside className={styles.formColumn} aria-label="Signup form">
              <div className={styles.formHeader}>
                <h2>Sign up</h2>
                <p>Create an account to save your personal settings.</p>
              </div>
              {form}
              <p className={styles.switch}>
                Already have an account? <Link href={loginHref}>Log in</Link>
              </p>
            </aside>
          </div>
        </section>
      </main>
    );
  }

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

          {form}

          <p className={styles.switch}>
            {isSignup ? "Already have an account?" : "Need an account?"}{" "}
            <Link href={isSignup ? loginHref : signupHref}>
              {isSignup ? "Log in" : "Create one"}
            </Link>
          </p>
        </div>
      </section>
    </main>
  );
}
