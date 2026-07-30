"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ADMIN_ROLES, type AdminRole } from "@/lib/admin/policy";
import styles from "./AdminSection.module.css";

export function RoleAssignmentForm({
  active,
  initialRole,
  locked = false,
  targetUserId,
  userLabel,
}: {
  active: boolean;
  initialRole: AdminRole;
  locked?: boolean;
  targetUserId: string;
  userLabel: string;
}) {
  const router = useRouter();
  const [role, setRole] = useState<AdminRole>(initialRole);
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const submitter = (event.nativeEvent as SubmitEvent)
      .submitter as HTMLButtonElement | null;
    const nextActive = submitter?.value === "grant";
    setPending(true);
    setError("");
    try {
      const response = await fetch("/api/admin/roles", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetUserId,
          role,
          active: nextActive,
          reason,
        }),
      });
      const payload = (await response.json()) as {
        error?: { message?: string };
      };
      if (!response.ok) {
        throw new Error(payload.error?.message || "Role update failed.");
      }
      setReason("");
      router.refresh();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Role update failed.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <form className={styles.stack} onSubmit={submit}>
      <strong>{userLabel}</strong>
      <span className={styles.mono}>{targetUserId}</span>
      <div className={styles.field}>
        <label htmlFor={`role-${targetUserId}-${initialRole}`}>Role</label>
        <select
          className={styles.select}
          disabled={active || locked}
          id={`role-${targetUserId}-${initialRole}`}
          onChange={(event) => setRole(event.target.value as AdminRole)}
          value={role}
        >
          {ADMIN_ROLES.map((item) => (
            <option key={item} value={item}>
              {item.replaceAll("_", " ")}
            </option>
          ))}
        </select>
      </div>
      <div className={styles.field}>
        <label htmlFor={`reason-${targetUserId}-${initialRole}`}>
          Required reason
        </label>
        <input
          className={styles.input}
          disabled={locked}
          id={`reason-${targetUserId}-${initialRole}`}
          minLength={4}
          onChange={(event) => setReason(event.target.value)}
          required
          value={reason}
        />
      </div>
      {error ? <p className={styles.error}>{error}</p> : null}
      {locked ? (
        <p className={styles.notice}>
          Your own administrator assignments cannot be changed here.
        </p>
      ) : null}
      <div className={styles.actions}>
        {active ? (
          <button
            className={styles.buttonDanger}
            disabled={pending || locked}
            name="intent"
            type="submit"
            value="revoke"
          >
            Revoke
          </button>
        ) : (
          <button
            className={styles.button}
            disabled={pending || locked}
            name="intent"
            type="submit"
            value="grant"
          >
            Grant
          </button>
        )}
      </div>
    </form>
  );
}
