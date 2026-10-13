"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { TickerCompanyAutocomplete } from "@/components/ui/TickerCompanyAutocomplete";
import { financialTargetSchema, financialTargetSelection, type FinancialTarget } from "@/lib/monitor/financialMonitorTarget";
import { REPORTED_HOLDINGS_SCOPE, reportedHoldingsSettingsSchema, reportedHoldingsConditionText, type ReportedHoldingsMonitor, type ReportedHoldingsSettings } from "@/lib/monitor/reportedHoldings";
import type { ReportedHoldingsAlert } from "@/lib/monitor/reportedHoldingsEvidence";
import styles from "./Sc13Monitor.module.css";
import pickerStyles from "./FinancialMonitor.module.css";

export function ReportedHoldingsMonitorBuilder({ authRequired }: { authRequired: boolean }) {
  const [query, setQuery] = useState("");
  const [target, setTarget] = useState<FinancialTarget | null>(null);
  const [settings, setSettings] = useState<ReportedHoldingsSettings>({ form: "3", securityTitle: "", operator: "gte", amount: "" });
  const [confirmed, setConfirmed] = useState(false), [busy, setBusy] = useState(false), [created, setCreated] = useState(false);
  const [message, setMessage] = useState(""), [targetMessage, setTargetMessage] = useState("");
  const selectionRequest = useRef<AbortController | null>(null), saving = useRef(false);
  useEffect(() => () => selectionRequest.current?.abort(), []);
  const parsed = reportedHoldingsSettingsSchema.safeParse(settings);
  function changeQuery(value: string) {
    selectionRequest.current?.abort(); setQuery(value); setTarget(null); setTargetMessage(""); setConfirmed(false); setCreated(false); setMessage("");
  }
  async function selectTicker(ticker: string) {
    changeQuery(ticker);
    const controller = new AbortController(); selectionRequest.current = controller;
    setTargetMessage("Confirming company with SEC...");
    try {
      const r = await fetch(`/api/monitors/reported-holdings/target?ticker=${encodeURIComponent(ticker)}`, { cache: "no-store", signal: controller.signal });
      const j = await r.json(), p = financialTargetSchema.safeParse(j.target);
      if (!r.ok || j.status !== "available" || !p.success) throw new Error("Company identity could not be confirmed. Select a confirmed company to continue.");
      if (!controller.signal.aborted) { setTarget(p.data); setTargetMessage(""); }
    } catch (e) { if (!controller.signal.aborted) setTargetMessage(e instanceof Error ? e.message : "Company identity unavailable."); }
  }
  function change(patch: Partial<ReportedHoldingsSettings>) { setSettings(s => ({ ...s, ...patch })); setConfirmed(false); setMessage(""); }
  async function save() {
    if (authRequired || !target || !parsed.success || !confirmed || saving.current || created) return;
    saving.current = true; setBusy(true); setMessage("");
    try {
      const r = await fetch("/api/monitors/reported-holdings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ target: financialTargetSelection(target), settings: parsed.data }) });
      const j = await r.json();
      if (!r.ok || !j.data?.monitor) throw new Error(j.message || "Could not save reported holding monitor.");
      setCreated(true); setMessage("Reported holding monitor saved. Matching future filings appear in Alerts.");
    } catch (e) { setMessage(e instanceof Error ? e.message : "Could not save reported holding monitor."); }
    finally { saving.current = false; setBusy(false); }
  }
  return <section className={`${styles.panel} ${pickerStyles.panel}`} aria-labelledby="reported-holdings-builder-title">
    <header><span>FORM 3 · FORM 5</span><h2 id="reported-holdings-builder-title">Reported holding alert</h2></header>
    <p>{REPORTED_HOLDINGS_SCOPE}</p>
    <TickerCompanyAutocomplete className={pickerStyles.companyPicker} label="Reported holding target company" placeholder="Search ticker or company" value={query} onValueChange={changeQuery} onSelect={r => void selectTicker(r.ticker)} selectedTicker={target?.ticker} autoSelectExact={false} disabled={authRequired || busy || created} />
    {targetMessage ? <p role="status">{targetMessage}</p> : null}
    {target ? <p data-reported-holding-target>{target.ticker} · {target.companyName} · {target.exchange} · SEC CIK {target.issuerCik}</p> : null}
    <fieldset className={styles.conditions} disabled={authRequired || busy || created}><legend>Non-derivative holding conditions — same row</legend>
      <div className={styles.condition}>
        <label>Holding filing form<select value={settings.form} onChange={e => change({ form: e.currentTarget.value as "3" | "5" })}><option value="3">Form 3</option><option value="5">Form 5</option></select></label>
        <label>Exact security title<input value={settings.securityTitle} maxLength={200} onChange={e => change({ securityTitle: e.currentTarget.value })} placeholder="e.g. Common Stock" /></label>
        <label>Reported shares comparison<select value={settings.operator} onChange={e => change({ operator: e.currentTarget.value as ReportedHoldingsSettings["operator"] })}><option value="eq">Equal to</option><option value="gte">At least</option><option value="lte">At most</option></select></label>
        <label>Reported shares (exact decimal)<input inputMode="decimal" value={settings.amount} onChange={e => change({ amount: e.currentTarget.value })} placeholder="e.g. 1000" /></label>
      </div>
    </fieldset>
    <p>Only filings accepted after activation are eligible. Missing or footnote-only amounts never become zero. Form 3/A and 5/A remain stored for history and manual review.</p>
    {parsed.success ? <div className={styles.review}><strong>Review reported holding conditions</strong><p>{target ? `${target.ticker} · ${target.companyName} · CIK ${target.issuerCik}` : "Select a confirmed company before saving."}</p><p>{reportedHoldingsConditionText(parsed.data)}</p></div> : <p>Enter an exact security title and a nonnegative decimal without commas.</p>}
    <label className={styles.confirm}><input type="checkbox" checked={confirmed} disabled={authRequired || busy || !target || !parsed.success || created} onChange={e => setConfirmed(e.currentTarget.checked)} /><span>I reviewed the selected company and these reported holding conditions.</span></label>
    <button type="button" disabled={authRequired || busy || !target || !parsed.success || !confirmed || created} onClick={() => void save()}>{busy ? "Saving…" : created ? "Reported holding monitor saved" : "Save reported holding monitor"}</button>
    {authRequired ? <p>Sign in to create a reported holding monitor.</p> : null}
    {message ? <p role="status">{message}</p> : null}
    {created ? <Link href="/alerts">View reported holding conditions and alerts</Link> : null}
  </section>;
}

export function useReportedHoldingsManagement() {
  const [state, setState] = useState<{ monitors: ReportedHoldingsMonitor[]; alerts: ReportedHoldingsAlert[]; loading: boolean; error: string }>({ monitors: [], alerts: [], loading: true, error: "" });
  useEffect(() => {
    const controller = new AbortController();
    void (async () => { try {
      const r = await fetch("/api/monitors/reported-holdings", { cache: "no-store", signal: controller.signal });
      if (!r.ok) throw new Error(r.status === 401 ? "Sign in to view reported holding monitors and alerts." : "Could not load reported holding monitors and alerts. Please reload.");
      const j = await r.json();
      if (!Array.isArray(j.data?.monitors) || !Array.isArray(j.data?.alerts)) throw new Error("Invalid reported holding response.");
      if (!controller.signal.aborted) setState({ monitors: j.data.monitors, alerts: j.data.alerts, loading: false, error: j.data.invalidIds?.length ? "Some saved reported holding conditions are unavailable." : "" });
    } catch (e) { if (!controller.signal.aborted) setState({ monitors: [], alerts: [], loading: false, error: e instanceof Error ? e.message : "Reported holding read failed." }); } })();
    return () => controller.abort();
  }, []);
  return state;
}
