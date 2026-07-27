"use client";

import { Eye, EyeOff } from "lucide-react";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { AuthShell } from "@/components/AuthShell";
import styles from "@/components/AuthForm.module.css";

export function UpdatePasswordForm() {
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [status, setStatus] = useState<
    "idle" | "saving" | "success" | "error"
  >("idle");
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
    <AuthShell
      description="Use at least 8 characters and avoid passwords used on other sites."
      eyebrow="Account security"
      footer={
        status === "success" ? (
          <Link href="/account">Return to your account</Link>
        ) : (
          <Link href="/login">Back to login</Link>
        )
      }
      title="Choose a new password"
    >
      <form
        aria-busy={status === "saving"}
        className={styles.form}
        onSubmit={handleSubmit}
      >
        <PasswordField
          label="New password"
          name="password"
          value={password}
          visible={showPassword}
          onChange={setPassword}
          onToggle={() => setShowPassword((current) => !current)}
        />
        <PasswordField
          label="Confirm new password"
          name="passwordConfirmation"
          value={confirmation}
          visible={showConfirmation}
          onChange={setConfirmation}
          onToggle={() => setShowConfirmation((current) => !current)}
        />
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
          {status === "saving" ? "Updating..." : "Update password"}
        </button>
      </form>
    </AuthShell>
  );
}

function PasswordField({
  label,
  name,
  value,
  visible,
  onChange,
  onToggle,
}: {
  label: string;
  name: string;
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
          maxLength={256}
          minLength={8}
          name={name}
          placeholder="At least 8 characters"
          required
          type={visible ? "text" : "password"}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
        <button
          aria-label={visible ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}
          className={styles.passwordToggle}
          type="button"
          onClick={onToggle}
        >
          {visible ? (
            <EyeOff aria-hidden="true" size={17} />
          ) : (
            <Eye aria-hidden="true" size={17} />
          )}
        </button>
      </span>
    </label>
  );
}
