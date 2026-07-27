"use client";

import { Eye, EyeOff } from "lucide-react";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import styles from "@/components/AuthForm.module.css";

export function UpdatePasswordForm() {
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [status, setStatus] = useState<"idle" | "saving" | "success" | "error">("idle");
  const [message, setMessage] = useState("");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (password !== confirmation) {
      setStatus("error");
      setMessage("Passwords do not match.");
      return;
    }

    setStatus("saving");
    setMessage("");

    try {
      const response = await fetch("/api/auth/password/update", {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ password }),
      });
      const payload = (await response.json()) as {
        ok?: boolean;
        message?: string;
      };
      if (!response.ok || !payload.ok) {
        throw new Error(payload.message || "Could not update your password.");
      }

      setStatus("success");
      setMessage("Your password has been updated.");
      setPassword("");
      setConfirmation("");
    } catch (error) {
      setStatus("error");
      setMessage(
        error instanceof Error
          ? error.message
          : "Could not update your password.",
      );
    }
  }

  return (
    <main className={styles.authUtilityPage}>
      <section className={styles.authUtilityPanel}>
        <Link className={`brand-lockup ${styles.brand}`} href="/account">
          <span className="brand-mark">SR</span>
          <span>STOCK RADAR</span>
        </Link>
        <span className={styles.eyebrow}>Account security</span>
        <h1>Choose a new password</h1>
        <p>Use at least 8 characters and avoid passwords used on other sites.</p>
        <form className={styles.form} onSubmit={handleSubmit}>
          <PasswordField
            label="New password"
            value={password}
            visible={showPassword}
            onChange={setPassword}
            onToggle={() => setShowPassword((current) => !current)}
          />
          <PasswordField
            label="Confirm new password"
            value={confirmation}
            visible={showPassword}
            onChange={setConfirmation}
            onToggle={() => setShowPassword((current) => !current)}
          />
          {message ? (
            <p className={`${styles.message} ${styles[status] || ""}`}>{message}</p>
          ) : null}
          <button className={styles.primaryButton} disabled={status === "saving"} type="submit">
            {status === "saving" ? "Updating..." : "Update password"}
          </button>
        </form>
        {status === "success" ? (
          <Link className={styles.inlineAction} href="/account">
            Return to account
          </Link>
        ) : null}
      </section>
    </main>
  );
}

function PasswordField({
  label,
  value,
  visible,
  onChange,
  onToggle,
}: {
  label: string;
  value: string;
  visible: boolean;
  onChange: (value: string) => void;
  onToggle: () => void;
}) {
  return (
    <label>
      {label}
      <span className={styles.passwordField}>
        <input
          autoComplete="new-password"
          minLength={8}
          maxLength={256}
          required
          type={visible ? "text" : "password"}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
        <button
          aria-label={visible ? "Hide password" : "Show password"}
          className={styles.passwordToggle}
          type="button"
          onClick={onToggle}
        >
          {visible ? <EyeOff size={17} /> : <Eye size={17} />}
        </button>
      </span>
    </label>
  );
}
