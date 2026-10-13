"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { StockSc13OwnershipSnapshot } from "@/lib/watchlist/stockSc13Ownership";
import { validateCanonicalSc13Conditions, type CanonicalSc13MonitorCondition, type Sc13Monitor, type Sc13MonitorTarget } from "@/lib/monitor/sc13MonitorPersistence";
import { SC13_FIELDS, SC13_OPERATORS, SC13_MEANING, sc13TargetChoices, sc13ConditionText, safeSc13SourceUrl, type Sc13TargetChoice, type Sc13DisplayAlert } from "@/lib/monitor/sc13MonitorDisplay";
import styles from "./Sc13Monitor.module.css";
import { sc13ReporterIdentityLinks } from "@/lib/sec-sc13-xml/reporterIdentityDisplay";

const INITIAL_CONDITIONS: readonly CanonicalSc13MonitorCondition[] = [{ key: "sc13.percent_of_class", operator: "gte", value: "" }];

export function Sc13MonitorBuilder({ authRequired }: Readonly<{ authRequired: boolean }>) {
  const [lookupMode, setLookupMode] = useState<"ticker" | "accession">("ticker");
  const [query, setQuery] = useState("");
  const [choices, setChoices] = useState<readonly Sc13TargetChoice[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [conditions, setConditions] = useState(INITIAL_CONDITIONS);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState<"lookup" | "save" | null>(null);
  const [message, setMessage] = useState("");
  const [created, setCreated] = useState<Sc13Monitor | null>(null);
  const lookupRequest = useRef<AbortController | null>(null);
  const saveInFlight = useRef(false);
  const selected = choices.find((choice) => choice.id === selectedId);
  const validConditions = validateCanonicalSc13Conditions(conditions).ok;
  useEffect(() => () => lookupRequest.current?.abort(), []);

  function invalidateLookup() {
    lookupRequest.current?.abort();
    lookupRequest.current = null;
    setChoices([]); setSelectedId(""); setConfirmed(false); setCreated(null); setMessage(""); setBusy(null);
  }
  function updateConditions(next: readonly CanonicalSc13MonitorCondition[]) {
    setConditions(next); setConfirmed(false); setCreated(null); setMessage("");
  }
  async function lookup(event: React.FormEvent) {
    event.preventDefault();
    invalidateLookup();
    const controller = new AbortController(); lookupRequest.current = controller;
    setBusy("lookup");
    try {
      const url = lookupMode === "ticker" ? `/api/market/sec/ownership?symbol=${encodeURIComponent(query.trim())}` : `/api/monitors/sc13/targets?accession=${encodeURIComponent(query.trim())}`;
      const response = await fetch(url, { cache: "no-store", signal: controller.signal });
      const payload = await response.json();
      if (controller.signal.aborted) return;
      if (!response.ok || !payload.data) throw new Error(payload.message || payload.error || "Could not read stored ownership history.");
      const snapshot = payload.data as StockSc13OwnershipSnapshot;
      const next = sc13TargetChoices(snapshot);
      setChoices(next);
      setMessage(next.length ? "Select the exact reporting person and security to monitor." : snapshot.status === "unavailable" ? "Stored ownership history is unavailable or incomplete. No target can be selected." : "No unambiguous reporting-person and security target is available in stored history.");
    } catch (error) {
      if (!controller.signal.aborted) setMessage(error instanceof Error ? error.message : "Could not read stored ownership history.");
    } finally { if (!controller.signal.aborted) setBusy(null); }
  }
  async function save() {
    if (!selected || !confirmed || !validConditions || busy || authRequired || created || saveInFlight.current) return;
    saveInFlight.current = true;
    setBusy("save"); setMessage("");
    try {
      const response = await fetch("/api/monitors/sc13", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ target: selected.target, conditions }) });
      const payload = await response.json();
      if (!response.ok || !payload.data?.monitor) throw new Error(payload.message || "Could not save this Schedule 13 monitor.");
      setCreated(payload.data.monitor); setMessage("Schedule 13 monitor saved. Future stored filing evaluations can generate an internal alert when all conditions match.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not save this monitor."); }
    finally { saveInFlight.current = false; setBusy(null); }
  }

  return <section className={styles.panel} aria-labelledby="sc13-builder-title">
    <header><span>Schedule 13D / 13G</span><h2 id="sc13-builder-title">Schedule 13 ownership alert</h2></header>
    <p>{SC13_MEANING}</p>
    <p>Specific-person alerts: CIK-verified shareholders only.</p>
    <form onSubmit={lookup} className={styles.lookup}>
      <label>Find stored filings by<select disabled={busy === "save" || authRequired} value={lookupMode} onChange={(event) => { invalidateLookup(); setLookupMode(event.currentTarget.value as "ticker" | "accession"); setQuery(""); }}><option value="ticker">Stock ticker</option><option value="accession">SEC filing accession</option></select></label>
      <label>{lookupMode === "ticker" ? "Stock ticker" : "SEC filing accession"}<input disabled={busy === "save" || authRequired} required value={query} onChange={(event) => { invalidateLookup(); setQuery(event.currentTarget.value); }} placeholder={lookupMode === "ticker" ? "e.g. AAPL" : "0000000000-00-000000"} autoCapitalize="characters" /></label>
      <button disabled={Boolean(busy) || authRequired || !query.trim()} type="submit">{busy === "lookup" ? "Finding…" : "Find stored targets"}</button>
    </form>
    <p className={styles.hint}>If a ticker has no stored issuer link, use the accession number from a stored SEC filing.</p>
    {choices.length > 0 ? <label className={styles.targetPicker}>Reporting person and security<select disabled={Boolean(busy)} value={selectedId} onChange={(event) => { setSelectedId(event.currentTarget.value); setConfirmed(false); setCreated(null); }}><option value="">Choose a target — required</option>{choices.map((choice) => <option key={choice.id} value={choice.id}>{choice.name || "Unnamed reporting person"} · CIK {choice.target.reportingPersonCik} · {choice.target.securityClass} · {choice.target.cusips.join(", ")}</option>)}</select></label> : null}
    {selected ? <>
      <Sc13TargetSummary target={selected.target} name={selected.name} issuerName={selected.issuerName} />
      {selected.identitySupplemented ? <p>Reporter CIK verified from this SEC filing’s header and index; absent from cover XML. {sc13ReporterIdentityLinks(selected.identityProvenance).map((link) => <a key={link.url} href={link.url} target="_blank" rel="noreferrer">{link.label} </a>)}</p> : null}
      <fieldset className={styles.conditions} disabled={busy === "save"}><legend>Conditions — all must match</legend>
        {conditions.map((condition, index) => <div className={styles.condition} key={condition.key}>
          <label>Reported field<select value={condition.key} onChange={(event) => updateConditions(conditions.map((item, i) => i === index ? { ...item, key: event.currentTarget.value, value: "" } : item))}>{SC13_FIELDS.filter((field) => field.key === condition.key || !conditions.some((item) => item.key === field.key)).map((field) => <option key={field.key} value={field.key}>{field.label}</option>)}</select></label>
          <label>Comparison<select value={condition.operator} onChange={(event) => updateConditions(conditions.map((item, i) => i === index ? { ...item, operator: event.currentTarget.value as CanonicalSc13MonitorCondition["operator"] } : item))}>{SC13_OPERATORS.map((operator) => <option key={operator.value} value={operator.value}>{operator.label}</option>)}</select></label>
          <label>{condition.key === "sc13.percent_of_class" ? "Threshold (%)" : "Threshold (shares)"}<input inputMode="decimal" value={condition.value} onChange={(event) => updateConditions(conditions.map((item, i) => i === index ? { ...item, value: event.currentTarget.value } : item))} placeholder={condition.key === "sc13.percent_of_class" ? "0–100" : "0 or more"} /></label>
          <button type="button" disabled={conditions.length === 1} aria-label={`Remove ${SC13_FIELDS.find((field) => field.key === condition.key)?.label}`} onClick={() => updateConditions(conditions.filter((_, i) => i !== index))}>Remove</button>
        </div>)}
        <button type="button" disabled={conditions.length === SC13_FIELDS.length} onClick={() => { const field = SC13_FIELDS.find((field) => !conditions.some((condition) => condition.key === field.key)); if (field) updateConditions([...conditions, { key: field.key, operator: "gte", value: "" }]); }}>Add condition</button>
      </fieldset>
      {!validConditions ? <p>Enter a non-negative decimal for every threshold. Percent must be between 0 and 100.</p> : <div className={styles.review}><strong>Review conditions</strong><ul>{conditions.map((condition) => <li key={condition.key}>{sc13ConditionText(condition)}</li>)}</ul></div>}
      <label className={styles.confirm}><input type="checkbox" checked={confirmed} disabled={Boolean(busy) || !validConditions} onChange={(event) => setConfirmed(event.currentTarget.checked)} /><span>I confirm this issuer, reporting person, security class, CUSIP and all conditions above.</span></label>
      <button type="button" disabled={Boolean(busy) || authRequired || !confirmed || !validConditions || Boolean(created)} onClick={() => void save()}>{busy === "save" ? "Saving…" : created ? "Schedule 13 monitor saved" : "Save Schedule 13 monitor"}</button>
    </> : null}
    {authRequired ? <p>Sign in to create a Schedule 13 monitor.</p> : null}
    {message ? <p role="status">{message}</p> : null}
    {created ? <div className={styles.review}><strong>{created.isActive ? "Active" : "Paused"}</strong><Sc13TargetSummary target={created.target} name={selected?.name} issuerName={selected?.issuerName} /><Link href="/alerts">View saved conditions and alerts</Link></div> : null}
  </section>;
}

export function Sc13TargetSummary({ target, name, issuerName }: Readonly<{ target: Sc13MonitorTarget; name?: string; issuerName?: string | null }>) {
  return <div className={styles.target}>{issuerName ? <strong>{issuerName}</strong> : null}<strong>{name || "Schedule 13 target"}</strong><span>Issuer CIK {target.issuerCik} · Reporting person CIK {target.reportingPersonCik}</span><span>{target.securityClass} · CUSIP {target.cusips.join(", ")}</span></div>;
}

export function Sc13AlertDetails({ alert }: Readonly<{ alert: Sc13DisplayAlert }>) {
  return <div className={styles.alert}>
    <strong>Schedule 13 ownership conditions matched</strong>
    <Sc13TargetSummary target={alert.evidence} name={alert.evidence.reportingPersonNameRaw} issuerName={alert.sources[0]?.issuerName} />
    {alert.evidence.reportingPersonIdentity ? <p>Reporter CIK verified from this SEC filing’s header and index; absent from cover XML. Identity evidence retained with this alert. {sc13ReporterIdentityLinks(alert.evidence.reportingPersonIdentity).map((link) => <a key={link.url} href={link.url} target="_blank" rel="noreferrer">{link.label} </a>)}</p> : null}
    <p>{SC13_MEANING}</p>
    <ul>{alert.evidence.conditions.map((condition) => <li key={condition.key}><strong>Reported: {condition.valueRaw}{condition.key === "sc13.percent_of_class" ? "%" : " shares"}</strong><span>{sc13ConditionText(condition)}</span><span>Source accession: {condition.sourceAccessionNumber}</span></li>)}</ul>
    <span>Root accession: {alert.rootAccessionNumber}</span><span>Latest stored accession at match: {alert.headAccessionNumber}</span>
    <span>Alert created: {new Date(alert.createdAt).toLocaleString("en-US")}</span>
    {alert.sources.length ? alert.sources.map((source) => safeSc13SourceUrl(source.sourceUrl, source.accessionNumber) ? <div key={source.accessionNumber}><span>Reported event date: {source.eventDate}{source.filedAt ? ` · Filed: ${source.filedAt}` : ""}</span><a href={source.sourceUrl} target="_blank" rel="noreferrer">SEC {source.formType} · {source.accessionNumber}</a></div> : null) : <span>SEC source link is currently unavailable. Saved match evidence is retained above.</span>}
  </div>;
}

export function useSc13Management() {
  const [state, setState] = useState<{ monitors: readonly Sc13Monitor[]; alerts: readonly Sc13DisplayAlert[]; loading: boolean; error: string }>({ monitors: [], alerts: [], loading: true, error: "" });
  useEffect(() => {
    const controller = new AbortController();
    async function read() {
      try {
        const responses = await Promise.all([fetch("/api/monitors/sc13", { cache: "no-store", signal: controller.signal }), fetch("/api/monitors/sc13/alerts", { cache: "no-store", signal: controller.signal })]);
        if (responses.some((response) => !response.ok)) throw new Error(responses.some((response) => response.status === 401) ? "Sign in to view your Schedule 13 monitors and alerts." : "Could not load Schedule 13 monitors and alerts. Please reload to try again.");
        const [monitors, alerts] = await Promise.all(responses.map((response) => response.json()));
        if (!Array.isArray(monitors.data?.monitors) || !Array.isArray(alerts.data?.alerts)) throw new Error("Could not read Schedule 13 monitors and alerts.");
        if (!controller.signal.aborted) setState({ monitors: monitors.data.monitors, alerts: [...new Map((alerts.data.alerts as Sc13DisplayAlert[]).map((alert) => [alert.id, alert])).values()], loading: false, error: "" });
      } catch (error) { if (!controller.signal.aborted) setState({ monitors: [], alerts: [], loading: false, error: error instanceof Error ? error.message : "Could not load Schedule 13 monitors and alerts." }); }
    }
    void read(); return () => controller.abort();
  }, []);
  return state;
}
