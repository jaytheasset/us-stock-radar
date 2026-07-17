"use client";

import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type RefObject,
} from "react";
import { X } from "lucide-react";
import { BottomSheetShell } from "@/components/ui/BottomSheetShell";
import {
  alertsV2EventOptions,
  alertsV2ImpactOptions,
  type AlertsV2EventType,
  type AlertsV2Rule,
  type AlertsV2Signal,
} from "@/lib/mock/alertsV2Data";
import styles from "./StockRadarAlertsV2.module.css";

export type AlertsV2RuleDraft = Pick<
  AlertsV2Rule,
  "channel" | "eventType" | "minimumImpact" | "name" | "scope" | "signal" | "ticker"
>;

const defaultDraft: AlertsV2RuleDraft = {
  channel: "Web",
  eventType: "filing",
  minimumImpact: "high",
  name: "High-impact filings",
  scope: "All Market",
  signal: "neutral",
};

function ruleToDraft(rule?: AlertsV2Rule): AlertsV2RuleDraft {
  if (!rule) {
    return { ...defaultDraft };
  }

  return {
    channel: rule.channel,
    eventType: rule.eventType,
    minimumImpact: rule.minimumImpact,
    name: rule.name,
    scope: rule.scope,
    signal: rule.signal,
    ticker: rule.ticker,
  };
}

export function CreateAlertSheet({
  editingRule,
  isMobile,
  isOpen,
  onClose,
  onSubmit,
  openerRef,
}: {
  editingRule?: AlertsV2Rule;
  isMobile: boolean;
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (draft: AlertsV2RuleDraft, editingRuleId?: string) => void;
  openerRef: RefObject<HTMLElement | null>;
}) {
  const [draft, setDraft] = useState<AlertsV2RuleDraft>(defaultDraft);
  const firstFieldRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    setDraft(ruleToDraft(editingRule));

    if (!isMobile) {
      requestAnimationFrame(() => firstFieldRef.current?.focus({ preventScroll: true }));
    }
  }, [editingRule, isMobile, isOpen]);

  useEffect(() => {
    if (!isOpen || isMobile) {
      return;
    }

    const previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousBodyOverflow;
      requestAnimationFrame(() => openerRef.current?.focus({ preventScroll: true }));
    };
  }, [isMobile, isOpen, onClose, openerRef]);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onSubmit(draft, editingRule?.id);
  };

  const form = (
    <form className={styles.createForm} id="alerts-v2-create-form" onSubmit={handleSubmit}>
      <label>
        <span>Rule name</span>
        <input
          maxLength={56}
          onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
          ref={firstFieldRef}
          required
          value={draft.name}
        />
      </label>

      <div className={styles.createFieldGrid}>
        <label>
          <span>Scope</span>
          <select
            onChange={(event) => setDraft((current) => ({
              ...current,
              scope: event.target.value as AlertsV2Rule["scope"],
            }))}
            value={draft.scope}
          >
            <option>All Market</option>
            <option>Watchlist</option>
            <option>Selected Ticker</option>
          </select>
        </label>

        <label>
          <span>Event type</span>
          <select
            onChange={(event) => setDraft((current) => ({
              ...current,
              eventType: event.target.value as AlertsV2EventType,
            }))}
            value={draft.eventType}
          >
            {alertsV2EventOptions.filter((option) => option.value !== "all").map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>

        <label>
          <span>Minimum impact</span>
          <select
            onChange={(event) => setDraft((current) => ({
              ...current,
              minimumImpact: event.target.value as AlertsV2Rule["minimumImpact"],
            }))}
            value={draft.minimumImpact}
          >
            {alertsV2ImpactOptions.filter((option) => option.value !== "all").map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>

        <label>
          <span>Signal</span>
          <select
            onChange={(event) => setDraft((current) => ({
              ...current,
              signal: event.target.value as AlertsV2Signal,
            }))}
            value={draft.signal}
          >
            <option value="neutral">Neutral</option>
            <option value="bullish">Bullish</option>
            <option value="bearish">Bearish</option>
          </select>
        </label>

        <label>
          <span>Delivery preference</span>
          <select
            onChange={(event) => setDraft((current) => ({
              ...current,
              channel: event.target.value as AlertsV2Rule["channel"],
            }))}
            value={draft.channel}
          >
            <option>Web</option>
            <option>Email</option>
            <option>Telegram</option>
          </select>
        </label>

        <label>
          <span>Selected ticker</span>
          <input
            disabled={draft.scope !== "Selected Ticker"}
            maxLength={10}
            onChange={(event) => setDraft((current) => ({ ...current, ticker: event.target.value.toUpperCase() }))}
            placeholder="Ticker"
            required={draft.scope === "Selected Ticker"}
            value={draft.ticker ?? ""}
          />
        </label>
      </div>

      <p className={styles.createNotice}>
        Preview only. Creating this rule changes local component state and sends no notification.
      </p>

      <div className={styles.createActions}>
        <button className={styles.secondaryAction} onClick={onClose} type="button">Cancel</button>
        <button className={styles.primaryAction} type="submit">{editingRule ? "Update mock rule" : "Create mock rule"}</button>
      </div>
    </form>
  );

  if (isMobile) {
    return (
      <BottomSheetShell
        aria-labelledby="alerts-v2-create-title-mobile"
        closeLabel="Close create alert"
        id="alerts-v2-create-sheet"
        isOpen={isOpen}
        layout="full-scroll"
        onDismiss={onClose}
        openerRef={openerRef}
        overlayLabel="Close create alert"
      >
        <header className={styles.createHeader}>
          <span>LOCAL PRESET</span>
          <h2 id="alerts-v2-create-title-mobile">{editingRule ? "Edit Alert Rule" : "Create Alert"}</h2>
          <p>Configure a deterministic rule preview.</p>
        </header>
        {form}
      </BottomSheetShell>
    );
  }

  if (!isOpen) {
    return null;
  }

  return (
    <div className={styles.desktopDialogRoot}>
      <button aria-label="Close create alert" className={styles.desktopDialogOverlay} onClick={onClose} type="button" />
      <section aria-labelledby="alerts-v2-create-title" aria-modal="true" className={styles.desktopDialog} role="dialog">
        <button aria-label="Close create alert" className={styles.dialogClose} onClick={onClose} type="button">
          <X aria-hidden="true" size={18} />
        </button>
        <header className={styles.createHeader}>
          <span>LOCAL PRESET</span>
          <h2 id="alerts-v2-create-title">{editingRule ? "Edit Alert Rule" : "Create Alert"}</h2>
          <p>Configure a deterministic rule preview.</p>
        </header>
        {form}
      </section>
    </div>
  );
}
