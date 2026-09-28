"use client";

import { useState } from "react";
import type { ListingMonitorAlertItem } from "@/lib/monitor/listingMonitorApi";
import type { ListingMonitor } from "@/lib/monitor/listingMonitorPersistence";
import {
  buildForm4PurchaseAlertCopy,
  type Form4InsiderPurchaseSettings,
  type Form4InsiderRole,
} from "@/lib/monitor/form4InsiderPurchaseMonitor";
import styles from "./Form4InsiderPurchaseMonitor.module.css";

type Draft = Readonly<{
  targetScope: "watchlist" | "ticker";
  ticker: string;
  role: Form4InsiderRole;
  minimumShares: string;
}>;

const EMPTY_DRAFT: Draft = Object.freeze({
  targetScope: "watchlist",
  ticker: "",
  role: "officer_or_director",
  minimumShares: "",
});

export function Form4InsiderPurchaseBuilder({
  authRequired,
}: Readonly<{ authRequired: boolean }>) {
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [created, setCreated] = useState<ListingMonitor | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    const settings = settingsFromDraft(draft);
    if (!settings) {
      setMessage("Choose a valid ticker and whole-share minimum.");
      return;
    }
    setSaving(true);
    setMessage("");
    try {
      const response = await fetch("/api/monitors/listing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ form4Purchase: settings }),
      });
      const payload = await response.json().catch(() => null) as { data?: { monitor?: ListingMonitor }; message?: string } | null;
      if (!response.ok || !payload?.data?.monitor) {
        throw new Error(payload?.message || "Could not create this monitor.");
      }
      setCreated(payload.data.monitor);
      setMessage("Form 4 purchase alert created.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not create this monitor.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className={styles.panel} aria-labelledby="form4-purchase-monitor-title">
      <header>
        <div>
          <span>Form 4</span>
          <h2 id="form4-purchase-monitor-title">Form 4 purchase alert</h2>
        </div>
        <strong>Internal alert</strong>
      </header>
      <p>
        Watch confirmed P-code, non-derivative common-stock purchases. Gifts, option exercises,
        conversions, sales, and uncertain owner relationships do not trigger an alert.
      </p>
      <form onSubmit={submit}>
        <Form4PurchaseFields draft={draft} disabled={saving || authRequired} onChange={setDraft} />
        <button disabled={saving || authRequired} type="submit">
          {saving ? "Creating…" : "Create purchase alert"}
        </button>
      </form>
      {authRequired ? <p role="status">Sign in to create this alert.</p> : null}
      {message ? <p role="status">{message}</p> : null}
      {created?.form4PurchaseSettings ? (
        <div className={styles.saved}>
          <strong>Active</strong>
          <span>{formatSettings(created.form4PurchaseSettings)}</span>
        </div>
      ) : null}
    </section>
  );
}

export function Form4PurchaseMonitorSummary({
  monitor,
  editing,
  busy,
  onCancel,
  onEdit,
  onSaved,
}: Readonly<{
  monitor: ListingMonitor;
  editing: boolean;
  busy: boolean;
  onCancel: () => void;
  onEdit: () => void;
  onSaved: (monitor: ListingMonitor) => void;
}>) {
  const settings = monitor.form4PurchaseSettings;
  const [draft, setDraft] = useState<Draft>(() => settings ? draftFromSettings(settings) : EMPTY_DRAFT);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  if (!settings) return null;

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next = settingsFromDraft(draft);
    if (!next) {
      setMessage("Choose a valid ticker and whole-share minimum.");
      return;
    }
    if (saving) return;
    setSaving(true);
    setMessage("");
    try {
      const response = await fetch(`/api/monitors/listing/${encodeURIComponent(monitor.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ form4Purchase: next }),
      });
      const payload = await response.json().catch(() => null) as { data?: { monitor?: ListingMonitor }; message?: string } | null;
      if (!response.ok || !payload?.data?.monitor) {
        setMessage(payload?.message || "Could not update this alert.");
        return;
      }
      onSaved(payload.data.monitor);
    } catch {
      setMessage("Could not update this alert.");
    } finally {
      setSaving(false);
    }
  }

  const disabled = busy || saving;

  return editing ? (
    <form className={styles.inlineEditor} onSubmit={(event) => void save(event)}>
      <Form4PurchaseFields draft={draft} disabled={disabled} onChange={setDraft} />
      <div>
        <button disabled={disabled} type="submit">{saving ? "Saving…" : "Save changes"}</button>
        <button
          disabled={disabled}
          onClick={() => {
            setDraft(draftFromSettings(settings));
            setMessage("");
            onCancel();
          }}
          type="button"
        >
          Cancel
        </button>
      </div>
      {message ? <p role="status">{message}</p> : null}
    </form>
  ) : (
    <div className={styles.summary}>
      <span>{formatSettings(settings)}</span>
      <button disabled={disabled} onClick={onEdit} type="button">Edit</button>
    </div>
  );
}

export function Form4PurchaseAlertDetails({
  alert,
  settings,
}: Readonly<{
  alert: ListingMonitorAlertItem;
  settings?: Form4InsiderPurchaseSettings | null;
}>) {
  const evidence = alert.matchEvidence;
  if (!evidence) return null;
  const copy = buildForm4PurchaseAlertCopy(evidence, settings);
  return (
    <article className={styles.alertDetails}>
      <header>
        <div>
          <strong>{copy.title}</strong>
          <span>Filed {formatTimestamp(evidence.filedAt)}</span>
        </div>
        <a href={evidence.sourceUrl} rel="noreferrer" target="_blank">SEC original</a>
      </header>
      <p>{copy.summary}</p>
      <div className={styles.matchRows}>
        {evidence.matches.map((match) => (
          <section key={`${match.transactionIndex}-${match.ownerName}`}>
            <div>
              <strong>{match.ownerName}</strong>
              <span>{formatOwnerRole(match.ownerRoles, match.officerTitle)}</span>
            </div>
            <dl>
              <div><dt>Shares</dt><dd>{formatShares(match.shares)}</dd></div>
              <div><dt>Price per share</dt><dd>{match.pricePerShare === null ? "Not disclosed in the row" : formatPrice(match.pricePerShare)}</dd></div>
              <div><dt>Ownership</dt><dd>{match.ownershipRelation === "direct" ? "Direct" : "Indirect"}</dd></div>
              <div><dt>Transaction date</dt><dd>{formatTransactionDate(match.transactionDate)}</dd></div>
            </dl>
            <details>
              <summary>Ownership source details</summary>
              {match.relationEvidence.map((item) => (
                <p key={`${item.kind}-${item.ref}`}><strong>{item.ref}</strong> {item.text}</p>
              ))}
            </details>
          </section>
        ))}
      </div>
    </article>
  );
}

function Form4PurchaseFields({
  draft,
  disabled,
  onChange,
}: Readonly<{
  draft: Draft;
  disabled: boolean;
  onChange: (draft: Draft) => void;
}>) {
  return (
    <div className={styles.fields}>
      <label>
        Target
        <select
          disabled={disabled}
          value={draft.targetScope}
          onChange={(event) => onChange({ ...draft, targetScope: event.target.value as Draft["targetScope"] })}
        >
          <option value="watchlist">My watchlist</option>
          <option value="ticker">Choose a ticker</option>
        </select>
      </label>
      {draft.targetScope === "ticker" ? (
        <label>
          Ticker
          <input
            aria-label="Form 4 purchase ticker"
            disabled={disabled}
            maxLength={15}
            placeholder="AAPL"
            value={draft.ticker}
            onChange={(event) => onChange({ ...draft, ticker: event.target.value.toUpperCase() })}
          />
        </label>
      ) : null}
      <label>
        Reporting-owner role
        <select
          disabled={disabled}
          value={draft.role}
          onChange={(event) => onChange({ ...draft, role: event.target.value as Form4InsiderRole })}
        >
          <option value="officer_or_director">Officer or director</option>
          <option value="officer">Officer</option>
          <option value="director">Director</option>
        </select>
      </label>
      <label>
        Minimum shares <span>Optional</span>
        <input
          disabled={disabled}
          inputMode="numeric"
          min="1"
          placeholder="No minimum"
          step="1"
          type="number"
          value={draft.minimumShares}
          onChange={(event) => onChange({ ...draft, minimumShares: event.target.value })}
        />
      </label>
    </div>
  );
}

function settingsFromDraft(draft: Draft): Form4InsiderPurchaseSettings | null {
  const ticker = draft.ticker.trim().toUpperCase();
  if (draft.targetScope === "ticker" && !/^[A-Z0-9][A-Z0-9.-]{0,14}$/.test(ticker)) return null;
  const minimumShares = draft.minimumShares.trim() ? Number(draft.minimumShares) : null;
  if (minimumShares !== null && (!Number.isSafeInteger(minimumShares) || minimumShares <= 0)) return null;
  return {
    target: draft.targetScope === "watchlist" ? { scope: "watchlist" } : { scope: "ticker", ticker },
    role: draft.role,
    minimumShares,
  };
}

function draftFromSettings(settings: Form4InsiderPurchaseSettings): Draft {
  return {
    targetScope: settings.target.scope,
    ticker: settings.target.scope === "ticker" ? settings.target.ticker : "",
    role: settings.role,
    minimumShares: settings.minimumShares === null ? "" : String(settings.minimumShares),
  };
}

function formatSettings(settings: Form4InsiderPurchaseSettings) {
  const target = settings.target.scope === "watchlist" ? "My watchlist" : settings.target.ticker;
  const role = settings.role === "officer_or_director"
    ? "officer or director"
    : settings.role;
  const minimum = settings.minimumShares === null ? "no share minimum" : `at least ${settings.minimumShares} shares`;
  return `${target} · ${role} · ${minimum}`;
}

function formatOwnerRole(roles: readonly string[], officerTitle: string | null) {
  const labels = roles.flatMap((role) => role === "officer" ? ["Officer"] : role === "director" ? ["Director"] : []);
  const role = labels.length > 0 ? Array.from(new Set(labels)).join(" · ") : "Reporting owner";
  return officerTitle ? `${role} · ${officerTitle}` : role;
}

function formatTimestamp(value: string) {
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime())
    ? new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(parsed)
    : value;
}

function formatShares(value: number) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 8 }).format(value);
}

function formatPrice(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 8,
  }).format(value);
}

function formatTransactionDate(value: string) {
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime())
    ? new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "UTC" }).format(parsed)
    : value;
}
