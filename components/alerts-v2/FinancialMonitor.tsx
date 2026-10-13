"use client";

import { TickerCompanyAutocomplete } from "@/components/ui/TickerCompanyAutocomplete";
import { financialTargetSelection, financialTargetSchema, type FinancialTarget } from "@/lib/monitor/financialMonitorTarget";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { FINANCIAL_FIELDS, FINANCIAL_SCOPE, financialConditionText, formatFinancialAmount } from "@/lib/monitor/financialMonitorDisplay";
import { MONITOR_CONDITION_OPERATOR_DISPLAY_LABELS } from "@/lib/monitor/conditionRegistry";
import { validateCanonicalFinancialConditions, type CanonicalFinancialMonitorCondition, type FinancialMonitor } from "@/lib/monitor/financialMonitorPersistence";
import type { FinancialMonitorAlertItem } from "@/lib/monitor/financialMonitorAlertConsumer";
import type { FinancialMonitorEvidence } from "@/lib/monitor/financialMonitorEvidence";
import styles from "./Sc13Monitor.module.css";
import financialStyles from "./FinancialMonitor.module.css";

export function FinancialMonitorBuilder({ authRequired }: { authRequired: boolean }) {
  const [conditions, setConditions] = useState<readonly CanonicalFinancialMonitorCondition[]>([{ key: FINANCIAL_FIELDS[0].key, operator: "gte", value: "", currency: "USD" }]);
  const [confirmed, setConfirmed] = useState(false), [busy, setBusy] = useState(false), [message, setMessage] = useState(""), [created, setCreated] = useState(false);
  const [query, setQuery] = useState("");
  const [target, setTarget] = useState<FinancialTarget | null>(null);
  const [targetMessage, setTargetMessage] = useState("");
  const selectionRequest = useRef<AbortController | null>(null);
  useEffect(() => () => selectionRequest.current?.abort(), []);
  function changeQuery(value: string) {
    selectionRequest.current?.abort(); setQuery(value); setTarget(null); setTargetMessage("");
    setConfirmed(false); setCreated(false); setMessage("");
  }
  async function selectTicker(ticker: string) {
    changeQuery(ticker);
    const controller = new AbortController(); selectionRequest.current = controller;
    setTargetMessage("Confirming company with SEC...");
    try {
      const response = await fetch(`/api/monitors/financial/target?ticker=${encodeURIComponent(ticker)}`, { cache: "no-store", signal: controller.signal });
      const data = await response.json();
      const parsed = financialTargetSchema.safeParse(data.target);
      if (!response.ok || data.status !== "available" || !parsed.success) throw new Error("Company identity could not be confirmed. Select a confirmed company to continue.");
      if (!controller.signal.aborted) { setTarget(parsed.data); setTargetMessage(""); }
    } catch (error) { if (!controller.signal.aborted) setTargetMessage(error instanceof Error ? error.message : "Company identity unavailable."); }
  }
  const saving = useRef(false);
  const validation = validateCanonicalFinancialConditions(conditions);
  function change(next: readonly CanonicalFinancialMonitorCondition[]) { setConditions(next); setConfirmed(false); setCreated(false); setMessage(""); }
  async function save() {
    if (authRequired || !target || !confirmed || !validation.ok || saving.current || created) return;
    saving.current = true; setBusy(true); setMessage("");
    try {
      const r = await fetch("/api/monitors/financial", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ conditions: validation.conditions, target: financialTargetSelection(target) }) });
      const j = await r.json();
      if (!r.ok || !j.data?.monitor) throw new Error(j.message || "Could not save financial monitor.");
      setCreated(true); setMessage("Financial monitor saved. Alerts appear when a supported filing evaluation matches.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not save financial monitor."); }
    finally { saving.current = false; setBusy(false); }
  }
  return <section className={`${styles.panel} ${financialStyles.panel}`} aria-labelledby="financial-builder-title">
    <header><span>10-Q · 10-K · 20-F · 40-F</span><h2 id="financial-builder-title">Periodic financial alert</h2></header>
    <p>{FINANCIAL_SCOPE}</p>
    <TickerCompanyAutocomplete className={financialStyles.companyPicker} label="Financial target company" placeholder="Search ticker or company" value={query} onValueChange={changeQuery} onSelect={r => void selectTicker(r.ticker)} selectedTicker={target?.ticker} autoSelectExact={false} disabled={authRequired || busy || created} />
    {targetMessage ? <p role="status">{targetMessage}</p> : null}
    {target ? <p data-financial-target>{target.ticker} · {target.companyName} · {target.exchange} · SEC CIK {target.issuerCik}<br />Company confirmed {target.confirmedAt}. All share classes of this issuer use the same financial facts.</p> : null}
    <p>Uses verified filing financial facts. Missing, ambiguous or mismatched periods and currencies do not trigger alerts. YoY change is an absolute currency amount, not a percentage.</p>
    <fieldset className={styles.conditions} disabled={authRequired || busy || created}><legend>Financial conditions — all must match</legend>
      {conditions.map((condition, index) => <div className={styles.condition} key={index}>
        <label>Financial metric and period<select value={condition.key} onChange={e => change(conditions.map((c, i) => i === index ? { ...c, key: e.currentTarget.value } : c))}>{FINANCIAL_FIELDS.map(d => <option key={d.key} value={d.key}>{d.display?.label}</option>)}</select></label>
        <label>Comparison<select value={condition.operator} onChange={e => change(conditions.map((c, i) => i === index ? { ...c, operator: e.currentTarget.value as CanonicalFinancialMonitorCondition["operator"] } : c))}>{FINANCIAL_FIELDS.find(d => d.key === condition.key)?.allowedOperators.map(op => <option key={op} value={op}>{MONITOR_CONDITION_OPERATOR_DISPLAY_LABELS[op]}</option>)}</select></label>
        <label>Amount (exact decimal)<input inputMode="decimal" value={condition.value} onChange={e => change(conditions.map((c, i) => i === index ? { ...c, value: e.currentTarget.value } : c))} placeholder="e.g. 10000000" /></label>
        <label>Currency (ISO code)<input maxLength={3} value={condition.currency} onChange={e => change(conditions.map((c, i) => i === index ? { ...c, currency: e.currentTarget.value.toUpperCase() } : c))} /></label>
        <button type="button" disabled={conditions.length === 1} onClick={() => change(conditions.filter((_, i) => i !== index))}>Remove condition</button>
      </div>)}
      <button type="button" onClick={() => change([...conditions, { key: FINANCIAL_FIELDS[0].key, operator: "gte", value: "", currency: "USD" }])}>Add financial condition</button>
    </fieldset>
    {validation.ok ? <div className={styles.review}><strong>Review financial conditions</strong>{target ? <p>Target: {target.ticker} · {target.companyName} · CIK {target.issuerCik}</p> : <p>Select a confirmed company before saving.</p>}<ul>{validation.conditions.map((c, i) => <li key={i}>{financialConditionText(c)}</li>)}</ul></div> : <p>Enter exact decimal amounts without commas and three-letter currency codes.</p>}
    <label className={styles.confirm}><input type="checkbox" checked={confirmed} disabled={authRequired || busy || !target || !validation.ok || created} onChange={e => setConfirmed(e.currentTarget.checked)} /><span>I reviewed the selected company and these financial conditions.</span></label>
    <button type="button" disabled={authRequired || busy || !target || !confirmed || !validation.ok || created} onClick={() => void save()}>{busy ? "Saving…" : created ? "Financial monitor saved" : "Save financial monitor"}</button>
    {authRequired ? <p>Sign in to create a financial monitor.</p> : null}
    {message ? <p role="status">{message}</p> : null}
    {created ? <Link href="/alerts">View financial conditions and alerts</Link> : null}
  </section>;
}

export function FinancialAlertDetails({ alert }: { alert: FinancialMonitorAlertItem }) {
  const e = alert.display.evidence;
  if (!e) return <div className={styles.alert}><strong>Financial monitor matched</strong><span>{alert.accession}</span><span>{alert.display.status === "invalid" ? "Saved financial evidence unavailable" : "Legacy — all supported issuers. Match evidence was not preserved for this alert."}</span></div>;
  return <div className={styles.alert}>
    <strong>{e.companyName ?? "Company unconfirmed"} · {e.ticker ?? "Ticker unconfirmed"}</strong>
    <span>{e.target ? `Selected issuer: ${e.target.selected.ticker} · CIK ${e.target.selected.issuerCik} · Confirmed at match ${e.target.confirmed.confirmedAt}` : "Legacy — all supported issuers"}</span>
    <span>SEC {e.form} · {e.accession} · Filed {e.filedAt}</span>
    {e.matches.map((m, i) => <div key={i}><strong>{m.label}: {formatFinancialAmount(m.actual, m.condition.currency)}</strong><span>Saved condition: {financialConditionText(m.condition)}</span>
      <FinancialObservation title="Current filing fact" observation={m.current} />
      {m.priorYear ? <FinancialObservation title="Prior-year comparison fact" observation={m.priorYear} /> : null}
    </div>)}
    <span>Match-time evidence preserved · Evaluated {e.evaluatedAt}</span>
    <a href={`/filings/${encodeURIComponent(e.eventId)}`}>View filing</a>
  </div>;
}
function FinancialObservation({ title, observation: o }: { title: string; observation: FinancialMonitorEvidence["matches"][number]["current"] }) {
  return <div><p>{title}: {formatFinancialAmount(o.value, o.currency)} · {o.period.kind === "instant" ? `As of ${o.period.instant}` : `${o.period.startDate} to ${o.period.endDate}`}</p>
    {o.filingFacts.map(f => <p key={f.factKey}><a href={f.url} target="_blank" rel="noreferrer">SEC original financial fact</a> · {o.concept} · Context {f.contextRef}</p>)}
  </div>;
}
export function useFinancialManagement() {
  const [state, setState] = useState<{ monitors: readonly FinancialMonitor[]; alerts: readonly FinancialMonitorAlertItem[]; loading: boolean; error: string }>({ monitors: [], alerts: [], loading: true, error: "" });
  useEffect(() => {
    const controller = new AbortController();
    void (async () => { try {
      const responses = await Promise.all([fetch("/api/monitors/financial", { cache: "no-store", signal: controller.signal }), fetch("/api/monitors/financial/alerts", { cache: "no-store", signal: controller.signal })]);
      if (responses.some(r => !r.ok)) throw new Error(responses.some(r => r.status === 401) ? "Sign in to view your financial monitors and alerts." : "Could not load financial monitors and alerts. Please reload.");
      const [m, a] = await Promise.all(responses.map(r => r.json()));
      if (!Array.isArray(m.data?.monitors) || !Array.isArray(a.data?.alerts)) throw new Error("Invalid financial monitor response.");
      if (!controller.signal.aborted) setState({ monitors: m.data.monitors, alerts: a.data.alerts, loading: false, error: "" });
    } catch (error) { if (!controller.signal.aborted) setState({ monitors: [], alerts: [], loading: false, error: error instanceof Error ? error.message : "Financial monitor read failed." }); } })();
    return () => controller.abort();
  }, []);
  return state;
}
